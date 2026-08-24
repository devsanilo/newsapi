/**
 * Page Model
 * Stores dynamic CMS-style pages (About, Privacy, Terms, Contact, etc.)
 */
const { DataTypes, Model } = require("sequelize");
const { sequelize } = require("../database/connection");

class Page extends Model {}

Page.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    slug: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
      comment: "URL-friendly identifier: about, privacy, terms, contact",
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    content: {
      type: DataTypes.TEXT("long"),
      allowNull: false,
      comment: "HTML content of the page",
    },
    meta_description: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: "SEO meta description",
    },
    is_published: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    updated_by: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: "User ID of last editor",
    },
  },
  {
    sequelize,
    tableName: "pages",
    timestamps: true,
    underscored: true,
    indexes: [{ unique: true, fields: ["slug"] }],
  },
);

module.exports = Page;
