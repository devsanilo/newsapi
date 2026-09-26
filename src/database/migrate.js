/**
 * Boot-time migration runner.
 *
 * Why this exists: `sequelize-cli` is a devDependency and the production image
 * is built with `npm ci --omit=dev`, so `npm run db:migrate` cannot run in the
 * container at all. Without this, every schema change required manual DDL
 * against production, and a model that declares a column the database does not
 * have breaks EVERY query on that table — Sequelize selects all declared
 * attributes by default.
 *
 * This runs the same `migrations/*.js` files the CLI would, using the app's own
 * connection, and records what it applied in `SequelizeMeta` — the table
 * `sequelize-cli` itself uses, so the two never diverge.
 *
 * Ordering matters and is enforced by the caller: this must finish BEFORE
 * `syncDatabase()`. `sequelize.sync()` recreates the model's indexes, and
 * building an index over a column that does not exist yet fails with MySQL
 * error 1072.
 */
const fs = require("fs");
const path = require("path");
const { Sequelize } = require("sequelize");
const { sequelize } = require("./connection");
const logger = require("../utils/logger");

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "migrations");
const META_TABLE = "SequelizeMeta";

/**
 * Migrations that predate this runner and are not idempotent.
 *
 * The baseline creates the whole schema with 22 unguarded `createTable` calls,
 * so replaying it against the existing production database would fail on
 * "table already exists". Its own docblock says to mark it applied WITHOUT
 * executing for existing databases — this does that automatically by checking
 * for the tables it would have created.
 */
const LEGACY_MIGRATIONS = [
  { name: "20250101000000-baseline.js", requires: ["news", "users"] },
];

/**
 * @param {Object}  options
 * @param {number} [options.retries]  Attempts to reach the DB before giving up
 * @param {number} [options.delayMs]  Base backoff between attempts
 * @returns {Promise<{adopted: string[], applied: string[], skipped: string[], failed: string[], error: string|null}>}
 */
async function runMigrations({ retries = 5, delayMs = 3000 } = {}) {
  const summary = {
    adopted: [],
    applied: [],
    skipped: [],
    failed: [],
    error: null,
  };

  const queryInterface = sequelize.getQueryInterface();

  // ── Reach the database, waiting out a container start-up race ───────────
  let connected = false;
  for (let attempt = 1; attempt <= retries && !connected; attempt += 1) {
    try {
      await sequelize.authenticate();
      connected = true;
    } catch (err) {
      if (attempt === retries) {
        summary.error = `Database unreachable: ${err.message}`;
        logger.error(`Migrations: ${summary.error}`);
        return summary;
      }
      const wait = delayMs * attempt;
      logger.warn(
        `Migrations: database not ready (attempt ${attempt}/${retries}) — retrying in ${wait}ms`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  await ensureMetaTable(queryInterface);

  const applied = new Set(
    (
      await sequelize.query(`SELECT name FROM \`${META_TABLE}\``, {
        type: Sequelize.QueryTypes.SELECT,
      })
    ).map((row) => row.name),
  );

  const files = listMigrations();

  // ── Adopt any legacy migration whose schema is already in place ─────────
  if (files.length > 0) {
    const existingTables = new Set(
      (await queryInterface.showAllTables()).map((t) =>
        String(typeof t === "string" ? t : t.tableName).toLowerCase(),
      ),
    );

    for (const legacy of LEGACY_MIGRATIONS) {
      if (!files.includes(legacy.name) || applied.has(legacy.name)) continue;
      const present = legacy.requires.every((t) =>
        existingTables.has(t.toLowerCase()),
      );
      if (present) {
        await record(queryInterface, legacy.name);
        applied.add(legacy.name);
        summary.adopted.push(legacy.name);
        logger.info(
          `Migrations: adopted "${legacy.name}" — its schema already exists, not replayed.`,
        );
      }
    }
  }

  // ── Apply everything else, in filename order ───────────────────────────
  for (const file of files) {
    if (applied.has(file)) {
      summary.skipped.push(file);
      continue;
    }

    const migration = require(path.join(MIGRATIONS_DIR, file));
    if (typeof migration.up !== "function") {
      logger.warn(`Migrations: "${file}" has no up() — skipping.`);
      summary.skipped.push(file);
      continue;
    }

    try {
      // Each migration opens and commits its own transaction, so this must not
      // wrap them in an outer one.
      await migration.up(queryInterface, Sequelize);
      await record(queryInterface, file);
      summary.applied.push(file);
      logger.info(`Migrations: applied "${file}"`);
    } catch (err) {
      // Stop at the first failure: later migrations may depend on this one, and
      // continuing could apply a change on top of a half-built schema.
      summary.failed.push(file);
      summary.error = `${file}: ${err.message}`;
      logger.error(`Migrations: FAILED on "${file}" — ${err.message}`);
      break;
    }
  }

  return summary;
}

/** Migration files in apply order. Excludes dotfiles and seed scripts. */
function listMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".js") && !f.startsWith(".") && f.includes("-"))
    .sort();
}

/**
 * Create the bookkeeping table on the same schema `sequelize-cli` uses, so a
 * later manual `db:migrate` agrees with what ran here.
 */
async function ensureMetaTable(queryInterface) {
  const tables = (await queryInterface.showAllTables()).map((t) =>
    String(typeof t === "string" ? t : t.tableName).toLowerCase(),
  );
  if (tables.includes(META_TABLE.toLowerCase())) return;

  await queryInterface.createTable(META_TABLE, {
    name: {
      type: Sequelize.DataTypes.STRING(255),
      primaryKey: true,
      allowNull: false,
    },
    // Extra over the CLI's schema; the CLI only ever reads/writes `name`, so
    // this stays compatible while giving ops a timestamp to look at.
    applied_at: {
      type: Sequelize.DataTypes.DATE,
      allowNull: true,
    },
  });
  logger.info(`Migrations: created \`${META_TABLE}\``);
}

/** Idempotent record — safe if two replicas boot at the same moment. */
async function record(queryInterface, name) {
  try {
    await sequelize.query(
      `INSERT IGNORE INTO \`${META_TABLE}\` (name, applied_at) VALUES (:name, NOW())`,
      { replacements: { name } },
    );
  } catch (err) {
    logger.warn(`Migrations: could not record "${name}": ${err.message}`);
  }
}

/**
 * Run migrations on boot unless disabled.
 *
 * Failure aborts start-up by DEFAULT, which is the opposite of the first
 * version of this file. That default caused a production outage: the migration
 * did not finish, the app started anyway, and because the model declared
 * columns the database did not have, every ORM query on `news` began failing
 * with "Unknown column". A deploy that refuses to start is loud and
 * rollback-able; a deploy that starts with a broken schema is silent and takes
 * the site down. A migration that only affects an unrelated feature can be
 * allowed through with `MIGRATE_STRICT=false`.
 */
async function migrateOnBoot() {
  if (String(process.env.MIGRATE_ON_BOOT || "true").toLowerCase() === "false") {
    logger.warn("Migrations: skipped (MIGRATE_ON_BOOT=false)");
    return { skippedAll: true };
  }

  const summary = await runMigrations();

  if (summary.error) {
    // Only skip the abort when explicitly told the failure is tolerable.
    const strict =
      String(process.env.MIGRATE_STRICT || "true").toLowerCase() !== "false";
    const message =
      `Migrations did not complete: ${summary.error}. ` +
      `A model that declares a column the database lacks breaks every query on that table.`;
    if (strict) {
      logger.error(`${message} Aborting start-up (set MIGRATE_STRICT=false to override).`);
      process.exit(1);
    }
    logger.error(`${message} Continuing because MIGRATE_STRICT=false.`);
  } else if (summary.applied.length > 0 || summary.adopted.length > 0) {
    logger.info(
      `Migrations: applied ${summary.applied.length}, adopted ${summary.adopted.length}, already present ${summary.skipped.length}.`,
    );
  } else {
    logger.info(`Migrations: up to date (${summary.skipped.length} known).`);
  }

  return summary;
}

module.exports = { runMigrations, migrateOnBoot, listMigrations, META_TABLE };
