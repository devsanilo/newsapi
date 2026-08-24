/**
 * Auth Middleware
 * JWT-based authentication for protected routes
 */
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const logger = require("../utils/logger");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error(
    "FATAL: JWT_SECRET environment variable is not set. " +
      "Please set it before starting the server.",
  );
}

// In-memory user cache to avoid DB hit on every authenticated request
const _userCache = new Map();
const USER_CACHE_TTL = 60_000; // 60 seconds

function getCachedUser(id) {
  const entry = _userCache.get(id);
  if (!entry) return null;
  if (Date.now() - entry.ts > USER_CACHE_TTL) {
    _userCache.delete(id);
    return null;
  }
  return entry.user;
}
function setCachedUser(id, user) {
  _userCache.set(id, { user, ts: Date.now() });
  // Prevent unbounded growth
  if (_userCache.size > 5000) {
    const oldest = _userCache.keys().next().value;
    _userCache.delete(oldest);
  }
}

/**
 * Generate JWT token for a user
 */
function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "30d" },
  );
}

/**
 * Required auth — request must have valid JWT
 */
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Authentication required. Provide Bearer token.",
      });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    let user = getCachedUser(decoded.id);
    if (!user) {
      user = await User.findByPk(decoded.id, {
        attributes: { exclude: ["password"] },
      });
      if (user && user.is_active) setCachedUser(decoded.id, user);
    }
    if (!user || !user.is_active) {
      return res
        .status(401)
        .json({ success: false, error: "User not found or deactivated." });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res
        .status(401)
        .json({ success: false, error: "Token expired. Please login again." });
    }
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ success: false, error: "Invalid token." });
    }
    logger.error("Auth middleware error:", error.message);
    return res
      .status(500)
      .json({ success: false, error: "Authentication error." });
  }
}

/**
 * Optional auth — attaches user if token present, but doesn't block
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      req.user = null;
      return next();
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    let user = getCachedUser(decoded.id);
    if (!user) {
      user = await User.findByPk(decoded.id, {
        attributes: { exclude: ["password"] },
      });
      if (user && user.is_active) setCachedUser(decoded.id, user);
    }
    req.user = user && user.is_active ? user : null;
  } catch {
    req.user = null;
  }
  next();
}

/**
 * Admin-only middleware — must be used after requireAuth
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res
      .status(403)
      .json({ success: false, error: "Admin access required." });
  }
  next();
}

module.exports = {
  generateToken,
  requireAuth,
  optionalAuth,
  requireAdmin,
};
