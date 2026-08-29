/**
 * Social Service — publish posts to Facebook, Instagram, and X (Twitter).
 * Config is read from the settings table (admin-managed credentials).
 */
const crypto = require("crypto");
const Setting = require("../models/Setting");
const logger = require("../utils/logger");

const FB_GRAPH = "https://graph.facebook.com/v19.0";

/* ── Config ─────────────────────────────────────────────────── */

async function getSocialConfig() {
  const s = await Setting.getAllSettings();
  const val = (k, d = "") => {
    const v = s[k]?.value;
    return v !== undefined && v !== "" ? v : d;
  };
  const bool = (k) => val(k, "false") === "true";
  const K = Setting.KEYS;

  return {
    facebook: {
      enabled: bool(K.SOCIAL_FB_ENABLED),
      pageId: val(K.SOCIAL_FB_PAGE_ID),
      token: val(K.SOCIAL_FB_TOKEN),
    },
    instagram: {
      enabled: bool(K.SOCIAL_IG_ENABLED),
      userId: val(K.SOCIAL_IG_USER_ID),
      token: val(K.SOCIAL_IG_TOKEN),
    },
    twitter: {
      enabled: bool(K.SOCIAL_X_ENABLED),
      apiKey: val(K.SOCIAL_X_API_KEY),
      apiSecret: val(K.SOCIAL_X_API_SECRET),
      accessToken: val(K.SOCIAL_X_ACCESS_TOKEN),
      accessSecret: val(K.SOCIAL_X_ACCESS_SECRET),
    },
  };
}

/* ── Facebook ───────────────────────────────────────────────── */

async function publishFacebook(cfg, { message, link }) {
  if (!cfg.pageId || !cfg.token) {
    return { ok: false, error: "Facebook not configured (Page ID or token missing)" };
  }
  const body = { message, access_token: cfg.token };
  if (link) body.link = link;

  const res = await fetch(`${FB_GRAPH}/${cfg.pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    return { ok: false, error: data?.error?.message || "Facebook request failed" };
  }
  return { ok: true, id: data.id, url: `https://facebook.com/${cfg.pageId}/posts/${data.id}` };
}

/* ── Instagram ──────────────────────────────────────────────── */

async function publishInstagram(cfg, { caption, imageUrl }) {
  if (!cfg.userId || !cfg.token) {
    return { ok: false, error: "Instagram not configured (account ID or token missing)" };
  }
  if (!imageUrl) {
    return { ok: false, error: "Instagram requires an image URL to post" };
  }

  // Step 1 — create a media container
  const cRes = await fetch(`${FB_GRAPH}/${cfg.userId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_url: imageUrl,
      caption: caption || "",
      access_token: cfg.token,
    }),
  });
  const cData = await cRes.json();
  if (!cRes.ok) {
    return { ok: false, error: cData?.error?.message || "Instagram: could not create media" };
  }

  // Step 2 — publish the container
  const pRes = await fetch(`${FB_GRAPH}/${cfg.userId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: cData.id, access_token: cfg.token }),
  });
  const pData = await pRes.json();
  if (!pRes.ok) {
    return { ok: false, error: pData?.error?.message || "Instagram: publish failed" };
  }
  return { ok: true, id: pData.id };
}

/* ── X (Twitter) — OAuth 1.0a ──────────────────────────────── */

function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function oauthHeader({ apiKey, apiSecret, accessToken, accessSecret, method, url, params = {} }) {
  const oauth = {
    oauth_consumer_key: apiKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: "1.0",
  };

  const all = { ...oauth, ...params };
  const baseString = Object.keys(all)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(String(all[k]))}`)
    .join("&");
  const signatureBase = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(baseString)}`;
  const signingKey = `${percentEncode(apiSecret)}&${percentEncode(accessSecret)}`;
  const signature = crypto.createHmac("sha1", signingKey).update(signatureBase).digest("base64");
  oauth.oauth_signature = signature;

  return (
    "OAuth " +
    Object.keys(oauth)
      .map((k) => `${percentEncode(k)}="${percentEncode(oauth[k])}"`)
      .join(", ")
  );
}

async function publishTwitter(cfg, { text }) {
  if (!cfg.apiKey || !cfg.apiSecret || !cfg.accessToken || !cfg.accessSecret) {
    return { ok: false, error: "X (Twitter) not configured (missing API keys)" };
  }
  const trimmed = String(text || "").slice(0, 280);
  if (!trimmed) return { ok: false, error: "X post is empty" };

  const url = "https://api.twitter.com/2/tweets";
  const authHeader = oauthHeader({
    apiKey: cfg.apiKey,
    apiSecret: cfg.apiSecret,
    accessToken: cfg.accessToken,
    accessSecret: cfg.accessSecret,
    method: "POST",
    url,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify({ text: trimmed }),
  });
  const data = await res.json();
  if (!res.ok) {
    return { ok: false, error: data?.detail || data?.title || "X request failed" };
  }
  return { ok: true, id: data.data?.id, url: data.data?.id ? `https://x.com/i/status/${data.data.id}` : undefined };
}

/* ── Publish to one or more platforms ──────────────────────── */

/**
 * @param {Object} opts
 * @param {string[]} opts.platforms  ["facebook","instagram","twitter"]
 * @param {string} opts.message
 * @param {string} [opts.link]
 * @param {string} [opts.imageUrl]
 * @returns {Promise<Object>} per-platform results
 */
async function publish({ platforms = [], message, link, imageUrl }) {
  const cfg = await getSocialConfig();
  const results = {};

  const tasks = [];
  if (platforms.includes("facebook") && cfg.facebook.enabled) {
    tasks.push(
      publishFacebook(cfg.facebook, { message, link }).then((r) => (results.facebook = r)),
    );
  } else if (platforms.includes("facebook")) {
    results.facebook = { ok: false, error: "Facebook is disabled or not configured" };
  }

  if (platforms.includes("instagram") && cfg.instagram.enabled) {
    tasks.push(
      publishInstagram(cfg.instagram, { caption: `${message}${link ? " " + link : ""}`, imageUrl }).then(
        (r) => (results.instagram = r),
      ),
    );
  } else if (platforms.includes("instagram")) {
    results.instagram = { ok: false, error: "Instagram is disabled or not configured" };
  }

  if (platforms.includes("twitter") && cfg.twitter.enabled) {
    tasks.push(
      publishTwitter(cfg.twitter, { text: `${message}${link ? " " + link : ""}` }).then(
        (r) => (results.twitter = r),
      ),
    );
  } else if (platforms.includes("twitter")) {
    results.twitter = { ok: false, error: "X is disabled or not configured" };
  }

  await Promise.allSettled(tasks);
  return results;
}

module.exports = { getSocialConfig, publish, publishFacebook, publishInstagram, publishTwitter };
