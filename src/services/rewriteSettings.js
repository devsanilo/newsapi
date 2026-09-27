/**
 * Rewrite pipeline settings.
 *
 * Resolved as: stored Setting -> environment -> hard default, matching how SMTP
 * is configured in this codebase. The DB layer is what makes the pipeline
 * switchable from the admin UI; the env layer keeps existing deploys working and
 * gives a way to force a value without touching the database.
 *
 * Two of these switches are consequential and both default to OFF:
 *   enabled     — spends money on a third-party API
 *   autoPublish — puts AI-written content on the live site with no human check
 */
const Setting = require("../models/Setting");
const logger = require("../utils/logger");

const DEFAULTS = {
  enabled: false,
  autoPublish: false,
  batchSize: 3,
};

/** Interpret a stored value, falling back to the environment, then a default. */
function resolveBoolean(storedValue, envName, fallback) {
  const raw =
    storedValue !== null && storedValue !== undefined && storedValue !== ""
      ? storedValue
      : process.env[envName];

  if (raw === undefined || raw === null || raw === "") return fallback;
  return String(raw).toLowerCase() === "true";
}

function resolveNumber(storedValue, envName, fallback) {
  const raw =
    storedValue !== null && storedValue !== undefined && storedValue !== ""
      ? storedValue
      : process.env[envName];

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Read the three settings.
 *
 * A missing settings table (fresh database, or a deploy that has not migrated)
 * must not break the pipeline's callers, so failures degrade to the defaults
 * rather than throwing.
 */
async function getRewriteSettings() {
  try {
    const [enabled, autoPublish, batchSize] = await Promise.all([
      Setting.getValue(Setting.KEYS.REWRITE_ENABLED, null),
      Setting.getValue(Setting.KEYS.REWRITE_AUTO_PUBLISH, null),
      Setting.getValue(Setting.KEYS.REWRITE_BATCH_SIZE, null),
    ]);

    return {
      enabled: resolveBoolean(enabled, "REWRITE_ENABLED", DEFAULTS.enabled),
      autoPublish: resolveBoolean(
        autoPublish,
        "REWRITE_AUTO_PUBLISH",
        DEFAULTS.autoPublish,
      ),
      batchSize: Math.min(
        resolveNumber(batchSize, "REWRITE_BATCH_SIZE", DEFAULTS.batchSize),
        50,
      ),
    };
  } catch (err) {
    logger.warn(
      `rewriteSettings: could not read settings (${err.message}); using defaults.`,
    );
    return { ...DEFAULTS };
  }
}

/** Persist a subset of settings. Omitted keys are left untouched. */
async function updateRewriteSettings({ enabled, autoPublish, batchSize }, updatedBy) {
  const writes = [];

  if (enabled !== undefined) {
    writes.push(
      Setting.setValue(
        Setting.KEYS.REWRITE_ENABLED,
        enabled ? "true" : "false",
        "Run the AI rewrite pipeline in the background",
        "rewrite",
      ),
    );
  }
  if (autoPublish !== undefined) {
    writes.push(
      Setting.setValue(
        Setting.KEYS.REWRITE_AUTO_PUBLISH,
        autoPublish ? "true" : "false",
        "Publish rewrites without human review",
        "rewrite",
      ),
    );
  }
  if (batchSize !== undefined) {
    const size = Math.max(1, Math.min(Number(batchSize) || DEFAULTS.batchSize, 50));
    writes.push(
      Setting.setValue(
        Setting.KEYS.REWRITE_BATCH_SIZE,
        String(size),
        "Articles rewritten per scheduled run",
        "rewrite",
      ),
    );
  }

  await Promise.all(writes);

  // Loud, because flipping autoPublish is the one setting that lets unreviewed
  // AI content reach the live site.
  if (autoPublish !== undefined) {
    logger.warn(
      `rewriteSettings: auto-publish ${autoPublish ? "ENABLED" : "disabled"} by ${updatedBy || "unknown"}.`,
    );
  }

  return getRewriteSettings();
}

module.exports = { getRewriteSettings, updateRewriteSettings, DEFAULTS };
