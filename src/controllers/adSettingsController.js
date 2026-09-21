/**
 * Ad Settings Controller
 * CRUD operations for ad configuration
 */
const AdSetting = require("../models/AdSetting");
const logger = require("../utils/logger");

/**
 * A unit is served only when its row is enabled AND carries a value. That lets
 * an operator park a unit — keep the ID on file, stop serving it — instead of
 * clearing the field and losing the value.
 */
function unitValue(settings, key) {
  const row = settings[key];
  if (!row || row.isEnabled === false) return "";
  return row.value || "";
}

/** Shorthand for a boolean setting. */
function flag(settings, key, fallback = true) {
  return AdSetting.getFlag(settings, key, fallback);
}

/**
 * GET /api/ad-settings — admin
 * Get all ad settings
 */
async function getAllSettings(req, res) {
  try {
    const settings = await AdSetting.findAll({
      order: [["key", "ASC"]],
    });
    res.json({ success: true, data: settings });
  } catch (err) {
    logger.error("getAllSettings error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * GET /api/ad-settings/mobile — public (for mobile app)
 * Get ad configuration for mobile app
 *
 * Returns a per-platform `enabled` flag as well as the master one, because the
 * Android and iOS switches are independent. `enabled` is kept for older app
 * builds that only understand the master switch.
 */
async function getMobileSettings(req, res) {
  try {
    const settings = await AdSetting.getAllSettings();
    const master = flag(settings, AdSetting.KEYS.ADS_ENABLED);

    if (!master) {
      return res.json({
        success: true,
        data: {
          enabled: false,
          testMode: false,
          android: { enabled: false },
          ios: { enabled: false },
        },
      });
    }

    const androidEnabled = flag(settings, AdSetting.KEYS.ANDROID_ENABLED);
    const iosEnabled = flag(settings, AdSetting.KEYS.IOS_ENABLED);
    const testMode = flag(settings, AdSetting.KEYS.ADS_TEST_MODE, false);

    // While test mode is on the configured IDs are withheld, so a client that
    // ignores the flag falls back to its own sample units rather than quietly
    // serving production inventory from a build nobody meant to ship.
    const unitIds = (prefix, enabled) =>
      enabled && !testMode
        ? {
            bannerId: unitValue(settings, AdSetting.KEYS[`${prefix}_BANNER_ID`]),
            interstitialId: unitValue(settings, AdSetting.KEYS[`${prefix}_INTERSTITIAL_ID`]),
            rewardedId: unitValue(settings, AdSetting.KEYS[`${prefix}_REWARDED_ID`]),
            nativeId: unitValue(settings, AdSetting.KEYS[`${prefix}_NATIVE_ID`]),
          }
        : // No IDs when a platform is off or in test mode, so a client that
          // ignores the flags still has nothing real to request.
          { bannerId: "", interstitialId: "", rewardedId: "", nativeId: "" };

    res.json({
      success: true,
      data: {
        enabled: androidEnabled || iosEnabled,
        testMode,
        android: { enabled: androidEnabled, ...unitIds("ANDROID", androidEnabled) },
        ios: { enabled: iosEnabled, ...unitIds("IOS", iosEnabled) },
        interstitialFrequency: parseInt(
          settings[AdSetting.KEYS.MOBILE_INTERSTITIAL_FREQUENCY]?.value || "5",
        ),
        infeedFrequency: parseInt(
          settings[AdSetting.KEYS.MOBILE_INFEED_FREQUENCY]?.value || "5",
        ),
        rewardedDailyLimit: parseInt(
          settings[AdSetting.KEYS.REWARDED_ADS_DAILY_LIMIT]?.value || "5",
        ),
      },
    });
  } catch (err) {
    logger.error("getMobileSettings error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * GET /api/ad-settings/web — public (for web app)
 * Get AdSense configuration for the website
 *
 * `enabled` is false when the master switch or the web switch is off, and a
 * slot is omitted entirely when its own row is switched off — AdSlot already
 * renders nothing unless it has a slot ID.
 */
async function getWebSettings(req, res) {
  try {
    const settings = await AdSetting.getAllSettings();
    const master = flag(settings, AdSetting.KEYS.ADS_ENABLED);
    const webEnabled = flag(settings, AdSetting.KEYS.WEB_ENABLED);

    if (!master || !webEnabled) {
      return res.json({ success: true, data: { enabled: false } });
    }

    res.json({
      success: true,
      data: {
        enabled: true,
        clientId:
          unitValue(settings, AdSetting.KEYS.ADSENSE_CLIENT_ID) ||
          process.env.ADSENSE_CLIENT_ID ||
          "ca-pub-8008635097866263",
        slots: {
          banner: unitValue(settings, AdSetting.KEYS.ADSENSE_SLOT_BANNER),
          sidebar: unitValue(settings, AdSetting.KEYS.ADSENSE_SLOT_SIDEBAR),
          infeed: unitValue(settings, AdSetting.KEYS.ADSENSE_SLOT_INFEED),
        },
      },
    });
  } catch (err) {
    logger.error("getWebSettings error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * PUT /api/ad-settings — admin
 * Update ad settings (batch update)
 */
async function updateSettings(req, res) {
  try {
    const { settings } = req.body;

    if (!settings || !Array.isArray(settings)) {
      return res.status(400).json({
        success: false,
        message: "Settings array is required",
      });
    }

    const updated = [];
    for (const setting of settings) {
      if (!setting.key) continue;

      const result = await AdSetting.setValue(
        setting.key,
        setting.value,
        setting.description,
      );

      if (typeof setting.isEnabled === "boolean") {
        result.isEnabled = setting.isEnabled;
        await result.save();
      }

      updated.push(result);
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error("updateSettings error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * PUT /api/ad-settings/:key — admin
 * Update a single ad setting
 */
async function updateSetting(req, res) {
  try {
    const { key } = req.params;
    const { value, description, isEnabled } = req.body;

    let setting = await AdSetting.findOne({ where: { key } });

    if (!setting) {
      setting = await AdSetting.create({
        key,
        value,
        description,
        isEnabled: isEnabled ?? true,
      });
    } else {
      if (value !== undefined) setting.value = value;
      if (description !== undefined) setting.description = description;
      if (isEnabled !== undefined) setting.isEnabled = isEnabled;
      await setting.save();
    }

    res.json({ success: true, data: setting });
  } catch (err) {
    logger.error("updateSetting error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * DELETE /api/ad-settings/:key — admin
 * Delete an ad setting
 */
async function deleteSetting(req, res) {
  try {
    const { key } = req.params;
    const deleted = await AdSetting.destroy({ where: { key } });

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Setting not found",
      });
    }

    res.json({ success: true, message: "Setting deleted" });
  } catch (err) {
    logger.error("deleteSetting error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * POST /api/ad-settings/initialize — admin
 * Initialize default ad settings
 */
async function initializeDefaults(req, res) {
  try {
    await AdSetting.initializeDefaults();
    const settings = await AdSetting.findAll({
      order: [["key", "ASC"]],
    });
    res.json({ success: true, data: settings });
  } catch (err) {
    logger.error("initializeDefaults error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

module.exports = {
  getAllSettings,
  getMobileSettings,
  getWebSettings,
  updateSettings,
  updateSetting,
  deleteSetting,
  initializeDefaults,
};
