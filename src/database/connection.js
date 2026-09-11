/**
 * Sequelize Database Connection
 * Initializes and exports the Sequelize instance for MySQL
 */
const { Sequelize } = require("sequelize");
const dbConfig = require("../config/database");
const logger = require("../utils/logger");

const env = process.env.NODE_ENV || "development";
const config = dbConfig[env];

const sequelize = new Sequelize(
  config.database,
  config.username,
  config.password,
  {
    host: config.host,
    port: config.port,
    dialect: config.dialect,
    dialectOptions: config.dialectOptions,
    define: config.define,
    pool: config.pool,
    logging: config.logging !== false ? (msg) => logger.debug(msg) : false,
  },
);

/**
 * Test the database connection.
 *
 * Retries with a fixed backoff because on a container redeploy the database
 * container is frequently not accepting connections yet. Exiting on the first
 * failure would crash-loop the API and leave the reverse proxy returning 502.
 */
async function testConnection({ attempts = 10, delayMs = 3000 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (attempt === 1) {
        logger.info(
          `🔄 Connecting to MySQL at ${config.host}:${config.port}/${config.database} ` +
            `as "${config.username}" (NODE_ENV=${env})`,
        );
      }
      await sequelize.authenticate();
      logger.info("✅ MySQL connection established successfully.");
      return;
    } catch (error) {
      logger.error(
        `❌ MySQL connection attempt ${attempt}/${attempts} failed: ${error.message}`,
      );
      if (attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Sync all models and run seeders
 */
async function syncDatabase(options = {}) {
  try {
    // Import all models to register them (associations are set up in models/index.js)
    require("../models");

    if (process.env.NODE_ENV === "production") {
      logger.warn(
        "⚠️  sequelize.sync() is running in production. " +
          "Prefer `npm run db:migrate` for safe, versioned schema changes.",
      );
    }

    // Columns added to page_views after the table was first created must exist
    // BEFORE sync() runs. sync() also (re)creates the model's indexes, and
    // adding an index for a column that is missing fails with MySQL error 1072:
    // "Key column 'country_code' doesn't exist in table".
    await ensurePageViewColumns();

    await sequelize.sync(options);
    logger.info("✅ Database synced successfully.");

    // FULLTEXT index for news search/related (Sequelize can't define FULLTEXT natively)
    await ensureFullTextIndexes();

    // Seed sources from DB seeder
    await seedSourcesIfEmpty();

    // Seed default pages if empty
    await seedPagesIfEmpty();
  } catch (error) {
    logger.error(`❌ Database sync failed: ${error.message}`);
    throw error;
  }
}

/**
 * Ensure analytics columns exist on page_views.
 * sync({ alter: false }) never adds columns to an existing table,
 * so we add them idempotently here.
 */
async function ensurePageViewColumns() {
  const columns = [
    ["session_id", "VARCHAR(64) NULL"],
    ["country", "VARCHAR(100) NULL"],
    ["country_code", "CHAR(2) NULL"],
    ["city", "VARCHAR(100) NULL"],
    ["browser", "VARCHAR(40) NULL"],
    ["os", "VARCHAR(40) NULL"],
    ["language", "VARCHAR(20) NULL"],
  ];

  let tableExists = false;
  try {
    const [[table]] = await sequelize.query(
      "SELECT COUNT(*) AS cnt FROM information_schema.tables " +
        "WHERE table_schema = DATABASE() AND table_name = 'page_views'",
    );
    tableExists = Number(table?.cnt || 0) > 0;
  } catch (error) {
    // A brand new database has no page_views table yet — sync() will create it
    // with every column already defined.
    logger.warn(`⚠️ Could not inspect page_views table: ${error.message}`);
    return;
  }
  if (!tableExists) return;

  // Each column is attempted independently: one failure must not skip the rest,
  // or sync() would then fail trying to index a still-missing column.
  for (const [name, def] of columns) {
    try {
      const [[row]] = await sequelize.query(
        "SELECT COUNT(*) AS cnt FROM information_schema.columns " +
          "WHERE table_schema = DATABASE() AND table_name = 'page_views' " +
          "AND column_name = :name",
        { replacements: { name } },
      );
      if (Number(row?.cnt || 0) > 0) continue;

      await sequelize.query(
        `ALTER TABLE page_views ADD COLUMN \`${name}\` ${def}`,
      );
      logger.info(`✅ Added missing column page_views.${name}`);
    } catch (error) {
      logger.error(
        `❌ Could not add column page_views.${name}: ${error.message}`,
      );
    }
  }
}

/**
 * Ensure the FULLTEXT index on news(title, description) exists.
 * Required by /api/news/search and /api/news/:id/related (MATCH ... AGAINST).
 * Sequelize doesn't natively support FULLTEXT indexes, so we create it manually.
 */
async function ensureFullTextIndexes() {
  try {
    const [[row]] = await sequelize.query(
      "SELECT COUNT(*) AS cnt FROM information_schema.statistics " +
        "WHERE table_schema = DATABASE() AND table_name = 'news' " +
        "AND index_name = 'ft_news_title_description'",
    );
    if (Number(row?.cnt || 0) > 0) {
      logger.info("✅ FULLTEXT index ft_news_title_description already exists.");
      return;
    }
    await sequelize.query(
      "ALTER TABLE news ADD FULLTEXT INDEX ft_news_title_description (title, description)",
    );
    logger.info("✅ Created FULLTEXT index on news(title, description).");
  } catch (error) {
    logger.warn("⚠️ Could not create FULLTEXT index:", error.message);
  }
}

/**
 * Seed sources table if it's empty
 */
async function seedSourcesIfEmpty() {
  try {
    const Source = require("../models/Source");
    const count = await Source.count();
    if (count === 0) {
      logger.info("Sources table is empty — running seeder...");
      const { seedSources } = require("./seedSources");
      await seedSources();
    } else {
      logger.info(`✅ Sources table has ${count} entries.`);
    }
  } catch (error) {
    logger.warn("⚠️ Source seeding skipped:", error.message);
  }
}

/**
 * Seed pages table if it's empty
 */
async function seedPagesIfEmpty() {
  try {
    const Page = require("../models/Page");
    const count = await Page.count();
    if (count === 0) {
      logger.info("Pages table is empty — seeding defaults...");
      const defaultPages = [
        {
          slug: "about",
          title: "About Noozia",
          meta_description: "Learn about Noozia — the smart news aggregator.",
          content:
            '<h2>⚡ What We Do</h2><p>We aggregate news from dozens of reputable sources, organize them by topic, and personalize your feed based on your reading habits.</p><h2>🎯 Our Mission</h2><p>To make staying informed effortless. We believe everyone deserves access to quality journalism without the noise.</p><h2>🚀 Features</h2><ul><li>Personalized "For You" feed</li><li>Real-time trending topics</li><li>AI-powered article summaries</li><li>Reading streaks and badges</li><li>Dark mode</li><li>Bookmark collections</li><li>Push notifications</li><li>Works offline as a PWA</li></ul>',
        },
        {
          slug: "privacy",
          title: "Privacy Policy",
          meta_description: "Noozia Privacy Policy.",
          content:
            '<h2>1. Information We Collect</h2><p><strong>Account Information:</strong> Name, email, password (bcrypt hashed).</p><p><strong>Usage Data:</strong> Articles you read, like, bookmark, and share.</p><h2>2. How We Use Your Information</h2><ul><li>Personalizing your news feed</li><li>Tracking reading streaks</li><li>Sending push notifications (if enabled)</li><li>Improving our service</li></ul><h2>3. Data Sharing</h2><p>We do not sell your personal information to third parties.</p><h2>4. Data Security</h2><p>We use encrypted passwords, JWT authentication, and HTTPS.</p><h2>5. Your Rights</h2><p>You can update or delete your account at any time from Profile settings.</p><h2>6. Contact</h2><p>Questions? Visit our <a href="/contact">Contact page</a>.</p>',
        },
        {
          slug: "terms",
          title: "Terms of Service",
          meta_description: "Noozia Terms of Service.",
          content:
            '<h2>1. Acceptance of Terms</h2><p>By using Noozia, you agree to these terms.</p><h2>2. Description of Service</h2><p>Noozia aggregates news from third-party sources. All articles link to original publishers.</p><h2>3. User Accounts</h2><p>You are responsible for keeping your credentials confidential.</p><h2>4. Acceptable Use</h2><ul><li>No unlawful use</li><li>No unauthorized access</li><li>No scraping or crawling</li><li>No spam or harassment</li></ul><h2>5. Intellectual Property</h2><p>Articles belong to their publishers. The platform is our property.</p><h2>6. Limitation of Liability</h2><p>Noozia is provided "as is" without warranties.</p><h2>7. Contact</h2><p>Questions? Visit our <a href="/contact">Contact page</a>.</p>',
        },
        {
          slug: "contact",
          title: "Contact Us",
          meta_description: "Get in touch with the Noozia team.",
          content:
            "<p>Have feedback, a question, or found a bug? We would love to hear from you.</p><h2>📧 Email</h2><p>support@noozia.app</p><h2>📍 Location</h2><p>San Francisco, CA</p><h2>💬 Get in Touch</h2><p>Use the contact form below to send us a message. We typically respond within 24 hours.</p>",
        },
      ];
      await Page.bulkCreate(defaultPages);
      logger.info(`✅ Seeded ${defaultPages.length} default pages.`);
    } else {
      logger.info(`✅ Pages table has ${count} entries.`);
    }
  } catch (error) {
    logger.warn("⚠️ Page seeding skipped:", error.message);
  }
}

module.exports = {
  sequelize,
  testConnection,
  syncDatabase,
};
