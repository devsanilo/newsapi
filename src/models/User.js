/**
 * User Model
 * Supports email/password + social auth (Google, Apple)
 */
const { DataTypes, Model } = require("sequelize");
const { sequelize } = require("../database/connection");
const bcrypt = require("bcryptjs");

class User extends Model {
  async comparePassword(candidatePassword) {
    if (!this.password) return false;
    return bcrypt.compare(candidatePassword, this.password);
  }

  toSafeJSON() {
    const { password, ...safe } = this.toJSON();
    return safe;
  }
}

User.init(
  {
    id: {
      type: DataTypes.CHAR(36),
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: { notEmpty: true, len: [2, 100] },
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: true, // null for social-auth-only users
    },
    avatar: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    role: {
      type: DataTypes.ENUM("user", "admin"),
      allowNull: false,
      defaultValue: "user",
    },
    auth_provider: {
      type: DataTypes.ENUM("local", "google", "apple"),
      allowNull: false,
      defaultValue: "local",
    },
    auth_provider_id: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: "Google sub / Apple sub identifier",
    },
    bio: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: "Short user bio",
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    location: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },
    website: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    fcm_token: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: "Firebase Cloud Messaging device token",
    },
    notification_push: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: "Enable push notifications",
    },
    notification_email: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: "Enable email notifications",
    },
    notification_breaking: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: "Breaking news notifications",
    },
    notification_comments: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: "Comment reply notifications",
    },
    notification_likes: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: "Like notifications",
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
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
    modelName: "User",
    tableName: "users",
    timestamps: false,
    engine: "InnoDB",
    charset: "utf8mb4",
    collate: "utf8mb4_unicode_ci",
    indexes: [
      { name: "idx_users_email", unique: true, fields: ["email"] },
      { name: "idx_users_role", fields: ["role"] },
      {
        name: "idx_users_provider",
        fields: ["auth_provider", "auth_provider_id"],
      },
    ],
    hooks: {
      beforeCreate: async (user) => {
        if (user.password) {
          user.password = await bcrypt.hash(user.password, 12);
        }
      },
      beforeUpdate: async (user) => {
        if (user.changed("password") && user.password) {
          user.password = await bcrypt.hash(user.password, 12);
        }
        user.updated_at = new Date();
      },
    },
  },
);

module.exports = User;
