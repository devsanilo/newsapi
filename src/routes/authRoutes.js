/**
 * Auth Routes — email/password + social auth (Google, Apple)
 */
const { Router } = require("express");
const auth = require("../controllers/authController");
const { requireAuth } = require("../middleware/auth");
const { authLimiter } = require("../middleware/rateLimiter");

const router = Router();

// Public (rate-limited to prevent brute force)
router.post("/register", authLimiter, auth.register);
router.post("/login", authLimiter, auth.login);
router.post("/google", authLimiter, auth.googleAuth);
router.post("/apple", authLimiter, auth.appleAuth);

// Protected
router.get("/me", requireAuth, auth.getProfile);
router.put("/me", requireAuth, auth.updateProfile);
router.put("/password", requireAuth, auth.changePassword);

module.exports = router;
