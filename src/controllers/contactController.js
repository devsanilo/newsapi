/**
 * Contact Controller
 *
 * Public contact form. This used to be client-only: ContactPage ran a
 * setTimeout and showed "Message sent!" without contacting anything, so no
 * message ever reached anyone. That is a support hole for real visitors and a
 * site-quality signal for ad review, so this endpoint actually sends.
 *
 * The one rule here: never report success unless the mail was accepted by the
 * SMTP server. `emailService.send()` returns null when SMTP is unconfigured and
 * throws when delivery fails — both are reported as failures, because a form
 * that lies is worse than a form that is visibly down.
 */
const emailService = require("../services/emailService");
const logger = require("../utils/logger");

const LIMITS = {
  name: 100,
  email: 255,
  subject: 150,
  message: 5000,
};

// Deliberately loose. The real validation is that a human reads it; rejecting
// unusual-but-valid addresses costs us a message.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

async function submit(req, res, next) {
  try {
    const name = clean(req.body?.name, LIMITS.name);
    const email = clean(req.body?.email, LIMITS.email);
    const subject = clean(req.body?.subject, LIMITS.subject);
    const message = clean(req.body?.message, LIMITS.message);

    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        error: "Name, email and message are all required.",
      });
    }

    if (!EMAIL_PATTERN.test(email)) {
      return res.status(400).json({
        success: false,
        error: "That email address does not look valid.",
      });
    }

    // DB settings first, then env, matching emailService's own resolution.
    const smtp = await emailService.getSmtpConfig();
    const to = process.env.CONTACT_EMAIL || smtp?.from || smtp?.user;

    if (!to) {
      logger.error(
        "Contact form: no recipient. Set CONTACT_EMAIL (or SMTP_FROM) — message from " +
          `${email} was NOT delivered.`,
      );
      return res.status(503).json({
        success: false,
        error: "The contact form is not available right now. Please try again later.",
      });
    }

    const heading = subject || "New message from the Trenxi site";
    const body = [`From: ${name} <${email}>`, `Subject: ${heading}`, "", message].join(
      "\n",
    );

    const sent = await emailService.send({
      to,
      subject: `[Contact] ${heading}`,
      text: body,
      html:
        `<p><strong>From:</strong> ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</p>` +
        `<p><strong>Subject:</strong> ${escapeHtml(heading)}</p>` +
        `<hr /><p style="white-space:pre-wrap">${escapeHtml(message)}</p>`,
      // So hitting Reply in the mailbox answers the visitor, not ourselves.
      replyTo: email,
    });

    // null means SMTP is not configured. This is the exact case the old form
    // reported as success.
    if (!sent) {
      logger.error(
        `Contact form: SMTP not configured, message from ${email} was NOT delivered.`,
      );
      return res.status(503).json({
        success: false,
        error: "We could not send your message. Please try again later.",
      });
    }

    logger.info(`Contact form delivered from ${email} (${sent.messageId})`);
    res.status(201).json({
      success: true,
      data: { message: "Thanks — your message has been sent." },
    });
  } catch (error) {
    // sendMail threw: the SMTP server rejected it. Say so rather than pretending.
    logger.error(`Contact form delivery failed: ${error.message}`);
    return res.status(502).json({
      success: false,
      error:
        "We could not deliver your message. Please try again in a few minutes.",
    });
  }
}

module.exports = { submit };
