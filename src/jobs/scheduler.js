/**
 * Cron Scheduler
 * Schedules periodic crawl jobs using node-cron
 */
const cron = require("node-cron");
const { addCrawlJob, cleanQueues } = require("./queue");
const CrawlerSchedule = require("../models/CrawlerSchedule");
const logger = require("../utils/logger");

const ENV_CRON_SCHEDULE = normalizeSchedule(process.env.CRON_SCHEDULE);
const DEFAULT_CRON_SCHEDULE = ENV_CRON_SCHEDULE || "*/5 * * * *";

let scheduledTask = null;
let cleanupTask = null;

const runtimeState = {
  cron_schedule: DEFAULT_CRON_SCHEDULE,
  is_enabled: true,
  is_running: false,
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
 * Start scheduler based on persisted config
 */
async function startScheduler() {
  const config = await loadScheduleConfig();
  runtimeState.cron_schedule = config.cron_schedule;
  runtimeState.is_enabled = config.is_enabled;
  runtimeState.updated_by = config.updated_by;
  runtimeState.updated_at = config.updated_at;

  ensureCleanupSchedule();

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
};
