/**
 * BookmarkCollectionItem Model
 * Mapping between collections and articles
 */
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../database/connection');

class BookmarkCollectionItem extends Model {}

BookmarkCollectionItem.init(
  {
    id: {
      type: DataTypes.CHAR(36),
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    collection_id: {
      type: DataTypes.CHAR(36),
      allowNull: false,
      references: { model: 'bookmark_collections', key: 'id' },
    },
    news_id: {
      type: DataTypes.CHAR(36),
      allowNull: false,
      references: { model: 'news', key: 'id' },
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: 'BookmarkCollectionItem',
    tableName: 'bookmark_collection_items',
    timestamps: false,
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
    indexes: [
      { name: 'idx_collection_items_collection', fields: ['collection_id'] },
      { name: 'idx_collection_items_news', fields: ['news_id'] },
      { name: 'idx_collection_items_unique', unique: true, fields: ['collection_id', 'news_id'] },
    ],
  }
);

module.exports = BookmarkCollectionItem;
