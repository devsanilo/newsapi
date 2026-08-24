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

  // Ad placement settings
  MOBILE_INTERSTITIAL_FREQUENCY: "mobile_interstitial_frequency",
  MOBILE_INFEED_FREQUENCY: "mobile_infeed_frequency",
  REWARDED_ADS_DAILY_LIMIT: "rewarded_ads_daily_limit",
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
  ];

  for (const def of defaults) {
    await this.findOrCreate({
      where: { key: def.key },
      defaults: def,
    });
  }
};

module.exports = AdSetting;
