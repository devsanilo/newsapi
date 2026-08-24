const Parser = require("rss-parser");
const { generateHash } = require("../utils/hash");
const { cleanText, toCanonicalCategory } = require("../utils/categories");
const logger = require("../utils/logger");

const parser = new Parser({
  headers: {
    "User-Agent": "Noozia-VideoFetcher/1.0",
  },
  timeout: 10000,
});

const DEFAULT_TTL_MS = 5 * 60 * 1000;
let cachedVideos = [];
let cachedAt = 0;

function getFeedUrls() {
  const raw = process.env.VIDEO_FEED_URLS || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function looksLikeImage(url) {
  return /(\.jpg|\.jpeg|\.png|\.webp|\.gif)$/i.test(url || "");
}

function extractSourceName(feedUrl, link) {
  try {
    const url = new URL(feedUrl || link);
    return url.hostname.replace(/^www\./, "");
  } catch (err) {
    return "video";
  }
}

function parseDuration(value) {
  if (!value) return null;
  const asNumber = Number(value);
  if (!Number.isNaN(asNumber) && asNumber > 0) return asNumber;
  // ISO 8601 duration like PT5M30S
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(String(value));
  if (!match) return null;
  const [, h, m, s] = match.map((x) => Number(x) || 0);
  return h * 3600 + m * 60 + s;
}

function normalizeItem(item, feedUrl) {
  const videoUrl = item.enclosure?.url || item.link;
  if (!videoUrl) return null;

  const publishedRaw =
    item.isoDate || item.pubDate || item.published || item.date;
  const publishedAt = publishedRaw ? new Date(publishedRaw) : null;
  const source = extractSourceName(feedUrl, item.link);
  const title = item.title || source;
  const hash = generateHash(title, source, publishedAt || new Date());

  let poster = null;
  if (looksLikeImage(item.enclosure?.url)) poster = item.enclosure.url;
  if (!poster && item["media:thumbnail"]?.url)
    poster = item["media:thumbnail"].url;
  if (!poster && Array.isArray(item.enclosure)) {
    const img = item.enclosure.find((e) => looksLikeImage(e.url));
    if (img) poster = img.url;
  }

  const durationSeconds = parseDuration(
    item["media:content"]?.duration ||
      item.enclosure?.length ||
      item.itunes?.duration,
  );

  const categories = Array.isArray(item.categories) ? item.categories : [];
  const category = categories.length
    ? toCanonicalCategory(cleanText(categories[0]), "entertainment")
    : "entertainment";

  return {
    id: hash,
    title,
    description: item.contentSnippet || item.summary || "",
    video_url: videoUrl,
    poster_url: poster,
    duration_seconds: durationSeconds,
    source,
    category,
    published_at: publishedAt ? publishedAt.toISOString() : null,
  };
}

async function fetchAllFeeds() {
  const feedUrls = getFeedUrls();
  if (!feedUrls.length) {
    return [];
  }

  const results = await Promise.all(
    feedUrls.map(async (url) => {
      try {
        const feed = await parser.parseURL(url);
        return (feed.items || [])
          .map((item) => normalizeItem(item, url))
          .filter(Boolean);
      } catch (err) {
        logger.warn(`Video feed fetch failed for ${url}: ${err.message}`);
        return [];
      }
    }),
  );

  return results.flat().sort((a, b) => {
    const aTime = a.published_at ? new Date(a.published_at).getTime() : 0;
    const bTime = b.published_at ? new Date(b.published_at).getTime() : 0;
    return bTime - aTime;
  });
}

class VideoService {
  async getVideos({ page = 1, limit = 20 } = {}) {
    const ttl =
      parseInt(process.env.VIDEO_FEED_CACHE_TTL_MS, 10) || DEFAULT_TTL_MS;
    const now = Date.now();

    if (cachedVideos.length && now - cachedAt < ttl) {
      return this._paginate(cachedVideos, page, limit);
    }

    const videos = await fetchAllFeeds();
    cachedVideos = videos;
    cachedAt = now;
    return this._paginate(videos, page, limit);
  }

  _paginate(items, page, limit) {
    const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 20, 50));
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const offset = (safePage - 1) * safeLimit;
    const slice = items.slice(offset, offset + safeLimit);

    return {
      data: slice,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: items.length,
        totalPages: Math.ceil(items.length / safeLimit) || 0,
        hasNext: offset + safeLimit < items.length,
        hasPrev: safePage > 1,
      },
    };
  }
}

module.exports = new VideoService();
