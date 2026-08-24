/**
 * Notification Controller
 * In-app notifications + FCM device token management
 */
const notificationService = require("../services/notificationService");
const User = require("../models/User");
const logger = require("../utils/logger");

// ─── GET /api/notifications ────────────────────────────────
async function getNotifications(req, res, next) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const result = await notificationService.getForUser(req.user.id, {
      page,
      limit,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/notifications/unread-count ────────────────────
async function getUnreadCount(req, res, next) {
  try {
    const count = await notificationService.unreadCount(req.user.id);
    res.json({ success: true, unread: count });
  } catch (error) {
    next(error);
  }
}

// ─── PUT /api/notifications/:id/read ────────────────────────
async function markRead(req, res, next) {
  try {
    const ok = await notificationService.markRead(req.user.id, req.params.id);
    res.json({ success: true, updated: ok });
  } catch (error) {
    next(error);
  }
}

// ─── PUT /api/notifications/read-all ────────────────────────
async function markAllRead(req, res, next) {
  try {
    const count = await notificationService.markAllRead(req.user.id);
    res.json({ success: true, updated: count });
  } catch (error) {
    next(error);
  }
}

// ─── DELETE /api/notifications/:id ──────────────────────────
async function deleteNotification(req, res, next) {
  try {
    await notificationService.remove(req.user.id, req.params.id);
    res.json({ success: true, message: "Notification deleted." });
  } catch (error) {
    next(error);
  }
}

// ─── DELETE /api/notifications ──────────────────────────────
async function clearAll(req, res, next) {
  try {
    const count = await notificationService.clearAll(req.user.id);
    res.json({ success: true, deleted: count });
  } catch (error) {
    next(error);
  }
}

// ─── POST /api/notifications/fcm-token ──────────────────────
async function registerFcmToken(req, res, next) {
  try {
    const { token } = req.body;
    if (!token)
      return res
        .status(400)
        .json({ success: false, error: "FCM token is required." });

    await User.update({ fcm_token: token }, { where: { id: req.user.id } });
    res.json({ success: true, message: "FCM token registered." });
  } catch (error) {
    next(error);
  }
}

// ─── DELETE /api/notifications/fcm-token ─────────────────────
async function removeFcmToken(req, res, next) {
  try {
    await User.update({ fcm_token: null }, { where: { id: req.user.id } });
    res.json({ success: true, message: "FCM token removed." });
  } catch (error) {
    next(error);
  }
}

// ─── PUT /api/notifications/settings ─────────────────────────
async function updateSettings(req, res, next) {
  try {
    const updates = {};
    const fields = [
      "notification_push",
      "notification_email",
      "notification_breaking",
      "notification_comments",
      "notification_likes",
    ];
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = Boolean(req.body[f]);
    }
    if (Object.keys(updates).length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "No valid settings provided." });
    }
    updates.updated_at = new Date();
    await User.update(updates, { where: { id: req.user.id } });

    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ["password"] },
      raw: true,
    });
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/notifications/settings ─────────────────────────
async function getSettings(req, res, next) {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: [
        "notification_push",
        "notification_email",
        "notification_breaking",
        "notification_comments",
        "notification_likes",
      ],
      raw: true,
    });
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
}

// ─── POST /api/notifications/broadcast (admin) ──────────────
async function broadcast(req, res, next) {
  try {
    const { title, body, news_id, image_url } = req.body;
    if (!title)
      return res
        .status(400)
        .json({ success: false, error: "title is required." });

    const result = await notificationService.broadcastBreakingNews({
      title,
      body: body || "",
      newsId: news_id,
      imageUrl: image_url,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  deleteNotification,
  clearAll,
  registerFcmToken,
  removeFcmToken,
  updateSettings,
  getSettings,
  broadcast,
};
