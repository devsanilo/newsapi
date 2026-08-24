/**
 * News Routes — public + personalized feed features
 */
const { Router } = require("express");
const newsController = require("../controllers/newsController");
const feedController = require("../controllers/feedController");
const { requireAuth, optionalAuth } = require("../middleware/auth");

const router = Router();

// AI summary endpoint
router.get("/:id/summary", optionalAuth, async (req, res, next) => {
  try {
    const aiService = require("../services/aiService");
    const { News } = require("../models");
    const article = await News.findByPk(req.params.id, {
      attributes: ["id", "title", "content", "description"],
    });
    if (!article)
      return res
        .status(404)
        .json({ success: false, error: "Article not found" });
    const result = await aiService.summarize(
      article.id,
      article.title,
      article.content,
      article.description,
    );
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// Public (optionalAuth enriches with user-specific data if token present)
router.get("/", optionalAuth, newsController.getNews);
router.get("/search", optionalAuth, newsController.searchNews);
router.get("/search/suggestions", newsController.getSearchSuggestions);
router.get("/search/keyword", optionalAuth, newsController.searchByKeyword);
router.get("/trending", optionalAuth, newsController.getTrending);
router.get("/categories", newsController.getCategories);
router.get("/sources", newsController.getSources);
router.get("/stats", newsController.getStats);

// Offline sync (public, enriched if authenticated)
router.get("/sync", optionalAuth, feedController.syncNews);

// Personalized feed (protected)
router.get("/for-you", requireAuth, feedController.getForYou);

// Single article + related (must be before /:id to avoid conflict)
router.get("/:id/related", optionalAuth, feedController.getRelated);
router.get("/:id", optionalAuth, newsController.getNewsById);

// Mark article as read (protected)
router.post("/:newsId/read", requireAuth, feedController.markAsRead);
// Track article impression (public, optionally attributed to user)
router.post(
  "/:newsId/impression",
  optionalAuth,
  feedController.trackImpression,
);

module.exports = router;
