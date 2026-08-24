/**
 * Noozia API - Main Entry Point
 * Express server with MySQL (Sequelize), Bull queues, and cron scheduler
 */
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");

const routes = require("./routes");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");
const { apiLimiter } = require("./middleware/rateLimiter");
const { testConnection, syncDatabase } = require("./database/connection");
const { startScheduler, stopScheduler } = require("./jobs/scheduler");
const { closeQueues } = require("./jobs/queue");
const logger = require("./utils/logger");
const { initFirebase } = require("./services/firebaseService");

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;

// ─── Middleware ───────────────────────────────────────────────
// crossOriginOpenerPolicy disabled: it breaks Firebase Auth popup
// detection (logs "Cross-Origin-Opener-Policy would block window.closed")
app.use(helmet({ crossOriginOpenerPolicy: false }));

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(compression());

app.use(
  morgan("short", {
    stream: { write: (message) => logger.info(message.trim()) },
    skip: (req) => req.url === "/api/health",
  }),
);

app.use("/api", apiLimiter);

// ─── Routes ──────────────────────────────────────────────────
app.use("/api", routes);

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    name: "Noozia API",
    version: "3.0.0",
    description:
      "Noozia — personalized news feed with social auth, read history & offline sync",
    public_endpoints: {
      health: "GET /api/health",
      register: "POST /api/auth/register",
      login: "POST /api/auth/login",
      google_auth: "POST /api/auth/google",
      apple_auth: "POST /api/auth/apple",
      news: "GET /api/news",
      search: "GET /api/news/search?q=query",
      trending: "GET /api/news/trending",
      categories: "GET /api/news/categories",
      videos: "GET /api/videos",
      article: "GET /api/news/:id",
      related: "GET /api/news/:id/related",
      sync: "GET /api/news/sync?since=ISO_TIMESTAMP",
      sources: "GET /api/sources",
      sources_local: "GET /api/sources?local=true",
      comments: "GET /api/news/:id/comments",
      likes: "GET /api/news/:id/likes",
    },
    protected_endpoints: {
      profile: "GET /api/auth/me",
      update_profile: "PUT /api/auth/me",
      change_password: "PUT /api/auth/password",
      for_you_feed: "GET /api/news/for-you",
      mark_read: "POST /api/news/:id/read",
      read_history: "GET /api/history",
      clear_history: "DELETE /api/history",
      preferences: "GET /api/preferences",
      update_preferences: "PUT /api/preferences",
      add_comment: "POST /api/news/:id/comments",
      edit_comment: "PUT /api/comments/:id",
      delete_comment: "DELETE /api/comments/:id",
      toggle_like: "POST /api/news/:id/like",
      my_likes: "GET /api/likes",
      toggle_bookmark: "POST /api/news/:id/bookmark",
      my_bookmarks: "GET /api/bookmarks",
    },
    admin_endpoints: {
      trigger_crawl: "POST /api/crawler/trigger",
      crawler_scheduler: "GET/PATCH /api/crawler/scheduler",
      crawler_scheduler_start: "POST /api/crawler/scheduler/start",
      crawler_scheduler_stop: "POST /api/crawler/scheduler/stop",
      scrape: "POST /api/crawler/scrape",
      backfill_images: "POST /api/crawler/backfill-images",
      manage_sources: "POST/PUT/DELETE /api/sources/:slug",
    },
  });
});

// ─── Error Handling ──────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ─── Server Startup ──────────────────────────────────────────
async function startServer() {
  try {
    await testConnection();
    await syncDatabase({ alter: false });

    const server = app.listen(PORT, () => {
      logger.info(`🚀 Noozia API running on port ${PORT}`);
      logger.info(`📡 Environment: ${process.env.NODE_ENV || "development"}`);
      logger.info(`🔗 http://localhost:${PORT}`);
    });

    // Initialize Firebase (non-blocking — warns if not configured)
    initFirebase();

    await startScheduler();

    const shutdown = async (signal) => {
      logger.info(`${signal} received. Shutting down gracefully...`);
      stopScheduler();
      server.close(async () => {
        logger.info("HTTP server closed.");
        try {
          await closeQueues();
        } catch (e) {
          logger.warn("Queue close error:", e.message);
        }
        logger.info("Shutdown complete.");
        process.exit(0);
      });
      setTimeout(() => {
        logger.error("Forced shutdown after timeout");
        process.exit(1);
      }, 30000);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("uncaughtException", (error) => {
      logger.error("Uncaught Exception:", {
        message: error.message,
        stack: error.stack,
      });
      process.exit(1);
    });
    process.on("unhandledRejection", (reason) => {
      logger.error("Unhandled Rejection:", {
        reason: reason?.message || reason,
      });
    });

    return server;
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
}

startServer();

module.exports = app;
