/**
 * PageView Model
 * Anonymous web analytics — page views and visits (unique visitors).
 */
const { DataTypes, Model } = require("sequelize");
const { sequelize } = require("../database/connection");

class PageView extends Model {}

PageView.init(
  {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    path: {
      type: DataTypes.STRING(500),
      allowNull: false,
    },
    visitor_id: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "Anonymous visitor id from the client (localStorage)",
    },
    session_id: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    referrer: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    device: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "mobile | tablet | desktop",
    },
    user_agent: {
      type: DataTypes.STRING(300),
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
    modelName: "PageView",
    tableName: "page_views",
    timestamps: false,
    engine: "InnoDB",
    charset: "utf8mb4",
    collate: "utf8mb4_unicode_ci",
    indexes: [
      { name: "idx_page_views_created_at", fields: ["created_at"] },
      { name: "idx_page_views_path", fields: ["path"] },
      { name: "idx_page_views_visitor", fields: ["visitor_id"] },
    ],
  },
);

module.exports = PageView;
