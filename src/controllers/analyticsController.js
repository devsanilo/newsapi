/**
 * Analytics Controller — anonymous page-view tracking
 */
const PageView = require("../models/PageView");
const logger = require("../utils/logger");

const BOT_RE =
  /bot|crawler|spider|crawl|slurp|mediapartners|facebookexternalhit|preview|monitor|curl|wget|headless|python-requests|axios|node-fetch|pingdom|uptime/i;

function detectDevice(ua = "") {
  if (/tablet|ipad/i.test(ua)) return "tablet";
  if (/mobile|iphone|ipod|android/i.test(ua)) return "mobile";
  return "desktop";
}

/**
 * POST /api/analytics/view — public
 * Body: { path, visitorId?, sessionId?, referrer? }
 * Never fails the client — analytics is best-effort.
 */
async function trackView(req, res) {
  try {
    const ua = req.get("user-agent") || "";
    if (BOT_RE.test(ua)) {
      return res.json({ success: true, skipped: "bot" });
    }

    const { path, visitorId, sessionId, referrer } = req.body || {};
    if (!path || typeof path !== "string") {
      return res.status(400).json({ success: false, message: "path is required" });
    }

    await PageView.create({
      path: path.slice(0, 500),
      visitor_id: visitorId ? String(visitorId).slice(0, 64) : null,
      session_id: sessionId ? String(sessionId).slice(0, 64) : null,
      referrer: referrer ? String(referrer).slice(0, 500) : null,
      device: detectDevice(ua),
      user_agent: ua.slice(0, 300),
    });

    res.json({ success: true });
  } catch (err) {
    logger.error("analytics.trackView error:", err);
    res.json({ success: false });
  }
}

module.exports = { trackView };
