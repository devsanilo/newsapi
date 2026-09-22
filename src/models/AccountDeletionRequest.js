/**
 * Account Deletion Request Model
 *
 * A signed-in user files one of these. The account is deactivated in the same
 * transaction, so deletion takes effect immediately; purging the user row and
 * their data is a separate, deliberate step, which is why the request is
 * recorded rather than resolved inline.
 *
 * `email` is snapshotted so the audit trail survives the user row being
 * removed. For the same reason `user_id` carries no foreign key — a constraint
 * would either block the user delete or cascade the audit trail away.
 */
const { DataTypes, Model } = require("sequelize");
const { sequelize } = require("../database/connection");

class AccountDeletionRequest extends Model {}

AccountDeletionRequest.init(
  {
    id: {
      type: DataTypes.CHAR(36),
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    user_id: {
      type: DataTypes.CHAR(36),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    reason: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("pending", "completed", "cancelled"),
      allowNull: false,
      defaultValue: "pending",
    },
    requested_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    processed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    processed_by: {
      type: DataTypes.CHAR(36),
      allowNull: true,
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
    modelName: "AccountDeletionRequest",
    tableName: "account_deletion_requests",
    timestamps: false,
    engine: "InnoDB",
    charset: "utf8mb4",
    collate: "utf8mb4_unicode_ci",
    indexes: [
      { name: "idx_adr_user", fields: ["user_id"] },
      { name: "idx_adr_status", fields: ["status"] },
    ],
    hooks: {
      beforeUpdate: async (request) => {
        request.updated_at = new Date();
      },
    },
  },
);

module.exports = AccountDeletionRequest;
