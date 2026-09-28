/**
 * Retire the existing corpus, so the feed contains only the new WordPress-based
 * articles.
 *
 * ── Read this before running --purge ───────────────────────────────────────
 *
 * Seven tables reference `news.id` with ON DELETE CASCADE:
 *
 *   bookmarks, bookmark_collection_items, comments, likes,
 *   news_reactions, read_history, impressions
 *
 * So deleting news rows does NOT just delete articles. It silently destroys
 * every user's saved articles and collections, every comment, every like and
 * reaction, everyone's reading history, and the entire impression history that
 * the analytics are built on. That is why `--purge` is not the default and
 * needs an explicit acknowledgement.
 *
 * RSS rows are headline highlights — they have no article page and are never
 * rewritten — so they are the rows to remove. `--archive` gets the feed to the
 * same place without destroying anything: it unpublishes them, which takes them
 * out of the feed and out of the rewrite queue while leaving bookmarks and
 * analytics intact and reversible.
 *
 *   node scripts/purge-news-corpus.js                          # dry run, archive mode
 *   node scripts/purge-news-corpus.js --archive --apply        # unpublish RSS rows
 *   node scripts/purge-news-corpus.js --purge --apply          # DESTRUCTIVE
 *   node scripts/purge-news-corpus.js --purge --apply --keep-wordpress
 *   node scripts/purge-news-corpus.js --purge --apply --yes-really
 *
 * --purge requires --apply and one of --keep-wordpress (keep WordPress rows,
 * delete only RSS) or --yes-really (delete everything).
 */

require("dotenv").config();

const { sequelize } = require("../src/database/connection");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const PURGE = args.includes("--purge");
const RESTORE = args.includes("--restore");
const KEEP_WORDPRESS = args.includes("--keep-wordpress");
const YES_REALLY = args.includes("--yes-really");

const DEPENDENT_TABLES = [
  { table: "bookmarks", column: "news_id" },
  { table: "bookmark_collection_items", column: "news_id" },
  { table: "comments", column: "news_id" },
  { table: "likes", column: "news_id" },
  { table: "news_reactions", column: "news_id" },
  { table: "read_history", column: "news_id" },
  { table: "impressions", column: "news_id" },
];

/** Which news rows this run would act on. */
function targetWhere() {
  const rssOnly = RESTORE || !(PURGE && !KEEP_WORDPRESS);
  return rssOnly
    ? { sql: "ingest_type = 'rss'", params: {} }
    : { sql: "1 = 1", params: {} };
}

(async () => {
  await sequelize.authenticate();

  const mode = RESTORE
    ? "RESTORE (republish)"
    : PURGE
      ? "PURGE (hard delete)"
      : "ARCHIVE (unpublish)";
  const scope = RESTORE
    ? "RSS rows only"
    : PURGE && !KEEP_WORDPRESS
      ? "ALL articles"
      : PURGE
        ? "RSS rows only (WordPress rows kept)"
        : "RSS rows only";

  console.log(`${APPLY ? "APPLYING" : "DRY RUN"} — ${mode}, ${scope}\n`);

  if (PURGE && APPLY && !KEEP_WORDPRESS && !YES_REALLY) {
    console.error(
      "Refusing to delete every article without confirmation.\n" +
        "  --purge --apply --keep-wordpress   delete RSS rows only\n" +
        "  --purge --apply --yes-really       delete everything, including user data",
    );
    await sequelize.close();
    process.exit(1);
  }

  const [counts] = await sequelize.query(`
    SELECT
      SUM(ingest_type = 'rss')                AS rss_rows,
      SUM(ingest_type = 'wordpress')          AS wordpress_rows,
      SUM(content_type = 'rewritten')         AS rewritten,
      SUM(content_type = 'original')          AS originals,
      SUM(is_published = 1)                   AS published,
      COUNT(*)                                AS total
    FROM news
  `);
  const c = counts[0];
  const n = (v) => Number(v || 0);

  console.log("corpus");
  console.log(`  total rows           ${n(c.total)}`);
  console.log(`  RSS (highlights)     ${n(c.rss_rows)}`);
  console.log(`  WordPress            ${n(c.wordpress_rows)}`);
  console.log(`  rewritten articles   ${n(c.rewritten)}`);
  console.log(`  originals            ${n(c.originals)}`);
  console.log(`  published            ${n(c.published)}`);

  const where = targetWhere();
  const [affected] = await sequelize.query(
    `SELECT COUNT(*) AS n FROM news WHERE ${where.sql}`,
    { replacements: where.params },
  );
  const affectedRows = n(affected[0].n);
  console.log(`\nrows this run would affect: ${affectedRows}`);

  if (PURGE) {
    console.log("\nDEPENDENT ROWS THAT CASCADE WITH THEM:");
    let totalDependents = 0;
    for (const dep of DEPENDENT_TABLES) {
      const [r] = await sequelize.query(
        `SELECT COUNT(*) AS n FROM \`${dep.table}\`
          WHERE \`${dep.column}\` IN (SELECT id FROM news WHERE ${where.sql})`,
        { replacements: where.params },
      );
      const count = n(r[0].n);
      totalDependents += count;
      if (count > 0) {
        console.log(`  ${String(count).padStart(7)}  ${dep.table}  (DELETED, unrecoverable)`);
      }
    }
    console.log(`  ${String(totalDependents).padStart(7)}  TOTAL user/analytics rows destroyed`);

    // The existing rewrites were produced from RSS sources, so a purge scoped to
    // RSS takes them with it. They are the only publishable articles in the
    // corpus today, so losing them is worth calling out rather than discovering.
    const [rw] = await sequelize.query(
      `SELECT COUNT(*) AS n FROM news WHERE ${where.sql} AND content_type = 'rewritten'`,
      { replacements: where.params },
    );
    const rewrittenInScope = n(rw[0].n);
    if (rewrittenInScope > 0) {
      console.log(
        `\n  WARNING: ${rewrittenInScope} already-rewritten article(s) are in scope and will be destroyed.`,
      );
    }
  } else {
    console.log("  user data is untouched — unpublishing is reversible.");
  }

  if (!APPLY) {
    console.log("\nDry run — nothing changed. Re-run with --apply to proceed.");
    await sequelize.close();
    return;
  }

  if (RESTORE) {
    const [result] = await sequelize.query(
      `UPDATE news SET is_published = 1, updated_at = NOW()
        WHERE ${where.sql} AND is_published = 0`,
      { replacements: where.params },
    );
    console.log(`\nRepublished ${result.affectedRows} row(s).`);
  } else if (PURGE) {
    const [result] = await sequelize.query(
      `DELETE FROM news WHERE ${where.sql}`,
      { replacements: where.params },
    );
    console.log(`\nDeleted ${result.affectedRows} news row(s) and everything that cascaded.`);
  } else {
    const [result] = await sequelize.query(
      `UPDATE news SET is_published = 0, updated_at = NOW()
        WHERE ${where.sql} AND is_published = 1`,
      { replacements: where.params },
    );
    console.log(
      `\nUnpublished ${result.affectedRows} row(s). This is reversible — republish with --restore --apply.`,
    );
  }

  await sequelize.close();
  process.exit(0);
})().catch(async (err) => {
  console.error("purge-news-corpus failed:", err.message);
  try {
    await sequelize.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
