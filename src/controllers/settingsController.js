/**
 * Settings Controller
 * Admin CRUD for site settings (branding, SMTP, etc.) + public appearance endpoint.
 */
const Setting = require("../models/Setting");
const logger = require("../utils/logger");

/**
 * GET /api/settings — admin
 * Get all settings
 */
async function getAll(req, res) {
  try {
    const settings = await Setting.findAll({
      order: [
        ["category", "ASC"],
        ["key", "ASC"],
      ],
    });
    res.json({ success: true, data: settings });
  } catch (err) {
    logger.error("settings.getAll error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * GET /api/settings/public — public
 * Appearance settings for the public site (safe subset, no secrets)
 */
async function getPublic(req, res) {
  try {
    const s = await Setting.getAllSettings();
    const str = (k, d) => s[k]?.value || d;
    const num = (k, d) => (s[k]?.value !== undefined && s[k].value !== "" ? s[k].value : d);

    res.json({
      success: true,
      data: {
        siteName: str(Setting.KEYS.SITE_NAME, "Trenxi"),
        siteTagline: str(Setting.KEYS.SITE_TAGLINE, "Your News, Your Way"),
        colors: {
          primary: num(Setting.KEYS.PRIMARY_COLOR, "#001e56"),
          accent: num(Setting.KEYS.ACCENT_COLOR, "#0246ba"),
        },
        logos: {
          logo: str(Setting.KEYS.LOGO_URL, "/logo_main.png"),
          icon: str(Setting.KEYS.LOGO_ICON_URL, "/logo2.png"),
        },
        seo: {
          title: str(Setting.KEYS.SEO_TITLE, "Trenxi — Your News, Your Way"),
          description: str(
            Setting.KEYS.SEO_DESCRIPTION,
            "Track breaking updates, save what matters, and pick up where you left off in seconds. Personalized news, scores, and stories from around the world.",
          ),
          keywords: str(
            Setting.KEYS.SEO_KEYWORDS,
            "news, breaking news, trending, sports, world news, daily news",
          ),
          ogImage: str(Setting.KEYS.SEO_OG_IMAGE, "/logo_main.png"),
          twitterHandle: str(Setting.KEYS.SEO_TWITTER_HANDLE, "@trenxi"),
        },
      },
    });
  } catch (err) {
    logger.error("settings.getPublic error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * PUT /api/settings — admin
 * Batch update settings. Each item: { key, value, description?, category? }
 */
async function update(req, res) {
  try {
    const { settings } = req.body;

    if (!settings || !Array.isArray(settings)) {
      return res.status(400).json({
        success: false,
        message: "Settings array is required",
      });
    }

    const updated = [];
    for (const item of settings) {
      if (!item.key) continue;
      const result = await Setting.setValue(
        item.key,
        item.value,
        item.description,
        item.category,
      );
      if (typeof item.isEnabled === "boolean") {
        result.isEnabled = item.isEnabled;
        await result.save();
      }
      updated.push(result);
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error("settings.update error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * POST /api/settings/initialize — admin
 * Seed default settings
 */
async function initialize(req, res) {
  try {
    await Setting.initializeDefaults();
    const settings = await Setting.findAll({
      order: [["key", "ASC"]],
    });
    res.json({ success: true, data: settings });
  } catch (err) {
    logger.error("settings.initialize error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

module.exports = { getAll, getPublic, update, initialize };
