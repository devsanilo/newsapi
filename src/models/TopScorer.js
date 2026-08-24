/**
 * TopScorer model — cached scorer rows from football-data.org
 */
const { DataTypes, Model } = require("sequelize");
const { sequelize } = require("../database/connection");

class TopScorer extends Model {}

TopScorer.init(
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
    /* ── ranking ─────────────────────────────────────────── */
    rank: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: "Position in the scorer list (1-based)",
    },
    /* ── player ──────────────────────────────────────────── */
    player_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    player_name: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    player_nationality: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    player_position: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    player_dob: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "Date of birth as string yyyy-MM-dd",
    },
    /* ── team ────────────────────────────────────────────── */
    team_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    team_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    team_short: {
      type: DataTypes.STRING(10),
      allowNull: true,
    },
    team_crest: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    /* ── stats ───────────────────────────────────────────── */
    goals: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    assists: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    penalties: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    played_matches: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    /* ── cache ───────────────────────────────────────────── */
    fetched_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: "top_scorers",
    timestamps: false,
    indexes: [
      { name: "idx_scorer_league_season", fields: ["league_code", "season"] },
      { name: "idx_scorer_player", fields: ["player_id"] },
    ],
  },
);

module.exports = TopScorer;
