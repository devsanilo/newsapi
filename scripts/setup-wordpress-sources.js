/**
 * Flag each source as WordPress or RSS.
 *
 * Probes `<site>/wp-json/wp/v2/posts` for every active source and records the
 * result on the source row:
 *
 *   feed_type  'wordpress' → ingest the complete post via the REST API; the row
 *                            is held unpublished until the rewrite pipeline
 *                            turns it into a Trenxi article.
 *   feed_type  'rss'       → headline highlight. Published immediately, links
 *                            out to the publisher, never rewritten.
 *
 * Detection is a probe rather than a hardcoded list because the answer is a
 * property of the publisher's stack, not of the codebase — and it changes when
 * a site is rebuilt, moves off WordPress, or starts blocking the REST API.
 *
 *   node scripts/setup-wordpress-sources.js            # dry run
 *   node scripts/setup-wordpress-sources.js --apply    # write the result
 *   node scripts/setup-wordpress-sources.js --apply --slug punch,vanguard
 */

require("dotenv").config();

const { sequelize } = require("../src/database/connection");
const Source = require("../src/models/Source");
const wpCrawler = require("../src/crawlers/wpCrawler");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const onlyFlag = args.indexOf("--slug");
const ONLY =
  onlyFlag !== -1 && args[onlyFlag + 1]
    ? args[onlyFlag + 1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

(async () => {
  await sequelize.authenticate();

  const sources = await Source.findAll({
    where: { is_active: true },
    order: [["is_local", "DESC"], ["slug", "ASC"]],
    raw: true,
  });

  const targets = ONLY ? sources.filter((s) => ONLY.includes(s.slug)) : sources;

  console.log(
    `${APPLY ? "APPLYING" : "DRY RUN"} — probing ${targets.length} active source(s) for a WordPress REST API\n`,
  );

  const willBeWordPress = [];
  const willBeRss = [];

  for (const source of targets) {
    const before = source.feed_type;
    const result = await wpCrawler.detect(source.url);

    if (result.supported) {
      willBeWordPress.push({ slug: source.slug, before, wpApiUrl: result.wpApiUrl });
      console.log(
        `  WP   ${String(source.slug).padEnd(18)} ${String(source.is_local ? "local" : "intl").padEnd(6)} ${result.sample?.words ?? "?"}w sample`,
      );
    } else {
      willBeRss.push({ slug: source.slug, before, reason: result.reason });
      console.log(
        `  --   ${String(source.slug).padEnd(18)} ${String(source.is_local ? "local" : "intl").padEnd(6)} ${String(result.reason).slice(0, 70)}`,
      );
    }
  }

  console.log(`\n=== summary ===`);
  console.log(`  WordPress (full articles, rewritten): ${willBeWordPress.length}`);
  console.log(`  RSS (highlights, no article page):     ${willBeRss.length}`);

  const changed = [...willBeWordPress, ...willBeRss].filter((s) => {
    const target = willBeWordPress.some((w) => w.slug === s.slug) ? "wordpress" : "rss";
    return s.before !== target;
  });
  console.log(`  rows needing a change:                 ${changed.length}`);

  if (!APPLY) {
    console.log(`\nDry run — nothing written. Re-run with --apply to persist.`);
    await sequelize.close();
    return;
  }

  for (const item of willBeWordPress) {
    await Source.update(
      { feed_type: "wordpress", wp_api_url: item.wpApiUrl },
      { where: { slug: item.slug } },
    );
  }
  for (const item of willBeRss) {
    // wp_api_url is cleared as well: a stale URL would be used in preference to
    // re-deriving one, and would silently point at an API that no longer works.
    await Source.update(
      { feed_type: "rss", wp_api_url: null },
      { where: { slug: item.slug } },
    );
  }

  console.log(`\nApplied. ${willBeWordPress.length} WordPress, ${willBeRss.length} RSS.`);
  await sequelize.close();
  process.exit(0);
})().catch(async (err) => {
  console.error("setup-wordpress-sources failed:", err.message);
  try {
    await sequelize.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
