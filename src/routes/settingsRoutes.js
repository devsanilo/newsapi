/**
 * Settings Routes
 */
const { Router } = require("express");
const settingsController = require("../controllers/settingsController");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = Router();

// Public
router.get("/public", settingsController.getPublic);

// Admin only
router.get("/", requireAuth, requireAdmin, settingsController.getAll);
router.put("/", requireAuth, requireAdmin, settingsController.update);
router.post("/initialize", requireAuth, requireAdmin, settingsController.initialize);

module.exports = router;
