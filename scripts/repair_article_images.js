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

const { Op } = require("sequelize");
const { sequelize } = require("../src/database/connection");
const { News } = require("../src/models");
const crawler = require("../src/crawlers/rssCrawler");
const logger = require("../src/utils/logger");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const DRY_RUN = !APPLY;
const sourceArg = args.find((a) => a.startsWith("--source="));
const SOURCE = sourceArg ? sourceArg.split("=")[1] : null;
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : 200;
const CONCURRENCY = 5;

/** Same signals the crawler uses to reject a feed image. */
const BRAND_ASSET_PATTERNS = [
  /logo/i,
  /(^|[/_.-])header[-_.]/i,
  /placeholder/i,
  /(^|[/_.-])default[-_]?(image|thumb)/i,
  /favicon/i,
];

function looksLikeBrandAsset(url) {
  if (!url) return false;
  return BRAND_ASSET_PATTERNS.some((re) => re.test(url));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Rows whose image is either a brand asset by URL, or one URL shared across
 * several articles from the same source.
 */
async function findSuspects() {
  const where = {};
  if (SOURCE) where.source = SOURCE;

  const rows = await News.findAll({
    where,
    attributes: ["id", "title", "url", "source", "image_url"],
    order: [["published_at", "DESC"]],
    raw: true,
  });

  // Count how often each (source, image_url) pair occurs.
  const pairCounts = new Map();
  for (const r of rows) {
    if (!r.image_url) continue;
    const key = `${r.source}||${r.image_url}`;
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }

  const suspects = [];
  for (const r of rows) {
    if (!r.image_url) continue;
    const shared = pairCounts.get(`${r.source}||${r.image_url}`) || 0;
    const brand = looksLikeBrandAsset(r.image_url);
    // 3+ articles from one source on the same URL is a brand asset, not a photo.
    if (brand || shared >= 3) {
      suspects.push({ ...r, reason: brand ? "brand-asset-url" : `shared-by-${shared}` });
    }
  }
  return suspects;
}

async function repairOne(row) {
  if (!row.url) return { row, status: "no-url" };
  let candidate = null;
  try {
    candidate = await crawler._fetchOgImage(row.url);
  } catch {
    return { row, status: "fetch-failed" };
  }

  if (!candidate) return { row, status: "no-og-image" };
  if (candidate === row.image_url) return { row, status: "unchanged" };
  if (looksLikeBrandAsset(candidate)) return { row, status: "og-is-brand-asset" };

  if (DRY_RUN) return { row, status: "would-update", candidate };

  await News.update({ image_url: candidate }, { where: { id: row.id } });
  return { row, status: "updated", candidate };
}

function short(url) {
  return String(url || "").replace(/^https?:\/\//, "").slice(0, 88);
}

async function main() {
  await sequelize.authenticate();

  console.log(
    `\nImage repair — ${DRY_RUN ? "DRY RUN (no writes)" : "APPLYING CHANGES"}` +
      `${SOURCE ? ` — source=${SOURCE}` : ""}\n`,
  );

  const suspects = await findSuspects();
  const targets = suspects.slice(0, LIMIT);

  console.log(`suspect rows : ${suspects.length}`);
  console.log(`processing   : ${targets.length}\n`);

  if (targets.length === 0) {
    console.log("Nothing to repair.\n");
    await sequelize.close();
    return;
  }

  const tally = {};
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const chunk = targets.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(repairOne));

    for (const { row, status, candidate } of results) {
      tally[status] = (tally[status] || 0) + 1;
      if (status === "would-update" || status === "updated") {
        console.log(`[${status}] ${row.source} — ${String(row.title).slice(0, 52)}`);
        console.log(`     was: ${short(row.image_url)}`);
        console.log(`     now: ${short(candidate)}\n`);
      }
    }
    await sleep(250);
  }

  console.log("summary:");
  for (const [status, count] of Object.entries(tally).sort()) {
    console.log(`  ${status.padEnd(20)} ${count}`);
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
