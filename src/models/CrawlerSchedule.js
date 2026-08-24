/**
 * CrawlerSchedule Model
 * Stores scheduler configuration that admins can manage at runtime
 */
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../database/connection');

class CrawlerSchedule extends Model {}

CrawlerSchedule.init(
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      allowNull: false,
    },
    cron_schedule: {
      type: DataTypes.STRING(100),
      allowNull: false,
      defaultValue: process.env.CRON_SCHEDULE || '*/30 * * * *',
    },
    is_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    updated_by: {
      type: DataTypes.STRING(120),
      allowNull: false,
      defaultValue: 'system',
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: 'CrawlerSchedule',
    tableName: 'crawler_schedule',
    timestamps: false,
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
  }
);

module.exports = CrawlerSchedule;
