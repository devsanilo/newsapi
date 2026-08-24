/**
 * Impression Model
 * Tracks article views/impressions for both guests and authenticated users
 */
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../database/connection');

class Impression extends Model {}

Impression.init(
  {
    id: {
      type: DataTypes.CHAR(36),
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    news_id: {
      type: DataTypes.CHAR(36),
      allowNull: false,
      references: { model: 'news', key: 'id' },
    },
    user_id: {
      type: DataTypes.CHAR(36),
      allowNull: true,
      references: { model: 'users', key: 'id' },
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: 'Impression',
    tableName: 'impressions',
    timestamps: false,
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
    indexes: [
      { name: 'idx_impressions_news', fields: ['news_id'] },
      { name: 'idx_impressions_user', fields: ['user_id'] },
      { name: 'idx_impressions_created_at', fields: [{ name: 'created_at', order: 'DESC' }] },
    ],
  }
);

module.exports = Impression;
