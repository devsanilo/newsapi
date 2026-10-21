const { DataTypes } = require("sequelize");
const { sequelize } = require("../database/connection");

const AdSetting = sequelize.define(
  "AdSetting",
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
    isEnabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    tableName: "ad_settings",
    timestamps: true,
  },
);

// Default ad settings keys
AdSetting.KEYS = {
  // Global settings
  ADS_ENABLED: "ads_enabled",

  // Per-platform switches. The master switch above gates all three, so this
  // lets an operator pull ads from one surface (say the website, pending a
  // review) without touching the apps.
  WEB_ENABLED: "web_enabled",
  ANDROID_ENABLED: "android_enabled",
  IOS_ENABLED: "ios_enabled",

  // Serve Google's sample ad units instead of the configured ones. AdMob only;
  // AdSense has no equivalent, so the website is unaffected.
  ADS_TEST_MODE: "ads_test_mode",

  // Mobile Android
  ANDROID_BANNER_ID: "android_banner_id",
  ANDROID_INTERSTITIAL_ID: "android_interstitial_id",
  ANDROID_REWARDED_ID: "android_rewarded_id",
  ANDROID_NATIVE_ID: "android_native_id",

  // Mobile iOS
  IOS_BANNER_ID: "ios_banner_id",
  IOS_INTERSTITIAL_ID: "ios_interstitial_id",
  IOS_REWARDED_ID: "ios_rewarded_id",
  IOS_NATIVE_ID: "ios_native_id",

  // Web AdSense
  ADSENSE_CLIENT_ID: "adsense_client_id",
  ADSENSE_SLOT_BANNER: "adsense_slot_banner",
  ADSENSE_SLOT_SIDEBAR: "adsense_slot_sidebar",
  ADSENSE_SLOT_INFEED: "adsense_slot_infeed",

  // Web Adsterra. One zone key per placement; Adsterra fixes a banner's size
  // when the zone is created, so each key carries its WxH alongside it.
  ADSTERRA_SCRIPT_BASE: "adsterra_script_base",
  ADSTERRA_BANNER_KEY: "adsterra_banner_key",
  ADSTERRA_BANNER_SIZE: "adsterra_banner_size",
  ADSTERRA_INFEED_KEY: "adsterra_infeed_key",
  ADSTERRA_INFEED_SIZE: "adsterra_infeed_size",
  ADSTERRA_SIDEBAR_KEY: "adsterra_sidebar_key",
  ADSTERRA_SIDEBAR_SIZE: "adsterra_sidebar_size",

  // Ad placement settings
  MOBILE_INTERSTITIAL_FREQUENCY: "mobile_interstitial_frequency",
  MOBILE_INFEED_FREQUENCY: "mobile_infeed_frequency",
  REWARDED_ADS_DAILY_LIMIT: "rewarded_ads_daily_limit",
};

// Adsterra zones for trenxi.com (account 6139663).
//
// IMPORTANT: the numeric ID in the ad-unit table (31848632) is NOT the key the
// tag uses. Both the key and the script base come from the unit's "GET CODE"
// snippet — e.g.
//   atOptions = { key: 'de72c5c0…', format: 'iframe', height: 90, width: 728 }
//   <script src="https://bauval.org/22/de72c5c0…"></script>
// The base is per-account and can change, so it is a setting rather than a
// constant. A size is fixed when the zone is created.
AdSetting.ADSTERRA_DEFAULTS = {
  scriptBase: "https://bauval.org/22",
  banner: { key: "de72c5c0aa1ea9ef6d00a2f52a424f62", size: "728x90" },
  infeed: { key: "1082cc006c49d48d5ed5d9d01f6a26da", size: "300x250" },
  sidebar: { key: "82282df786e874a14c334a9d1480c3b1", size: "160x600" },
};

// Get all settings as an object
AdSetting.getAllSettings = async function () {
  const settings = await this.findAll();
  const result = {};
  settings.forEach((s) => {
    result[s.key] = {
      value: s.value,
      isEnabled: s.isEnabled,
      description: s.description,
    };
  });
  return result;
};

// Get a single setting value
AdSetting.getValue = async function (key, defaultValue = null) {
  const setting = await this.findOne({ where: { key } });
  if (!setting || !setting.isEnabled) return defaultValue;
  return setting.value ?? defaultValue;
};

/**
 * Read a boolean flag.
 *
 * Deliberately not built on getValue: for a flag, a row that is switched off
 * must mean "false", whereas getValue treats a disabled row as "fall back to
 * the default" — which for a switch defaulting to true would turn it back on.
 * A flag is therefore on only when the row exists, is enabled, and its value
 * is "true", so the row toggle and the value always agree.
 */
AdSetting.getFlag = function (settings, key, defaultValue = true) {
  const row = settings ? settings[key] : undefined;
  if (!row) return defaultValue;
  if (row.isEnabled === false) return false;
  return String(row.value ?? "").toLowerCase() === "true";
};

// Set a setting value
AdSetting.setValue = async function (key, value, description = null) {
  const [setting, created] = await this.findOrCreate({
    where: { key },
    defaults: { value, description },
  });

  if (!created) {
    setting.value = value;
    if (description) setting.description = description;
    await setting.save();
  }

  return setting;
};

// Initialize default settings
AdSetting.initializeDefaults = async function () {
  const defaults = [
    {
      key: this.KEYS.ADS_ENABLED,
      value: "true",
      description: "Master switch for all ads",
    },
    {
      key: this.KEYS.WEB_ENABLED,
      value: "true",
      description: "Serve ads on the website (Adsterra)",
    },
    {
      key: this.KEYS.ANDROID_ENABLED,
      value: "true",
      description: "Serve ads in the Android app (AdMob)",
    },
    {
      key: this.KEYS.IOS_ENABLED,
      value: "true",
      description: "Serve ads in the iOS app (AdMob)",
    },
    {
      key: this.KEYS.ADS_TEST_MODE,
      // Defaults to off so the configured unit IDs are used as-is. Turning it
      // on makes the apps request Google's sample units, which serve real-looking
      // ads and record no revenue.
      value: "false",
      description: "Use Google's sample AdMob ad units instead of the configured ones",
    },
    {
      key: this.KEYS.MOBILE_INTERSTITIAL_FREQUENCY,
      value: "5",
      description: "Show interstitial after N articles",
    },
    {
      key: this.KEYS.MOBILE_INFEED_FREQUENCY,
      value: "5",
      description: "Show in-feed ad after N articles",
    },
    {
      key: this.KEYS.REWARDED_ADS_DAILY_LIMIT,
      value: "5",
      description: "Max rewarded ads per day",
    },

    // Adsterra. Script base plus one zone per placement; both come from the
    // dashboard's GET CODE, and the numeric ad-unit ID is not usable as a key.
    {
      key: this.KEYS.ADSTERRA_SCRIPT_BASE,
      value: this.ADSTERRA_DEFAULTS.scriptBase,
      description: "Adsterra script base URL (from GET CODE)",
    },
    {
      key: this.KEYS.ADSTERRA_BANNER_KEY,
      value: this.ADSTERRA_DEFAULTS.banner.key,
      description: `Adsterra banner zone key (${this.ADSTERRA_DEFAULTS.banner.size})`,
    },
    {
      key: this.KEYS.ADSTERRA_BANNER_SIZE,
      value: this.ADSTERRA_DEFAULTS.banner.size,
      description: "Banner zone size, WxH",
    },
    {
      key: this.KEYS.ADSTERRA_INFEED_SIZE,
      value: this.ADSTERRA_DEFAULTS.infeed.size,
      description: "In-feed zone size, WxH",
    },
    {
      key: this.KEYS.ADSTERRA_SIDEBAR_SIZE,
      value: this.ADSTERRA_DEFAULTS.sidebar.size,
      description: "Sidebar zone size, WxH",
    },
  ];

  for (const def of defaults) {
    await this.findOrCreate({
      where: { key: def.key },
      defaults: def,
    });
  }
};

module.exports = AdSetting;
