/**
 * Account Deletion Service
 *
 * The second half of the deletion flow: filing the request deactivates the
 * account immediately, and this module is what actually erases it.
 *
 * Distinction that matters: deactivation (`is_active = false`) happens the
 * moment a user asks. Erasure — removing the row and everything hanging off it
 * — happens here, either when the retention window elapses or when an admin
 * forces it early.
 *
 * The window is a published commitment (the web page states it in days), so if
 * the fast path is ever needed, prefer running `purgeDueRequests()` by hand
 * over lowering `ACCOUNT_ERASURE_DAYS`: shortening the window silently changes
 * what the policy page promises.
 */
const { Op } = require("sequelize");
const User = require("../models/User");
const AccountDeletionRequest = require("../models/AccountDeletionRequest");
const logger = require("../utils/logger");

const ERASURE_WINDOW_DAYS = Number(process.env.ACCOUNT_ERASURE_DAYS || 30);

/** A request becomes erasable this long after it was filed. */
function erasureDueAt(requestedAt) {
  const due = new Date(requestedAt);
  due.setDate(due.getDate() + ERASURE_WINDOW_DAYS);
  return due;
}

/** Whole days still to wait, floored at 0. */
function daysRemaining(request, now = new Date()) {
  const due = erasureDueAt(request.requested_at);
  const ms = due.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86400000);
}

/**
 * Erase one user and close out its request.
 *
 * The user row goes first: associations are declared `onDelete: CASCADE`, so
 * comments, bookmarks, likes, history and the rest follow it out. The request
 * row deliberately survives — it is the audit trail, and its `user_id` carries
 * no foreign key so nothing cascades it away.
 */
async function eraseRequest(request, { processedBy = null } = {}) {
  const erasedAt = new Date();

  await User.destroy({ where: { id: request.user_id } });

  request.status = "completed";
  request.processed_at = erasedAt;
  request.processed_by = processedBy;
  await request.save();

  logger.info(
    `Account erased: ${request.email} (${request.user_id}) [request ${request.id}]`,
  );

  return request;
}

/**
 * Erase every pending request whose window has elapsed.
 *
 * Counting on `requested_at` rather than a stored due date keeps the window a
 * single number that can be changed without backfilling rows.
 */
async function purgeDueRequests({ limit = 100 } = {}) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - ERASURE_WINDOW_DAYS);

  const due = await AccountDeletionRequest.findAll({
    where: {
      status: "pending",
      requested_at: { [Op.lte]: cutoff },
    },
    limit,
    order: [["requested_at", "ASC"]],
  });

  const result = { scanned: due.length, erased: 0, failed: 0 };

  for (const request of due) {
    try {
      await eraseRequest(request);
      result.erased += 1;
    } catch (error) {
      // One bad row must not abandon the rest of the batch; the request stays
      // pending so the next pass retries it.
      result.failed += 1;
      logger.error(
        `Failed to erase account for request ${request.id}: ${error.message}`,
      );
    }
  }

  return result;
}

module.exports = {
  ERASURE_WINDOW_DAYS,
  erasureDueAt,
  daysRemaining,
  eraseRequest,
  purgeDueRequests,
};
