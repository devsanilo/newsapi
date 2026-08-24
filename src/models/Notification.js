/**
 * Notification Model
 * In-app notifications for users (breaking news, comments, likes, system, etc.)
 */
const { DataTypes, Model } = require("sequelize");
const { sequelize } = require("../database/connection");

class Notification extends Model {}

Notification.init(
  {
    id: {
      type: DataTypes.CHAR(36),
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    user_id: {
      type: DataTypes.CHAR(36),
      allowNull: false,
      comment: "Recipient user",
    },
    type: {
      type: DataTypes.ENUM(
        "breaking_news",
        "article_recommendation",
        "comment_reply",
        "comment_on_article",
        "like",
        "follow",
        "system",
      ),
      allowNull: false,
      defaultValue: "system",
    },
    title: {
      type: DataTypes.STRING(300),
      allowNull: false,
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    /** JSON payload for deep-linking: { news_id, comment_id, url, ... } */
    data: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {},
    },
    image_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    is_read: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    read_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: "Notification",
    tableName: "notifications",
    timestamps: false,
    engine: "InnoDB",
    charset: "utf8mb4",
    collate: "utf8mb4_unicode_ci",
    indexes: [
      { name: "idx_notif_user", fields: ["user_id"] },
      { name: "idx_notif_user_read", fields: ["user_id", "is_read"] },
      {
        name: "idx_notif_created",
        fields: [{ name: "created_at", order: "DESC" }],
      },
      { name: "idx_notif_type", fields: ["type"] },
    ],
  },
);

module.exports = Notification;
