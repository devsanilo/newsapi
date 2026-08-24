/**
 * Email Service — transactional and digest emails via nodemailer
 * Requires SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in env
 */
const nodemailer = require("nodemailer");
const logger = require("../utils/logger");

let transporter = null;

function init() {
  const host = process.env.SMTP_HOST;
  if (!host) {
    logger.warn("SMTP not configured — email service disabled.");
    return;
  }

  transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  transporter
    .verify()
    .then(() => {
      logger.info("✅ SMTP email transport ready.");
    })
    .catch((err) => {
      logger.warn(`SMTP verification failed: ${err.message}`);
    });
}

async function send({ to, subject, html, text }) {
  if (!transporter) {
    logger.warn("Email skipped — SMTP not configured.");
    return null;
  }

  const from =
    process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@noozia.app";

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

module.exports = { init, send, buildDigestHtml };
