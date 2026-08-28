/**
 * Ad Settings Routes
 * Mobile config fetch + admin CRUD
 */
const { Router } = require("express");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const {
  getAllSettings,
  getMobileSettings,
  getWebSettings,
  updateSettings,
  updateSetting,
  deleteSetting,
  initializeDefaults,
} = require("../controllers/adSettingsController");

const router = Router();

// Public — get mobile ad configuration
router.get("/mobile", getMobileSettings);

// Public — get web (AdSense) configuration
router.get("/web", getWebSettings);

// Admin — get all settings
router.get("/", requireAuth, requireAdmin, getAllSettings);

// Admin — batch update settings
router.put("/", requireAuth, requireAdmin, updateSettings);

// Admin — initialize defaults
router.post("/initialize", requireAuth, requireAdmin, initializeDefaults);

// Admin — update single setting
router.put("/:key", requireAuth, requireAdmin, updateSetting);

// Admin — delete setting
router.delete("/:key", requireAuth, requireAdmin, deleteSetting);

module.exports = router;
