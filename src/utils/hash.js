/**
 * Hash Utility
 * Generate SHA256 hash for deduplication
 */
const crypto = require("crypto");

/**
 * Normalize a title string for consistent hashing
 * - Lowercase
 * - Trim whitespace
 * - Remove extra spaces
 * - Remove special characters
 * @param {string} title
 * @returns {string}
 */
function normalizeTitle(title) {
  if (!title) return "";
  return title
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ") // Collapse multiple spaces
    .replace(/[^\w\s]/g, "") // Remove special characters
    .trim();
}

/**
 * Generate SHA256 hash from a title
 * @param {string} title - Article title
 * @returns {string} - 64-character hex hash
 */
function generateHash(title, source, publishedAt) {
  const normalizedTitle = normalizeTitle(title);
  const normalizedSource = normalizeTitle(source || "");
  let normalizedDate = "";

  if (publishedAt) {
    const asDate = new Date(publishedAt);
    if (!Number.isNaN(asDate.getTime())) {
      normalizedDate = asDate.toISOString().slice(0, 10); // YYYY-MM-DD for stability
    }
  }

  const payload = [normalizedTitle, normalizedSource, normalizedDate].join("|");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

module.exports = {
  normalizeTitle,
  generateHash,
};
