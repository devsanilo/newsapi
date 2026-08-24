/**
 * Notification Routes
 */
const { Router } = require("express");
const ctrl = require("../controllers/notificationController");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Notifications CRUD
router.get("/", ctrl.getNotifications);
router.get("/unread-count", ctrl.getUnreadCount);
router.put("/read-all", ctrl.markAllRead);
router.put("/:id/read", ctrl.markRead);
router.delete("/:id", ctrl.deleteNotification);
router.delete("/", ctrl.clearAll);

// FCM token management
router.post("/fcm-token", ctrl.registerFcmToken);
router.delete("/fcm-token", ctrl.removeFcmToken);

// Notification preferences
router.get("/settings", ctrl.getSettings);
router.put("/settings", ctrl.updateSettings);

// Admin: broadcast breaking news
router.post("/broadcast", requireAdmin, ctrl.broadcast);

module.exports = router;
