/**
 * Rate Limiter Middleware
 * Protects API endpoints from abuse
 */
const rateLimit = require("express-rate-limit");

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs:
    parseInt(process.env.API_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.API_RATE_LIMIT_MAX, 10) || 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too Many Requests",
    message: "You have exceeded the rate limit. Please try again later.",
  },
});

// Stricter limiter for crawler trigger endpoints
const crawlerLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5, // Max 5 trigger requests per 5 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too Many Requests",
    message:
      "Crawler trigger rate limit exceeded. Please wait before triggering again.",
  },
});

// Search endpoint limiter
const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Max 30 searches per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too Many Requests",
    message: "Search rate limit exceeded. Please slow down.",
  },
});

// Auth endpoint limiter — prevents brute-force login / credential stuffing
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // Max 15 auth attempts per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too Many Requests",
    message: "Too many authentication attempts. Please try again later.",
  },
});

module.exports = {
  apiLimiter,
  crawlerLimiter,
  searchLimiter,
  authLimiter,
};
