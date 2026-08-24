/**
 * Crawler Routes
 * Admin-only endpoints for managing the crawler
 */
const { Router } = require('express');
const crawlerController = require('../controllers/crawlerController');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { crawlerLimiter } = require('../middleware/rateLimiter');

const router = Router();

// All crawler routes require admin
router.post('/trigger', requireAuth, requireAdmin, crawlerLimiter, crawlerController.triggerCrawl);
router.post('/scrape', requireAuth, requireAdmin, crawlerLimiter, crawlerController.scrapeArticle);
router.post('/backfill-images', requireAuth, requireAdmin, crawlerLimiter, crawlerController.backfillImages);
router.get('/feeds', requireAuth, requireAdmin, crawlerController.getFeeds);
router.get('/status', requireAuth, requireAdmin, crawlerController.getStatus);
router.get('/activity', requireAuth, requireAdmin, crawlerController.getActivity);
router.get('/scheduler', requireAuth, requireAdmin, crawlerController.getScheduler);
router.patch('/scheduler', requireAuth, requireAdmin, crawlerController.updateScheduler);
router.post('/scheduler/start', requireAuth, requireAdmin, crawlerController.startScheduler);
router.post('/scheduler/stop', requireAuth, requireAdmin, crawlerController.stopScheduler);

module.exports = router;
