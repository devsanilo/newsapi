/**
 * Backfill: decode HTML entities left in stored article text.
 *
 * Titles/descriptions/content crawled before the cleaner handled entities were
 * saved with raw references such as "&#8211;" or "&amp;#8216;". This walks the
 * news table and rewrites those columns with decoded text.
 *
 * Usage:
 *   node scripts/fix_html_entities.js            # dry-run (report only)
 *   node scripts/fix_html_entities.js --apply    # write changes
 */
const { sequelize } = require("../src/database/connection");
const { decodeEntities } = require("../src/utils/cleaner");

const APPLY = process.argv.includes("--apply");
const COLUMNS = ["title", "description", "content"];
const BATCH_SIZE = 200;
const MATCH = COLUMNS.map((c) => `${c} LIKE '%&%'`).join(" OR ");

async function main() {
  await sequelize.authenticate();

  const [[{ total }]] = await sequelize.query(
    `SELECT COUNT(*) AS total FROM news WHERE ${MATCH}`,
  );

  console.log(
    `Mode: ${APPLY ? "APPLY" : "DRY-RUN"}  |  candidate rows: ${total}`,
  );
  if (!Number(total)) {
    console.log("Nothing to fix.");
    return;
  }

  let lastId = "";
  let scanned = 0;
  let changed = 0;
  let fieldsChanged = 0;
  const samples = [];

  for (;;) {
    const [rows] = await sequelize.query(
      `SELECT id, title, description, content
         FROM news
        WHERE id > :lastId AND (${MATCH})
        ORDER BY id
        LIMIT ${BATCH_SIZE}`,
      { replacements: { lastId } },
    );
    if (!rows.length) break;

    for (const row of rows) {
      scanned++;
      const updates = {};

      for (const column of COLUMNS) {
        const before = row[column];
        if (typeof before !== "string" || !before.includes("&")) continue;
        const after = decodeEntities(before, 2);
        if (after !== before) updates[column] = after;
      }

      if (!Object.keys(updates).length) continue;
      changed++;
      fieldsChanged += Object.keys(updates).length;

      if (samples.length < 5 && updates.title) {
        samples.push({ from: row.title, to: updates.title });
      }

      if (APPLY) {
        const sets = Object.keys(updates)
          .map((c) => `${c} = :${c}`)
          .join(", ");
        await sequelize.query(`UPDATE news SET ${sets} WHERE id = :id`, {
          replacements: { ...updates, id: row.id },
        });
      }
    }

    lastId = rows[rows.length - 1].id;
    if (rows.length < BATCH_SIZE) break;
  }

  console.log(
    `Scanned: ${scanned}  |  Rows changed: ${changed}  |  Fields: ${fieldsChanged}`,
  );
  if (samples.length) {
    console.log("\nExamples:");
    for (const s of samples) {
      console.log(`  before: ${s.from}`);
      console.log(`  after:  ${s.to}`);
    }
  }
  if (!APPLY) console.log("\nRe-run with --apply to write these changes.");
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
