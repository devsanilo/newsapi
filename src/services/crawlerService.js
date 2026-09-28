/**
 * Crawler Service (Orchestrator)
 *
 * Two ingest paths, because the two kinds of source now mean different things:
 *   - feed_type 'rss'       → headline highlights. Published immediately, they
 *                             link out to the publisher, and are never rewritten.
 *   - feed_type 'wordpress' → the WordPress REST API returns the complete post,
 *                             so the row carries real source text and is held
 *                             UNPUBLISHED until the rewrite pipeline turns it
 *                             into a Trenxi article.
 */
const rssCrawler = require('../crawlers/rssCrawler');
const wpCrawler = require('../crawlers/wpCrawler');
const htmlScraper = require('../crawlers/htmlScraper');
const newsService = require('./newsService');
const Source = require('../models/Source');
const logger = require('../utils/logger');

class CrawlerService {
  /**
   * Get active RSS feed configs from the sources table.
   *
   * WordPress sources are excluded: they carry an rss_url too, and ingesting
   * them twice would duplicate every post.
   */
  async _getActiveFeeds() {
    const sources = await Source.findAll({
      where: {
        is_active: true,
        feed_type: 'rss',
        rss_url: { [require('sequelize').Op.ne]: null },
      },
      raw: true,
    });

    return sources.map((s) => ({
      name: s.name,
      source: s.slug,
      category: s.category || 'general',
      url: s.rss_url,
      language: s.language || 'en',
    }));
  }

  /** Active sources read in full via the WordPress REST API. */
  async _getWordPressSources() {
    return Source.findAll({
      where: { is_active: true, feed_type: 'wordpress' },
      order: [['is_local', 'DESC'], ['name', 'ASC']],
      raw: true,
    });
  }

  /**
   * Run a full ingest cycle.
   *
   * RSS and WordPress are run as two independent passes so that a failure in
   * one cannot cost the other — a broken feed or a publisher blocking the REST
   * API should not stop the rest of the corpus from updating.
   */
  async runFullCrawl() {
    const startTime = Date.now();
    logger.info('=== Starting full ingest cycle ===');

    const result = {
      articles: 0,
      inserted: 0,
      skipped: 0,
      errors: 0,
      rss: null,
      wordpress: null,
    };

    try {
      result.rss = await this.runRssCrawl();
    } catch (error) {
      logger.error(`RSS ingest failed: ${error.message}`, { stack: error.stack });
      result.errors += 1;
    }

    try {
      result.wordpress = await this.runWordPressIngest();
    } catch (error) {
      logger.error(`WordPress ingest failed: ${error.message}`, { stack: error.stack });
      result.errors += 1;
    }

    for (const part of [result.rss, result.wordpress]) {
      if (!part) continue;
      result.articles += part.articles;
      result.inserted += part.inserted;
      result.skipped += part.skipped;
      result.errors += part.errors;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    result.duration = parseFloat(duration);

    logger.info(`=== Ingest cycle complete in ${duration}s ===`, {
      rss: result.rss,
      wordpress: result.wordpress,
      totalArticles: result.articles,
      totalInserted: result.inserted,
    });

    return result;
  }

  /** Ingest the RSS highlights (published immediately, never rewritten). */
  async runRssCrawl() {
    const feeds = await this._getActiveFeeds();
    if (feeds.length === 0) {
      logger.warn('No active RSS feeds found in sources table.');
      return { articles: 0, inserted: 0, skipped: 0, errors: 0, sources: 0 };
    }

    logger.info(`Found ${feeds.length} active RSS feeds.`);
    const concurrency = parseInt(process.env.CRAWLER_CONCURRENCY, 10) || 3;
    const articles = await rssCrawler.fetchMultipleFeeds(feeds, concurrency);

    if (articles.length === 0) {
      logger.warn('No articles fetched from RSS feeds.');
      return { articles: 0, inserted: 0, skipped: 0, errors: 0, sources: feeds.length };
    }

    const stored = await newsService.storeArticles(articles);
    return { articles: articles.length, ...stored, sources: feeds.length };
  }

  /**
   * Ingest complete posts from every WordPress source.
   *
   * One publisher failing is logged and skipped rather than aborting the pass:
   * a single site blocking the REST API must not stop the others ingesting.
   */
  async runWordPressIngest() {
    const sources = await this._getWordPressSources();
    if (sources.length === 0) {
      logger.info('No WordPress sources configured.');
      return { articles: 0, inserted: 0, skipped: 0, errors: 0, sources: 0, failed: [] };
    }

    logger.info(`Found ${sources.length} WordPress sources.`);
    const perPage = Number(process.env.WP_PER_PAGE || 20);

    let articles = 0;
    let inserted = 0;
    let skipped = 0;
    let errors = 0;
    const failed = [];

    for (const source of sources) {
      try {
        const posts = await wpCrawler.fetchFromSource(source, { perPage });
        if (posts.length === 0) continue;

        const stored = await newsService.storeArticles(posts);
        articles += posts.length;
        inserted += stored.inserted;
        skipped += stored.skipped;
        errors += stored.errors;
      } catch (error) {
        errors += 1;
        failed.push({ slug: source.slug, error: error.message });
        logger.warn(`WordPress source ${source.slug} failed: ${error.message}`);
      }
    }

    return { articles, inserted, skipped, errors, sources: sources.length, failed };
  }

  /**
   * Crawl a specific source by slug, following its configured feed_type.
   */
  async crawlSingleSource(slug) {
    const source = await Source.findOne({ where: { slug, is_active: true }, raw: true });
    if (!source) {
      throw new Error(`Source "${slug}" not found or inactive.`);
    }

    if (source.feed_type === 'wordpress') {
      logger.info(`Ingesting WordPress source: ${source.name}`);
      const posts = await wpCrawler.fetchFromSource(source, {
        perPage: Number(process.env.WP_PER_PAGE || 20),
      });
      if (posts.length === 0) {
        return { articles: 0, inserted: 0, skipped: 0, errors: 0 };
      }
      const stored = await newsService.storeArticles(posts);
      return { articles: posts.length, ...stored };
    }

    if (!source.rss_url) {
      throw new Error(`Source "${slug}" has no RSS URL.`);
    }

    const feedConfig = {
      name: source.name,
      source: source.slug,
      category: source.category || 'general',
      url: source.rss_url,
      language: source.language || 'en',
    };

    logger.info(`Crawling single source: ${source.name}`);
    const articles = await rssCrawler.fetchFeed(feedConfig);
    if (articles.length === 0) {
      return { articles: 0, inserted: 0, skipped: 0, errors: 0 };
    }

    const result = await newsService.storeArticles(articles);
    return { articles: articles.length, ...result };
  }

  /**
   * Scrape a single article URL and store it
   */
  async scrapeAndStoreArticle(url, sourceSlug, category = null) {
    logger.info(`Scraping and storing article: ${url}`);

    const article = await htmlScraper.scrapeArticle(url, sourceSlug);
    if (!article) return null;

    if (category) article.category = category;

    const result = await newsService.storeArticles([article]);
    return { article, ...result };
  }

  /**
   * Get available feed configurations from DB
   */
  async getAvailableFeeds({ includeInactive = true } = {}) {
    const where = {};
    if (!includeInactive) where.is_active = true;

    const sources = await Source.findAll({
      where,
      attributes: ['id', 'name', 'slug', 'url', 'language', 'category', 'rss_url', 'country', 'is_local', 'is_active', 'feed_type', 'wp_api_url'],
      order: [['is_local', 'DESC'], ['name', 'ASC']],
      raw: true,
    });
    return sources;
  }
}

module.exports = new CrawlerService();
