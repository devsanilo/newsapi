/**
 * Analytics Controller — anonymous page-view tracking with
 * device / browser / OS / language / country enrichment.
 */
const PageView = require("../models/PageView");
const logger = require("../utils/logger");

const BOT_RE =
  /bot|crawler|spider|crawl|slurp|mediapartners|facebookexternalhit|preview|monitor|curl|wget|headless|python-requests|axios|node-fetch|pingdom|uptime/i;

/* ── User-Agent parsing ─────────────────────────────────────── */

function parseUA(ua = "") {
  let device = "desktop";
  if (/tablet|ipad/i.test(ua)) device = "tablet";
  else if (/mobile|iphone|ipod|android/i.test(ua)) device = "mobile";

  let os = "Other";
  if (/windows/i.test(ua)) os = "Windows";
  else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/mac os x|macintosh/i.test(ua)) os = "macOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/linux/i.test(ua)) os = "Linux";

  let browser = "Other";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/opr\/|opera/i.test(ua)) browser = "Opera";
  else if (/chrome|crios/i.test(ua)) browser = "Chrome";
  else if (/firefox|fxios/i.test(ua)) browser = "Firefox";
  else if (/safari/i.test(ua)) browser = "Safari";

  return { device, browser, os };
}

/* ── Geo lookup (CDN headers first, then cached IP lookup) ──── */

const geoCache = new Map(); // ip -> { country, country_code, city } | null
const GEO_CACHE_MAX = 5000;

function headerCountry(req) {
  const code =
    req.get("cf-ipcountry") ||
    req.get("x-vercel-ip-country") ||
    req.get("x-country-code") ||
    "";
  if (code && code.length === 2 && code.toUpperCase() !== "XX") {
    return { country_code: code.toUpperCase() };
  }
  return null;
}

function clientIp(req) {
  const fwd = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  let ip = fwd || req.ip || "";
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  return ip;
}

function isPrivateIp(ip) {
  return (
    !ip ||
    ip === "::1" ||
    ip === "127.0.0.1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
}

/**
 * Best-effort country lookup (no API key, cached). Never throws.
 */
async function resolveGeo(ip) {
  if (isPrivateIp(ip)) return null;
  if (geoCache.has(ip)) return geoCache.get(ip);

  try {
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    const geo = data?.success
      ? {
          country: data.country || null,
          country_code: data.country_code || null,
          city: data.city || null,
        }
      : null;
    if (geoCache.size > GEO_CACHE_MAX) geoCache.clear();
    geoCache.set(ip, geo);
    return geo;
  } catch {
    geoCache.set(ip, null);
    return null;
  }
}

/* ── Tracking ───────────────────────────────────────────────── */

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

    const { device, browser, os } = parseUA(ua);
    const language = (req.get("accept-language") || "")
      .split(",")[0]
      .trim()
      .slice(0, 20);
    const fromHeader = headerCountry(req);

    const row = await PageView.create({
      path: path.slice(0, 500),
      visitor_id: visitorId ? String(visitorId).slice(0, 64) : null,
      session_id: sessionId ? String(sessionId).slice(0, 64) : null,
      referrer: referrer ? String(referrer).slice(0, 500) : null,
      device,
      browser,
      os,
      language: language || null,
      country_code: fromHeader?.country_code || null,
      user_agent: ua.slice(0, 300),
    });

    // Respond immediately; enrich geo in the background
    res.json({ success: true });

    if (!fromHeader) {
      resolveGeo(clientIp(req))
        .then((geo) => {
          if (geo && row?.id) {
            return PageView.update(
              {
                country: geo.country,
                country_code: geo.country_code,
                city: geo.city,
              },
              { where: { id: row.id } },
            );
          }
        })
        .catch(() => {});
    }
  } catch (err) {
    logger.error("analytics.trackView error:", err);
    res.json({ success: false });
  }
}

module.exports = { trackView };
