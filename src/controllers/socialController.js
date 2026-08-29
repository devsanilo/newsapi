/**
 * Social Controller — manage social publishing config and publish posts
 */
const Setting = require("../models/Setting");
const socialService = require("../services/socialService");
const logger = require("../utils/logger");

const SOCIAL_PREFIX = "social_";

/**
 * GET /api/admin/social/config — admin
 * Return all social_* settings
 */
async function getConfig(req, res) {
  try {
    const settings = await Setting.findAll({
      where: { key: { [require("sequelize").Op.like]: `${SOCIAL_PREFIX}%` } },
      order: [["key", "ASC"]],
    });
    res.json({ success: true, data: settings });
  } catch (err) {
    logger.error("social.getConfig error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * PUT /api/admin/social/config — admin
 * Batch update social_* settings (only these keys are accepted)
 */
async function saveConfig(req, res) {
  try {
    const { settings } = req.body;
    if (!settings || !Array.isArray(settings)) {
      return res.status(400).json({ success: false, message: "Settings array is required" });
    }

    const updated = [];
    for (const item of settings) {
      if (!item.key || !item.key.startsWith(SOCIAL_PREFIX)) continue;
      updated.push(await Setting.setValue(item.key, item.value, item.description, "social"));
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error("social.saveConfig error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * POST /api/admin/social/publish — admin
 * Publish a post. Body: { platforms: [], message, link?, imageUrl? }
 */
async function publish(req, res) {
  try {
    const { platforms = [], message, link, imageUrl } = req.body;
    if (!platforms.length) {
      return res.status(400).json({ success: false, message: "Select at least one platform" });
    }
    if (!message || !String(message).trim()) {
      return res.status(400).json({ success: false, message: "Post message is required" });
    }

    const results = await socialService.publish({
      platforms,
      message: String(message).trim(),
      link: link || undefined,
      imageUrl: imageUrl || undefined,
    });

    const failed = Object.values(results).filter((r) => r && !r.ok);
    res.json({
      success: failed.length === 0,
      message: failed.length === 0 ? "Posted successfully" : "Some platforms failed",
      data: results,
    });
  } catch (err) {
    logger.error("social.publish error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * POST /api/admin/social/test — admin
 * Send a test post to a single platform to verify credentials
 * Body: { platform: "facebook" | "instagram" | "twitter" }
 */
async function test(req, res) {
  try {
    const { platform } = req.body;
    if (!["facebook", "instagram", "twitter"].includes(platform)) {
      return res.status(400).json({ success: false, message: "Invalid platform" });
    }

    const cfg = await socialService.getSocialConfig();
    const c = cfg[platform];

    if (!c.enabled) {
      return res.status(400).json({ success: false, message: `${platform} is not enabled` });
    }

    const results = await socialService.publish({
      platforms: [platform],
      message: `Test post from Trenxi ✅ ${new Date().toISOString()}`,
      link: "https://trenxi.com",
      imageUrl: "https://trenxi.com/logo_main.png",
    });

    res.json({ success: results[platform]?.ok, data: results[platform] });
  } catch (err) {
    logger.error("social.test error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

module.exports = { getConfig, saveConfig, publish, test };
