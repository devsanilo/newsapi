/**
 * Source Model
 * News sources stored in DB instead of hardcoded config
 * Includes both Nigerian (local) and international sources
 */
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../database/connection');

class Source extends Model {}

Source.init(
  {
    id: {
      type: DataTypes.CHAR(36),
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    name: {
      type: DataTypes.STRING(150),
      allowNull: false,
      comment: 'Display name e.g. "BBC News"',
    },
    slug: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
      comment: 'Unique key e.g. "bbc"',
    },
    url: {
      type: DataTypes.STRING(500),
      allowNull: false,
      comment: 'Website base URL',
    },
    logo_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    country: {
      type: DataTypes.STRING(5),
      allowNull: false,
      defaultValue: 'int',
      comment: 'Country code: ng=Nigeria, us, gb, int=international',
    },
    language: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'en',
    },
    category: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Default category for this source',
    },
    rss_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: 'RSS feed URL',
    },
    scraper_config: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'HTML scraper selectors config',
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    is_local: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'true = Nigerian/local source',
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: 'Source',
    tableName: 'sources',
    timestamps: false,
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
    indexes: [
      { name: 'idx_sources_slug', unique: true, fields: ['slug'] },
      { name: 'idx_sources_country', fields: ['country'] },
      { name: 'idx_sources_is_active', fields: ['is_active'] },
      { name: 'idx_sources_is_local', fields: ['is_local'] },
    ],
  }
);

module.exports = Source;
