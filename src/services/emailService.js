/**
 * Email Service — transactional and digest emails via nodemailer.
 * SMTP config is read from the `settings` table (editable in the admin
 * dashboard) with env vars (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)
 * as fallback.
 */
const nodemailer = require("nodemailer");
const logger = require("../utils/logger");

/**
 * Resolve SMTP config: DB settings first, then env fallback.
 */
async function getSmtpConfig() {
  let db = {};
  try {
    const Setting = require("../models/Setting");
    db = await Setting.getAllSettings();
  } catch (err) {
    logger.warn(`emailService: could not read settings: ${err.message}`);
  }

  const val = (key, envKey, fallback) => {
    const fromDb = db[key]?.value;
    if (fromDb !== undefined && fromDb !== "") return fromDb;
    return process.env[envKey] || fallback;
  };

  const host = val(Setting?.KEYS?.SMTP_HOST || "smtp_host", "SMTP_HOST", "");
  return {
    host,
    port: parseInt(val(Setting?.KEYS?.SMTP_PORT || "smtp_port", "SMTP_PORT", "587"), 10) || 587,
    secure:
      val(Setting?.KEYS?.SMTP_SECURE || "smtp_secure", "SMTP_SECURE", "false") === "true",
    user: val(Setting?.KEYS?.SMTP_USER || "smtp_user", "SMTP_USER", ""),
    pass: val(Setting?.KEYS?.SMTP_PASS || "smtp_pass", "SMTP_PASS", ""),
    from:
      val(Setting?.KEYS?.SMTP_FROM || "smtp_from", "SMTP_FROM", "") ||
      process.env.SMTP_USER ||
      "noreply@trenxi.com",
  };
}

async function getTransporter() {
  const cfg = await getSmtpConfig();
  if (!cfg.host) return null;
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
}

function init() {
  // Warm check only — no blocking on startup if SMTP missing.
  getTransporter()
    .then((t) => {
      if (!t) {
        logger.warn("SMTP not configured — email service disabled.");
        return;
      }
      return t.verify();
    })
    .then(() => logger.info("✅ SMTP email transport ready."))
    .catch((err) => logger.warn(`SMTP verification failed: ${err.message}`));
}

async function send({ to, subject, html, text }) {
  const transporter = await getTransporter();
  if (!transporter) {
    logger.warn("Email skipped — SMTP not configured.");
    return null;
  }

  const cfg = await getSmtpConfig();
  const from = cfg.from || cfg.user || "noreply@trenxi.com";

  try {
    const info = await transporter.sendMail({ from, to, subject, html, text });
    logger.info(`Email sent to ${to}: ${info.messageId}`);
    return info;
  } catch (error) {
    logger.error(`Email send failed: ${error.message}`);
    throw error;
  }
}

/**
 * Send a test email (used by the admin dashboard SMTP tester).
 * Returns { ok, messageId } or { ok:false, error }.
 */
async function sendTest({ to }) {
  const transporter = await getTransporter();
  if (!transporter) {
    return { ok: false, error: "SMTP is not configured. Save SMTP settings first." };
  }
  try {
    const cfg = await getSmtpConfig();
    const info = await transporter.sendMail({
      from: cfg.from || cfg.user,
      to,
      subject: "Trenxi — Test email ✅",
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:520px;margin:0 auto;">
          <h2 style="color:#001e56;">Trenxi Admin</h2>
          <p>Great news — your SMTP settings work! 🎉</p>
          <p style="color:#555;">This is a test message from the Trenxi admin dashboard. You can now send transactional emails and digests from this server.</p>
        </div>`,
    });
    return { ok: true, messageId: info.messageId };
  } catch (error) {
    logger.error(`Test email failed: ${error.message}`);
    return { ok: false, error: error.message };
  }
}

/**
 * Build daily digest HTML for a user
 */
function buildDigestHtml(userName, articles) {
  const articleCards = articles
    .map(
      (a) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #eee;">
        <a href="${process.env.APP_URL || "http://localhost:3000"}/article/${a.id}" style="color:#111;text-decoration:none;">
          <strong style="font-size:14px;line-height:1.4;">${a.title}</strong>
        </a>
        <div style="font-size:12px;color:#666;margin-top:4px;">${a.source || ""} · ${a.category || ""}</div>
      </td>
    </tr>
  `,
    )
    .join("");

  return `
  <div style="max-width:560px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
    <div style="padding:24px 0;text-align:center;">
      <h1 style="font-size:24px;margin:0;">⚡ Noozia Daily Digest</h1>
      <p style="color:#666;font-size:14px;">Hi ${userName}, here are today's top stories</p>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      ${articleCards}
    </table>
    <div style="padding:20px 0;text-align:center;font-size:12px;color:#999;">
      <a href="${process.env.APP_URL || "http://localhost:3000"}/profile" style="color:#6d28d9;">Manage preferences</a>
      · <a href="${process.env.APP_URL || "http://localhost:3000"}" style="color:#6d28d9;">Open Noozia</a>
    </div>
  </div>`;
}

module.exports = { init, send, sendTest, getSmtpConfig, buildDigestHtml };
