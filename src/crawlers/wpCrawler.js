/**
 * WordPress REST Crawler
 *
 * Reads complete posts from a WordPress site's public REST API:
 *   GET {base}/wp-json/wp/v2/posts?per_page=20
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Every source used to be RSS, and RSS only carries a summary. Full text had to
 * be scraped back off the publisher's article page, and that scrape failed or
 * came back nearly empty for a large share of articles — which is exactly why
 * rewrites kept coming out thin. A WordPress site will hand over the complete
 * post on request, so the rewrite pipeline gets real source text and the
 * scrape disappears from the path entirely.
 *
 * These rows are ingested UNPUBLISHED. The publisher's own text is never served
 * to readers; the row only goes live once a rewrite has been generated and
 * applied, at which point `content_type` becomes 'rewritten'. A row that never
 * rewrites successfully simply stays invisible.
 *
 * Rows are marked `ingest_type = 'wordpress'`, which is what makes them
 * eligible for the rewrite queue. RSS rows are `ingest_type = 'rss'`: they are
 * headline highlights that link out to the publisher and are never rewritten.
 */

const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const logger = require("../utils/logger");
const { generateHash } = require("../utils/hash");
const { toCanonicalCategory } = require("../utils/categories");
const {
  cleanTitle,
  cleanDescription,
  htmlToParagraphText,
  extractTags,
  detectLanguage,
} = require("../utils/cleaner");

const DEFAULT_PER_PAGE = Number(process.env.WP_PER_PAGE || 20);
// Generous: a long-form WordPress post can run to several thousand words. The
// model prompt is truncated separately, so this only bounds the DB column.
const CONTENT_CHAR_LIMIT = Number(process.env.WP_CONTENT_CHARS || 20000);
// Posts shorter than this carry too little to rewrite honestly, and a rewrite
// can only be as substantial as its source — a 157-word post produced a
// 147-word article, which is the thin output this pipeline exists to avoid.
// Raised from 120 to 250 after measuring the real corpus: that drops 45 of 218
// posts (21%), almost all of them short daily-post briefs, and keeps the rest.
const MIN_CONTENT_WORDS = Number(process.env.WP_MIN_CONTENT_WORDS || 250);

const USER_AGENT =
  process.env.CRAWLER_USER_AGENT ||
  "Mozilla/5.0 (compatible; TrenxiBot/1.0; +https://trenxi.com)";

class WPCrawler {
  /**
   * Ask whether a site exposes the WordPress REST API.
   *
   * Used when flagging sources rather than at ingest time, so a publisher that
   * later blocks the API is handled per crawl (and logged) instead of silently
   * flipping every source back to RSS.
   *
   * @param {string} baseUrl - Site root, e.g. https://example.com
   * @returns {Promise<{supported: boolean, wpApiUrl?: string, reason?: string, sample?: Object}>}
   */
  async detect(baseUrl) {
    const wpApiUrl = `${String(baseUrl || "").replace(/\/+$/, "")}/wp-json/wp/v2`;
    try {
      // Uses the SAME request shape as the plain ingest path, so a source is
      // only ever flagged WordPress if the request we will actually make
      // works. Probing with a richer request would mark sources that then fail
      // on every crawl.
      const posts = await this._request(`${wpApiUrl}/posts`, {
        params: { per_page: 1, orderby: "date", order: "desc" },
      });
      if (!Array.isArray(posts)) {
        return { supported: false, reason: "response was not a post array" };
      }
      if (posts.length === 0) {
        return { supported: false, reason: "API reachable but returned no posts" };
      }
      const words = htmlToParagraphText(posts[0].content?.rendered || "")
        .split(/\s+/)
        .filter(Boolean).length;
      return {
        supported: true,
        wpApiUrl,
        sample: { link: posts[0].link, words },
      };
    } catch (err) {
      return { supported: false, reason: err.message };
    }
  }

  /**
   * Fetch and normalise the latest posts for one source row.
   *
   * @param {Object} source - Raw row from the `sources` table
   * @param {Object} [opts] - { perPage }
   * @returns {Promise<Array>} Normalised article objects ready to store
   */
  async fetchFromSource(source, { perPage = DEFAULT_PER_PAGE } = {}) {
    const wpApiUrl =
      source.wp_api_url ||
      `${String(source.url || "").replace(/\/+$/, "")}/wp-json/wp/v2`;

    const posts = await this._fetchPosts(wpApiUrl, perPage);
    if (!Array.isArray(posts)) {
      throw new Error(
        `WordPress API returned ${typeof posts} instead of an array (${source.slug})`,
      );
    }

    const articles = [];
    let tooShort = 0;

    for (const post of posts) {
      const article = this._normalizePost(post, source);
      if (!article) continue;
      if (article._words < MIN_CONTENT_WORDS) {
        tooShort += 1;
        continue;
      }
      delete article._words;
      articles.push(article);
    }

    logger.info(
      `WordPress ${source.slug}: ${posts.length} posts fetched, ${articles.length} usable` +
        (tooShort ? `, ${tooShort} skipped as too short (<${MIN_CONTENT_WORDS} words)` : ""),
    );

    return articles;
  }

  /**
   * Fetch posts, preferring embedded media for the featured image and category.
   *
   * `_embed` inlines the featured media and terms, which saves a request per
   * post — but it is the first thing a publisher's WAF blocks, and it does so
   * with HTTP 200 and an HTML body, so a naive client mistakes the block for
   * success. premiumtimes does exactly this, and refuses `_fields` beyond the
   * bare minimum as well. Hence: try the rich request, and on anything that is
   * not a post array fall back to the plain one, which is what detection
   * verified. Fields are never requested explicitly, because filtering them is
   * itself what trips some WAFs.
   */
  async _fetchPosts(wpApiUrl, perPage) {
    const base = { per_page: perPage, orderby: "date", order: "desc" };

    try {
      const embedded = await this._request(`${wpApiUrl}/posts`, {
        params: { ...base, _embed: 1 },
      });
      if (Array.isArray(embedded)) return embedded;
      logger.warn(
        `WordPress: embedded request returned ${typeof embedded} for ${wpApiUrl} — falling back to the plain payload`,
      );
    } catch (err) {
      logger.warn(
        `WordPress: embedded request failed for ${wpApiUrl} (${err.message}) — falling back to the plain payload`,
      );
    }

    return this._request(`${wpApiUrl}/posts`, { params: base });
  }

  /**
   * GET JSON, with a bounded retry for transient transport faults.
   *
   * Publishers time out intermittently (nairametrics does), and a single
   * timeout should not cost that source's whole crawl run.
   *
   * A non-JSON body is raised as an error rather than returned: it means a bot
   * wall answered instead of WordPress, and treating an HTML error page as data
   * is how a block gets mistaken for a successful, empty crawl.
   */
  async _request(url, { params }) {
    const timeout = Number(process.env.WP_TIMEOUT_MS || 30000);
    const attempts = Math.max(1, Number(process.env.WP_RETRIES || 3));

    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await axios.get(url, {
          params,
          timeout,
          maxRedirects: 3,
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
          validateStatus: () => true,
        });

        if (response.status !== 200) {
          throw new Error(`HTTP ${response.status}`);
        }
        if (typeof response.data === "string") {
          // Axios only leaves the body as a string when it is not JSON.
          throw new Error(
            `expected JSON but received ${response.data.trimStart().startsWith("<") ? "HTML (likely a bot wall)" : "text"}`,
          );
        }
        return response.data;
      } catch (err) {
        lastError = err;
        const status = err?.response?.status;
        const retryable =
          err.code === "ECONNABORTED" ||
          err.code === "ETIMEDOUT" ||
          err.code === "ECONNRESET" ||
          err.code === "EAI_AGAIN" ||
          (status >= 500 && status < 600);

        if (!retryable || attempt === attempts) break;
        logger.warn(
          `WordPress: ${url} ${err.code || `HTTP ${status}`} (attempt ${attempt}/${attempts}) — retrying`,
        );
        await new Promise((r) => setTimeout(r, attempt * 1500));
      }
    }

    throw lastError;
  }

  /**
   * Normalise one WordPress post into the article shape `storeArticles` wants.
   */
  _normalizePost(post, source) {
    try {
      const title = cleanTitle(post?.title?.rendered || "");
      const link = post?.link?.trim();
      if (!title || !link) return null;

      const rawHtml = post?.content?.rendered || "";
      const content = htmlToParagraphText(rawHtml, CONTENT_CHAR_LIMIT);
      if (!content) return null;

      const description = cleanDescription(post?.excerpt?.rendered || "");

      // `date_gmt` is the UTC instant; `date` is site-local with no offset, so
      // using it would silently shift every article by the site's timezone.
      const publishedAt = post?.date_gmt
        ? new Date(`${post.date_gmt}Z`)
        : post?.date
          ? new Date(post.date)
          : new Date();

      const sourceSlug = String(source.slug || source.source || "").toLowerCase();
      const words = content.split(/\s+/).filter(Boolean).length;

      const tags = extractTags(`${title} ${description} ${content}`);

      return {
        id: uuidv4(),
        title,
        description,
        content,
        image_url: this._imageUrl(post, rawHtml),
        source: sourceSlug,
        category: this._category(post, source),
        url: link,
        hash: generateHash(title, sourceSlug, publishedAt),
        tags: JSON.stringify(tags),
        language: source.language || detectLanguage(`${title} ${description}`),
        published_at: publishedAt,
        created_at: new Date(),

        // Provenance: this is what lets the rewrite queue claim the row.
        ingest_type: "wordpress",
        // Live content is still the publisher's until a rewrite is applied.
        content_type: "aggregated",
        rewrite_status: "none",
        // Held back until a rewrite exists, so publisher text is never served.
        is_published: false,

        // Internal only — stripped before insert.
        _words: words,
      };
    } catch (err) {
      logger.warn(`WordPress: failed to normalise post ${post?.id}: ${err.message}`);
      return null;
    }
  }

  /** Featured image from embedded media, else the first image in the body. */
  _imageUrl(post, rawHtml) {
    const media = post?._embedded?.["wp:featuredmedia"];
    if (Array.isArray(media) && media[0]) {
      const url =
        media[0].source_url ||
        media[0].media_details?.sizes?.full?.source_url ||
        media[0].media_details?.sizes?.large?.source_url;
      if (url) return url;
    }

    const match = String(rawHtml || "").match(
      /<img[^>]+(?:data-src|src)=["']([^"']+\.(?:jpe?g|png|webp|gif)[^"']*)["']/i,
    );
    return match ? match[1] : null;
  }

  /**
   * Map the post's WordPress category onto a Trenxi category.
   *
   * WordPress categories are free text per site ("Politics", "Metro", "Sports
   * Extra"), and the app renders a fixed set, so they are canonicalised with the
   * source's configured category as the fallback.   *
   * Terms are only present when the embedded request succeeded; publishers that
   * block `_embed` simply fall back to the source's own category.   */
  _category(post, source) {
    const fallback = source.category || "general";
    const terms = post?._embedded?.["wp:term"];
    if (Array.isArray(terms)) {
      for (const group of terms) {
        if (!Array.isArray(group)) continue;
        for (const term of group) {
          if (term?.taxonomy === "category" && term?.name) {
            const mapped = toCanonicalCategory(term.name, null);
            if (mapped) return mapped;
          }
        }
      }
    }
    return toCanonicalCategory(fallback, "general");
  }
}

module.exports = new WPCrawler();
