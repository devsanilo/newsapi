/**
 * Queue Worker
 * Processes crawl and scrape jobs from Bull queues
 * Run separately: npm run worker
 */
require("dotenv").config();

const { crawlQueue, scrapeQueue } = require("./queue");
const crawlerService = require("../services/crawlerService");
const htmlScraper = require("../crawlers/htmlScraper");
const newsService = require("../services/newsService");
const logger = require("../utils/logger");
const { testConnection } = require("../database/connection");

// ─── Crawl Queue Processor ───────────────────────────────────
crawlQueue.process("full-crawl", async (job) => {
  logger.info(`Processing crawl job: ${job.id}`);

  try {
    const result = await crawlerService.runFullCrawl();

    await job.progress(100);
    return result;
  } catch (error) {
    logger.error(`Crawl job ${job.id} processing error: ${error.message}`);
    throw error;
  }
});

// ─── Scrape Queue Processor ──���───────────────────────────────
const scrapeConcurrency = parseInt(process.env.CRAWLER_CONCURRENCY, 10) || 3;

scrapeQueue.process("scrape-article", scrapeConcurrency, async (job) => {
  const { url, sourceKey, category } = job.data;
  logger.info(`Processing scrape job: ${job.id} - ${url}`);

  try {
    const article = await htmlScraper.scrapeArticle(url, sourceKey);

    if (!article) {
      logger.warn(`No article data scraped from: ${url}`);
      return { success: false, url, reason: "no-data" };
    }

    if (category) {
      article.category = category;
    }

    const result = await newsService.storeArticles([article]);

    await job.progress(100);

    return {
      success: true,
      url,
      title: article.title,
      ...result,
    };
  } catch (error) {
    logger.error(`Scrape job ${job.id} processing error: ${error.message}`);
    throw error;
  }
});

// ─── Worker Startup ──────────────────────────────────────────
async function startWorker() {
  try {
    // Test database connection
    await testConnection();

    logger.info("Worker started and listening for jobs...");
    logger.info(`Scrape concurrency: ${scrapeConcurrency}`);
  } catch (error) {
    logger.error(`Worker startup failed: ${error.message}`);
    process.exit(1);
  }
}

// ─── Graceful Shutdown ───────────────────────────────────────
async function shutdown() {
  logger.info("Worker shutting down...");
  await crawlQueue.close();
  await scrapeQueue.close();
  await htmlScraper.closeBrowser();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Start the worker
startWorker();
