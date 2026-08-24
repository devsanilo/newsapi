/**
 * UserPreference Model
 * Stores user's preferred categories and sources for personalized feed
 * Also tracks implicit preferences from reading behavior
 */
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../database/connection');

class UserPreference extends Model {}

UserPreference.init(
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
      references: { model: 'users', key: 'id' },
    },
    preferred_categories: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
      comment: 'Explicitly chosen categories e.g. ["technology","sports"]',
    },
    preferred_sources: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
      comment: 'Explicitly chosen source slugs e.g. ["bbc","punch"]',
    },
    preferred_languages: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: ['en'],
    },
    implicit_scores: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
      comment: 'Auto-computed category scores from reading behavior e.g. {"technology":15,"sports":8}',
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: 'UserPreference',
    tableName: 'user_preferences',
    timestamps: false,
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
    indexes: [
      { name: 'idx_up_user', unique: true, fields: ['user_id'] },
    ],
  }
);

module.exports = UserPreference;
