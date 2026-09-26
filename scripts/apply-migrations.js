#!/usr/bin/env node
/**
 * Apply pending migrations standalone, without booting the API.
 *
 *   node scripts/apply-migrations.js
 *
 * Why this exists: a large `ALTER TABLE` should not happen inside a deploy
 * window. `news` has two FULLTEXT indexes, so adding columns forces a full
 * table copy (~1-2 minutes on the production row count) during which writes to
 * `news` are blocked. Running it here, deliberately and with visible output,
 * means the migration is already applied by the time the new code deploys — so
 * `migrateOnBoot()` becomes a no-op and the deploy stays fast.
 *
 * It applies exactly what boot would apply: the same files, the same
 * `SequelizeMeta` bookkeeping table, so the two never disagree.
 */
const { runMigrations } = require("../src/database/migrate");
const { sequelize } = require("../src/database/connection");

(async () => {
  const summary = await runMigrations({ retries: 10, delayMs: 2000 });

  console.log("");
  console.log("── result ──");
  console.log(`  adopted (schema already present, not replayed): ${summary.adopted.length}`);
  for (const n of summary.adopted) console.log(`      ${n}`);
  console.log(`  applied: ${summary.applied.length}`);
  for (const n of summary.applied) console.log(`      ${n}`);
  console.log(`  already present: ${summary.skipped.length}`);
  if (summary.error) {
    console.log(`  FAILED: ${summary.error}`);
  }

  await sequelize.close();
  process.exit(summary.error ? 1 : 0);
})().catch(async (err) => {
  console.error(`Migration run failed: ${err.message}`);
  try {
    await sequelize.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
