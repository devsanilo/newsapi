/**
 * Corpus maintenance: retire the pre-restructure articles.
 *
 * ── What is being removed, and what must NOT be ────────────────────────────
 *
 * Before the restructure every source was RSS, so the corpus is mostly 11k
 * headline+summary rows that were never meant to be articles. The default scope
 * is exactly those:
 *
 *     ingest_type = 'rss' AND content_type = 'aggregated'
 *
 * Scoping by `ingest_type = 'rss'` alone is NOT safe: the already-rewritten
 * articles were produced from RSS sources, so they carry ingest_type='rss' even
 * though they are real, published Trenxi articles. A purge built on that alone
 * destroys the only real articles in the corpus. `content_type = 'aggregated'`
 * is what excludes them, and it also leaves the WordPress rows that are still
 * waiting to be rewritten.
 *
 * ── The cascade ────────────────────────────────────────────────────────────
 *
 * Seven tables reference `news.id` ON DELETE CASCADE. Deleting articles is
 * therefore also deleting user data:
 *
 *     bookmarks, bookmark_collection_items, comments, likes,
 *     news_reactions, read_history, impressions
 *
 * `describe()` reports those counts before anything happens, so the cost is
 * visible rather than discovered. `archive()` gets the feed to the same place
 * without destroying anything.
 */

const { sequelize } = require("../database/connection");
const logger = require("../utils/logger");

/** Rows that cascade when a news row is deleted. */
const DEPENDENT_TABLES = [
  "bookmarks",
  "bookmark_collection_items",
  "comments",
  "likes",
  "news_reactions",
  "read_history",
  "impressions",
];

/**
 * Named scopes.
 *
 *   highlights — the old RSS headline rows (default). Leaves real articles and
 *                pending WordPress rows alone.
 *   rss        — every RSS row, INCLUDING already-rewritten articles.
 *   all        — everything. Nuclear; removes WordPress rows too.
 */
const SCOPES = {
  highlights: "ingest_type = 'rss' AND content_type = 'aggregated'",
  rss: "ingest_type = 'rss'",
  all: "1 = 1",
};

function scopeWhere(scope = "highlights") {
  const sql = SCOPES[scope];
  if (!sql) {
    throw new Error(
      `Unknown scope "${scope}". Use one of: ${Object.keys(SCOPES).join(", ")}`,
    );
  }
  return sql;
}

// Batching is not a micro-optimisation, it is the difference between working
// and appearing to hang. Measured on a 12k-row corpus, a single DELETE of
// 11,894 rows cascaded into the seven dependent tables locked over 13,000 rows
// and held them for 20+ seconds, and the equivalent UPDATE was the same — even
// though those tables held a few hundred rows each, because every cascaded
// child row must be found and locked too.
//
// Each batch is its own autocommit statement, so locks are released between
// batches and readers are never blocked for the length of the whole operation.
const BATCH_SIZE = Number(process.env.CORPUS_BATCH_SIZE || 500);
const BATCH_PAUSE_MS = Number(process.env.CORPUS_BATCH_PAUSE_MS || 50);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `statement` repeatedly until it stops matching rows.
 *
 * Safe because each pass excludes what the previous pass already changed:
 * archived rows no longer have is_published = 1, and purged rows are gone.
 */
async function runBatched(statement) {
  let rows = 0;
  let batches = 0;

  for (;;) {
    const [result] = await sequelize.query(`${statement} LIMIT ${BATCH_SIZE}`);
    const affected = Number(result.affectedRows || 0);
    rows += affected;
    batches += 1;

    if (affected < BATCH_SIZE) break;
    await sleep(BATCH_PAUSE_MS);
  }

  return { rows, batches };
}

/**
 * Count what the scope covers, and what a delete would cascade into.
 *
 * Read-only; safe to call at any time.
 */
async function describe(scope = "highlights") {
  const where = scopeWhere(scope);

  const [[corpus]] = await sequelize.query(`
    SELECT COUNT(*) AS total,
           SUM(ingest_type = 'rss')       AS rss_rows,
           SUM(ingest_type = 'wordpress') AS wordpress_rows,
           SUM(content_type = 'aggregated') AS aggregated,
           SUM(content_type = 'rewritten')  AS rewritten,
           SUM(content_type = 'original')   AS originals,
           SUM(is_published = 1)            AS published
      FROM news
  `);

  const [[inScope]] = await sequelize.query(
    `SELECT COUNT(*) AS n,
            SUM(content_type = 'rewritten') AS rewritten,
            SUM(is_published = 1)           AS published
       FROM news WHERE ${where}`,
  );

  const dependents = [];
  let dependentTotal = 0;
  for (const table of DEPENDENT_TABLES) {
    const [[row]] = await sequelize.query(
      `SELECT COUNT(*) AS n FROM \`${table}\`
        WHERE news_id IN (SELECT id FROM news WHERE ${where})`,
    );
    const count = Number(row.n || 0);
    dependentTotal += count;
    if (count > 0) dependents.push({ table, rows: count });
  }

  return {
    scope,
    where,
    corpus: {
      total: Number(corpus.total || 0),
      rssRows: Number(corpus.rss_rows || 0),
      wordpressRows: Number(corpus.wordpress_rows || 0),
      aggregated: Number(corpus.aggregated || 0),
      rewritten: Number(corpus.rewritten || 0),
      originals: Number(corpus.originals || 0),
      published: Number(corpus.published || 0),
    },
    inScope: {
      rows: Number(inScope.n || 0),
      rewritten: Number(inScope.rewritten || 0),
      published: Number(inScope.published || 0),
    },
    cascade: { dependents, total: dependentTotal },
  };
}

/**
 * Take the rows out of the feed without deleting anything.
 *
 * Reversible with `restore()`.
 */
async function archive(scope = "highlights") {
  const where = scopeWhere(scope);
  const { rows, batches } = await runBatched(
    `UPDATE news SET is_published = 0, updated_at = NOW()
      WHERE ${where} AND is_published = 1`,
  );
  logger.info(
    `Corpus archive (${scope}): unpublished ${rows} row(s) in ${batches} batch(es)`,
  );
  return { action: "archive", scope, rows, batches };
}

/** Reverse `archive()`. */
async function restore(scope = "highlights") {
  const where = scopeWhere(scope);
  const { rows, batches } = await runBatched(
    `UPDATE news SET is_published = 1, updated_at = NOW()
      WHERE ${where} AND is_published = 0`,
  );
  logger.info(
    `Corpus restore (${scope}): republished ${rows} row(s) in ${batches} batch(es)`,
  );
  return { action: "restore", scope, rows, batches };
}

/**
 * Hard delete. Irreversible, and takes the cascaded user data with it.
 *
 * Refuses to touch rows containing already-rewritten articles unless the caller
 * has explicitly acknowledged it, because that is the one mistake here that
 * cannot be walked back.
 */
async function purge(scope = "highlights", { allowRewritten = false } = {}) {
  const where = scopeWhere(scope);

  const [[rw]] = await sequelize.query(
    `SELECT COUNT(*) AS n FROM news WHERE ${where} AND content_type = 'rewritten'`,
  );
  const rewritten = Number(rw.n || 0);
  if (rewritten > 0 && !allowRewritten) {
    return {
      action: "purge",
      scope,
      refused: true,
      rewritten,
      reason: `Scope contains ${rewritten} already-rewritten article(s). Pass allowRewritten to confirm their destruction.`,
    };
  }

  const { rows, batches } = await runBatched(`DELETE FROM news WHERE ${where}`);
  logger.warn(
    `Corpus purge (${scope}): deleted ${rows} news row(s) in ${batches} batch(es), and all cascaded dependents`,
  );
  return { action: "purge", scope, rows, batches, rewrittenDestroyed: rewritten };
}

module.exports = {
  SCOPES,
  DEPENDENT_TABLES,
  describe,
  archive,
  restore,
  purge,
};
