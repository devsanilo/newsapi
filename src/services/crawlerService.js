/**
 * Crawler Service (Orchestrator)
 * Reads active sources from DB, coordinates RSS fetching and article storage
 */
const rssCrawler = require('../crawlers/rssCrawler');
const htmlScraper = require('../crawlers/htmlScraper');
const newsService = require('./newsService');
const Source = require('../models/Source');
const logger = require('../utils/logger');

class CrawlerService {
  /**
   * Get active RSS feed configs from the sources table
   */
  async _getActiveFeeds() {
    const sources = await Source.findAll({
      where: { is_active: true, rss_url: { [require('sequelize').Op.ne]: null } },
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

  /**
   * Run a full crawl cycle: fetch RSS feeds from DB sources and store articles
   */
  async runFullCrawl() {
    const startTime = Date.now();
    logger.info('=== Starting full crawl cycle ===');

    try {
      const feeds = await this._getActiveFeeds();
      if (feeds.length === 0) {
        logger.warn('No active feeds found in sources table.');
        return { articles: 0, inserted: 0, skipped: 0, errors: 0, duration: 0 };
      }

      logger.info(`Found ${feeds.length} active feeds in database.`);

      const concurrency = parseInt(process.env.CRAWLER_CONCURRENCY, 10) || 3;
      const articles = await rssCrawler.fetchMultipleFeeds(feeds, concurrency);

      if (articles.length === 0) {
        logger.warn('No articles fetched from RSS feeds.');
        return { articles: 0, inserted: 0, skipped: 0, errors: 0, duration: 0 };
      }

      const result = await newsService.storeArticles(articles);

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info(`=== Crawl cycle complete in ${duration}s ===`, {
        totalFetched: articles.length,
        ...result,
      });

      return { articles: articles.length, ...result, duration: parseFloat(duration) };
    } catch (error) {
      logger.error(`Crawl cycle failed: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * Crawl a specific source by slug
   */
  async crawlSingleSource(slug) {
    const source = await Source.findOne({ where: { slug, is_active: true }, raw: true });
    if (!source || !source.rss_url) {
      throw new Error(`Source "${slug}" not found or has no RSS URL.`);
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
      attributes: ['id', 'name', 'slug', 'url', 'language', 'category', 'rss_url', 'country', 'is_local', 'is_active'],
      order: [['is_local', 'DESC'], ['name', 'ASC']],
      raw: true,
    });
    return sources;
  }
}

module.exports = new CrawlerService();
