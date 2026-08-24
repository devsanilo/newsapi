/**
 * ReadingStreak Model — daily reading streaks and gamification
 */
const { DataTypes, Model } = require("sequelize");
const { sequelize } = require("../database/connection");

class ReadingStreak extends Model {}

ReadingStreak.init(
  {
    id: {
      type: DataTypes.CHAR(36),
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    user_id: {
      type: DataTypes.CHAR(36),
      allowNull: false,
      unique: true,
      references: { model: "users", key: "id" },
    },
    current_streak: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    longest_streak: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    total_articles_read: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    total_reading_days: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    last_read_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    badges: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
      comment: "Array of earned badge objects { id, name, earned_at }",
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: "ReadingStreak",
    tableName: "reading_streaks",
    timestamps: false,
    indexes: [{ unique: true, fields: ["user_id"] }],
  },
);

module.exports = ReadingStreak;
