/**
 * BookmarkCollection Model
 * User-defined collections/folders for saved articles
 */
const { DataTypes, Model } = require("sequelize");
const { sequelize } = require("../database/connection");

class BookmarkCollection extends Model {}

BookmarkCollection.init(
  {
    id: {
      type: DataTypes.CHAR(36),
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    user_id: {
      type: DataTypes.CHAR(36),
      allowNull: false,
      references: { model: "users", key: "id" },
    },
    name: {
      type: DataTypes.STRING(80),
      allowNull: false,
      validate: { notEmpty: true, len: [1, 80] },
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
    modelName: "BookmarkCollection",
    tableName: "bookmark_collections",
    timestamps: false,
    engine: "InnoDB",
    charset: "utf8mb4",
    collate: "utf8mb4_unicode_ci",
    indexes: [
      { name: "idx_collections_user", fields: ["user_id"] },
      {
        name: "idx_collections_user_name_unique",
        unique: true,
        fields: ["user_id", "name"],
      },
    ],
  },
);

module.exports = BookmarkCollection;
