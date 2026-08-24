/**
 * News Service
 * Business logic for storing, retrieving, and managing news articles
 */
const { Op } = require("sequelize");
const { sequelize } = require("../database/connection");
const News = require("../models/News");
const logger = require("../utils/logger");

class NewsService {
  /**
   * Store articles in the database, skipping duplicates
   * @param {Array} articles - Array of normalized article objects
   * @returns {Object} - { inserted, skipped, errors }
   */
  async storeArticles(articles) {
    if (!articles || articles.length === 0) {
      return { inserted: 0, skipped: 0, errors: 0 };
    }

    const chunkSize = parseInt(process.env.CRAWLER_INSERT_CHUNK, 10) || 500;
    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < articles.length; i += chunkSize) {
      const batch = articles.slice(i, i + chunkSize);
      const ids = batch.map((b) => b.id);

      try {
        await News.bulkCreate(batch, {
          ignoreDuplicates: true,
          validate: true,
          hooks: true,
          returning: false,
        });

        // Count how many actually landed; INSERT IGNORE drops duplicates silently
        const persisted = await News.count({ where: { id: ids } });
        inserted += persisted;
        skipped += batch.length - persisted;
      } catch (error) {
        errors += batch.length;
        logger.error("Failed to store batch of articles", {
          error: error.message,
        });
      }
    }

    logger.info(
      `Storage results: inserted=${inserted}, skipped=${skipped}, errors=${errors}`,
    );
    return { inserted, skipped, errors };
  }

  /**
   * Store articles using a transaction for batch integrity
   * @param {Array} articles
   * @returns {Object}
   */
  async storeArticlesWithTransaction(articles) {
    const transaction = await sequelize.transaction();
    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    try {
      for (const article of articles) {
        try {
          await News.create(article, { transaction });
          inserted++;
        } catch (error) {
          if (
            error.name === "SequelizeUniqueConstraintError" ||
            (error.original && error.original.code === "ER_DUP_ENTRY")
          ) {
            skipped++;
          } else {
            errors++;
            logger.error(`Transaction store error: ${error.message}`);
          }
        }
      }

      await transaction.commit();
      logger.info(
        `Transaction complete: inserted=${inserted}, skipped=${skipped}, errors=${errors}`,
      );
      return { inserted, skipped, errors };
    } catch (error) {
      await transaction.rollback();
      logger.error(`Transaction rolled back: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get paginated news articles with optional filters
   * @param {Object} options - { page, limit, category, source, language }
   * @returns {Object} - { data, pagination }
   */
  async getNews({ page = 1, limit = 20, category, source, language } = {}) {
    const maxLimit = parseInt(process.env.MAX_PAGE_SIZE, 10) || 100;
    limit = Math.min(parseInt(limit, 10) || 20, maxLimit);
    page = Math.max(parseInt(page, 10) || 1, 1);
    const offset = (page - 1) * limit;

    const where = {};

    if (category) {
      where.category = category.toLowerCase();
    }
    if (source) {
      where.source = source.toLowerCase();
    }
    if (language) {
      where.language = language.toLowerCase();
    }

    // Use separate findAll + lightweight count to avoid full-table COUNT(*) on every page
    const [rows, count] = await Promise.all([
      News.findAll({
        where,
        order: [
          ["published_at", "DESC"],
          ["created_at", "DESC"],
          ["id", "DESC"],
        ],
        limit: limit + 1, // fetch one extra to detect hasNext without COUNT
        offset,
        raw: true,
      }),
      // Only compute total on first page; later pages skip the expensive COUNT
      page === 1 ? News.count({ where }) : Promise.resolve(null),
    ]);

    const hasNext = rows.length > limit;
    if (hasNext) rows.pop(); // remove the extra probe row

    return {
      data: rows.map(this._formatArticle),
      pagination: {
        page,
        limit,
        total: count ?? undefined,
        totalPages: count != null ? Math.ceil(count / limit) : undefined,
        hasNext,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Get a single article by ID
   * @param {string} id - Article UUID
   * @returns {Object|null}
   */
  async getNewsById(id) {
    const article = await News.findByPk(id, { raw: true });
    if (!article) return null;
    return this._formatArticle(article);
  }

  /**
   * Full-text search for articles
   * @param {string} query - Search query
   * @param {Object} options - { page, limit }
   * @returns {Object} - { data, pagination }
   */
  async searchNews(query, { page = 1, limit = 20 } = {}) {
    if (!query || query.trim().length === 0) {
      return {
        data: [],
        pagination: { page: 1, limit, total: 0, totalPages: 0 },
      };
    }

    const maxLimit = parseInt(process.env.MAX_PAGE_SIZE, 10) || 100;
    limit = Math.min(parseInt(limit, 10) || 20, maxLimit);
    page = Math.max(parseInt(page, 10) || 1, 1);
    const offset = (page - 1) * limit;

    const { rows, count } = await News.fullTextSearch(query, { limit, offset });

    return {
      data: rows.map(this._formatArticle),
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
        hasNext: page * limit < count,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Get search suggestions for autocomplete (lightweight, no full articles)
   * @param {string} query - Partial search query
   * @param {number} limit - Max suggestions
   * @returns {Array} - Array of suggestion strings
   */
  async getSearchSuggestions(query, limit = 8) {
    if (!query || query.trim().length < 2) {
      return [];
    }

    const searchTerm = `%${query.trim()}%`;
    const safeLimit = Math.min(parseInt(limit, 10) || 8, 20);

    const [rows] = await sequelize.query(
      `SELECT DISTINCT title FROM news 
       WHERE title LIKE :searchTerm 
       ORDER BY published_at DESC 
       LIMIT :limit`,
      { replacements: { searchTerm, limit: safeLimit } },
    );

    return rows.map((r) => r.title);
  }

  /**
   * Search articles by keyword (exact or partial match in title/description)
   * @param {string} keyword - Keyword to search
   * @param {Object} options - { page, limit, category }
   * @returns {Object} - { data, pagination }
   */
  async searchByKeyword(keyword, { page = 1, limit = 20, category } = {}) {
    if (!keyword || keyword.trim().length === 0) {
      return {
        data: [],
        pagination: { page: 1, limit, total: 0, totalPages: 0 },
      };
    }

    const maxLimit = parseInt(process.env.MAX_PAGE_SIZE, 10) || 100;
    limit = Math.min(parseInt(limit, 10) || 20, maxLimit);
    page = Math.max(parseInt(page, 10) || 1, 1);
    const offset = (page - 1) * limit;
    const searchTerm = `%${keyword.trim()}%`;

    let whereClause =
      "WHERE (title LIKE :searchTerm OR description LIKE :searchTerm)";
    const replacements = { searchTerm, limit, offset };

    if (category) {
      whereClause += " AND category = :category";
      replacements.category = category;
    }

    const [rows] = await sequelize.query(
      `SELECT * FROM news ${whereClause}
       ORDER BY published_at DESC
       LIMIT :limit OFFSET :offset`,
      { replacements },
    );

    const [[{ total }]] = await sequelize.query(
      `SELECT COUNT(*) as total FROM news ${whereClause}`,
      { replacements },
    );

    return {
      data: rows.map(this._formatArticle),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Get trending articles
   * @param {Object} options - { limit, hours }
   * @returns {Array}
   */
  async getTrending({ limit = 20, hours = 24 } = {}) {
    try {
      const articles = await News.getTrending({ limit, hours });
      if (!articles || articles.length === 0) {
        return await this._fallbackTrending(limit);
      }
      return articles.map(this._formatArticle);
    } catch (error) {
      // Fallback: return recent + impressions if trending query fails
      logger.warn(
        `Trending query failed, falling back to recent: ${error.message}`,
      );
      return await this._fallbackTrending(limit);
    }
  }

  /**
   * Fallback trending: recent articles weighted by impressions
   */
  async _fallbackTrending(limit) {
    const recentLimit = parseInt(limit, 10) || 20;
    const [rows] = await sequelize.query(
      `SELECT n.*,
              COALESCE(i.impressions_count, 0) AS impressions_score
       FROM news n
       LEFT JOIN (
         SELECT news_id, COUNT(*) AS impressions_count
         FROM impressions
         GROUP BY news_id
       ) i ON i.news_id = n.id
       ORDER BY n.published_at DESC, impressions_score DESC
       LIMIT :limit`,
      { replacements: { limit: recentLimit } },
    );
    return rows.map(this._formatArticle);
  }

  /**
   * Get distinct categories
   * @returns {Array<string>}
   */
  async getCategories() {
    const results = await News.findAll({
      attributes: [
        [sequelize.fn("DISTINCT", sequelize.col("category")), "category"],
      ],
      where: { category: { [Op.ne]: null } },
      raw: true,
    });
    return results
      .map((r) => r.category)
      .filter(Boolean)
      .sort();
  }

  /**
   * Get distinct sources
   * @returns {Array<string>}
   */
  async getSources() {
    const results = await News.findAll({
      attributes: [
        [sequelize.fn("DISTINCT", sequelize.col("source")), "source"],
      ],
      where: { source: { [Op.ne]: null } },
      raw: true,
    });
    return results
      .map((r) => r.source)
      .filter(Boolean)
      .sort();
  }

  /**
   * Get article count statistics
   * @returns {Object}
   */
  async getStats() {
    const total = await News.count();
    const today = await News.count({
      where: {
        created_at: { [Op.gte]: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    });

    const byCategory = await News.findAll({
      attributes: [
        "category",
        [sequelize.fn("COUNT", sequelize.col("id")), "count"],
      ],
      group: ["category"],
      raw: true,
    });

    const bySource = await News.findAll({
      attributes: [
        "source",
        [sequelize.fn("COUNT", sequelize.col("id")), "count"],
      ],
      group: ["source"],
      raw: true,
    });

    const [[impressionsTotalRow]] = await sequelize.query(
      "SELECT COUNT(*) AS cnt FROM impressions",
    );
    const [[commentsTotalRow]] = await sequelize.query(
      "SELECT COUNT(*) AS cnt FROM comments",
    );
    const [[reactionsTotalRow]] = await sequelize.query(
      "SELECT COUNT(*) AS cnt FROM news_reactions",
    );
    const [[bookmarksTotalRow]] = await sequelize.query(
      "SELECT COUNT(*) AS cnt FROM bookmarks",
    );
    const [[usersTotalRow]] = await sequelize.query(
      "SELECT COUNT(*) AS cnt FROM users",
    );

    const [topEngagedArticles] = await sequelize.query(`
      SELECT
        n.id,
        n.title,
        n.source,
        COALESCE(i.impressions_count, 0) AS impressions_count,
        COALESCE(c.comments_count, 0) AS comments_count,
        COALESCE(l.likes_count, 0) AS likes_count,
        (COALESCE(i.impressions_count, 0) + (COALESCE(c.comments_count, 0) * 3) + (COALESCE(l.likes_count, 0) * 2)) AS engagement_score
      FROM news n
      LEFT JOIN (SELECT news_id, COUNT(*) AS impressions_count FROM impressions GROUP BY news_id) i ON i.news_id = n.id
      LEFT JOIN (SELECT news_id, COUNT(*) AS comments_count FROM comments GROUP BY news_id) c ON c.news_id = n.id
      LEFT JOIN (SELECT news_id, COUNT(*) AS likes_count FROM likes GROUP BY news_id) l ON l.news_id = n.id
      ORDER BY engagement_score DESC, n.published_at DESC
      LIMIT 10
    `);

    const [reactionBreakdown] = await sequelize.query(`
      SELECT reaction_type, COUNT(*) AS count
      FROM news_reactions
      GROUP BY reaction_type
    `);

    return {
      total,
      today,
      byCategory,
      bySource,
      totals: {
        impressions: Number(impressionsTotalRow?.cnt || 0),
        comments: Number(commentsTotalRow?.cnt || 0),
        reactions: Number(reactionsTotalRow?.cnt || 0),
        bookmarks: Number(bookmarksTotalRow?.cnt || 0),
        users: Number(usersTotalRow?.cnt || 0),
      },
      topEngagedArticles,
      reactionBreakdown: reactionBreakdown.map((r) => ({
        reaction_type: r.reaction_type,
        count: Number(r.count || 0),
      })),
    };
  }

  /**
   * Format article for API response
   * @param {Object} article - Raw article from DB
   * @returns {Object}
   */
  _formatArticle(article) {
    if (!article) return null;

    // Parse tags if stored as JSON string
    let tags = article.tags;
    if (typeof tags === "string") {
      try {
        tags = JSON.parse(tags);
      } catch {
        tags = [];
      }
    }

    return {
      id: article.id,
      title: article.title,
      description: article.description,
      content: article.content,
      image_url: article.image_url,
      source: article.source,
      category: article.category,
      url: article.url,
      tags: tags || [],
      language: article.language,
      published_at: article.published_at,
      created_at: article.created_at,
      // Include relevance score if present (from search)
      ...(article.relevance !== undefined && { relevance: article.relevance }),
      ...(article.headline_frequency !== undefined && {
        headline_frequency: article.headline_frequency,
      }),
    };
  }
}

module.exports = new NewsService();
