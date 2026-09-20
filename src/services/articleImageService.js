/**
 * Article lead-image resolution and repair.
 *
 * Feeds sometimes expose a publisher brand asset where article photography
 * belongs. Punch is the canonical case: every item carries the same
 * `<enclosure>` pointing at their masthead, so the logo was stored as the lead
 * image for the whole source and the og:image fallback never ran — that
 * fallback only handles articles with NO image at all.
 *
 * The crawler now rejects those URLs on ingestion, but ingestion uses
 * `INSERT IGNORE`, so re-crawling never corrects a row that already exists.
 * Repair therefore has to be an explicit UPDATE. That is what this module
 * does, for both the admin "reload image" action and
 * `scripts/repair_article_images.js` — one implementation, two callers.
 */

const { News } = require("../models");
const crawler = require("../crawlers/rssCrawler");
const logger = require("../utils/logger");

/** Same signals the crawler uses to reject a feed image. */
const BRAND_ASSET_PATTERNS = [
  /logo/i,
  /(^|[/_.-])header[-_.]/i,
  /placeholder/i,
  /(^|[/_.-])default[-_]?(image|thumb)/i,
  /favicon/i,
];

/** One URL reused by this many articles from a source is a brand asset. */
const SHARED_IMAGE_THRESHOLD = 3;

const STATUS = {
  NO_URL: "no-url",
  FETCH_FAILED: "fetch-failed",
  NO_OG_IMAGE: "no-og-image",
  UNCHANGED: "unchanged",
  OG_IS_BRAND_ASSET: "og-is-brand-asset",
  RESOLVED: "resolved",
  UPDATED: "updated",
  WOULD_UPDATE: "would-update",
};

function looksLikeBrandAsset(url) {
  if (!url) return false;
  return BRAND_ASSET_PATTERNS.some((re) => re.test(url));
}

/**
 * og:image values are frequently protocol-relative or root-relative, and can
 * still carry HTML entities from the markup.
 */
function normalizeImageUrl(candidate, pageUrl) {
  if (!candidate) return null;
  const raw = String(candidate).trim().replace(/&amp;/g, "&");
  if (!raw) return null;
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("/")) {
    try {
      return new URL(raw, pageUrl).toString();
    } catch {
      return null;
    }
  }
  return raw;
}

/**
 * Look up the real photo for an article without touching the database.
 * Returns `{ status, candidate? }` where `resolved` means a better image was
 * found and `candidate` holds it.
 */
async function resolveArticleImage(article) {
  if (!article || !article.url) return { status: STATUS.NO_URL };

  let raw = null;
  try {
    raw = await crawler._fetchOgImage(article.url);
  } catch {
    return { status: STATUS.FETCH_FAILED };
  }

  const candidate = normalizeImageUrl(raw, article.url);
  if (!candidate) return { status: STATUS.NO_OG_IMAGE };
  if (candidate === article.image_url) {
    return { status: STATUS.UNCHANGED, candidate };
  }
  // The page's own og:image can be a brand asset too; writing it would swap
  // one logo for another.
  if (looksLikeBrandAsset(candidate)) {
    return { status: STATUS.OG_IS_BRAND_ASSET, candidate };
  }

  return { status: STATUS.RESOLVED, candidate };
}

/**
 * Re-fetch one article's lead image and, unless `persist` is false, write it.
 */
async function refreshArticleImage(article, { persist = true } = {}) {
  const previous = article?.image_url ?? null;
  const resolved = await resolveArticleImage(article);

  if (resolved.status !== STATUS.RESOLVED) {
    return { ...resolved, previous, changed: false };
  }
  if (!persist) {
    return { ...resolved, status: STATUS.WOULD_UPDATE, previous, changed: false };
  }

  await News.update(
    { image_url: resolved.candidate },
    { where: { id: article.id } },
  );
  return { ...resolved, status: STATUS.UPDATED, previous, changed: true };
}

/** Convenience wrapper used by the admin API. */
async function refreshArticleImageById(id, options = {}) {
  const article = await News.findByPk(id, {
    attributes: ["id", "title", "url", "source", "image_url"],
    raw: true,
  });
  if (!article) return { status: "not-found" };
  const result = await refreshArticleImage(article, options);
  return { ...result, article };
}

/**
 * Rows whose lead image is a brand asset by URL, or one URL shared by several
 * articles from the same source.
 *
 * `scanLimit` bounds how many recent rows are inspected; pass null to scan the
 * whole table (fine for the CLI, too heavy for an HTTP request).
 */
async function findSuspects({ source = null, scanLimit = 500 } = {}) {
  const query = {
    attributes: ["id", "title", "url", "source", "image_url", "published_at"],
    order: [["published_at", "DESC"]],
    raw: true,
  };
  if (source) query.where = { source };
  if (scanLimit) query.limit = scanLimit;

  const rows = await News.findAll(query);

  // Count how often each (source, image_url) pair occurs within the window.
  const pairCounts = new Map();
  for (const r of rows) {
    if (!r.image_url) continue;
    const key = `${r.source}||${r.image_url}`;
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }

  const suspects = [];
  for (const r of rows) {
    // An article with no URL cannot be repaired — there is nothing to fetch.
    if (!r.url) continue;
    const brand = looksLikeBrandAsset(r.image_url);
    const shared = r.image_url
      ? pairCounts.get(`${r.source}||${r.image_url}`) || 0
      : 0;
    if (brand || shared >= SHARED_IMAGE_THRESHOLD) {
      suspects.push({
        ...r,
        reason: brand ? "brand-asset-url" : `shared-by-${shared}`,
      });
    }
  }
  return { rows, suspects };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Repair a batch of suspect rows with a small worker pool.
 * Returns a tally plus per-article results so a caller can report progress.
 */
async function repairMany({
  source = null,
  scanLimit = 500,
  limit = 25,
  persist = true,
  concurrency = 5,
} = {}) {
  const { rows, suspects } = await findSuspects({ source, scanLimit });
  const targets = suspects.slice(0, limit);

  const tally = {};
  const results = [];

  for (let i = 0; i < targets.length; i += concurrency) {
    const chunk = targets.slice(i, i + concurrency);
    const settled = await Promise.all(
      chunk.map(async (row) => {
        try {
          const outcome = await refreshArticleImage(row, { persist });
          return { row, ...outcome };
        } catch (error) {
          logger.warn(`Image refresh failed for ${row.id}: ${error.message}`);
          return { row, status: STATUS.FETCH_FAILED, previous: row.image_url };
        }
      }),
    );

    for (const item of settled) {
      tally[item.status] = (tally[item.status] || 0) + 1;
      results.push(item);
    }
    // Stagger between batches so we do not hammer the publisher's origin.
    if (i + concurrency < targets.length) await sleep(250);
  }

  return {
    scanned: rows.length,
    suspects: suspects.length,
    processed: targets.length,
    remaining: Math.max(0, suspects.length - targets.length),
    tally,
    results,
  };
}

module.exports = {
  BRAND_ASSET_PATTERNS,
  SHARED_IMAGE_THRESHOLD,
  STATUS,
  looksLikeBrandAsset,
  normalizeImageUrl,
  resolveArticleImage,
  refreshArticleImage,
  refreshArticleImageById,
  findSuspects,
  repairMany,
};
