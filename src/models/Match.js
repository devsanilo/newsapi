/**
 * Match model — cached fixture / result rows
 */
const { DataTypes, Model } = require("sequelize");
const { sequelize } = require("../database/connection");

class Match extends Model {}

Match.init(
  {
    id: {
      type: DataTypes.CHAR(36),
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    /* ── competition ─────────────────────────────────────── */
    league_code: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    league_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    season: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    matchday: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    stage: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: "e.g. GROUP_STAGE, ROUND_OF_16, QUARTER_FINALS …",
    },
    group: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    /* ── external id ─────────────────────────────────────── */
    external_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: "Match id from football-data.org",
    },
    /* ── status ──────────────────────────────────────────── */
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      comment:
        "SCHEDULED, TIMED, IN_PLAY, PAUSED, FINISHED, POSTPONED, CANCELLED, SUSPENDED",
    },
    /* ── date / time ─────────────────────────────────────── */
    utc_date: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    /* ── home team ───────────────────────────────────────── */
    home_team_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    home_team_name: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    home_team_short: {
      type: DataTypes.STRING(10),
      allowNull: true,
    },
    home_team_crest: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    /* ── away team ───────────────────────────────────────── */
    away_team_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    away_team_name: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    away_team_short: {
      type: DataTypes.STRING(10),
      allowNull: true,
    },
    away_team_crest: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    /* ── score ────────────────────────────────────────────── */
    home_score: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    away_score: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    home_ht_score: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "Half-time score",
    },
    away_ht_score: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    winner: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "HOME_TEAM, AWAY_TEAM, DRAW, null",
    },
    duration: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "REGULAR, EXTRA_TIME, PENALTY_SHOOTOUT",
    },
    /* ── meta ────────────────────────────────────────────── */
    venue: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },
    referee_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    fetched_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: "Match",
    tableName: "matches",
    timestamps: false,
    engine: "InnoDB",
    charset: "utf8mb4",
    collate: "utf8mb4_unicode_ci",
    indexes: [
      { name: "idx_match_league_season", fields: ["league_code", "season"] },
      { name: "idx_match_status", fields: ["league_code", "status"] },
      { name: "idx_match_date", fields: ["utc_date"] },
      { name: "idx_match_external", fields: ["external_id"], unique: true },
      {
        name: "idx_match_matchday",
        fields: ["league_code", "season", "matchday"],
      },
    ],
  },
);

module.exports = Match;
