/**
 * Crawler Controller
 * Handles HTTP requests for crawler management endpoints
 */
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs/promises");
const path = require("path");
const crawlerService = require("../services/crawlerService");
const {
  triggerImmediateCrawl,
  getSchedulerState,
  updateSchedulerConfig,
} = require("../jobs/scheduler");
const { getQueueStatus } = require("../jobs/queue");
const News = require("../models/News");
const logger = require("../utils/logger");

class CrawlerController {
  /**
   * POST /api/crawler/trigger
   * Trigger an immediate crawl cycle
   */
  async triggerCrawl(req, res, next) {
    try {
      logger.info("Manual crawl triggered via API");

      await triggerImmediateCrawl();

      res.json({
        success: true,
        message: "Crawl enqueued successfully. Worker will process it.",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/crawler/scrape
   * Scrape a specific article URL
   * Body: { url, sourceKey, category }
   */
  async scrapeArticle(req, res, next) {
    try {
      const { url, sourceKey, category } = req.body;

      if (!url || !sourceKey) {
        return res.status(400).json({
          success: false,
          error: 'Both "url" and "sourceKey" are required',
        });
      }

      const result = await crawlerService.scrapeAndStoreArticle(
        url,
        sourceKey,
        category,
      );

      if (!result) {
        return res.status(422).json({
          success: false,
          error:
            "Failed to scrape article. Check URL and source configuration.",
        });
      }

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/crawler/feeds
   * Get available RSS feed configurations
   */
  async getFeeds(req, res, next) {
    try {
      const includeInactive = req.query.include_inactive !== "false";
      const feeds = await crawlerService.getAvailableFeeds({ includeInactive });
      res.json({
        success: true,
        data: feeds,
        count: feeds.length,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/crawler/backfill-images
   * Backfill og:image for articles that have null image_url
   */
  async backfillImages(req, res, next) {
    try {
      const { Op } = require("sequelize");
      const articles = await News.findAll({
        where: { image_url: { [Op.or]: [null, ""] } },
        attributes: ["id", "url"],
        raw: true,
      });

      logger.info(`Backfilling images for ${articles.length} articles`);

      res.json({
        success: true,
        message: `Backfilling images for ${articles.length} articles in background.`,
      });

      // Run in background
      (async () => {
        let filled = 0;
        for (let i = 0; i < articles.length; i += 5) {
          const batch = articles.slice(i, i + 5);
          await Promise.allSettled(
            batch.map(async (article) => {
              try {
                const resp = await axios.get(article.url, {
                  timeout: 12000,
                  headers: {
                    "User-Agent":
                      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
                  },
                  maxContentLength: 500000,
                  responseType: "text",
                });
                const html = typeof resp.data === "string" ? resp.data : "";
                const headEnd = html.indexOf("</head>");
                const headHtml =
                  headEnd > 0
                    ? html.substring(0, headEnd + 7)
                    : html.substring(0, 50000);
                const $ = cheerio.load(headHtml);
                const img =
                  $('meta[property="og:image"]').attr("content") ||
                  $('meta[name="twitter:image"]').attr("content") ||
                  $('meta[itemprop="image"]').attr("content");
                if (img) {
                  await News.update(
                    { image_url: img },
                    { where: { id: article.id } },
                  );
                  filled++;
                }
              } catch {
                /* skip */
              }
            }),
          );
          await new Promise((r) => setTimeout(r, 500));
        }
        logger.info(
          `Backfill complete: ${filled}/${articles.length} images filled`,
        );
      })();
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/crawler/status
   * Get queue status and metrics
   */
  async getStatus(req, res, next) {
    try {
      const status = await getQueueStatus();
      const scheduler = await getSchedulerState();
      res.json({
        success: true,
        data: { queue: status, scheduler },
      });
    } catch (error) {
      // If Redis is not available, return a graceful error
      const scheduler = await getSchedulerState().catch(() => null);
      res.json({
        success: false,
        error: "Queue status unavailable (Redis may not be connected)",
        data: { queue: null, scheduler },
      });
    }
  }

  /**
   * GET /api/crawler/scheduler
   * Return crawler schedule configuration + runtime status
   */
  async getScheduler(req, res, next) {
    try {
      const scheduler = await getSchedulerState();
      res.json({ success: true, data: scheduler });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/crawler/scheduler
   * Body: { cron_schedule?, is_enabled? }
   */
  async updateScheduler(req, res, next) {
    try {
      const { cron_schedule, is_enabled } = req.body || {};

      if (cron_schedule === undefined && is_enabled === undefined) {
        return res.status(400).json({
          success: false,
          error: 'Provide at least one of "cron_schedule" or "is_enabled".',
        });
      }

      const updated = await updateSchedulerConfig({
        cron_schedule,
        is_enabled,
        updated_by: req.user?.email || req.user?.id || "admin",
      });

      res.json({
        success: true,
        message: "Crawler scheduler updated.",
        data: updated,
      });
    } catch (error) {
      if (/Invalid cron schedule/i.test(error.message || "")) {
        return res.status(400).json({ success: false, error: error.message });
      }
      next(error);
    }
  }

  /**
   * POST /api/crawler/scheduler/start
   * Enable scheduler with current persisted cron expression
   */
  async startScheduler(req, res, next) {
    try {
      const updated = await updateSchedulerConfig({
        is_enabled: true,
        updated_by: req.user?.email || req.user?.id || "admin",
      });

      res.json({
        success: true,
        message: "Crawler scheduler started.",
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/crawler/scheduler/stop
   * Disable scheduled crawl execution
   */
  async stopScheduler(req, res, next) {
    try {
      const updated = await updateSchedulerConfig({
        is_enabled: false,
        updated_by: req.user?.email || req.user?.id || "admin",
      });

      res.json({
        success: true,
        message: "Crawler scheduler stopped.",
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/crawler/activity?limit=100
   * Return recent crawler-related logs for admin UI
   */
  async getActivity(req, res, next) {
    try {
      const limit = Math.max(
        10,
        Math.min(500, parseInt(req.query.limit, 10) || 120),
      );
      const logPath = path.join(process.cwd(), "logs", "combined.log");

      let content = "";
      try {
        content = await fs.readFile(logPath, "utf8");
      } catch {
        return res.json({ success: true, data: [], count: 0 });
      }

      const keywords =
        /(crawl|crawler|rss|feed|backfill|scrape|storage results|og:image|manual crawl)/i;

      const entries = content
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          try {
            const parsed = JSON.parse(line);
            return {
              timestamp: parsed.timestamp || null,
              level: parsed.level || "info",
              message: parsed.message || "",
              meta: Object.fromEntries(
                Object.entries(parsed).filter(
                  ([k]) => !["timestamp", "level", "message"].includes(k),
                ),
              ),
            };
          } catch {
            return {
              timestamp: null,
              level: "info",
              message: line,
              meta: {},
            };
          }
        })
        .filter((entry) =>
          keywords.test(`${entry.message} ${JSON.stringify(entry.meta || {})}`),
        );

      const recent = entries.slice(-limit).reverse();
      res.json({ success: true, data: recent, count: recent.length });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new CrawlerController();
