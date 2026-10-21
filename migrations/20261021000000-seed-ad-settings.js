"use strict";

/**
 * Put the ad configuration in the database, not just in the code.
 *
 * ── Why ───────────────────────────────────────────────────────────────────
 *
 * The Adsterra switch shipped with its zones hardcoded in
 * `AdSetting.ADSTERRA_DEFAULTS`, and the public endpoint falls back to them.
 * That keeps the website serving ads, but it leaves production with an empty
 * `ad_settings` table: the admin → Ads screen reads rows only, so an operator
 * sees no settings to edit, and every toggle has to re-create the row from
 * scratch with a PUT.
 *
 * `AdSetting.initializeDefaults()` exists for this, but it is reachable only as
 * an authenticated admin endpoint — never at boot — so a fresh environment is
 * never seeded.
 *
 * ── Idempotent by design ──────────────────────────────────────────────────
 *
 * `INSERT IGNORE` relies on the unique index on `key`: rows that already exist
 * (a local database where the zones were entered through the admin UI, or a
 * production database that has been toggled) keep their values untouched. This
 * migration only fills gaps, so it is safe on every environment and safe to
 * replay by hand.
 */

const SETTINGS = [
  {
    key: "ads_enabled",
    value: "true",
    description: "Master switch for all ads",
  },
  {
    key: "web_enabled",
    value: "true",
    description: "Serve ads on the website (Adsterra)",
  },
  {
    key: "android_enabled",
    value: "true",
    description: "Serve ads in the Android app (AdMob)",
  },
  {
    key: "ios_enabled",
    value: "true",
    description: "Serve ads in the iOS app (AdMob)",
  },
  {
    key: "ads_test_mode",
    value: "false",
    description: "Use Google's sample AdMob ad units instead of the configured ones",
  },
  {
    key: "mobile_interstitial_frequency",
    value: "5",
    description: "Show interstitial after N articles",
  },
  {
    key: "mobile_infeed_frequency",
    value: "5",
    description: "Show in-feed ad after N articles",
  },
  {
    key: "rewarded_ads_daily_limit",
    value: "5",
    description: "Max rewarded ads per day",
  },

  // Adsterra: one script base per account plus one zone per placement. Both
  // the key and the base come from the dashboard's GET CODE snippet; the
  // numeric ad-unit ID is not usable as a key. A zone's size is fixed when it
  // is created, so it is stored alongside the key.
  {
    key: "adsterra_script_base",
    value: "https://bauval.org/22",
    description: "Adsterra script base URL (from GET CODE)",
  },
  {
    key: "adsterra_banner_key",
    value: "de72c5c0aa1ea9ef6d00a2f52a424f62",
    description: "Adsterra banner zone key (728x90)",
  },
  {
    key: "adsterra_banner_size",
    value: "728x90",
    description: "Banner zone size, WxH",
  },
  {
    key: "adsterra_infeed_key",
    value: "1082cc006c49d48d5ed5d9d01f6a26da",
    description: "Adsterra in-feed zone key (300x250)",
  },
  {
    key: "adsterra_infeed_size",
    value: "300x250",
    description: "In-feed zone size, WxH",
  },
  {
    key: "adsterra_sidebar_key",
    value: "82282df786e874a14c334a9d1480c3b1",
    description: "Adsterra sidebar zone key (160x600)",
  },
  {
    key: "adsterra_sidebar_size",
    value: "160x600",
    description: "Sidebar zone size, WxH",
  },
];

module.exports = {
  async up(queryInterface) {
    const placeholders = SETTINGS.map(() => "(?, ?, ?, 1, NOW(), NOW())").join(", ");
    const replacements = SETTINGS.flatMap((setting) => [
      setting.key,
      setting.value,
      setting.description,
    ]);

    await queryInterface.sequelize.query(
      `INSERT IGNORE INTO \`ad_settings\` (\`key\`, \`value\`, \`description\`, \`isEnabled\`, \`createdAt\`, \`updatedAt\`)
       VALUES ${placeholders}`,
      { replacements },
    );
  },

  async down(queryInterface) {
    // Only drop rows this migration would have created. A row an operator has
    // since edited no longer matches, so it is left alone — the migration must
    // not erase configuration it did not own.
    const keys = SETTINGS.map((setting) => setting.key);
    await queryInterface.sequelize.query(
      `DELETE FROM \`ad_settings\`
        WHERE (\`key\`, \`value\`, \`description\`) IN (${SETTINGS.map(() => "(?, ?, ?)").join(", ")})
          AND \`key\` IN (?)`,
      {
        replacements: [
          ...SETTINGS.flatMap((s) => [s.key, s.value, s.description]),
          keys,
        ],
      },
    );
  },
};
