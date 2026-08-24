/**
 * Like Model
 * User likes on news articles
 */
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../database/connection');

class Like extends Model {}

Like.init(
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
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: 'Like',
    tableName: 'likes',
    timestamps: false,
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
    indexes: [
      {
        name: 'idx_likes_unique',
        unique: true,
        fields: ['user_id', 'news_id'],
        comment: 'One like per user per article',
      },
      { name: 'idx_likes_news', fields: ['news_id'] },
      { name: 'idx_likes_user', fields: ['user_id'] },
    ],
  }
);

module.exports = Like;
