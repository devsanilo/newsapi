/**
 * HTML Scraper Service
 * Uses Cheerio for static pages and Puppeteer for dynamic (JS-rendered) pages
 * Supports configurable selectors per source
 */
const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer");
const { v4: uuidv4 } = require("uuid");
const logger = require("../utils/logger");
const { generateHash } = require("../utils/hash");
const {
  cleanContent,
  cleanDescription,
  extractTags,
  detectLanguage,
} = require("../utils/cleaner");
const { scraperConfigs } = require("../config/sources");

class HTMLScraper {
  constructor() {
    this.browser = null;
    this.userAgent =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
  }

  /**
   * Initialize Puppeteer browser instance (lazy loading)
   */
  async _getBrowser() {
    if (!this.browser || !this.browser.isConnected()) {
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

    if (!config.titleSelector) {
      logger.warn(`No scraper config found for source: ${sourceKey}`);
      return null;
    }

    try {
      logger.info(
        `Scraping article: ${url} (source: ${sourceKey}, dynamic: ${config.dynamic})`,
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

      return this._parseArticle(html, url, config);
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
  _parseArticle(html, url, config) {
    try {
      const $ = cheerio.load(html);

      // Extract title
      const title = $(config.titleSelector).first().text().trim();
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
      const content = cleanContent(contentParts.join(" "), 2000);

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
        title: title.substring(0, 500),
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
