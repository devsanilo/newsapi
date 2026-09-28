/**
 * The single definition of which corpus a feed serves.
 *
 * There are two corpora and they must not mix:
 *
 *   articles   — AI rewrites and first-party originals. Full articles we own,
 *                with an in-app page.
 *   highlights — raw RSS rows. A headline, a standfirst and an image, which is
 *                why they open the publisher instead of an in-app page.
 *
 * ── Why the split is on content_type and NOT ingest_type ───────────────────
 *
 * `ingest_type` records where a row CAME FROM, and every article rewritten
 * before the WordPress change came from RSS. Filtering the article feed on
 * ingest_type='wordpress' would therefore hide every published article in the
 * corpus — the feed would go empty. What matters for a feed is whether we own
 * the text, which is what `content_type` records.
 *
 * WordPress rows awaiting a rewrite are `content_type='aggregated'` and
 * unpublished, so they belong to neither feed.
 *
 * This lives in its own module because it was previously duplicated across
 * newsService and feedController, and the copies drifted: `/news` was scoped
 * and `/news/for-you` — the default Home tab — was not, so logged-in readers
 * still got the entire RSS corpus in their feed.
 */

const { Op } = require("sequelize");

const ARTICLE_CONTENT_TYPES = ["rewritten", "original", "syndicated"];
const HIGHLIGHT_CONTENT_TYPE = "aggregated";

/** Sequelize where-fragment for the article feed. */
function articleScopeWhere() {
  return { content_type: { [Op.in]: ARTICLE_CONTENT_TYPES } };
}

/** Sequelize where-fragment for the highlights feed. */
function highlightScopeWhere() {
  return { ingest_type: "rss", content_type: HIGHLIGHT_CONTENT_TYPE };
}

/**
 * Scope for a named feed. Anything that is not 'highlights' resolves to the
 * article feed, so an unexpected value can never leak the wrong corpus.
 */
function feedWhere(feed) {
  return feed === "highlights" ? highlightScopeWhere() : articleScopeWhere();
}

/** SQL equivalent, for the queries written by hand in raw MySQL. */
const ARTICLE_SCOPE_SQL = "content_type IN ('rewritten','original','syndicated')";

module.exports = {
  ARTICLE_CONTENT_TYPES,
  HIGHLIGHT_CONTENT_TYPE,
  ARTICLE_SCOPE_SQL,
  articleScopeWhere,
  highlightScopeWhere,
  feedWhere,
};
