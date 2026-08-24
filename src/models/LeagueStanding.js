/**
 * LeagueStanding model — cached league table rows
 */
const { DataTypes, Model } = require("sequelize");
const { sequelize } = require("../database/connection");

class LeagueStanding extends Model {}

LeagueStanding.init(
  {
    id: {
      type: DataTypes.CHAR(36),
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    league_code: {
      type: DataTypes.STRING(20),
      allowNull: false,
      comment: "e.g. PL, CL, PD, SA, BL1, FL1, PPL",
    },
    league_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    season: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    group: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: "Group stage name for CL / EL, null for domestic leagues",
    },
    position: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    team_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    team_name: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    team_short: {
      type: DataTypes.STRING(10),
      allowNull: true,
    },
    team_crest: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    played: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    won: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    draw: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    lost: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    goals_for: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    goals_against: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    goal_difference: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    points: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    form: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "Recent form e.g. W,W,D,L,W",
    },
    fetched_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: "LeagueStanding",
    tableName: "league_standings",
    timestamps: false,
    engine: "InnoDB",
    charset: "utf8mb4",
    collate: "utf8mb4_unicode_ci",
    indexes: [
      { name: "idx_league_season", fields: ["league_code", "season"] },
      { name: "idx_league_group", fields: ["league_code", "season", "group"] },
      { name: "idx_team", fields: ["team_id"] },
    ],
  },
);

module.exports = LeagueStanding;
