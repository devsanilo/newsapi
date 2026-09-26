'use strict';

/**
 * AI rewrite pipeline: staging columns on `news`.
 *
 * ── Why this migration is written the way it is ────────────────────────────
 *
 * The first version of this file caused a production outage. Two mistakes
 * compounded, and neither produced an error, which is what made it so hard to
 * see:
 *
 * 1. It wrapped DDL in `queryInterface.sequelize.transaction()`. MySQL DDL is
 *    not transactional — it implicitly commits — so the wrapper bought nothing
 *    and cost a great deal: the pooled connection was left sitting in an open
 *    transaction holding a metadata lock on `news`. Any later DDL against that
 *    table then waits on that lock. The migration runner executes files in
 *    sequence within one process, and the two migrations ordered before this
 *    one both wrap their DDL the same way, so this migration blocked on their
 *    leftover locks. It never errored; it simply never finished. Hence NO DDL
 *    BELOW IS WRAPPED IN A TRANSACTION.
 *
 * 2. It issued one `ALTER TABLE` per column — ten of them. `news` carries two
 *    FULLTEXT indexes, so MySQL cannot use ALGORITHM=INSTANT and every
 *    statement costs a full table copy plus a FULLTEXT rebuild. Ten copies took
 *    over five minutes on a 12k-row copy and would have taken 10-20 minutes on
 *    the production row count. Batching them into one statement does one copy
 *    (~33s measured on 12k rows) and is atomic, so a killed deploy cannot leave
 *    a half-migrated table.
 *
 * `lock_wait_timeout` is also bounded. Its default is 31536000 seconds — a
 * year — so a blocked ALTER hangs silently rather than failing, which is
 * exactly how mistake 1 stayed invisible.
 *
 * ── Schema notes ──────────────────────────────────────────────────────────
 *
 * `content_type` describes the LIVE content and is deliberately separate from
 * `is_original`: an AI rewrite of syndicated copy is a derivative work, so it
 * must not claim to be first-party. Conflating the two would destroy the only
 * signal that distinguishes Trenxi-authored pages. The backfill therefore maps
 * is_original=1 -> 'original' only.
 *
 * Generated output lands in `staged_*` and is never served to readers until an
 * admin approves it.
 */

const COLUMN_DDL = [
  [
    'content_type',
    "ENUM('aggregated','rewritten','original') NOT NULL DEFAULT 'aggregated' COMMENT 'Provenance of the live content: third-party feed, AI rewrite, or first-party'",
  ],
  [
    'rewrite_status',
    "ENUM('none','pending','processing','ready','applied','failed') NOT NULL DEFAULT 'none' COMMENT 'State of the AI rewrite for this row'",
  ],
  [
    'rewrite_attempts',
    "INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Failed attempts, used to stop retrying hopeless rows'",
  ],
  ['staged_title', "VARCHAR(500) NULL COMMENT 'Rewritten headline awaiting approval'"],
  ['staged_description', "TEXT NULL COMMENT 'Rewritten standfirst awaiting approval'"],
  [
    'staged_content',
    "MEDIUMTEXT NULL COMMENT 'AI rewrite awaiting approval; never served to readers'",
  ],
  ['staged_at', "DATETIME NULL COMMENT 'When the staged rewrite was generated'"],
  [
    'rewrite_meta',
    "JSON NULL COMMENT 'Model, prompt version, token usage and cost for the staged rewrite'",
  ],
  ['rewrite_error', "VARCHAR(500) NULL COMMENT 'Last failure reason, for the admin queue'"],
];

const COLUMN_NAMES = COLUMN_DDL.map(([name]) => name);

/**
 * Run a single batched ALTER, retrying while it is blocked by a metadata lock.
 *
 * A metadata lock timeout is an expected transient here: the crawler writes to
 * `news` continuously, so a brief overlap is normal. Anything else is raised
 * immediately rather than retried.
 */
async function runDdl(sequelize, clauses, { label }) {
  const lockWait = Math.max(1, Number(process.env.MIGRATE_LOCK_WAIT_SECONDS || 120));
  const attempts = Math.max(1, Number(process.env.MIGRATE_DDL_RETRIES || 4));

  await sequelize.query(`SET SESSION lock_wait_timeout = ${lockWait}`);

  const sql = `ALTER TABLE \`news\` ${clauses.join(', ')}`;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await sequelize.query(sql);
      return;
    } catch (err) {
      const code = err?.original?.code || err?.parent?.code || err?.code;
      const retryable =
        code === 'ER_LOCK_WAIT_TIMEOUT' || code === 'ER_LOCK_DEADLOCK';
      lastError = err;
      if (!retryable || attempt === attempts) break;
      console.warn(
        `news (${label}): ALTER blocked by a metadata lock (${code}), attempt ${attempt}/${attempts} — retrying after ${attempt * 5}s`,
      );
      await new Promise((r) => setTimeout(r, attempt * 5000));
    }
  }

  throw lastError;
}

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;

    const columns = await queryInterface
      .describeTable('news')
      .then((d) => new Set(Object.keys(d)))
      .catch(() => new Set());

    if (columns.size === 0) {
      throw new Error('Table `news` not found — run the baseline first.');
    }

    const existingIndexes = await queryInterface.showIndex('news').catch(() => []);
    const indexNames = new Set(existingIndexes.map((i) => i.name));

    const clauses = COLUMN_DDL.filter(([name]) => !columns.has(name)).map(
      ([name, definition]) => `ADD COLUMN \`${name}\` ${definition}`,
    );

    // Batch selection scans "aggregated rows not yet rewritten", so the leading
    // column is content_type.
    if (!indexNames.has('idx_news_rewrite_queue')) {
      clauses.push(
        'ADD INDEX `idx_news_rewrite_queue` (`content_type`, `rewrite_status`)',
      );
    }
    // The review queue reads status='ready' ordered by staged_at.
    if (!indexNames.has('idx_news_staged_at')) {
      clauses.push('ADD INDEX `idx_news_staged_at` (`staged_at`)');
    }

    if (clauses.length > 0) {
      await runDdl(sequelize, clauses, { label: 'up' });
    }

    // Backfill only genuine first-party rows. Everything else — including the
    // 43k aggregated rows — stays 'aggregated'.
    await sequelize.query(
      "UPDATE news SET content_type = 'original' WHERE is_original = 1 AND content_type <> 'original'",
    );
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;

    const columns = await queryInterface
      .describeTable('news')
      .then((d) => new Set(Object.keys(d)))
      .catch(() => new Set());
    const existingIndexes = await queryInterface.showIndex('news').catch(() => []);
    const indexNames = new Set(existingIndexes.map((i) => i.name));

    // Batched for the same reason as up(): every statement is a full table copy
    // while FULLTEXT indexes are present.
    const clauses = [];
    for (const name of COLUMN_NAMES) {
      if (columns.has(name)) clauses.push(`DROP COLUMN \`${name}\``);
    }
    if (indexNames.has('idx_news_rewrite_queue')) {
      clauses.push('DROP INDEX `idx_news_rewrite_queue`');
    }
    if (indexNames.has('idx_news_staged_at')) {
      clauses.push('DROP INDEX `idx_news_staged_at`');
    }

    if (clauses.length > 0) {
      await runDdl(sequelize, clauses, { label: 'down' });
    }
  },

  // Exposed so the schema check in scripts/apply-migrations.js and the tests
  // agree with the migration on what "applied" means.
  COLUMN_NAMES,
};
