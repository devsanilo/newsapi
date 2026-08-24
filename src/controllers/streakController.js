/**
 * Streak Controller — reading streaks & gamification
 */
const { sequelize } = require("../database/connection");
const logger = require("../utils/logger");

// Badge definitions
const BADGES = [
  {
    id: "first_read",
    name: "📖 First Read",
    description: "Read your first article",
    threshold: 1,
    field: "total_articles_read",
  },
  {
    id: "bookworm",
    name: "🐛 Bookworm",
    description: "Read 10 articles",
    threshold: 10,
    field: "total_articles_read",
  },
  {
    id: "voracious",
    name: "📚 Voracious Reader",
    description: "Read 50 articles",
    threshold: 50,
    field: "total_articles_read",
  },
  {
    id: "centurion",
    name: "💯 Centurion",
    description: "Read 100 articles",
    threshold: 100,
    field: "total_articles_read",
  },
  {
    id: "streak_3",
    name: "🔥 3-Day Streak",
    description: "3 consecutive reading days",
    threshold: 3,
    field: "current_streak",
  },
  {
    id: "streak_7",
    name: "⚡ Week Warrior",
    description: "7-day reading streak",
    threshold: 7,
    field: "current_streak",
  },
  {
    id: "streak_30",
    name: "🏆 Monthly Master",
    description: "30-day reading streak",
    threshold: 30,
    field: "current_streak",
  },
  {
    id: "streak_100",
    name: "👑 Century Streak",
    description: "100-day reading streak",
    threshold: 100,
    field: "current_streak",
  },
];

/**
 * Record a read and update streak — called from feedController.markAsRead
 */
async function recordRead(userId) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  try {
    // Upsert streak record
    const [[record]] = await sequelize.query(
      "SELECT * FROM reading_streaks WHERE user_id = :userId",
      { replacements: { userId } },
    );

    if (!record) {
      await sequelize.query(
        `INSERT INTO reading_streaks (id, user_id, current_streak, longest_streak, total_articles_read, total_reading_days, last_read_date, badges, created_at, updated_at)
         VALUES (UUID(), :userId, 1, 1, 1, 1, :today, '[]', NOW(), NOW())`,
        { replacements: { userId, today } },
      );
      return checkBadges(userId, {
        current_streak: 1,
        longest_streak: 1,
        total_articles_read: 1,
        total_reading_days: 1,
      });
    }

    const lastDate = record.last_read_date;
    const yesterday = new Date(Date.now() - 86400000)
      .toISOString()
      .slice(0, 10);

    let currentStreak = record.current_streak || 0;
    let totalDays = record.total_reading_days || 0;
    const totalArticles = (record.total_articles_read || 0) + 1;

    if (lastDate === today) {
      // Already read today, just increment article count
      await sequelize.query(
        "UPDATE reading_streaks SET total_articles_read = :totalArticles, updated_at = NOW() WHERE user_id = :userId",
        { replacements: { userId, totalArticles } },
      );
    } else if (lastDate === yesterday) {
      // Consecutive day — extend streak
      currentStreak += 1;
      totalDays += 1;
      const longestStreak = Math.max(record.longest_streak || 0, currentStreak);
      await sequelize.query(
        `UPDATE reading_streaks SET current_streak = :currentStreak, longest_streak = :longestStreak,
         total_articles_read = :totalArticles, total_reading_days = :totalDays,
         last_read_date = :today, updated_at = NOW() WHERE user_id = :userId`,
        {
          replacements: {
            userId,
            currentStreak,
            longestStreak,
            totalArticles,
            totalDays,
            today,
          },
        },
      );
    } else {
      // Streak broken — reset to 1
      currentStreak = 1;
      totalDays += 1;
      await sequelize.query(
        `UPDATE reading_streaks SET current_streak = 1, total_articles_read = :totalArticles,
         total_reading_days = :totalDays, last_read_date = :today, updated_at = NOW() WHERE user_id = :userId`,
        { replacements: { userId, totalArticles, totalDays, today } },
      );
    }

    return checkBadges(userId, {
      current_streak: currentStreak,
      total_articles_read: totalArticles,
      total_reading_days: totalDays,
    });
  } catch (error) {
    logger.warn(`Streak update failed for ${userId}: ${error.message}`);
  }
}

async function checkBadges(userId, stats) {
  try {
    const [[record]] = await sequelize.query(
      "SELECT badges FROM reading_streaks WHERE user_id = :userId",
      { replacements: { userId } },
    );
    let badges = [];
    try {
      badges =
        typeof record.badges === "string"
          ? JSON.parse(record.badges)
          : record.badges || [];
    } catch {
      badges = [];
    }

    const earnedIds = new Set(badges.map((b) => b.id));
    const newBadges = [];

    for (const badge of BADGES) {
      if (earnedIds.has(badge.id)) continue;
      if ((stats[badge.field] || 0) >= badge.threshold) {
        newBadges.push({
          id: badge.id,
          name: badge.name,
          earned_at: new Date().toISOString(),
        });
      }
    }

    if (newBadges.length > 0) {
      const allBadges = [...badges, ...newBadges];
      await sequelize.query(
        "UPDATE reading_streaks SET badges = :badges, updated_at = NOW() WHERE user_id = :userId",
        { replacements: { userId, badges: JSON.stringify(allBadges) } },
      );
    }

    return newBadges;
  } catch (error) {
    logger.warn(`Badge check failed: ${error.message}`);
    return [];
  }
}

/**
 * GET /api/user/streak — get user's current streak stats
 */
async function getStreak(req, res, next) {
  try {
    const [[record]] = await sequelize.query(
      "SELECT * FROM reading_streaks WHERE user_id = :userId",
      { replacements: { userId: req.user.id } },
    );

    if (!record) {
      return res.json({
        success: true,
        data: {
          current_streak: 0,
          longest_streak: 0,
          total_articles_read: 0,
          total_reading_days: 0,
          last_read_date: null,
          badges: [],
          available_badges: BADGES,
        },
      });
    }

    let badges = [];
    try {
      badges =
        typeof record.badges === "string"
          ? JSON.parse(record.badges)
          : record.badges || [];
    } catch {
      badges = [];
    }

    res.json({
      success: true,
      data: {
        current_streak: record.current_streak,
        longest_streak: record.longest_streak,
        total_articles_read: record.total_articles_read,
        total_reading_days: record.total_reading_days,
        last_read_date: record.last_read_date,
        badges,
        available_badges: BADGES.map((b) => ({
          ...b,
          earned: badges.some((eb) => eb.id === b.id),
        })),
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { recordRead, getStreak, BADGES };
