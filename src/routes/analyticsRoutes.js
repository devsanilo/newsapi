/**
 * Analytics Routes — public page-view tracking
 */
const { Router } = require("express");
const analyticsController = require("../controllers/analyticsController");

const router = Router();

// Public — record a page view / visit
router.post("/view", analyticsController.trackView);

module.exports = router;
