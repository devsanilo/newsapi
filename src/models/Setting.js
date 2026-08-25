/**
 * Setting Model — generic key/value store for site configuration
 * (appearance, branding, SMTP, etc.) editable from the admin dashboard.
 */
const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const Setting = sequelize.define(
  "Setting",
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    key: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    value: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    category: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: "general",
    },
    isEnabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    tableName: "settings",
    timestamps: true,
  },
);

// Settings keys
Setting.KEYS = {
  // Branding / appearance
  SITE_NAME: "site_name",
  SITE_TAGLINE: "site_tagline",
  PRIMARY_COLOR: "primary_color",
  ACCENT_COLOR: "accent_color",
  LOGO_URL: "logo_url",
  LOGO_ICON_URL: "logo_icon_url",

  // Email / SMTP
  SMTP_HOST: "smtp_host",
  SMTP_PORT: "smtp_port",
  SMTP_USER: "smtp_user",
  SMTP_PASS: "smtp_pass",
  SMTP_SECURE: "smtp_secure",
  SMTP_FROM: "smtp_from",

  // SEO / meta
  SEO_TITLE: "seo_title",
  SEO_DESCRIPTION: "seo_description",
  SEO_KEYWORDS: "seo_keywords",
  SEO_OG_IMAGE: "seo_og_image",
  SEO_TWITTER_HANDLE: "seo_twitter_handle",
};

// Get all settings as an object
Setting.getAllSettings = async function () {
  const settings = await this.findAll();
  const result = {};
  settings.forEach((s) => {
    result[s.key] = {
      value: s.value,
      isEnabled: s.isEnabled,
      description: s.description,
      category: s.category,
    };
  });
  return result;
};

// Get a single setting value
Setting.getValue = async function (key, defaultValue = null) {
  const setting = await this.findOne({ where: { key } });
  if (!setting || !setting.isEnabled) return defaultValue;
  return setting.value ?? defaultValue;
};

// Set a setting value
Setting.setValue = async function (key, value, description = null, category = "general") {
  const [setting] = await this.findOrCreate({
    where: { key },
    defaults: { value, description, category },
  });

  if (value !== undefined) setting.value = value;
  if (description) setting.description = description;
  if (category) setting.category = category;
  await setting.save();

  return setting;
};

// Initialize default settings
Setting.initializeDefaults = async function () {
  const defaults = [
    { key: this.KEYS.SITE_NAME, value: "Trenxi", description: "Site display name", category: "branding" },
    { key: this.KEYS.SITE_TAGLINE, value: "Your News, Your Way", description: "Site tagline", category: "branding" },
    { key: this.KEYS.PRIMARY_COLOR, value: "#001e56", description: "Primary brand color", category: "branding" },
    { key: this.KEYS.ACCENT_COLOR, value: "#0246ba", description: "Accent brand color", category: "branding" },
    { key: this.KEYS.LOGO_URL, value: "/logo_main.png", description: "Full logo URL", category: "branding" },
    { key: this.KEYS.LOGO_ICON_URL, value: "/logo2.png", description: "Icon / favicon URL", category: "branding" },
    { key: this.KEYS.SMTP_HOST, value: "", description: "SMTP server host", category: "smtp" },
    { key: this.KEYS.SMTP_PORT, value: "587", description: "SMTP port", category: "smtp" },
    { key: this.KEYS.SMTP_USER, value: "", description: "SMTP username", category: "smtp" },
    { key: this.KEYS.SMTP_PASS, value: "", description: "SMTP password / app password", category: "smtp" },
    { key: this.KEYS.SMTP_SECURE, value: "false", description: "Use SSL/TLS for SMTP", category: "smtp" },
    { key: this.KEYS.SMTP_FROM, value: "", description: "Sender email (From)", category: "smtp" },
    { key: this.KEYS.SEO_TITLE, value: "Trenxi — Your News, Your Way", description: "Default meta title", category: "seo" },
    { key: this.KEYS.SEO_DESCRIPTION, value: "Track breaking updates, save what matters, and pick up where you left off in seconds. Personalized news, scores, and stories from around the world.", description: "Default meta description", category: "seo" },
    { key: this.KEYS.SEO_KEYWORDS, value: "news, breaking news, trending, sports, world news, daily news", description: "Default meta keywords (comma separated)", category: "seo" },
    { key: this.KEYS.SEO_OG_IMAGE, value: "/logo_main.png", description: "Default Open Graph / share image URL", category: "seo" },
    { key: this.KEYS.SEO_TWITTER_HANDLE, value: "@trenxi", description: "Twitter/X handle for card attribution", category: "seo" },
  ];

  for (const def of defaults) {
    await this.findOrCreate({ where: { key: def.key }, defaults: def });
  }
};

module.exports = Setting;
