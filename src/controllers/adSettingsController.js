/**
 * Ad Settings Controller
 * CRUD operations for ad configuration
 */
const AdSetting = require("../models/AdSetting");
const logger = require("../utils/logger");

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
 */
async function getMobileSettings(req, res) {
  try {
    const adsEnabled = await AdSetting.getValue(
      AdSetting.KEYS.ADS_ENABLED,
      "true",
    );

    if (adsEnabled !== "true") {
      return res.json({
        success: true,
        data: {
          enabled: false,
        },
      });
    }

    const settings = await AdSetting.getAllSettings();

    res.json({
      success: true,
      data: {
        enabled: true,
        android: {
          bannerId: settings[AdSetting.KEYS.ANDROID_BANNER_ID]?.value || "",
          interstitialId:
            settings[AdSetting.KEYS.ANDROID_INTERSTITIAL_ID]?.value || "",
          rewardedId: settings[AdSetting.KEYS.ANDROID_REWARDED_ID]?.value || "",
          nativeId: settings[AdSetting.KEYS.ANDROID_NATIVE_ID]?.value || "",
        },
        ios: {
          bannerId: settings[AdSetting.KEYS.IOS_BANNER_ID]?.value || "",
          interstitialId:
            settings[AdSetting.KEYS.IOS_INTERSTITIAL_ID]?.value || "",
          rewardedId: settings[AdSetting.KEYS.IOS_REWARDED_ID]?.value || "",
          nativeId: settings[AdSetting.KEYS.IOS_NATIVE_ID]?.value || "",
        },
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
 */
async function getWebSettings(req, res) {
  try {
    const adsEnabled = await AdSetting.getValue(
      AdSetting.KEYS.ADS_ENABLED,
      "true",
    );

    if (adsEnabled !== "true") {
      return res.json({
        success: true,
        data: { enabled: false },
      });
    }

    const settings = await AdSetting.getAllSettings();

    res.json({
      success: true,
      data: {
        enabled: true,
        clientId:
          settings[AdSetting.KEYS.ADSENSE_CLIENT_ID]?.value ||
          process.env.ADSENSE_CLIENT_ID ||
          "ca-pub-8208734803835173",
        slots: {
          banner: settings[AdSetting.KEYS.ADSENSE_SLOT_BANNER]?.value || "",
          sidebar: settings[AdSetting.KEYS.ADSENSE_SLOT_SIDEBAR]?.value || "",
          infeed: settings[AdSetting.KEYS.ADSENSE_SLOT_INFEED]?.value || "",
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
