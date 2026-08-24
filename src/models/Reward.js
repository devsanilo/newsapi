/**
 * Reward Model - Track user rewards from ads and activities
 */
const { DataTypes, Model } = require("sequelize");
const { sequelize } = require("../database/connection");

class Reward extends Model {
  /**
   * Get user's current balance
   */
  static async getBalance(userId) {
    const result = await sequelize.query(
      `SELECT 
        COALESCE(SUM(CASE WHEN type != 'spend' THEN amount ELSE 0 END), 0) as earned,
        COALESCE(SUM(CASE WHEN type = 'spend' THEN amount ELSE 0 END), 0) as spent
       FROM rewards WHERE user_id = :userId`,
      { replacements: { userId }, type: sequelize.QueryTypes.SELECT },
    );
    const earned = result[0]?.earned || 0;
    const spent = result[0]?.spent || 0;
    return { balance: earned - spent, earned, spent };
  }

  /**
   * Get user's reward history
   */
  static async getHistory(userId, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const { rows, count } = await Reward.findAndCountAll({
      where: { userId },
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });
    return {
      data: rows,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    };
  }

  /**
   * Get daily stats
   */
  static async getDailyStats(userId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = await sequelize.query(
      `SELECT 
        COUNT(CASE WHEN type = 'watchAd' THEN 1 END) as ads_watched,
        COALESCE(SUM(CASE WHEN type != 'spend' THEN amount ELSE 0 END), 0) as earned_today
       FROM rewards 
       WHERE user_id = :userId AND created_at >= :today`,
      {
        replacements: { userId, today },
        type: sequelize.QueryTypes.SELECT,
      },
    );

    return {
      adsWatched: result[0]?.ads_watched || 0,
      earnedToday: result[0]?.earned_today || 0,
      maxDailyAds: 5,
      adsRemaining: Math.max(0, 5 - (result[0]?.ads_watched || 0)),
    };
  }
}

Reward.init(
  {
    id: {
      type: DataTypes.CHAR(36),
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    userId: {
      type: DataTypes.CHAR(36),
      allowNull: false,
      field: "user_id",
      references: {
        model: "users",
        key: "id",
      },
    },
    amount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 0,
      },
    },
    type: {
      type: DataTypes.ENUM(
        "watchAd",
        "dailyLogin",
        "shareArticle",
        "readArticle",
        "spend",
        "bonus",
      ),
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: "Reward",
    tableName: "rewards",
    underscored: true,
    timestamps: true,
  },
);

module.exports = Reward;
