/**
 * Comment Model
 * User comments on news articles
 */
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../database/connection');

class Comment extends Model {}

Comment.init(
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
    parent_id: {
      type: DataTypes.CHAR(36),
      allowNull: true,
      references: { model: 'comments', key: 'id' },
      comment: 'For threaded/reply comments',
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: { notEmpty: true, len: [1, 2000] },
    },
    is_edited: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
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
    modelName: 'Comment',
    tableName: 'comments',
    timestamps: false,
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
    indexes: [
      { name: 'idx_comments_news', fields: ['news_id'] },
      { name: 'idx_comments_user', fields: ['user_id'] },
      { name: 'idx_comments_parent', fields: ['parent_id'] },
      { name: 'idx_comments_created', fields: [{ name: 'created_at', order: 'DESC' }] },
    ],
  }
);

module.exports = Comment;
