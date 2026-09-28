/**
 * News Model
 * Sequelize model for the `news` table with optimized indexing for MySQL InnoDB
 */
const { DataTypes, Model } = require("sequelize");
const { sequelize } = require("../database/connection");
const { generateHash } = require("../utils/hash");
const { toCanonicalCategory } = require("../utils/categories");
// The article/highlights split, so the raw SQL here cannot drift from the
// Sequelize queries in the services.
const { ARTICLE_SCOPE_SQL } = require("../utils/feedScope");

class News extends Model {
  /**
   * Check if an article already exists by hash or URL
   * @param {string} hash - SHA256 hash of normalized title
   * @param {string} url - Article URL
   * @returns {boolean}
   */
  static async isDuplicate(hash, url) {
    const existing = await News.findOne({
      where: sequelize.literal(
        `hash = ${sequelize.escape(hash)} OR url = ${sequelize.escape(url)}`,
      ),
      attributes: ["id"],
      raw: true,
    });
    return !!existing;
  }

  /**
   * Bulk insert articles, ignoring duplicates
   * @param {Array} articles - Array of article objects
   * @returns {Object} - { inserted, skipped }
   */
  static async bulkInsertIgnoreDuplicates(articles) {
    let inserted = 0;
    let skipped = 0;

    for (const article of articles) {
      try {
        await News.create(article);
        inserted++;
      } catch (error) {
        if (
          error.name === "SequelizeUniqueConstraintError" ||
          (error.original && error.original.code === "ER_DUP_ENTRY")
        ) {
          skipped++;
        } else {
          throw error;
        }
      }
    }

    return { inserted, skipped };
  }

  /**
   * Full-text search using MySQL FULLTEXT index
   * @param {string} query - Search query
   * @param {Object} options - { limit, offset }
   * @returns {Object} - { rows, count }
   */
  static async fullTextSearch(query, { limit = 20, offset = 0 } = {}) {
    const escapedQuery = sequelize.escape(query);

    const [rows] = await sequelize.query(
      `SELECT *, MATCH(title, description) AGAINST(${escapedQuery} IN NATURAL LANGUAGE MODE) AS relevance
       FROM news
       WHERE is_published = 1
         AND MATCH(title, description) AGAINST(${escapedQuery} IN NATURAL LANGUAGE MODE)
       ORDER BY relevance DESC, published_at DESC
       LIMIT ${parseInt(limit, 10)} OFFSET ${parseInt(offset, 10)}`,
    );

    const [[{ total }]] = await sequelize.query(
      `SELECT COUNT(*) as total FROM news
       WHERE is_published = 1
         AND MATCH(title, description) AGAINST(${escapedQuery} IN NATURAL LANGUAGE MODE)`,
    );

    return { rows, count: total };
  }

  /**
   * Get trending articles based on recency and source diversity
   * Uses a scoring system: more recent articles from more sources = more trending
   * @param {Object} options - { limit, hours }
   * @returns {Array}
   */
  static async getTrending({ limit = 20, hours = 48 } = {}) {
    // Compute cutoff in app code to avoid MySQL INTERVAL placeholder quirks
    const cutoff = new Date(
      Date.now() - (parseInt(hours, 10) || 48) * 60 * 60 * 1000,
    );
    const safeLimit = parseInt(limit, 10) || 20;

    const [rows] = await sequelize.query(
      `SELECT n.*, cat_counts.article_count AS trending_score
       FROM news n
       INNER JOIN (
         SELECT category, COUNT(*) AS article_count
         FROM news
         WHERE is_published = 1
           AND ${ARTICLE_SCOPE_SQL}
           AND COALESCE(published_at, created_at) >= :cutoff
           AND category IS NOT NULL
         GROUP BY category
       ) cat_counts ON n.category = cat_counts.category
       WHERE n.is_published = 1
         AND n.${ARTICLE_SCOPE_SQL}
         AND COALESCE(n.published_at, n.created_at) >= :cutoff
       ORDER BY cat_counts.article_count DESC, COALESCE(n.published_at, n.created_at) DESC
       LIMIT :limit`,
      {
        replacements: { cutoff, limit: safeLimit },
      },
    );

    return rows;
  }
}

News.init(
  {
    id: {
      type: DataTypes.CHAR(36),
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
      comment: "UUID primary key",
    },
    title: {
      type: DataTypes.STRING(500),
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [1, 500],
      },
      comment: "Article title",
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Article summary/description",
    },
    content: {
      type: DataTypes.TEXT("medium"),
      allowNull: true,
      comment: "Article content (summary only, not full copyrighted text)",
    },
    image_url: {
      type: DataTypes.STRING(1000),
      allowNull: true,
      comment: "Featured image URL",
    },
    source: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: "News source identifier",
    },
    category: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: "Article category",
    },
    url: {
      type: DataTypes.STRING(768),
      allowNull: false,
      unique: true,
      comment:
        "Original article URL (max 768 chars for InnoDB utf8mb4 unique key)",
    },
    hash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
      comment: "SHA256 hash of normalized title for deduplication",
    },
    tags: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
      comment: "Extracted tags from content",
    },
    language: {
      type: DataTypes.STRING(10),
      allowNull: true,
      defaultValue: "en",
      comment: "Article language code",
    },
    is_original: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: "True for first-party Trenxi-authored posts",
    },
    is_published: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: "False for drafts; only published rows are public",
    },
    author_id: {
      type: DataTypes.CHAR(36),
      allowNull: true,
      comment: "Optional user id for original authored posts",
    },
    published_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "Original publication date",
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "Last update timestamp",
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: "Record creation timestamp",
    },
    // ─── AI rewrite pipeline ───────────────────────────────────────────────
    // `content_type` describes the LIVE content and is intentionally separate
    // from `is_original`: an AI rewrite of syndicated copy is a derivative, so
    // it must not claim to be first-party. Conflating the two would destroy the
    // only signal that distinguishes Trenxi-authored pages.
    //
    //   aggregated — an RSS/crawled row: headline, standfirst, image, link out.
    //                Never rewritten, never given an article page.
    //   rewritten  — our own prose derived from a publisher's full post.
    //   original   — first-party Trenxi reporting.
    //   syndicated — a WordPress post published VERBATIM, with a page. Kept
    //                separate from 'aggregated' precisely because it has a page
    //                and belongs in the article feed.
    content_type: {
      type: DataTypes.ENUM("aggregated", "rewritten", "original", "syndicated"),
      allowNull: false,
      defaultValue: "aggregated",
      comment:
        "Provenance of the live content: third-party feed, AI rewrite, first-party, or verbatim syndication",
    },
    // How the row got here, fixed at insert and never changed.
    //
    // Deliberately NOT derived from content_type, which changes when a rewrite
    // is applied ('aggregated' -> 'rewritten'). Rewrite eligibility has to be a
    // property of where the text CAME from: a WordPress post is rewritable,
    // an RSS highlight is not. Using content_type for this would break the
    // moment a rewrite landed, and would leave RSS highlights and WordPress
    // rows waiting their turn indistinguishable.
    ingest_type: {
      type: DataTypes.ENUM("rss", "wordpress"),
      allowNull: false,
      defaultValue: "rss",
      comment: "rss = headline highlight; wordpress = full post, rewritable",
    },
    rewrite_status: {
      type: DataTypes.ENUM(
        "none",
        "pending",
        "processing",
        "ready",
        "applied",
        "failed",
        // Published as-is. The claim query takes only ('none','failed'), so this
        // takes a row out of the rewrite queue for good without pretending a
        // rewrite happened ('applied') or that it failed ('failed').
        "skipped",
      ),
      allowNull: false,
      defaultValue: "none",
      comment: "State of the AI rewrite for this row; skipped = published as-is",
    },
    // Generated output is parked here and is NEVER served to readers until an
    // admin approves it. This is what stops one bad model day from rewriting
    // every live page at once.
    staged_title: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: "Rewritten headline awaiting approval",
    },
    staged_description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Rewritten standfirst awaiting approval",
    },
    staged_content: {
      type: DataTypes.TEXT("medium"),
      allowNull: true,
      comment: "AI rewrite awaiting approval; never served to readers",
    },
    staged_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "When the staged rewrite was generated",
    },
    rewrite_meta: {
      type: DataTypes.JSON,
      allowNull: true,
      comment:
        "Model, prompt version, token usage and cost for the staged rewrite",
    },
    rewrite_error: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: "Last failure reason, for the admin queue",
    },
    rewrite_attempts: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      comment: "Failed attempts, used to stop retrying hopeless rows",
    },
  },
  {
    sequelize,
    modelName: "News",
    tableName: "news",
    timestamps: false, // We manage timestamps manually
    engine: "InnoDB",
    charset: "utf8mb4",
    collate: "utf8mb4_unicode_ci",
    indexes: [
      {
        name: "idx_category",
        fields: ["category"],
      },
      {
        name: "idx_source",
        fields: ["source"],
      },
      {
        name: "idx_published_at",
        fields: [{ name: "published_at", order: "DESC" }],
      },
      {
        name: "idx_language",
        fields: ["language"],
      },
      {
        name: "idx_created_at",
        fields: [{ name: "created_at", order: "DESC" }],
      },
      {
        name: "idx_is_published",
        fields: ["is_published"],
      },
      {
        name: "idx_is_original",
        fields: ["is_original"],
      },
      {
        name: "idx_author_id",
        fields: ["author_id"],
      },
      // FULLTEXT index is created manually in connection.js
      // because Sequelize doesn't natively support FULLTEXT indexes
    ],
    hooks: {
      beforeValidate: (news) => {
        // Auto-generate hash from normalized title + source + published_at if not provided
        if (news.title && !news.hash) {
          news.hash = generateHash(news.title, news.source, news.published_at);
        }

        // Normalize category to the canonical set; fallback to general
        if (news.category !== undefined) {
          news.category = toCanonicalCategory(news.category, "general");
        } else {
          news.category = "general";
        }
      },
    },
  },
);

module.exports = News;
