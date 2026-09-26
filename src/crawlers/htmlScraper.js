/**
 * HTML Scraper Service
 * Uses Cheerio for static pages and Puppeteer for dynamic (JS-rendered) pages
 * Supports configurable selectors per source
 */
const axios = require("axios");
const cheerio = require("cheerio");
const { v4: uuidv4 } = require("uuid");
const logger = require("../utils/logger");
const { generateHash } = require("../utils/hash");
const {
  cleanTitle,
  cleanContent,
  cleanDescription,
  extractTags,
  detectLanguage,
} = require("../utils/cleaner");
const { scraperConfigs } = require("../config/sources");

/**
 * Below this many characters, a configured scrape is treated as unconvincing
 * and generic extraction is tried as well. A stale selector does not fail
 * loudly — it returns a short or empty body — so the length is the only signal
 * available that the config no longer matches the page.
 */
const MIN_TRUSTED_CONTENT_CHARS = 400;

class HTMLScraper {
  constructor() {
    this.browser = null;
    this.userAgent =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
  }

  /**
   * Initialize Puppeteer browser instance (lazy loading).
   *
   * Puppeteer is required HERE rather than at module load on purpose. Only one
   * of the ten configured sources (reuters) sets `dynamic`, and the other nine
   * are fetched with plain axios — but a top-level require meant a missing Chromium
   * or an incomplete `node_modules` took down scraping for all ten, including
   * the nine that never needed a browser. Requiring it at the point of use
   * confines the blast radius to the one source that actually needs it.
   */
  async _getBrowser() {
    if (!this.browser || !this.browser.isConnected()) {
      let puppeteer;
      try {
        puppeteer = require("puppeteer");
      } catch (err) {
        const wrapped = new Error(
          `Puppeteer unavailable, so JS-rendered sources cannot be scraped: ${err.message}`,
        );
        wrapped.scraperUnavailable = true;
        throw wrapped;
      }

      this.browser = await puppeteer.launch({
        headless: process.env.PUPPETEER_HEADLESS !== "false" ? "new" : false,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-web-security",
          "--window-size=1920,1080",
        ],
        timeout: parseInt(process.env.PUPPETEER_TIMEOUT, 10) || 30000,
      });
      logger.info("Puppeteer browser launched.");
    }
    return this.browser;
  }

  /**
   * Close Puppeteer browser
   */
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info("Puppeteer browser closed.");
    }
  }

  /**
   * Scrape a single article URL using the appropriate method
   * @param {string} url - Article URL
   * @param {string} sourceKey - Source identifier (e.g., 'bbc', 'reuters')
   * @param {Object} overrides - Optional selector overrides
   * @returns {Object|null} - Scraped article data or null
   */
  async scrapeArticle(url, sourceKey, overrides = {}) {
    const config = { ...(scraperConfigs[sourceKey] || {}), ...overrides };
    const hasSelectorConfig = Boolean(config.titleSelector);

    try {
      logger.info(
        `Scraping article: ${url} (source: ${sourceKey || "unconfigured"}, dynamic: ${Boolean(config.dynamic)}, ${hasSelectorConfig ? "configured selectors" : "generic extraction"})`,
      );

      let html;
      if (config.dynamic) {
        html = await this._fetchDynamic(url);
      } else {
        html = await this._fetchStatic(url);
      }

      if (!html) {
        logger.warn(`No HTML content retrieved from: ${url}`);
        return null;
      }

      // Sources without a selector config still get scraped. Returning null
      // here (the previous behaviour) meant the AI pipeline could not fetch a
      // source page for 83% of the corpus, because scraperConfigs only covers a
      // curated subset of the publishers the feeds draw from.
      if (!hasSelectorConfig) {
        return this._parseGeneric(html, url, config, sourceKey);
      }

      const parsed = this._parseArticle(html, url, config);

      // Configured selectors go stale: a publisher redesign silently yields an
      // empty or near-empty body, which looks like SUCCESS to the caller and
      // only surfaces later as a thin article. Measured on live data, several
      // configured sources (aljazeera, football365) returned 0 characters while
      // generic extraction of the same page returned hundreds of words. So when
      // the configured parse is unconvincing, re-parse generically and keep
      // whichever actually found more text.
      const configuredChars = (parsed?.content || "").length;
      if (configuredChars >= MIN_TRUSTED_CONTENT_CHARS) return parsed;

      const generic = this._parseGeneric(html, url, config, sourceKey);
      if (!generic) return parsed;
      if (!parsed) return generic;

      if (generic.content.length > configuredChars) {
        logger.info(
          `Scraper: configured selectors for "${sourceKey}" produced ${configuredChars} chars; generic extraction found ${generic.content.length}. Using generic.`,
        );
        return generic;
      }
      return parsed;
    } catch (error) {
      logger.error(`Failed to scrape article: ${url}`, {
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Scrape multiple articles
   * @param {Array} urls - Array of { url, sourceKey } objects
   * @param {number} concurrency - Max concurrent scrapes
   * @returns {Array} - Scraped articles
   */
  async scrapeMultiple(urls, concurrency = 2) {
    const results = [];
    const chunks = [];

    for (let i = 0; i < urls.length; i += concurrency) {
      chunks.push(urls.slice(i, i + concurrency));
    }

    for (const chunk of chunks) {
      const chunkResults = await Promise.allSettled(
        chunk.map(({ url, sourceKey }) => this.scrapeArticle(url, sourceKey)),
      );

      for (const result of chunkResults) {
        if (result.status === "fulfilled" && result.value) {
          results.push(result.value);
        }
      }

      // Rate limiting
      const delay = parseInt(process.env.CRAWLER_RATE_LIMIT_MS, 10) || 2000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    // Close browser after batch scraping
    await this.closeBrowser();

    return results;
  }

  /**
   * Fetch HTML from a static page using Axios
   * @param {string} url
   * @returns {string|null}
   */
  async _fetchStatic(url) {
    try {
      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          "User-Agent": this.userAgent,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
        maxRedirects: 5,
      });
      return response.data;
    } catch (error) {
      logger.error(`Static fetch failed for ${url}: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch HTML from a dynamic (JS-rendered) page using Puppeteer
   * @param {string} url
   * @returns {string|null}
   */
  async _fetchDynamic(url) {
    let page = null;
    try {
      const browser = await this._getBrowser();
      page = await browser.newPage();

      await page.setUserAgent(this.userAgent);
      await page.setViewport({ width: 1920, height: 1080 });

      // Block unnecessary resources for faster loading
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const resourceType = req.resourceType();
        if (["image", "stylesheet", "font", "media"].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: parseInt(process.env.PUPPETEER_TIMEOUT, 10) || 30000,
      });

      // Wait a bit for any lazy-loaded content
      await page.waitForTimeout(2000);

      const html = await page.content();
      return html;
    } catch (error) {
      logger.error(`Dynamic fetch failed for ${url}: ${error.message}`);
      return null;
    } finally {
      if (page) {
        await page.close();
      }
    }
  }

  /**
   * Parse article data from HTML using configured selectors
   * @param {string} html - Raw HTML
   * @param {string} url - Article URL
   * @param {Object} config - Scraper configuration
   * @returns {Object|null}
   */
  /**
   * Extract an article from ANY publisher, without a per-source config.
   *
   * `scraperConfigs` only covers a curated set of sources (10 at the time of
   * writing), but the corpus draws from far more — 83% of rows had no config,
   * so the AI rewrite pipeline could not fetch a source page for the vast
   * majority of the articles it was meant to rewrite. Per-source selectors do
   * not scale to that; this is the fallback that makes the long tail reachable.
   *
   * Deliberately heuristic and dependency-free: prefer semantic containers,
   * then fall back to the largest run of ordinary paragraphs. Short paragraphs
   * are dropped because they are usually captions, bylines or navigation.
   *
   * Returns the same shape as `_parseArticle` so callers cannot tell them apart.
   */
  _parseGeneric(html, url, config = {}, sourceKey = null) {
    try {
      const $ = cheerio.load(html);

      // Remove chrome first, so menu and footer copy cannot be mistaken for
      // article text by the paragraph heuristics below.
      $(
        "script, style, noscript, nav, aside, footer, header, form, iframe, svg, button",
      ).remove();

      const metaValue = (selector) => ($(selector).attr("content") || "").trim();

      const title = cleanTitle(
        metaValue('meta[property="og:title"]') ||
          $("h1").first().text() ||
          $("title").text() ||
          "",
      );
      if (!title) {
        logger.warn(`Generic parse found no usable title for: ${url}`);
        return null;
      }

      const description = cleanDescription(
        metaValue('meta[property="og:description"]') ||
          metaValue('meta[name="description"]') ||
          "",
      );

      // Ordered by reliability. The FIRST selector yielding a substantial body
      // wins — concatenating them all would mix in summary boxes and related
      // links alongside the actual article.
      const candidateSelectors = [
        '[itemprop="articleBody"] p',
        "article p",
        ".article-body p",
        ".articleBody p",
        ".article__body p",
        ".story-body p",
        ".post-content p",
        ".entry-content p",
        '[class*="article-body"] p',
        '[class*="articleBody"] p',
        '[class*="story-body"] p',
        '[class*="post-content"] p',
        '[class*="entry-content"] p',
        "main p",
      ];

      const collect = (selector) =>
        $(selector)
          .map((_, el) => $(el).text().trim())
          .get()
          .filter((text) => text.length >= 60)
          .join(" ");

      let body = "";
      let usedSelector = null;
      for (const selector of candidateSelectors) {
        const text = collect(selector);
        if (text.length > body.length) {
          body = text;
          usedSelector = selector;
        }
      }

      // Nothing matched a known container — take the largest run of ordinary
      // paragraphs anywhere on the page instead.
      if (body.length < 600) {
        const loose = collect("p");
        if (loose.length > body.length) {
          body = loose;
          usedSelector = "p (loose fallback)";
        }
      }

      const contentLimit = Number(config.contentLimit) || 2000;
      const content = cleanContent(body, contentLimit);

      const imageUrl =
        metaValue('meta[property="og:image"]') ||
        $("article img").first().attr("src") ||
        null;

      const tags = extractTags(`${title} ${description} ${content}`);
      const language = detectLanguage(`${title} ${description}`);
      const publishedAt = new Date();
      const normalizedSource = (sourceKey || "").toLowerCase();

      logger.debug(
        `Generic parse: ${url} -> ${content.length} chars via "${usedSelector}"`,
      );

      return {
        id: uuidv4(),
        title,
        description,
        content,
        image_url: imageUrl,
        source: normalizedSource || null,
        category: null,
        url,
        hash: generateHash(title, normalizedSource, publishedAt),
        tags: JSON.stringify(tags),
        language,
        published_at: publishedAt,
        created_at: new Date(),
      };
    } catch (error) {
      logger.error(`Failed to generically parse article HTML: ${error.message}`);
      return null;
    }
  }

  _parseArticle(html, url, config) {
    try {
      const $ = cheerio.load(html);

      // Extract title
      const title = cleanTitle($(config.titleSelector).first().text());
      if (!title) {
        logger.warn(`No title found for: ${url}`);
        return null;
      }

      // Extract description
      let description = "";
      if (config.descriptionSelector) {
        if (config.descriptionAttr) {
          description =
            $(config.descriptionSelector).attr(config.descriptionAttr) || "";
        } else {
          description = $(config.descriptionSelector).first().text().trim();
        }
      }
      description = cleanDescription(description);

      // Extract content (paragraphs)
      let contentParts = [];
      $(config.contentSelector).each((_, el) => {
        const text = $(el).text().trim();
        if (text) contentParts.push(text);
      });
      // 2000 chars is the right cap for a stored aggregated summary, but it is
      // far too thin to rewrite from — this is overridable so the AI pipeline
      // can pull real source text without changing ingest behaviour.
      const contentLimit = Number(config.contentLimit) || 2000;
      const content = cleanContent(contentParts.join(" "), contentLimit);

      // Extract image
      let imageUrl = null;
      if (config.imageSelector) {
        if (config.imageAttr) {
          imageUrl = $(config.imageSelector).attr(config.imageAttr) || null;
        } else {
          imageUrl = $(config.imageSelector).attr("src") || null;
        }
      }

      // Extract tags
      const tags = extractTags(title + " " + description + " " + content);

      // Detect language
      const language = detectLanguage(title + " " + description);

      const publishedAt = new Date();
      const normalizedSource = config.source?.toLowerCase();

      return {
        id: uuidv4(),
        title,
        description,
        content,
        image_url: imageUrl,
        source: normalizedSource,
        category: null, // Category determined by RSS feed config
        url,
        hash: generateHash(title, normalizedSource, publishedAt),
        tags: JSON.stringify(tags),
        language,
        published_at: publishedAt,
        created_at: new Date(),
      };
    } catch (error) {
      logger.error(`Failed to parse article HTML: ${error.message}`);
      return null;
    }
  }
}

module.exports = new HTMLScraper();
