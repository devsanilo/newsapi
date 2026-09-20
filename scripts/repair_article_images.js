#!/usr/bin/env node
/**
 * Repair article lead images that were stored with a publisher brand asset.
 *
 * Why this is needed
 * ------------------
 * Feeds like Punch expose one image URL on every item (their masthead in
 * `<enclosure>`), and the crawler used to accept it. Because the og:image
 * fallback only runs for articles with NO image, the real photo was never
 * fetched. And ingestion uses `INSERT IGNORE`, so re-crawling never corrects an
 * existing row — the bad value is permanent without a repair like this one.
 *
 * What it does
 * ------------
 * 1. Finds suspect rows: an image URL that looks like a brand asset, or that is
 *    shared by several articles from the same source.
 * 2. Re-fetches `og:image` from the article page.
 * 3. Updates the row in place (a normal UPDATE, so it actually applies).
 *
 * The same logic backs the admin "Reload image" action — see
 * src/services/articleImageService.js. This file is only the CLI around it.
 *
 * Usage
 * -----
 *   node scripts/repair_article_images.js                 # dry run (default)
 *   node scripts/repair_article_images.js --apply         # write changes
 *   node scripts/repair_article_images.js --source=punch --apply
 *   node scripts/repair_article_images.js --limit=20 --apply
 *
 * Always run the dry run first and read the diff.
 */
require("dotenv").config();

const { sequelize } = require("../src/database/connection");
const imageService = require("../src/services/articleImageService");
const logger = require("../src/utils/logger");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const DRY_RUN = !APPLY;
const sourceArg = args.find((a) => a.startsWith("--source="));
const SOURCE = sourceArg ? sourceArg.split("=")[1] : null;
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : 200;
const scanArg = args.find((a) => a.startsWith("--scan="));
const SCAN = scanArg ? parseInt(scanArg.split("=")[1], 10) : 500;

function short(url) {
  return String(url || "").replace(/^https?:\/\//, "").slice(0, 88);
}

async function main() {
  await sequelize.authenticate();

  console.log(
    `\nImage repair — ${DRY_RUN ? "DRY RUN (no writes)" : "APPLYING CHANGES"}` +
      `${SOURCE ? ` — source=${SOURCE}` : ""}\n`,
  );

  const report = await imageService.repairMany({
    source: SOURCE,
    scanLimit: SCAN,
    limit: LIMIT,
    persist: APPLY,
  });

  console.log(`rows scanned : ${report.scanned}`);
  console.log(`suspect rows : ${report.suspects}`);
  console.log(`processing   : ${report.processed}\n`);

  if (report.processed === 0) {
    console.log("Nothing to repair.\n");
    await sequelize.close();
    return;
  }

  for (const { row, status, candidate } of report.results) {
    if (status !== "would-update" && status !== "updated") continue;
    console.log(`[${status}] ${row.source} — ${String(row.title).slice(0, 52)}`);
    console.log(`     was: ${short(row.image_url)}`);
    console.log(`     now: ${short(candidate)}\n`);
  }

  console.log("summary:");
  for (const [status, count] of Object.entries(report.tally).sort()) {
    console.log(`  ${status.padEnd(20)} ${count}`);
  }
  if (report.remaining > 0) {
    console.log(`\n  ${report.remaining} suspect row(s) left unprocessed — raise --limit.`);
  }
  if (DRY_RUN) {
    console.log("\nRe-run with --apply to write these changes.\n");
  } else {
    console.log("");
  }

  await sequelize.close();
}

main().catch(async (error) => {
  logger.error(`Image repair failed: ${error.message}`);
  console.error("Image repair failed:", error.message);
  try {
    await sequelize.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
