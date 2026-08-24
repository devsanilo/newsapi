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
 * Test the database connection
 */
async function testConnection() {
  try {
    await sequelize.authenticate();
    logger.info("✅ MySQL connection established successfully.");
  } catch (error) {
    logger.error("❌ Unable to connect to MySQL:", error.message);
    throw error;
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

    await sequelize.sync(options);
    logger.info("✅ Database synced successfully.");

    // Seed sources from DB seeder
    await seedSourcesIfEmpty();

    // Seed default pages if empty
    await seedPagesIfEmpty();
  } catch (error) {
    logger.error("❌ Database sync failed:", error.message);
    throw error;
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
