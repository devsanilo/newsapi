/**
 * Follow Model — user follows another user
 */
const { DataTypes, Model } = require("sequelize");
const { sequelize } = require("../database/connection");

class Follow extends Model {}

Follow.init(
  {
    id: {
      type: DataTypes.CHAR(36),
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    follower_id: {
      type: DataTypes.CHAR(36),
      allowNull: false,
      references: { model: "users", key: "id" },
    },
    following_id: {
      type: DataTypes.CHAR(36),
      allowNull: false,
      references: { model: "users", key: "id" },
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: "Follow",
    tableName: "follows",
    timestamps: false,
    indexes: [
      { unique: true, fields: ["follower_id", "following_id"] },
      { fields: ["following_id"] },
    ],
  },
);

module.exports = Follow;
