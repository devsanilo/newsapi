/**
 * Rewards Controller - Handle user rewards from ads and activities
 */
const { v4: uuid } = require("uuid");
const { Reward } = require("../models");
const logger = require("../utils/logger");

// Reward amounts for different activities
const REWARD_AMOUNTS = {
  watchAd: 10,
  dailyLogin: 5,
  shareArticle: 3,
  readArticle: 10,
  bonus: 0, // Variable
};

/**
 * Get user's reward balance and stats
 */
async function getBalance(req, res, next) {
  try {
    const userId = req.user.id;

    const balance = await Reward.getBalance(userId);
    const dailyStats = await Reward.getDailyStats(userId);

    res.json({
      success: true,
      data: {
        ...balance,
        daily: dailyStats,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get user's reward history
 */
async function getHistory(req, res, next) {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;

    const result = await Reward.getHistory(userId, {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Record earned reward
 */
async function earnReward(req, res, next) {
  try {
    const userId = req.user.id;
    const { type, amount: customAmount, description, metadata } = req.body;

    // Validate type
    if (!REWARD_AMOUNTS.hasOwnProperty(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid reward type: ${type}`,
      });
    }

    // Check daily ad limit for watchAd type
    if (type === "watchAd") {
      const dailyStats = await Reward.getDailyStats(userId);
      if (dailyStats.adsRemaining <= 0) {
        return res.status(429).json({
          success: false,
          error: "Daily ad watching limit reached",
          data: dailyStats,
        });
      }
    }

    // Always use server-defined amounts — never trust client-submitted values
    const amount = type === "bonus" ? customAmount || 0 : REWARD_AMOUNTS[type];

    const reward = await Reward.create({
      id: uuid(),
      userId,
      type,
      amount,
      description: description || `Earned from ${type}`,
      metadata,
    });

    const newBalance = await Reward.getBalance(userId);

    logger.info(`User ${userId} earned ${amount} coins from ${type}`);

    res.json({
      success: true,
      data: {
        reward,
        balance: newBalance.balance,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Record spent reward (for premium features, etc.)
 */
async function spendReward(req, res, next) {
  try {
    const userId = req.user.id;
    const { amount, description, metadata } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Amount must be a positive number",
      });
    }

    // Check balance
    const currentBalance = await Reward.getBalance(userId);
    if (currentBalance.balance < amount) {
      return res.status(400).json({
        success: false,
        error: "Insufficient balance",
        data: { balance: currentBalance.balance, required: amount },
      });
    }

    const reward = await Reward.create({
      id: uuid(),
      userId,
      type: "spend",
      amount,
      description: description || "Spent coins",
      metadata,
    });

    const newBalance = await Reward.getBalance(userId);

    logger.info(`User ${userId} spent ${amount} coins`);

    res.json({
      success: true,
      data: {
        reward,
        balance: newBalance.balance,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Claim daily login reward
 */
async function claimDailyReward(req, res, next) {
  try {
    const userId = req.user.id;

    // Check if already claimed today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingClaim = await Reward.findOne({
      where: {
        userId,
        type: "dailyLogin",
      },
      order: [["createdAt", "DESC"]],
    });

    if (existingClaim) {
      const claimDate = new Date(existingClaim.createdAt);
      claimDate.setHours(0, 0, 0, 0);

      if (claimDate.getTime() >= today.getTime()) {
        return res.status(400).json({
          success: false,
          error: "Daily reward already claimed today",
          data: {
            nextClaimAt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
          },
        });
      }
    }

    const amount = REWARD_AMOUNTS.dailyLogin;

    const reward = await Reward.create({
      id: uuid(),
      userId,
      type: "dailyLogin",
      amount,
      description: "Daily login bonus",
    });

    const newBalance = await Reward.getBalance(userId);

    logger.info(`User ${userId} claimed daily reward: ${amount} coins`);

    res.json({
      success: true,
      data: {
        reward,
        balance: newBalance.balance,
        amount,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get leaderboard of top earners
 */
async function getLeaderboard(req, res, next) {
  try {
    const { limit = 10 } = req.query;

    const [leaders] = await Reward.sequelize.query(
      `SELECT 
        u.id,
        u.username,
        u.avatar_url,
        COALESCE(SUM(CASE WHEN r.type != 'spend' THEN r.amount ELSE 0 END), 0) as total_earned,
        COUNT(CASE WHEN r.type = 'watchAd' THEN 1 END) as ads_watched
       FROM users u
       LEFT JOIN rewards r ON r.user_id = u.id
       GROUP BY u.id
       ORDER BY total_earned DESC
       LIMIT :limit`,
      { replacements: { limit: parseInt(limit, 10) } },
    );

    res.json({
      success: true,
      data: leaders.map((l, index) => ({
        rank: index + 1,
        userId: l.id,
        username: l.username,
        avatarUrl: l.avatar_url,
        totalEarned: parseInt(l.total_earned, 10),
        adsWatched: parseInt(l.ads_watched, 10),
      })),
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getBalance,
  getHistory,
  earnReward,
  spendReward,
  claimDailyReward,
  getLeaderboard,
};
