/**
 * Routes Index — all public, protected, and admin routes
 */
const { Router } = require("express");
const newsRoutes = require("./newsRoutes");
const authRoutes = require("./authRoutes");
const sourceRoutes = require("./sourceRoutes");
const interactionRoutes = require("./interactionRoutes");
const userRoutes = require("./userRoutes");
const crawlerRoutes = require("./crawlerRoutes");
const videoRoutes = require("./videoRoutes");
const notificationRoutes = require("./notificationRoutes");
const followRoutes = require("./followRoutes");
const pageRoutes = require("./pageRoutes");
const rewardRoutes = require("./rewardRoutes");
const adSettingsRoutes = require("./adSettingsRoutes");
const leagueRoutes = require("./leagueRoutes");
const trendingController = require("../controllers/trendingController");
const streakController = require("../controllers/streakController");
const { requireAuth } = require("../middleware/auth");

const router = Router();

// Health check
router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Noozia API is running",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ─── Public + Protected ───────────────────────────────────────
router.use("/auth", authRoutes);
router.use("/news", newsRoutes);
router.use("/videos", videoRoutes);
router.use("/sources", sourceRoutes);
router.use("/", interactionRoutes);
router.use("/", userRoutes);

router.use("/notifications", notificationRoutes);
router.use("/users", followRoutes);
router.use("/pages", pageRoutes);
router.use("/rewards", rewardRoutes);
router.use("/ad-settings", adSettingsRoutes);
router.use("/leagues", leagueRoutes);

// Trending topics & reading streaks
router.get("/trending-topics", trendingController.getTrendingTopics);
router.get("/user/streak", requireAuth, streakController.getStreak);

// ─── Admin ────────────────────────────────────────────────────
router.use("/crawler", crawlerRoutes);

module.exports = router;
