/**
 * ReadHistory Model
 * Tracks which articles a user has opened/read
 */
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../database/connection');

class ReadHistory extends Model {}

ReadHistory.init(
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
    read_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    read_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      comment: 'How many times user opened this article',
    },
  },
  {
    sequelize,
    modelName: 'ReadHistory',
    tableName: 'read_history',
    timestamps: false,
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
    indexes: [
      { name: 'idx_rh_unique', unique: true, fields: ['user_id', 'news_id'] },
      { name: 'idx_rh_user', fields: ['user_id'] },
      { name: 'idx_rh_read_at', fields: [{ name: 'read_at', order: 'DESC' }] },
    ],
  }
);

module.exports = ReadHistory;
