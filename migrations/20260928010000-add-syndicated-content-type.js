"use strict";

/**
 * Publish WordPress content as-is.
 *
 * ── The model this supports ───────────────────────────────────────────────
 *
 *   RSS / crawled rows  → highlights, Google-News style. Headline, standfirst,
 *                         image, and a link out to the publisher. NEVER
 *                         rewritten, and never given an article page.
 *
 *   WordPress rows      → full publisher post, so they can go either way:
 *                           rewritten  → 'rewritten', our own article
 *                           as-is      → 'syndicated', the publisher's article
 *                                         published verbatim with a page
 *
 * `syndicated` is a new content_type because "as-is" is neither our writing
 * ('rewritten'/'original') nor a bare highlight ('aggregated'). It still gets an
 * article page, so the article feed has to include it — which is exactly why it
 * needs its own value rather than reusing 'aggregated', whose rows deliberately
 * have no page and appear only in Highlights.
 *
 * `skipped` is a new rewrite_status meaning "this row is not to be rewritten".
 * The claim query takes only ('none','failed'), so publishing as-is removes the
 * row from the queue permanently without pretending a rewrite happened
 * ('applied') or that it failed ('failed').
 *
 * ── DDL notes ─────────────────────────────────────────────────────────────
 *
 * Both enum changes are issued as ONE ALTER: `news` carries two FULLTEXT
 * indexes, so every ALTER costs a full table copy, and two statements would
 * mean two copies. No transaction wrapper (MySQL DDL implicitly commits and a
 * pooled connection left mid-transaction holds a metadata lock), and
 * lock_wait_timeout is bounded so a blocked ALTER fails instead of hanging.
 */

const NEW_CONTENT_TYPE =
  "ENUM('aggregated','rewritten','original','syndicated') NOT NULL DEFAULT 'aggregated' COMMENT 'Provenance of the live content: third-party feed, AI rewrite, first-party, or verbatim syndication'";

const NEW_REWRITE_STATUS =
  "ENUM('none','pending','processing','ready','applied','failed','skipped') NOT NULL DEFAULT 'none' COMMENT 'State of the AI rewrite for this row; skipped = published as-is, never to be rewritten'";

async function runDdl(sequelize, clauses) {
  const lockWait = Math.max(1, Number(process.env.MIGRATE_LOCK_WAIT_SECONDS || 120));
  const attempts = Math.max(1, Number(process.env.MIGRATE_DDL_RETRIES || 4));

  await sequelize.query(`SET SESSION lock_wait_timeout = ${lockWait}`);

  const sql = `ALTER TABLE \`news\` ${clauses.join(", ")}`;
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
        `news: ALTER blocked by a metadata lock (${code}), attempt ${attempt}/${attempts} — retrying after ${attempt * 5}s`,
      );
      await new Promise((r) => setTimeout(r, attempt * 5000));
    }
  }

  throw lastError;
}

async function currentEnum(queryInterface, column) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT COLUMN_TYPE AS type FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'news' AND COLUMN_NAME = :column`,
    { replacements: { column } },
  );
  return rows[0]?.type || null;
}

module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;

    const contentType = await currentEnum(queryInterface, "content_type");
    if (!contentType) {
      throw new Error("Column `news.content_type` not found — run the earlier migrations first.");
    }
    const rewriteStatus = await currentEnum(queryInterface, "rewrite_status");
    if (!rewriteStatus) {
      throw new Error("Column `news.rewrite_status` not found — run the earlier migrations first.");
    }

    const clauses = [];
    if (!contentType.includes("syndicated")) {
      clauses.push(`MODIFY COLUMN \`content_type\` ${NEW_CONTENT_TYPE}`);
    }
    if (!rewriteStatus.includes("skipped")) {
      clauses.push(`MODIFY COLUMN \`rewrite_status\` ${NEW_REWRITE_STATUS}`);
    }

    if (clauses.length > 0) {
      await runDdl(sequelize, clauses);
    }
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;

    // Refuse rather than silently mangle rows: MySQL truncates the value to ''
    // with a warning when an enum loses a member that rows still use, so rows
    // published as-is would end up with an empty content_type and drop out of
    // every feed.
    const [[used]] = await sequelize.query(
      "SELECT COUNT(*) AS n FROM news WHERE content_type = 'syndicated' OR rewrite_status = 'skipped'",
    );
    if (Number(used.n) > 0) {
      throw new Error(
        `Cannot roll back: ${used.n} row(s) use 'syndicated'/'skipped'. Reclassify them first.`,
      );
    }

    await runDdl(sequelize, [
      "MODIFY COLUMN `content_type` ENUM('aggregated','rewritten','original') NOT NULL DEFAULT 'aggregated' COMMENT 'Provenance of the live content: third-party feed, AI rewrite, or first-party'",
      "MODIFY COLUMN `rewrite_status` ENUM('none','pending','processing','ready','applied','failed') NOT NULL DEFAULT 'none' COMMENT 'State of the AI rewrite for this row'",
    ]);
  },
};
