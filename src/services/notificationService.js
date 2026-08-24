/**
 * Notification Service
 * Create, retrieve, and manage in-app notifications + push via FCM
 */
const { Op } = require("sequelize");
const { sequelize } = require("../database/connection");
const Notification = require("../models/Notification");
const User = require("../models/User");
const fcm = require("./firebaseService");
const logger = require("../utils/logger");

class NotificationService {
  /**
   * Create an in-app notification and optionally send push via FCM
   * @param {Object} opts
   * @param {string} opts.userId - recipient
   * @param {string} opts.type - notification type enum
   * @param {string} opts.title
   * @param {string} [opts.body]
   * @param {Object} [opts.data] - deep-link payload
   * @param {string} [opts.imageUrl]
   * @param {boolean} [opts.push=true] - also send FCM push
   * @returns {Object} notification record
   */
  async create({ userId, type, title, body, data, imageUrl, push = true }) {
    const notification = await Notification.create({
      user_id: userId,
      type,
      title,
      body: body || null,
      data: data || {},
      image_url: imageUrl || null,
    });

    // Send FCM push in background (don't block response)
    if (push) {
      this._sendPush(userId, {
        title,
        body: body || "",
        data: data || {},
        imageUrl,
      }).catch(() => {});
    }

    return notification.toJSON();
  }

  /**
   * Create notification for multiple users (e.g. breaking news)
   */
  async createBulk({
    userIds,
    type,
    title,
    body,
    data,
    imageUrl,
    push = true,
  }) {
    const records = userIds.map((uid) => ({
      user_id: uid,
      type,
      title,
      body: body || null,
      data: data || {},
      image_url: imageUrl || null,
    }));

    await Notification.bulkCreate(records, { validate: true });

    if (push) {
      this._sendPushBulk(userIds, {
        title,
        body: body || "",
        data: data || {},
        imageUrl,
      }).catch(() => {});
    }

    return { sent: userIds.length };
  }

  /**
   * Broadcast breaking news to all users with push enabled
   */
  async broadcastBreakingNews({ title, body, newsId, imageUrl }) {
    // Send to FCM topic — users subscribe on the client
    await fcm.sendToTopic("breaking_news", {
      title,
      body,
      data: { type: "breaking_news", news_id: newsId || "" },
      imageUrl,
    });

    // Also create in-app records for active users
    const [users] = await sequelize.query(
      "SELECT id FROM users WHERE is_active = 1 AND notification_push = 1 LIMIT 10000",
    );

    if (users.length) {
      const records = users.map((u) => ({
        user_id: u.id,
        type: "breaking_news",
        title,
        body,
        data: { news_id: newsId },
        image_url: imageUrl,
      }));
      await Notification.bulkCreate(records, {
        validate: true,
        ignoreDuplicates: true,
      });
    }

    return { pushed: true, in_app: users.length };
  }

  /**
   * Get paginated notifications for a user
   */
  async getForUser(userId, { page = 1, limit = 30 } = {}) {
    const offset = (page - 1) * limit;

    const [rows, [[{ cnt }]]] = await Promise.all([
      Notification.findAll({
        where: { user_id: userId },
        order: [["created_at", "DESC"]],
        limit,
        offset,
        raw: true,
      }),
      sequelize.query(
        "SELECT COUNT(*) as cnt FROM notifications WHERE user_id = :userId",
        { replacements: { userId } },
      ),
    ]);

    const total = Number(cnt);

    return {
      data: rows,
      unread: await this.unreadCount(userId),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
      },
    };
  }

  /**
   * Count of unread notifications
   */
  async unreadCount(userId) {
    return Notification.count({ where: { user_id: userId, is_read: false } });
  }

  /**
   * Mark a single notification as read
   */
  async markRead(userId, notificationId) {
    const [updated] = await Notification.update(
      { is_read: true, read_at: new Date() },
      { where: { id: notificationId, user_id: userId, is_read: false } },
    );
    return updated > 0;
  }

  /**
   * Mark all notifications as read
   */
  async markAllRead(userId) {
    const [updated] = await Notification.update(
      { is_read: true, read_at: new Date() },
      { where: { user_id: userId, is_read: false } },
    );
    return updated;
  }

  /**
   * Delete a single notification
   */
  async remove(userId, notificationId) {
    return Notification.destroy({
      where: { id: notificationId, user_id: userId },
    });
  }

  /**
   * Delete all notifications for user
   */
  async clearAll(userId) {
    return Notification.destroy({ where: { user_id: userId } });
  }

  // ─── FCM helpers ──────────────────────────────────────────

  async _sendPush(userId, payload) {
    const user = await User.findByPk(userId, {
      attributes: ["fcm_token", "notification_push"],
      raw: true,
    });
    if (!user?.fcm_token || !user.notification_push) return;
    const result = await fcm.sendToDevice(user.fcm_token, payload);
    if (result === "INVALID_TOKEN") {
      await User.update({ fcm_token: null }, { where: { id: userId } });
    }
  }

  async _sendPushBulk(userIds, payload) {
    const users = await User.findAll({
      where: {
        id: userIds,
        fcm_token: { [Op.ne]: null },
        notification_push: true,
      },
      attributes: ["id", "fcm_token"],
      raw: true,
    });
    if (!users.length) return;

    const tokens = users.map((u) => u.fcm_token);
    const result = await fcm.sendToDevices(tokens, payload);

    // Clean up invalid tokens
    if (result.invalidTokens.length) {
      const invalidUsers = users.filter((u) =>
        result.invalidTokens.includes(u.fcm_token),
      );
      if (invalidUsers.length) {
        await User.update(
          { fcm_token: null },
          { where: { id: invalidUsers.map((u) => u.id) } },
        );
      }
    }
  }
}

module.exports = new NotificationService();
