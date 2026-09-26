#!/usr/bin/env node
/**
 * Rewrite ONE article and report everything needed to judge it.
 *
 *   node scripts/rewrite-one.js                    # list candidates
 *   node scripts/rewrite-one.js --id <uuid>        # fetch source, rewrite, stage
 *   node scripts/rewrite-one.js --id <uuid> --dry  # fetch source only (free)
 *   node scripts/rewrite-one.js --id <uuid> --file body.txt   # skip scraping
 *   node scripts/rewrite-one.js --id <uuid> --apply           # also go live
 *
 * Output is STAGED unless --apply is passed, so this is safe to run against
 * production: nothing becomes reader-visible without an explicit flag.
 *
 * `--file` exists because the scraping dependency can be broken in a given
 * environment (a partial `node_modules`, or no Chromium in a container) while
 * the model and the guard rails are perfectly testable without it. Supplying
 * the source text directly separates "is the model any good" from "can we fetch
 * the page".
 *
 * Never prints the API key; only whether one is configured.
 */
const fs = require("fs");
const { sequelize } = require("../src/database/connection");
const aiService = require("../src/services/aiService");
const rewriteService = require("../src/services/rewriteService");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry") args.dry = true;
    else if (a === "--apply") args.apply = true;
    else if (a === "--file") args.file = argv[++i];
    else if (a === "--id") args.id = argv[++i];
    else args._.push(a);
  }
  return args;
}

const words = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
const rule = (t) => console.log(`\n${"─".repeat(72)}\n${t}\n${"─".repeat(72)}`);

async function listCandidates() {
  const [rows] = await sequelize.query(
    `SELECT id, title, source, CHAR_LENGTH(COALESCE(content,'')) AS content_len, url
       FROM news
      WHERE content_type = 'aggregated'
        AND rewrite_status IN ('none','failed')
        AND url IS NOT NULL AND url <> ''
      ORDER BY created_at DESC
      LIMIT 8`,
  );

  console.log("Candidate articles (most recent aggregated rows):\n");
  if (rows.length === 0) {
    console.log("  none found — every aggregated row is already staged or applied.");
    return;
  }
  for (const r of rows) {
    console.log(`  ${r.id}`);
    console.log(`    ${String(r.title).slice(0, 78)}`);
    console.log(`    source=${r.source} | stored content=${r.content_len} chars`);
    console.log(`    ${r.url}`);
    console.log("");
  }
  console.log("Run:  node scripts/rewrite-one.js --id <uuid>");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await sequelize.authenticate();

  rule("environment");
  console.log(`  DeepSeek key configured : ${aiService.isConfigured() ? "yes" : "NO"}`);
  console.log(`  model                   : ${aiService.deepseekModel()}`);
  console.log(`  word range              : ${rewriteService.MIN_WORDS}-${rewriteService.MAX_WORDS}`);
  console.log(`  max shared run allowed  : ${rewriteService.MAX_SHARED_RUN} words`);

  if (!args.id) {
    rule("candidates");
    await listCandidates();
    await sequelize.close();
    return;
  }

  const [[row]] = await sequelize.query(
    `SELECT id, title, description, source, url, content, content_type, rewrite_status
       FROM news WHERE id = :id`,
    { replacements: { id: args.id } },
  );
  if (!row) {
    console.log(`\nNo article with id ${args.id}`);
    await sequelize.close();
    process.exit(1);
  }

  rule("target article");
  console.log(`  id     : ${row.id}`);
  console.log(`  title  : ${row.title}`);
  console.log(`  source : ${row.source}`);
  console.log(`  url    : ${row.url}`);
  console.log(`  state  : content_type=${row.content_type} rewrite_status=${row.rewrite_status}`);
  console.log(`  stored content: ${words(row.content)} words (this is what readers see today)`);

  // ── Obtain the source text ───────────────────────────────────────────────
  let source = null;
  if (args.file) {
    if (!fs.existsSync(args.file)) {
      console.log(`\n--file not found: ${args.file}`);
      await sequelize.close();
      process.exit(1);
    }
    const text = fs.readFileSync(args.file, "utf8");
    source = { title: row.title, description: row.description || "", text };
    rule("source (from --file)");
    console.log(`  ${words(text)} words, ${text.length} chars`);
  } else {
    rule("fetching source page");
    try {
      source = await rewriteService.fetchSourceText(row);
      if (!source) {
        console.log("  source page returned nothing usable.");
      } else {
        console.log(`  fetched: ${words(source.text)} words, ${source.text.length} chars`);
      }
    } catch (err) {
      console.log(`  FAILED: ${err.message}`);
      if (err.scraperUnavailable) {
        console.log("");
        console.log("  The scraping dependency could not be loaded, so the source page");
        console.log("  cannot be fetched in THIS environment. That is environment");
        console.log("  trouble, not an article problem — the pipeline releases the row");
        console.log("  rather than marking it un-rewritable.");
        console.log("");
        console.log("  To test the model and the guard rails anyway, pass the source");
        console.log("  text directly:  --file <path>");
      }
    }
  }

  if (!source) {
    await sequelize.close();
    process.exit(1);
  }

  if (source.text && source.text.length < 1500) {
    console.log(
      `\n  Note: only ${source.text.length} chars of source text. Short sources tend to`,
    );
    console.log("  produce thin rewrites; the guard rails will reject anything too short.");
  }

  if (args.dry) {
    rule("source preview (first 700 chars)");
    console.log(source.text.slice(0, 700));
    console.log("\n--dry: model not called.");
    await sequelize.close();
    return;
  }

  if (!aiService.isConfigured()) {
    rule("stopping");
    console.log("  DEEPSEEK_API_KEY is not set in this environment.");
    console.log("  Add it to .env (never commit it) and re-run.");
    await sequelize.close();
    process.exit(1);
  }

  // ── Rewrite ──────────────────────────────────────────────────────────────
  rule("generating rewrite");
  const started = Date.now();
  const result = await rewriteService.rewriteRow(row, {
    // Reuse the text we already obtained so --file works and we do not scrape twice.
    scrape: async () => source,
  });
  const elapsed = Date.now() - started;

  if (!result.ok) {
    console.log(`  REJECTED: ${result.reason}`);
    console.log(`  (took ${(elapsed / 1000).toFixed(1)}s)`);
    console.log("\n  The row's rewrite_error column records why. Rejections are not");
    console.log("  failures of the pipeline — they are the guard rails working.");
    const [[after]] = await sequelize.query(
      "SELECT rewrite_status, rewrite_attempts, rewrite_error FROM news WHERE id = :id",
      { replacements: { id: args.id } },
    );
    console.log(`  row now: ${JSON.stringify(after)}`);
    await sequelize.close();
    process.exit(2);
  }

  const meta = result.meta;
  const [[staged]] = await sequelize.query(
    `SELECT staged_title, staged_description, staged_content FROM news WHERE id = :id`,
    { replacements: { id: args.id } },
  );

  rule("result");
  console.log(`  accepted in      : ${(elapsed / 1000).toFixed(1)}s (model ${meta.ms}ms)`);
  console.log(`  model            : ${meta.model}`);
  console.log(`  tokens           : in=${meta.usage?.prompt_tokens} out=${meta.usage?.completion_tokens}`);
  console.log(`  cost             : $${Number(meta.cost_usd).toFixed(6)}`);
  console.log(`  finish reason    : ${meta.finish_reason}`);
  console.log(`  source chars     : ${meta.source_chars}`);
  console.log(`  output words     : ${meta.words} (was ${words(row.content)} before)`);
  console.log(`  longest shared run with source : ${meta.shared_run} words (limit ${rewriteService.MAX_SHARED_RUN})`);

  rule("STAGED headline");
  console.log(`  OLD: ${row.title}`);
  console.log(`  NEW: ${staged.staged_title}`);

  rule("STAGED standfirst");
  console.log(`  NEW: ${staged.staged_description}`);

  rule("STAGED body (full)");
  console.log(staged.staged_content);

  rule("next");
  console.log("  Nothing is live yet — this is staged only.");
  if (args.apply) {
    const applied = await rewriteService.applyStaged(row.id, { appliedBy: "script" });
    console.log(`  --apply given: ${applied.ok ? "APPLIED" : "not applied: " + applied.reason}`);
  } else {
    console.log("  To publish it:  re-run with --apply");
    console.log("  To discard it:  it stays staged until you decide");
  }

  await sequelize.close();
}

main().catch(async (err) => {
  console.error(`\nFailed: ${err.message}`);
  try {
    await sequelize.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
