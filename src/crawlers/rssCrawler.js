/**
 * RSS Crawler Service
 * Fetches and parses RSS feeds, normalizes articles into unified format
 * Includes robust image extraction with og:image fallback
 */
const RSSParser = require("rss-parser");
const axios = require("axios");
const https = require("https");
const cheerio = require("cheerio");
const { v4: uuidv4 } = require("uuid");
const logger = require("../utils/logger");
const { generateHash } = require("../utils/hash");
const {
  cleanDescription,
  cleanContent,
  extractTags,
  detectLanguage,
} = require("../utils/cleaner");
const { toCanonicalCategory } = require("../utils/categories");

// Configure RSS parser — keep arrays for media fields so we don't miss nested structures
const parser = new RSSParser({
  timeout: 25000,
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; Noozia/1.0)",
    Accept: "application/rss+xml, application/xml, text/xml, */*",
  },
  customFields: {
    item: [
      ["media:content", "media:content", { keepArray: true }],
      ["media:thumbnail", "media:thumbnail", { keepArray: true }],
      ["media:group", "media:group"],
      ["enclosure", "enclosure"],
      ["dc:creator", "creator"],
      ["dc:subject", "dc:subject", { keepArray: true }],
      ["content:encoded", "contentEncoded"],
    ],
  },
});

// Shared HTTP client with optional relaxed TLS (for corp proxies) and retries
const allowInsecure = process.env.ALLOW_INSECURE_SSL === "true";
const HTTP_FIRST_HOSTS = (
  process.env.HTTP_FIRST_HOSTS || "nairametrics.com,punchng.com"
)
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);
const httpsAgent = new https.Agent({ rejectUnauthorized: !allowInsecure });
const httpClient = axios.create({
  timeout: parseInt(process.env.CRAWLER_REQUEST_TIMEOUT_MS, 10) || 25000,
  httpsAgent,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept: "application/rss+xml, application/xml, text/xml, */*",
  },
  // Force IPv4 if IPv6 DNS causes issues
  family: parseInt(process.env.CRAWLER_DNS_FAMILY, 10) || undefined,
});

class RSSCrawler {
  /**
   * Fetch and parse a single RSS feed
   */
  async fetchFeed(feedConfig) {
    const { name, source, category, url, language } = feedConfig;

    try {
      logger.info(`Fetching RSS feed: ${name} (${url})`);
      const xml = await this._fetchWithRetry(url);
      if (!xml) {
        logger.error(`RSS fetch failed after retries: ${name}`);
        return [];
      }

      const feed = await parser.parseString(xml);

      if (!feed || !feed.items || feed.items.length === 0) {
        logger.warn(`No items found in feed: ${name}`);
        return [];
      }

      logger.info(`Found ${feed.items.length} items in feed: ${name}`);

      // Normalize all items
      const articles = feed.items
        .map((item) =>
          this._normalizeItem(item, { source, category, language }),
        )
        .filter((a) => a !== null);

      // Fetch og:image for articles that have no image (batch, with concurrency limit)
      const needImage = articles.filter((a) => !a.image_url);
      if (needImage.length > 0) {
        logger.info(
          `Fetching og:image for ${needImage.length} articles from ${name}`,
        );
        await this._fillOgImages(needImage);
      }

      const withImage = articles.filter((a) => a.image_url).length;
      logger.info(
        `Normalized ${articles.length} articles (${withImage} with images) from: ${name}`,
      );
      return articles;
    } catch (error) {
      logger.error(`Failed to fetch RSS feed "${name}":`, {
        url,
        error: error.message,
      });
      return [];
    }
  }

  async _fetchWithRetry(url) {
    const maxRetries = parseInt(process.env.FEED_MAX_RETRIES, 10) || 3;
    const backoffMs = parseInt(process.env.FEED_RETRY_DELAY_MS, 10) || 2000;
    const referer = this._buildReferer(url);
    const { httpFirst, httpUrl } = this._httpFallback(url);
    const candidateUrls = httpFirst && httpUrl ? [httpUrl, url] : [url];

    const attemptFetch = async (targetUrl) => {
      const { data } = await httpClient.get(targetUrl, {
        responseType: "text",
        transformResponse: [(r) => r],
        headers: referer ? { Referer: referer } : undefined,
        maxRedirects: 5,
      });
      return data;
    };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        for (const target of candidateUrls) {
          try {
            return await attemptFetch(target);
          } catch (innerErr) {
            logger.warn(
              `Fetch attempt ${attempt}/${maxRetries} failed for ${target}: ${innerErr.message}`,
            );
          }
        }
      } catch (err) {
        const last = attempt === maxRetries;
        logger.warn(
          `Fetch attempt ${attempt}/${maxRetries} failed for ${url}: ${err.message}`,
        );

        // If 403 on https, try a one-time downgrade to http to bypass TLS filters
        if (
          !last &&
          err.response?.status === 403 &&
          url.startsWith("https://")
        ) {
          const insecureUrl = url.replace(/^https:\/\//i, "http://");
          try {
            logger.warn(`Retrying over http for ${url}`);
            return await attemptFetch(insecureUrl);
          } catch (innerErr) {
            logger.warn(`HTTP fallback failed for ${url}: ${innerErr.message}`);
          }
        }

        if (last) break;
        await this._sleep(backoffMs);
      }
    }
    return null;
  }

  _buildReferer(url) {
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.host}`;
    } catch (_) {
      return null;
    }
  }

  _httpFallback(url) {
    try {
      const u = new URL(url);
      const host = u.host.toLowerCase();
      if (HTTP_FIRST_HOSTS.includes(host) && u.protocol === "https:") {
        const httpUrl = url.replace(/^https:\/\//i, "http://");
        return { httpFirst: true, httpUrl };
      }
    } catch (_) {
      // ignore
    }
    return { httpFirst: false, httpUrl: null };
  }

  /**
   * Fetch multiple RSS feeds concurrently
   */
  async fetchMultipleFeeds(feedConfigs, concurrency = 3) {
    const allArticles = [];
    const chunks = this._chunkArray(feedConfigs, concurrency);

    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map((config) => this.fetchFeed(config)),
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value.length > 0) {
          allArticles.push(...result.value);
        }
      }

      // Rate limiting between chunks
      if (chunks.indexOf(chunk) < chunks.length - 1) {
        await this._sleep(
          parseInt(process.env.CRAWLER_RATE_LIMIT_MS, 10) || 2000,
        );
      }
    }

    logger.info(`Total articles fetched from RSS: ${allArticles.length}`);
    return allArticles;
  }

  /**
   * Normalize a single RSS item into unified article format
   */
  _normalizeItem(item, { source, category, language }) {
    try {
      const title = item.title?.trim();
      const link = item.link?.trim();
      if (!title || !link) return null;

      // Extract image from RSS data
      const imageUrl = this._extractImageUrl(item);

      // Description
      const rawDescription =
        item.contentSnippet || item.summary || item.content || "";
      const description = cleanDescription(rawDescription);

      // Content (summary only)
      const rawContent = item.contentEncoded || item.content || rawDescription;
      const content = cleanContent(rawContent, 2000);
      const resolvedCategory = this._resolveCategory(item, category);

      // Publication date
      const publishedAt =
        item.pubDate || item.isoDate
          ? new Date(item.pubDate || item.isoDate)
          : new Date();

      const detectedLang =
        language || detectLanguage(title + " " + description);
      const tags = extractTags(title + " " + description + " " + content);

      const normalizedSource = source?.toLowerCase();

      return {
        id: uuidv4(),
        title: title.substring(0, 500),
        description,
        content,
        image_url: imageUrl,
        source: normalizedSource,
        category: resolvedCategory,
        url: link,
        hash: generateHash(title, normalizedSource, publishedAt),
        tags: JSON.stringify(tags),
        language: detectedLang,
        published_at: publishedAt,
        created_at: new Date(),
      };
    } catch (error) {
      logger.warn(`Failed to normalize RSS item: ${error.message}`);
      return null;
    }
  }

  /**
   * Resolve article category from item metadata.
   * Priority:
   * 1. RSS item categories/tags (if present and meaningful)
   * 2. Source default category
   * 3. "general"
   */
  _resolveCategory(item, fallbackCategory) {
    const genericBuckets = new Set([
      "news",
      "latest",
      "top stories",
      "breaking news",
      "breaking",
      "updates",
      "featured",
      "home",
      "rss",
    ]);

    const candidates = [
      ...(Array.isArray(item.categories) ? item.categories : []),
      item.category,
      ...(Array.isArray(item["dc:subject"])
        ? item["dc:subject"]
        : item["dc:subject"]
          ? [item["dc:subject"]]
          : []),
      ...(Array.isArray(item.tags) ? item.tags : []),
      item.genre,
      fallbackCategory,
    ];

    for (const candidate of candidates) {
      const normalized = this._normalizeCategoryValue(candidate);
      if (!normalized) continue;
      if (genericBuckets.has(normalized)) continue;
      const canonical = toCanonicalCategory(normalized, null);
      if (canonical) return canonical;
    }

    return toCanonicalCategory(fallbackCategory, "general");
  }

  /**
   * Normalize free-form category-like values from RSS metadata.
   */
  _normalizeCategoryValue(value) {
    if (!value) return null;

    let text = "";
    if (typeof value === "string") {
      text = value;
    } else if (typeof value === "object") {
      text =
        value._ ||
        value["#text"] ||
        value.term ||
        value.label ||
        value.name ||
        value.text ||
        "";
    }

    if (!text || typeof text !== "string") return null;

    const cleaned = text
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[_/|>]+/g, " ")
      .replace(/[^a-z0-9 -]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned) return null;
    return cleaned.slice(0, 100);
  }

  /**
   * Extract image URL from RSS item — handles all common RSS/Atom image patterns
   */
  _extractImageUrl(item) {
    let url = null;

    // 1. media:content (can be array or object)
    url = this._extractFromMedia(item["media:content"]);
    if (url) return url;

    // 2. media:thumbnail (can be array or object)
    url = this._extractFromMedia(item["media:thumbnail"]);
    if (url) return url;

    // 3. media:group > media:content
    if (item["media:group"]) {
      const group = item["media:group"];
      url = this._extractFromMedia(group["media:content"]);
      if (url) return url;
      url = this._extractFromMedia(group["media:thumbnail"]);
      if (url) return url;
    }

    // 4. enclosure (don't require image/ type — many feeds omit it)
    if (item.enclosure) {
      const enc = item.enclosure;
      const encUrl = enc.url || enc.href || (enc.$ && enc.$.url);
      if (encUrl) {
        const type = (enc.type || enc.mime || "").toLowerCase();
        // Accept if type is image, or if URL looks like an image, or if no type specified
        if (
          !type ||
          type.startsWith("image/") ||
          /\.(jpg|jpeg|png|gif|webp|svg)/i.test(encUrl)
        ) {
          return encUrl;
        }
      }
    }

    // 5. Extract <img> from content/contentEncoded HTML
    const htmlContent =
      item.contentEncoded || item.content || item["content:encoded"] || "";
    if (htmlContent) {
      const imgMatch = htmlContent.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch && imgMatch[1]) return imgMatch[1];
    }

    // 6. Extract from description HTML
    const descHtml = item.summary || item.description || "";
    if (descHtml && typeof descHtml === "string") {
      const imgMatch = descHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch && imgMatch[1]) return imgMatch[1];
    }

    // 7. Check for itunes:image or image field (some podcast/news feeds)
    if (item.itunes && item.itunes.image) return item.itunes.image;
    if (item.image && typeof item.image === "string") return item.image;
    if (item.image && item.image.url) return item.image.url;

    return null;
  }

  /**
   * Extract URL from a media:content or media:thumbnail field
   * Handles: object with $, array of objects, nested structures
   */
  _extractFromMedia(media) {
    if (!media) return null;

    // If it's an array, find the first image entry
    if (Array.isArray(media)) {
      for (const entry of media) {
        const url = this._extractFromMediaEntry(entry);
        if (url) return url;
      }
      return null;
    }

    // Single object
    return this._extractFromMediaEntry(media);
  }

  /**
   * Extract URL from a single media entry object
   */
  _extractFromMediaEntry(entry) {
    if (!entry) return null;

    // Direct $ attributes (most common: { $: { url: '...', medium: 'image' } })
    if (entry.$ && entry.$.url) {
      return entry.$.url;
    }

    // Direct url property
    if (entry.url) return entry.url;
    if (entry.href) return entry.href;

    // If entry itself is a string URL
    if (typeof entry === "string" && entry.startsWith("http")) return entry;

    return null;
  }

  /**
   * Fetch og:image from article pages for articles missing images
   * Processes in small batches with stagger to avoid network saturation
   */
  async _fillOgImages(articles) {
    const batchSize = 5;
    const chunks = this._chunkArray(articles, batchSize);
    let filled = 0;

    for (const chunk of chunks) {
      await Promise.allSettled(
        chunk.map(async (article) => {
          try {
            const img = await this._fetchOgImage(article.url);
            if (img) {
              article.image_url = img;
              filled++;
            }
          } catch {
            // Silently skip — image is optional
          }
        }),
      );
      // Stagger between batches to avoid network saturation
      await this._sleep(300);
    }

    logger.info(`og:image filled for ${filled}/${articles.length} articles`);
  }

  /**
   * Fetch og:image meta tag from an article URL
   * Uses streaming to only read the <head> portion, handles large pages
   */
  async _fetchOgImage(url) {
    try {
      const response = await axios.get(url, {
        timeout: 12000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        maxRedirects: 3,
        maxContentLength: 500000, // 500KB to handle large pages like ESPN
        responseType: "text",
      });

      const html = typeof response.data === "string" ? response.data : "";
      if (!html) return null;

      // Only parse the <head> section for speed (meta tags live there)
      const headEnd = html.indexOf("</head>");
      const headHtml =
        headEnd > 0 ? html.substring(0, headEnd + 7) : html.substring(0, 50000);

      const $ = cheerio.load(headHtml);

      // Try og:image first (most reliable)
      let img = $('meta[property="og:image"]').attr("content");
      if (img) return img;

      // Try twitter:image
      img =
        $('meta[name="twitter:image"]').attr("content") ||
        $('meta[name="twitter:image:src"]').attr("content");
      if (img) return img;

      // Try schema.org image
      img = $('meta[itemprop="image"]').attr("content");
      if (img) return img;

      // Try link rel="image_src"
      img = $('link[rel="image_src"]').attr("href");
      if (img) return img;

      return null;
    } catch {
      return null;
    }
  }

  _chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = new RSSCrawler();
