/**
 * Flag each source as WordPress or RSS.
 *
 * Probes `<site>/wp-json/wp/v2/posts` for every active source and records the
 * result on the source row:
 *
 *   feed_type  'wordpress' → ingest the complete post via the REST API. The row
 *                            is held unpublished until the rewrite pipeline
 *                            turns it into a Trenxi article.
 *   feed_type  'rss'       → headline highlight. Published immediately, links
 *                            out to the publisher, never rewritten.
 *
 * Detection is a probe rather than a hardcoded list because the answer is a
 * property of the publisher's stack, not of this codebase — it changes when a
 * site is rebuilt, moves off WordPress, or starts blocking the REST API.
 *
 * The same code is exposed as POST /api/crawler/detect-wordpress for running
 * against an environment with no shell access (production), so the two paths
 * cannot drift apart.
 *
 *   node scripts/setup-wordpress-sources.js            # dry run
 *   node scripts/setup-wordpress-sources.js --apply    # write the result
 *   node scripts/setup-wordpress-sources.js --apply --slug punch,vanguard
 */

require("dotenv").config();

const { sequelize } = require("../src/database/connection");
const sourceDetectionService = require("../src/services/sourceDetectionService");

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

  console.log(
    `${APPLY ? "APPLYING" : "DRY RUN"} — probing active source(s) for a WordPress REST API${ONLY ? ` (${ONLY.join(", ")})` : ""}\n`,
  );

  const detection = await sourceDetectionService.detect({ only: ONLY });

  for (const s of detection.wordpress) {
    const note =
      s.previous === "wordpress" ? "already set" : `was '${s.previous}' → wordpress`;
    console.log(`  WP   ${String(s.slug).padEnd(18)} ${String(s.sampleWords ?? "?").padStart(5)}w sample   ${note}`);
  }
  for (const s of detection.rss) {
    const note =
      s.previous === "wordpress" ? `was 'wordpress' → rss (${s.reason})` : String(s.reason).slice(0, 50);
    console.log(`  --   ${String(s.slug).padEnd(18)} ${"".padStart(5)}           ${note}`);
  }

  console.log(`\n=== summary ===`);
  console.log(`  WordPress (full articles, rewritten): ${detection.wordpress.length}`);
  console.log(`  RSS (highlights, no article page):     ${detection.rss.length}`);
  console.log(`  rows needing a change:                 ${detection.changed.length}`);

  if (!APPLY) {
    console.log(`\nDry run — nothing written. Re-run with --apply to persist.`);
    await sequelize.close();
    return;
  }

  const applied = await sourceDetectionService.apply(detection);
  console.log(
    `\nApplied. ${applied.wordpress} WordPress, ${applied.rss} RSS (${applied.changed} changed).`,
  );

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
