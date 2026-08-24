/**
 * Queue System (Bull + Redis)
 * Manages scraping job queues with retry logic and concurrency control
 */
const Bull = require("bull");
const redisConfig = require("../config/redis");
const logger = require("../utils/logger");

// ─── Queue Definitions ───────────────────────────────────────
const crawlQueue = new Bull("crawl-queue", {
  redis: redisConfig.redis,
  defaultJobOptions: redisConfig.defaultJobOptions,
});

const scrapeQueue = new Bull("scrape-queue", {
  redis: redisConfig.redis,
  defaultJobOptions: {
    ...redisConfig.defaultJobOptions,
    timeout: 60000, // 60s timeout for scraping jobs
  },
});

// ─── Queue Event Handlers ─────────────────────────────────────

crawlQueue.on("completed", (job, result) => {
  logger.info(`Crawl job ${job.id} completed`, { result });
});

crawlQueue.on("failed", (job, error) => {
  logger.error(`Crawl job ${job.id} failed`, {
    error: error.message,
    attempts: job.attemptsMade,
  });
});

crawlQueue.on("stalled", (job) => {
  logger.warn(`Crawl job ${job.id} stalled`);
});

scrapeQueue.on("completed", (job, result) => {
  logger.info(`Scrape job ${job.id} completed`, { url: job.data.url });
});

scrapeQueue.on("failed", (job, error) => {
  logger.error(`Scrape job ${job.id} failed`, {
    url: job.data.url,
    error: error.message,
    attempts: job.attemptsMade,
  });
});

scrapeQueue.on("stalled", (job) => {
  logger.warn(`Scrape job ${job.id} stalled`);
});

// ─── Queue API ────────────────────────────────────────────────

/**
 * Add a full crawl job to the queue
 * @param {Object} data - Job data
 * @param {Object} opts - Bull job options
 * @returns {Object} - Bull job
 */
async function addCrawlJob(data = {}, opts = {}) {
  // Use deterministic jobId to enforce single-flight crawls; newer job replaces existing
  const job = await crawlQueue.add("full-crawl", data, {
    ...opts,
    jobId: "full-crawl-singleton",
    removeOnComplete: true,
    removeOnFail: false,
  });
  logger.info(`Added crawl job: ${job.id}`);
  return job;
}

/**
 * Add a scrape job for a single article URL
 * @param {Object} data - { url, sourceKey, category }
 * @param {Object} opts - Bull job options
 * @returns {Object} - Bull job
 */
async function addScrapeJob(data, opts = {}) {
  const job = await scrapeQueue.add("scrape-article", data, opts);
  logger.info(`Added scrape job: ${job.id} for ${data.url}`);
  return job;
}

/**
 * Add multiple scrape jobs in bulk
 * @param {Array} urls - Array of { url, sourceKey, category }
 * @returns {Array} - Array of Bull jobs
 */
async function addBulkScrapeJobs(urls) {
  const jobs = urls.map((data) => ({
    name: "scrape-article",
    data,
    opts: {},
  }));
  const result = await scrapeQueue.addBulk(jobs);
  logger.info(`Added ${result.length} bulk scrape jobs`);
  return result;
}

/**
 * Get queue status/metrics
 * @returns {Object}
 */
async function getQueueStatus() {
  const [crawlCounts, scrapeCounts] = await Promise.all([
    crawlQueue.getJobCounts(),
    scrapeQueue.getJobCounts(),
  ]);

  return {
    crawlQueue: crawlCounts,
    scrapeQueue: scrapeCounts,
  };
}

/**
 * Clean completed and failed jobs
 */
async function cleanQueues() {
  await Promise.all([
    crawlQueue.clean(3600000, "completed"), // Clean completed older than 1h
    crawlQueue.clean(86400000, "failed"), // Clean failed older than 24h
    scrapeQueue.clean(3600000, "completed"),
    scrapeQueue.clean(86400000, "failed"),
  ]);
  logger.info("Queues cleaned");
}

/**
 * Gracefully close all queues
 */
async function closeQueues() {
  await Promise.all([crawlQueue.close(), scrapeQueue.close()]);
  logger.info("All queues closed");
}

module.exports = {
  crawlQueue,
  scrapeQueue,
  addCrawlJob,
  addScrapeJob,
  addBulkScrapeJobs,
  getQueueStatus,
  cleanQueues,
  closeQueues,
};
