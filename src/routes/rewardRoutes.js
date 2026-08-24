/**
 * Rewards Routes - User rewards from ads and activities
 */
const { Router } = require("express");
const rewardController = require("../controllers/rewardController");
const { requireAuth, optionalAuth } = require("../middleware/auth");

const router = Router();

// Get current user's reward balance and stats
router.get("/balance", requireAuth, rewardController.getBalance);

// Get reward history
router.get("/history", requireAuth, rewardController.getHistory);

// Earn reward (from watching ad, sharing, etc.)
router.post("/earn", requireAuth, rewardController.earnReward);

// Spend reward (on premium features)
router.post("/spend", requireAuth, rewardController.spendReward);

// Claim daily login reward
router.post("/daily", requireAuth, rewardController.claimDailyReward);

// Get leaderboard (public)
router.get("/leaderboard", optionalAuth, rewardController.getLeaderboard);

module.exports = router;
