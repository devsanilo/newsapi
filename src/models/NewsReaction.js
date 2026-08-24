/**
 * NewsReaction Model
 * One reaction per user per article
 */
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../database/connection');

class NewsReaction extends Model {}

NewsReaction.init(
  {
    id: {
      type: DataTypes.CHAR(36),
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    user_id: {
      type: DataTypes.CHAR(36),
      allowNull: false,
      references: { model: 'users', key: 'id' },
    },
    news_id: {
      type: DataTypes.CHAR(36),
      allowNull: false,
      references: { model: 'news', key: 'id' },
    },
    reaction_type: {
      type: DataTypes.ENUM('insightful', 'shocking', 'useful'),
      allowNull: false,
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
    modelName: 'NewsReaction',
    tableName: 'news_reactions',
    timestamps: false,
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
    indexes: [
      { name: 'idx_reactions_user_news_unique', unique: true, fields: ['user_id', 'news_id'] },
      { name: 'idx_reactions_news', fields: ['news_id'] },
      { name: 'idx_reactions_type', fields: ['reaction_type'] },
    ],
  }
);

module.exports = NewsReaction;
