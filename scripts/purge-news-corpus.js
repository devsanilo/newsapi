/**
 * Retire the pre-restructure corpus.
 *
 * Scope (default `highlights`) is `ingest_type = 'rss' AND content_type =
 * 'aggregated'`: the old headline+summary rows. Real articles (rewrites and
 * originals) and WordPress rows still awaiting a rewrite are left alone.
 *
 *   node scripts/purge-news-corpus.js                          # report only
 *   node scripts/purge-news-corpus.js --archive --apply        # unpublish (reversible)
 *   node scripts/purge-news-corpus.js --restore --apply        # undo an archive
 *   node scripts/purge-news-corpus.js --purge --apply --scope all --yes-really
 *
 * --scope highlights | rss | all. `rss` and `all` include already-rewritten
 * articles; --purge refuses to touch those without --yes-really.
 *
 * Same code as GET/POST /api/admin/corpus, so it can also be run against
 * production from the admin API when there is no shell access.
 */

require("dotenv").config();

const { sequelize } = require("../src/database/connection");
const corpusService = require("../src/services/corpusService");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const YES_REALLY = args.includes("--yes-really");

const scopeFlag = args.indexOf("--scope");
const SCOPE = scopeFlag !== -1 && args[scopeFlag + 1] ? args[scopeFlag + 1] : "highlights";

const ACTION = args.includes("--purge")
  ? "purge"
  : args.includes("--restore")
    ? "restore"
    : "archive";

(async () => {
  await sequelize.authenticate();

  const report = await corpusService.describe(SCOPE);

  console.log(`${APPLY ? "APPLYING" : "DRY RUN"} — action: ${ACTION}, scope: ${SCOPE}\n`);
  console.log(`  scope filter: ${report.where}`);
  console.log();
  console.log("  current corpus");
  console.log(`    total rows          ${report.corpus.total}`);
  console.log(`    RSS rows            ${report.corpus.rssRows}`);
  console.log(`    WordPress rows      ${report.corpus.wordpressRows}`);
  console.log(`    aggregated          ${report.corpus.aggregated}`);
  console.log(`    rewritten articles  ${report.corpus.rewritten}`);
  console.log(`    originals           ${report.corpus.originals}`);
  console.log(`    published           ${report.corpus.published}`);
  console.log();
  console.log(`  in scope: ${report.inScope.rows} row(s)`);
  console.log(`    published in scope  ${report.inScope.published}`);
  console.log(`    rewritten in scope  ${report.inScope.rewritten}`);

  if (ACTION === "purge") {
    console.log("\n  CASCADE — these are destroyed with the news rows:");
    if (report.cascade.dependents.length === 0) {
      console.log("    (none)");
    } else {
      for (const d of report.cascade.dependents) {
        console.log(`    ${String(d.rows).padStart(7)}  ${d.table}`);
      }
    }
    console.log(`    ${String(report.cascade.total).padStart(7)}  TOTAL user/analytics rows, unrecoverable`);
  } else if (ACTION === "archive") {
    console.log("\n  user data is untouched — unpublishing is reversible with --restore.");
  }

  if (!APPLY) {
    console.log("\nDry run — nothing changed. Re-run with --apply to proceed.");
    await sequelize.close();
    return;
  }

  let result;
  if (ACTION === "archive") result = await corpusService.archive(SCOPE);
  else if (ACTION === "restore") result = await corpusService.restore(SCOPE);
  else result = await corpusService.purge(SCOPE, { allowRewritten: YES_REALLY });

  if (result.refused) {
    console.log(`\nRefused: ${result.reason}`);
    await sequelize.close();
    process.exit(1);
  }

  console.log(`\nDone: ${JSON.stringify(result)}`);
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
