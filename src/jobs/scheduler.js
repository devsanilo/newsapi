/**
 * Cron Scheduler
 * Schedules periodic crawl jobs using node-cron
 */
const cron = require("node-cron");
const { addCrawlJob, cleanQueues } = require("./queue");
const CrawlerSchedule = require("../models/CrawlerSchedule");
const { purgeDueRequests } = require("../services/accountDeletionService");
const rewriteService = require("../services/rewriteService");
const { getRewriteSettings } = require("../services/rewriteSettings");
const logger = require("../utils/logger");

const ENV_CRON_SCHEDULE = normalizeSchedule(process.env.CRON_SCHEDULE);
const DEFAULT_CRON_SCHEDULE = ENV_CRON_SCHEDULE || "*/5 * * * *";

let scheduledTask = null;
let cleanupTask = null;
let deletionPurgeTask = null;
let rewriteTask = null;

const runtimeState = {
  cron_schedule: DEFAULT_CRON_SCHEDULE,
  is_enabled: true,
  is_running: false,
  is_rewriting: false,
  last_started_at: null,
  last_finished_at: null,
  last_result: null,
  last_error: null,
  updated_by: "system",
  updated_at: null,
};

function normalizeSchedule(value) {
  return (value || "").toString().trim();
}

async function ensureScheduleRecord() {
  let record = await CrawlerSchedule.findByPk(1);
  if (!record) {
    record = await CrawlerSchedule.create({
      id: 1,
      cron_schedule: DEFAULT_CRON_SCHEDULE,
      is_enabled: true,
      updated_by: "system",
      updated_at: new Date(),
    });
  }
  return record;
}

async function loadScheduleConfig() {
  const record = await ensureScheduleRecord();
  const persisted = normalizeSchedule(record.cron_schedule);
  const chosen = ENV_CRON_SCHEDULE || persisted || DEFAULT_CRON_SCHEDULE;
  const safeSchedule = cron.validate(chosen) ? chosen : DEFAULT_CRON_SCHEDULE;

  if (!cron.validate(chosen)) {
    logger.warn(
      `Invalid cron schedule "${chosen}". Falling back to default "${DEFAULT_CRON_SCHEDULE}".`,
    );
    await CrawlerSchedule.upsert({
      id: 1,
      cron_schedule: DEFAULT_CRON_SCHEDULE,
      is_enabled: Boolean(record.is_enabled),
      updated_by: "system-repair",
      updated_at: new Date(),
    });
  }

  return {
    cron_schedule: safeSchedule,
    is_enabled: Boolean(record.is_enabled),
    updated_by: record.updated_by || "system",
    updated_at: record.updated_at || null,
  };
}

async function persistScheduleConfig(partial = {}, updatedBy = "system") {
  const current = await loadScheduleConfig();
  const next = {
    cron_schedule:
      partial.cron_schedule !== undefined
        ? normalizeSchedule(partial.cron_schedule)
        : current.cron_schedule,
    is_enabled:
      partial.is_enabled !== undefined
        ? Boolean(partial.is_enabled)
        : current.is_enabled,
    updated_by: updatedBy || current.updated_by || "system",
    updated_at: new Date(),
  };

  if (!cron.validate(next.cron_schedule)) {
    throw new Error(`Invalid cron schedule: "${next.cron_schedule}"`);
  }

  await CrawlerSchedule.upsert({
    id: 1,
    ...next,
  });

  return next;
}

function stopMainScheduleOnly() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    logger.info("Crawl scheduler stopped");
  }
}

function ensureCleanupSchedule() {
  if (cleanupTask) return;

  cleanupTask = cron.schedule("0 3 * * *", async () => {
    logger.info("Cron: Running daily cleanup...");
    try {
      await cleanQueues();
      logger.info("Cron: Daily cleanup completed");
    } catch (error) {
      logger.error(`Cron: Cleanup failed: ${error.message}`);
    }
  });
  logger.info("Cleanup scheduled daily at 3:00 AM");
}

/**
 * Erase accounts whose retention window has elapsed.
 *
 * This is what makes the published "erased within N days" promise true without
 * anyone remembering to act. It runs on the same node-cron instance as the rest
 * of the scheduler, so it only exists in whichever process calls
 * `startScheduler()` — the scheduler/worker, not every web replica.
 */
function ensureDeletionPurgeSchedule() {
  if (deletionPurgeTask) return;

  // Half past the hour rather than on it, so this does not run alongside the
  // queue cleanup above — that one is Redis-bound, this one is DB-bound.
  deletionPurgeTask = cron.schedule("30 3 * * *", async () => {
    logger.info("Cron: Purging accounts past their erasure window...");
    try {
      const result = await purgeDueRequests();
      logger.info(
        `Cron: Erasure purge complete — scanned ${result.scanned}, erased ${result.erased}, failed ${result.failed}`,
      );
    } catch (error) {
      logger.error(`Cron: Erasure purge failed: ${error.message}`);
    }
  });
  logger.info("Account erasure purge scheduled daily at 3:30 AM");
}

function startMainSchedule(schedule) {
  stopMainScheduleOnly();

  scheduledTask = cron.schedule(schedule, async () => {
    if (runtimeState.is_running) {
      logger.warn("Cron: Previous crawl still running, skipping this tick");
      return;
    }

    logger.info("Cron: Starting scheduled crawl...");
    runtimeState.is_running = true;
    runtimeState.last_started_at = new Date().toISOString();
    runtimeState.last_error = null;

    try {
      await addCrawlJob({
        triggeredBy: "cron",
        timestamp: new Date().toISOString(),
      });
      runtimeState.last_result = { enqueued: true };
      runtimeState.last_finished_at = new Date().toISOString();
      logger.info("Cron: Scheduled crawl enqueued to queue");
    } catch (error) {
      runtimeState.last_error = error.message;
      runtimeState.last_finished_at = new Date().toISOString();
      logger.error(`Cron: Failed to enqueue crawl: ${error.message}`);
    } finally {
      runtimeState.is_running = false;
    }
  });

  logger.info(`Scheduler started with schedule: ${schedule}`);
}

/**
 * Process one batch of aggregated rows through the AI rewrite pipeline.
 *
 * Sequential by design: each article is a paid API call plus a source fetch, so
 * a wide fan-out would burn quota on rate limits before producing anything.
 * Rows are claimed atomically (FOR UPDATE SKIP LOCKED), so it is safe for more
 * than one process to run this.
 */
async function runRewriteBatch({ limit, autoPublish } = {}) {
  const settings = await getRewriteSettings();
  const batchSize = Number(limit) || settings.batchSize;
  // Defaults to the stored setting, so the admin switch governs scheduled runs.
  // An explicit argument is used by the "run now" button.
  const shouldPublish =
    autoPublish === undefined ? settings.autoPublish : Boolean(autoPublish);

  // Owned here rather than by the cron handler, because the admin "run now"
  // button calls this directly. Leaving it to the caller meant a manual run was
  // invisible: concurrent manual batches were allowed, and the UI never showed
  // that one was in progress.
  if (runtimeState.is_rewriting) {
    return {
      claimed: 0,
      ok: 0,
      failed: 0,
      published: 0,
      cost_usd: 0,
      skipped: "already_running",
    };
  }
  runtimeState.is_rewriting = true;

  try {
    return await processRewriteBatch({ batchSize, shouldPublish });
  } finally {
    runtimeState.is_rewriting = false;
  }
}

/** The body of a batch, split out so the running flag is always cleared. */
async function processRewriteBatch({ batchSize, shouldPublish }) {
  const claimed = await rewriteService.claimBatch({
    limit: batchSize,
    order: process.env.REWRITE_ORDER || "recent",
  });

  if (claimed.length === 0) {
    return { claimed: 0, ok: 0, failed: 0, published: 0, cost_usd: 0 };
  }

  let ok = 0;
  let failed = 0;
  let published = 0;
  let cost = 0;
  let environmentError = false;

  for (const row of claimed) {
    const result = await rewriteService.rewriteRow(row);
    if (result.ok) {
      ok += 1;
      cost += Number(result.meta?.cost_usd || 0);

      if (shouldPublish) {
        // The guard rails have already passed at this point, so this is the
        // only quality check standing between the model and the live site.
        const applied = await rewriteService.applyStaged(row.id, {
          appliedBy: "auto-publish",
        });
        if (applied.ok) {
          published += 1;
        } else {
          logger.warn(
            `Cron: rewrite for ${row.id} staged but not published: ${applied.reason}`,
          );
        }
      }
    } else {
      failed += 1;
      // Once the environment is broken (no key, no scraper) every remaining
      // row would fail the same way, so stop rather than churn the queue.
      if (result.reason === "environment_error") {
        environmentError = true;
        logger.error(
          "Cron: AI rewrite aborted early — environment error. Fix the API key or scraper.",
        );
        break;
      }
    }
  }

  return {
    claimed: claimed.length,
    ok,
    failed,
    published,
    cost_usd: Number(cost.toFixed(6)),
    environmentError,
  };
}

/**
 * AI rewrite batch.
 *
 * The cron is ALWAYS scheduled; whether each tick actually does anything is
 * decided by the stored setting, read on every run. Scheduling only when the
 * env var was set meant flipping the switch needed a redeploy, which defeats the
 * point of having one. Reading one row every interval costs nothing.
 *
 * Both switches default to off — one spends money, the other publishes
 * unreviewed AI content to the live site.
 */
function ensureRewriteSchedule() {
  if (rewriteTask) return;

  const schedule = process.env.REWRITE_CRON || "*/10 * * * *";
  if (!cron.validate(schedule)) {
    logger.error(
      `Invalid REWRITE_CRON "${schedule}" — rewrite schedule not started.`,
    );
    return;
  }

  rewriteTask = cron.schedule(schedule, async () => {
    if (runtimeState.is_rewriting) {
      logger.warn("Cron: Previous AI rewrite batch still running, skipping tick");
      return;
    }

    let settings;
    try {
      settings = await getRewriteSettings();
    } catch (error) {
      logger.error(`Cron: could not read rewrite settings: ${error.message}`);
      return;
    }

    if (!settings.enabled) {
      logger.debug("Cron: AI rewrite is switched off — skipping tick");
      return;
    }

    try {
      const result = await runRewriteBatch({
        limit: settings.batchSize,
        autoPublish: settings.autoPublish,
      });
      if (result.claimed > 0) {
        logger.info(
          `Cron: AI rewrite — claimed ${result.claimed}, staged ${result.ok}, ` +
            `published ${result.published}, failed ${result.failed}, cost $${result.cost_usd}` +
            `${settings.autoPublish ? " [AUTO-PUBLISH]" : ""}`,
        );
      }
    } catch (error) {
      logger.error(`Cron: AI rewrite batch failed: ${error.message}`);
    }
  });

  logger.info(
    `AI rewrite scheduled with "${schedule}" (runs only when enabled in admin settings)`,
  );
}

/**
 * Start scheduler based on persisted config
 */
async function startScheduler() {
  const config = await loadScheduleConfig();
  runtimeState.cron_schedule = config.cron_schedule;
  runtimeState.is_enabled = config.is_enabled;
  runtimeState.updated_by = config.updated_by;
  runtimeState.updated_at = config.updated_at;

  ensureCleanupSchedule();
  ensureDeletionPurgeSchedule();
  ensureRewriteSchedule();

  if (runtimeState.is_enabled) {
    startMainSchedule(runtimeState.cron_schedule);
  } else {
    stopMainScheduleOnly();
    logger.info(
      "Scheduler is disabled in config. Skipping crawl schedule start.",
    );
  }
}

/**
 * Stop all schedulers (used for process shutdown)
 */
function stopScheduler() {
  stopMainScheduleOnly();
  if (cleanupTask) {
    cleanupTask.stop();
    cleanupTask = null;
    logger.info("Cleanup scheduler stopped");
  }
  if (deletionPurgeTask) {
    deletionPurgeTask.stop();
    deletionPurgeTask = null;
    logger.info("Erasure purge scheduler stopped");
  }
  if (rewriteTask) {
    rewriteTask.stop();
    rewriteTask = null;
    logger.info("AI rewrite scheduler stopped");
  }
}

/**
 * Trigger an immediate crawl (outside of schedule)
 */
async function triggerImmediateCrawl() {
  logger.info("Triggering immediate crawl...");
  await addCrawlJob({
    triggeredBy: "manual",
    timestamp: new Date().toISOString(),
  });
  return { enqueued: true };
}

/**
 * Get persisted + runtime scheduler state
 */
async function getSchedulerState() {
  const config = await loadScheduleConfig();
  return {
    ...runtimeState,
    cron_schedule: config.cron_schedule,
    is_enabled: config.is_enabled,
    updated_by: config.updated_by,
    updated_at: config.updated_at,
    has_main_task: Boolean(scheduledTask),
    has_cleanup_task: Boolean(cleanupTask),
    has_deletion_purge_task: Boolean(deletionPurgeTask),
    rewrite_enabled:
      String(process.env.REWRITE_ENABLED || "false").toLowerCase() === "true",
    has_rewrite_task: Boolean(rewriteTask),
  };
}

/**
 * Update scheduler configuration and apply immediately
 */
async function updateSchedulerConfig({
  cron_schedule,
  is_enabled,
  updated_by,
}) {
  const config = await persistScheduleConfig(
    { cron_schedule, is_enabled },
    updated_by || "admin",
  );

  runtimeState.cron_schedule = config.cron_schedule;
  runtimeState.is_enabled = config.is_enabled;
  runtimeState.updated_by = config.updated_by;
  runtimeState.updated_at = config.updated_at.toISOString();

  ensureCleanupSchedule();
  ensureDeletionPurgeSchedule();
  ensureRewriteSchedule();
  if (runtimeState.is_enabled) {
    startMainSchedule(runtimeState.cron_schedule);
  } else {
    stopMainScheduleOnly();
  }

  return getSchedulerState();
}

module.exports = {
  startScheduler,
  stopScheduler,
  triggerImmediateCrawl,
  getSchedulerState,
  updateSchedulerConfig,
  runRewriteBatch,
  // Read by the admin queue so the UI can show whether a batch is in flight.
  isRewriteRunning: () => runtimeState.is_rewriting,
};
