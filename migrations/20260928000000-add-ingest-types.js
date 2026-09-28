"use strict";

/**
 * Ingest-type restructure: WordPress REST as the article source, RSS as highlights.
 *
 * ── What changes and why ──────────────────────────────────────────────────
 *
 * Until now every source was RSS. RSS only carries a summary, so full text had
 * to be scraped back off the publisher's article page — and that scrape failed
 * or returned almost nothing for a large share of articles, which is why
 * rewrites kept coming out thin.
 *
 * WordPress sites expose `/wp-json/wp/v2/posts`, which returns the complete
 * post. That becomes the source text for the rewrite pipeline and removes the
 * scrape entirely, so the two kinds of source now need different treatment:
 *
 *   feed_type = 'wordpress' → ingested in full, unpublished until rewritten,
 *                             and the only rows the rewrite queue will claim.
 *   feed_type = 'rss'       → a headline highlight. Published immediately,
 *                             links out to the publisher, never rewritten, and
 *                             never gets an article page on Trenxi.
 *
 * `news.ingest_type` records which of those a row is. It is deliberately
 * separate from `content_type`: ingest_type is provenance fixed at insert
 * (where the text came from), while content_type describes the LIVE content and
 * changes when a rewrite is applied ('aggregated' → 'rewritten'). Deriving
 * eligibility for rewriting from content_type would break the moment a rewrite
 * landed, and would also make RSS highlights indistinguishable from WordPress
 * rows waiting their turn.
 *
 * `sources.feed_type` is the single source of truth for how a publisher is
 * read; `news.ingest_type` is the denormalised copy taken at ingest, so the
 * claim query stays single-table (`FOR UPDATE SKIP LOCKED` plus a join is much
 * harder to reason about, and ingest_type can never legitimately drift).
 *
 * ── DDL notes ─────────────────────────────────────────────────────────────
 *
 * Follows the constraints learned the hard way in 20260926000000:
 *   - NO transaction wrapper. MySQL DDL implicitly commits, and a pooled
 *     connection left in an open transaction holds a metadata lock that blocks
 *     every later DDL on the table.
 *   - ONE batched ALTER per table. `news` has two FULLTEXT indexes, so each
 *     statement costs a full table copy plus a FULLTEXT rebuild.
 *   - `lock_wait_timeout` is bounded; its default is a year, so a blocked ALTER
 *     would hang silently instead of failing.
 */

const NEWS_COLUMNS = [
  [
    'ingest_type',
    "ENUM('rss','wordpress') NOT NULL DEFAULT 'rss' COMMENT 'How this row was ingested: RSS highlight, or full WordPress post'",
  ],
];

const SOURCE_COLUMNS = [
  [
    'feed_type',
    "ENUM('rss','wordpress') NOT NULL DEFAULT 'rss' COMMENT 'How this publisher is read: RSS highlights, or the WordPress REST API'",
  ],
  [
    'wp_api_url',
    "VARCHAR(500) NULL COMMENT 'WordPress REST base, e.g. https://site/wp-json/wp/v2'",
  ],
];

async function runDdl(sequelize, table, clauses, { label }) {
  const lockWait = Math.max(1, Number(process.env.MIGRATE_LOCK_WAIT_SECONDS || 120));
  const attempts = Math.max(1, Number(process.env.MIGRATE_DDL_RETRIES || 4));

  await sequelize.query(`SET SESSION lock_wait_timeout = ${lockWait}`);

  const sql = `ALTER TABLE \`${table}\` ${clauses.join(", ")}`;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await sequelize.query(sql);
      return;
    } catch (err) {
      const code = err?.original?.code || err?.parent?.code || err?.code;
      const retryable = code === "ER_LOCK_WAIT_TIMEOUT" || code === "ER_LOCK_DEADLOCK";
      lastError = err;
      if (!retryable || attempt === attempts) break;
      console.warn(
        `${table} (${label}): ALTER blocked by a metadata lock (${code}), attempt ${attempt}/${attempts} — retrying after ${attempt * 5}s`,
      );
      await new Promise((r) => setTimeout(r, attempt * 5000));
    }
  }

  throw lastError;
}

async function describe(queryInterface, table) {
  return queryInterface
    .describeTable(table)
    .then((d) => new Set(Object.keys(d)))
    .catch(() => new Set());
}

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;

    // ── news ────────────────────────────────────────────────────────────────
    const newsColumns = await describe(queryInterface, "news");
    if (newsColumns.size === 0) {
      throw new Error("Table `news` not found — run the baseline first.");
    }

    const newsIndexes = new Set(
      (await queryInterface.showIndex("news").catch(() => [])).map((i) => i.name),
    );

    const newsClauses = NEWS_COLUMNS.filter(([name]) => !newsColumns.has(name)).map(
      ([name, definition]) => `ADD COLUMN \`${name}\` ${definition}`,
    );

    // The claim query filters on ingest_type, so it leads the index.
    if (!newsIndexes.has("idx_news_ingest_queue")) {
      newsClauses.push(
        "ADD INDEX `idx_news_ingest_queue` (`ingest_type`, `rewrite_status`)",
      );
    }

    if (newsClauses.length > 0) {
      await runDdl(sequelize, "news", newsClauses, { label: "up" });
    }

    // ── sources ─────────────────────────────────────────────────────────────
    const sourceColumns = await describe(queryInterface, "sources");
    if (sourceColumns.size === 0) {
      throw new Error("Table `sources` not found — run the baseline first.");
    }

    const sourceIndexes = new Set(
      (await queryInterface.showIndex("sources").catch(() => [])).map((i) => i.name),
    );

    const sourceClauses = SOURCE_COLUMNS.filter(
      ([name]) => !sourceColumns.has(name),
    ).map(([name, definition]) => `ADD COLUMN \`${name}\` ${definition}`);

    if (!sourceIndexes.has("idx_sources_feed_type")) {
      sourceClauses.push("ADD INDEX `idx_sources_feed_type` (`feed_type`)");
    }

    if (sourceClauses.length > 0) {
      await runDdl(sequelize, "sources", sourceClauses, { label: "up" });
    }
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;

    const newsColumns = await describe(queryInterface, "news");
    const newsIndexes = new Set(
      (await queryInterface.showIndex("news").catch(() => [])).map((i) => i.name),
    );
    const newsClauses = [];
    if (newsIndexes.has("idx_news_ingest_queue")) {
      newsClauses.push("DROP INDEX `idx_news_ingest_queue`");
    }
    if (newsColumns.has("ingest_type")) {
      newsClauses.push("DROP COLUMN `ingest_type`");
    }
    if (newsClauses.length > 0) {
      await runDdl(sequelize, "news", newsClauses, { label: "down" });
    }

    const sourceColumns = await describe(queryInterface, "sources");
    const sourceIndexes = new Set(
      (await queryInterface.showIndex("sources").catch(() => [])).map((i) => i.name),
    );
    const sourceClauses = [];
    if (sourceIndexes.has("idx_sources_feed_type")) {
      sourceClauses.push("DROP INDEX `idx_sources_feed_type`");
    }
    if (sourceColumns.has("wp_api_url")) {
      sourceClauses.push("DROP COLUMN `wp_api_url`");
    }
    if (sourceColumns.has("feed_type")) {
      sourceClauses.push("DROP COLUMN `feed_type`");
    }
    if (sourceClauses.length > 0) {
      await runDdl(sequelize, "sources", sourceClauses, { label: "down" });
    }
  },
};
