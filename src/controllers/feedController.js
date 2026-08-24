/**
 * Feed Controller
 * Personalized feed, read history, related articles, offline sync
 */
const { Op } = require("sequelize");
const { sequelize } = require("../database/connection");
const {
  News,
  ReadHistory,
  UserPreference,
  Like,
  Bookmark,
  Comment,
  NewsReaction,
} = require("../models");
const logger = require("../utils/logger");

// ─── Shared enrichment helper (parallelized) ─────────────────
async function enrichArticles(articles, userId) {
  if (!articles || !articles.length) return articles;
  const ids = articles.map((a) => a.id);

  // Fire all aggregate queries in parallel instead of sequentially
  const [
    [likeCounts],
    [commentCounts],
    [impressionCounts],
    [reactionRows],
    [legacyReadCounts],
  ] = await Promise.all([
    sequelize.query(
      "SELECT news_id, COUNT(*) as cnt FROM likes WHERE news_id IN (:ids) GROUP BY news_id",
      { replacements: { ids } },
    ),
    sequelize.query(
      "SELECT news_id, COUNT(*) as cnt FROM comments WHERE news_id IN (:ids) GROUP BY news_id",
      { replacements: { ids } },
    ),
    sequelize.query(
      "SELECT news_id, COUNT(*) as cnt FROM impressions WHERE news_id IN (:ids) GROUP BY news_id",
      { replacements: { ids } },
    ),
    sequelize.query(
      "SELECT news_id, reaction_type, COUNT(*) as cnt FROM news_reactions WHERE news_id IN (:ids) GROUP BY news_id, reaction_type",
      { replacements: { ids } },
    ),
    sequelize.query(
      "SELECT news_id, COALESCE(SUM(read_count), 0) as cnt FROM read_history WHERE news_id IN (:ids) GROUP BY news_id",
      { replacements: { ids } },
    ),
  ]);

  const likeMap = {};
  likeCounts.forEach((r) => {
    likeMap[r.news_id] = +r.cnt;
  });
  const commentMap = {};
  commentCounts.forEach((r) => {
    commentMap[r.news_id] = +r.cnt;
  });
  const impressionMap = {};
  impressionCounts.forEach((r) => {
    impressionMap[r.news_id] = +r.cnt;
  });
  const legacyReadMap = {};
  legacyReadCounts.forEach((r) => {
    legacyReadMap[r.news_id] = +r.cnt;
  });
  const reactionMap = {};
  reactionRows.forEach((r) => {
    if (!reactionMap[r.news_id]) {
      reactionMap[r.news_id] = {
        insightful: 0,
        shocking: 0,
        useful: 0,
        total: 0,
      };
    }
    reactionMap[r.news_id][r.reaction_type] = +r.cnt;
    reactionMap[r.news_id].total += +r.cnt;
  });

  let userLikeSet = new Set(),
    userBookmarkSet = new Set(),
    userReadSet = new Set(),
    userReactionMap = {};
  if (userId) {
    // Fire all user-specific queries in parallel
    const [[uL], [uB], [uR], [uReact]] = await Promise.all([
      sequelize.query(
        "SELECT news_id FROM likes WHERE user_id=:userId AND news_id IN (:ids)",
        { replacements: { userId, ids } },
      ),
      sequelize.query(
        "SELECT news_id FROM bookmarks WHERE user_id=:userId AND news_id IN (:ids)",
        { replacements: { userId, ids } },
      ),
      sequelize.query(
        "SELECT news_id FROM read_history WHERE user_id=:userId AND news_id IN (:ids)",
        { replacements: { userId, ids } },
      ),
      sequelize.query(
        "SELECT news_id, reaction_type FROM news_reactions WHERE user_id=:userId AND news_id IN (:ids)",
        { replacements: { userId, ids } },
      ),
    ]);
    uL.forEach((r) => userLikeSet.add(r.news_id));
    uB.forEach((r) => userBookmarkSet.add(r.news_id));
    uR.forEach((r) => userReadSet.add(r.news_id));
    uReact.forEach((r) => {
      userReactionMap[r.news_id] = r.reaction_type;
    });
  }

  return articles.map((a) => ({
    ...a,
    likes_count: likeMap[a.id] || 0,
    comments_count: commentMap[a.id] || 0,
    impressions_count: Object.prototype.hasOwnProperty.call(impressionMap, a.id)
      ? impressionMap[a.id] || 0
      : legacyReadMap[a.id] || 0,
    reactions_count: reactionMap[a.id] || {
      insightful: 0,
      shocking: 0,
      useful: 0,
      total: 0,
    },
    ...(userId
      ? {
          is_liked: userLikeSet.has(a.id),
          is_bookmarked: userBookmarkSet.has(a.id),
          is_read: userReadSet.has(a.id),
          user_reaction: userReactionMap[a.id] || null,
        }
      : {}),
  }));
}

function parseTags(tags) {
  if (!tags) return [];
  if (typeof tags === "string") {
    try {
      return JSON.parse(tags);
    } catch {
      return [];
    }
  }
  return tags;
}

/** Safely parse a JSON column that may be a string or already parsed */
function _parseJson(val, fallback) {
  if (val == null) return fallback;
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return fallback;
    }
  }
  return val;
}

// ═══════════════════════════════════════════════════════════════
//  1. PERSONALIZED FEED  —  GET /api/news/for-you
//     Engagement-weighted, time-decayed, language-filtered
// ═══════════════════════════════════════════════════════════════
async function getForYou(req, res, next) {
  try {
    const userId = req.user.id;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = (page - 1) * limit;

    // Get or create preferences
    let prefs = await UserPreference.findOne({
      where: { user_id: userId },
      raw: true,
    });
    if (!prefs) {
      prefs = {
        preferred_categories: [],
        preferred_sources: [],
        preferred_languages: ["en"],
        implicit_scores: {},
      };
    }

    const explicitCats = _parseJson(prefs.preferred_categories, []);
    const explicitSrcs = _parseJson(prefs.preferred_sources, []);
    const prefLangs = _parseJson(prefs.preferred_languages, ["en"]);
    const implicit = _parseJson(prefs.implicit_scores, {});

    // Build category relevance scores (used for ranking, not filtering)
    const catScores = {};
    Object.entries(implicit).forEach(([cat, score]) => {
      catScores[cat] = Math.min(+score, 100);
    });
    explicitCats.forEach((c) => {
      catScores[c] = (catScores[c] || 0) + 50;
    });

    // Determine which categories to QUERY (WHERE clause)
    // If user explicitly chose categories → use exactly those
    // If no explicit but has implicit → use top implicit categories
    // If nothing at all → fall back to read-history
    let topCats;
    if (explicitCats.length > 0) {
      topCats = explicitCats;
    } else if (Object.keys(catScores).length > 0) {
      topCats = Object.entries(catScores)
        .sort((a, b) => b[1] - a[1])
        .map(([c]) => c);
    } else {
      // No preferences at all — fall back to read history
      const [readCats] = await sequelize.query(
        `SELECT n.category, COUNT(*) as cnt FROM read_history rh
         JOIN news n ON n.id = rh.news_id
         WHERE rh.user_id = :userId AND n.category IS NOT NULL
         GROUP BY n.category ORDER BY cnt DESC LIMIT 5`,
        { replacements: { userId } },
      );
      topCats = readCats.map((r) => r.category);
      readCats.forEach((r) => {
        catScores[r.category] = +r.cnt;
      });
    }

    // Build WHERE clause
    let where = {};
    if (topCats.length > 0 || explicitSrcs.length > 0) {
      const conditions = [];
      if (topCats.length > 0)
        conditions.push({ category: { [Op.in]: topCats.slice(0, 10) } });
      if (explicitSrcs.length > 0)
        conditions.push({ source: { [Op.in]: explicitSrcs } });
      where = { [Op.or]: conditions };
    }

    // Language filter
    if (prefLangs.length > 0) {
      where.language = { [Op.in]: prefLangs };
    }

    // Exclude already-read articles
    if (req.query.exclude_read !== "false") {
      const [readIds] = await sequelize.query(
        "SELECT news_id FROM read_history WHERE user_id = :userId ORDER BY read_at DESC LIMIT 500",
        { replacements: { userId } },
      );
      const readNewsIds = readIds.map((r) => r.news_id);
      if (readNewsIds.length > 0) {
        where.id = { [Op.notIn]: readNewsIds };
      }
    }

    // Fetch a larger pool for engagement-based re-ranking
    const poolSize = Math.min(limit * 4, 200);
    const { count, rows } = await News.findAndCountAll({
      where,
      order: [["published_at", "DESC"]],
      limit: poolSize,
      offset: 0,
      raw: true,
    });

    // Engagement scoring + re-rank
    const enriched = await enrichArticles(
      rows.map((a) => ({ ...a, tags: parseTags(a.tags) })),
      userId,
    );

    const catScoreMap = catScores;
    const maxCatScore = Math.max(...Object.values(catScoreMap), 1);

    const scored = enriched.map((a) => {
      // Category relevance: 0–1
      const catRelevance = (catScoreMap[a.category] || 0) / maxCatScore;

      // Engagement signal: likes + comments + reactions (log-dampened)
      const engagement =
        Math.log2(
          1 +
            (a.likes_count || 0) * 2 +
            (a.comments_count || 0) * 3 +
            (a.reactions_count?.total || 0),
        ) / 10; // normalize to ~0–1 range

      // Freshness: exponential decay, half-life = 12 hours
      const ageHours =
        (Date.now() - new Date(a.published_at).getTime()) / 3600000;
      const freshness = Math.exp(-ageHours / 17); // ~0.5 at 12h, ~0.25 at 24h

      // Combined score: 45% relevance, 25% engagement, 30% freshness
      a._score = catRelevance * 0.45 + engagement * 0.25 + freshness * 0.3;
      return a;
    });

    // Sort by score, then paginate
    scored.sort((a, b) => b._score - a._score);
    const paginated = scored.slice(offset, offset + limit);

    // Remove internal scoring field
    const data = paginated.map(({ _score, ...rest }) => rest);

    res.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
        hasNext: offset + limit < scored.length,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    next(error);
  }
}

// ═══════════════════════════════════════════════════════════════
//  1b. PREFERENCES  —  GET/PUT /api/preferences
// ═══════════════════════════════════════════════════════════════
async function getPreferences(req, res, next) {
  try {
    let prefs = await UserPreference.findOne({
      where: { user_id: req.user.id },
    });
    if (!prefs) {
      prefs = await UserPreference.create({ user_id: req.user.id });
    }
    res.json({ success: true, data: prefs });
  } catch (error) {
    next(error);
  }
}

async function updatePreferences(req, res, next) {
  try {
    const { preferred_categories, preferred_sources, preferred_languages } =
      req.body;
    let prefs = await UserPreference.findOne({
      where: { user_id: req.user.id },
    });
    if (!prefs) {
      prefs = await UserPreference.create({ user_id: req.user.id });
    }

    if (preferred_categories !== undefined)
      prefs.preferred_categories = preferred_categories;
    if (preferred_sources !== undefined)
      prefs.preferred_sources = preferred_sources;
    if (preferred_languages !== undefined)
      prefs.preferred_languages = preferred_languages;
    prefs.updated_at = new Date();
    await prefs.save();

    res.json({ success: true, data: prefs });
  } catch (error) {
    next(error);
  }
}

// ═══════════════════════════════════════════════════════════════
//  2. READ HISTORY  —  POST /api/news/:id/read + GET /api/history
// ═══════════════════════════════════════════════════════════════
async function markAsRead(req, res, next) {
  try {
    const { newsId } = req.params;
    const userId = req.user.id;

    const news = await News.findByPk(newsId, {
      attributes: ["id", "category", "source"],
      raw: true,
    });
    if (!news)
      return res
        .status(404)
        .json({ success: false, error: "Article not found." });

    // Upsert read history
    const [record, created] = await ReadHistory.findOrCreate({
      where: { user_id: userId, news_id: newsId },
      defaults: { user_id: userId, news_id: newsId },
    });
    if (!created) {
      record.read_count += 1;
      record.read_at = new Date();
      await record.save();
    }

    // Update implicit preference scores
    if (news.category) {
      let prefs = await UserPreference.findOne({ where: { user_id: userId } });
      if (!prefs) {
        prefs = await UserPreference.create({ user_id: userId });
      }
      const scores =
        typeof prefs.implicit_scores === "string"
          ? JSON.parse(prefs.implicit_scores)
          : prefs.implicit_scores || {};
      scores[news.category] = (scores[news.category] || 0) + 1;
      prefs.implicit_scores = scores;
      prefs.updated_at = new Date();
      await prefs.save();
    }

    res.json({
      success: true,
      message: "Marked as read.",
      read_count: created ? 1 : record.read_count,
    });

    // Fire-and-forget streak update
    const { recordRead } = require("./streakController");
    recordRead(userId).catch(() => {});
  } catch (error) {
    next(error);
  }
}

async function getReadHistory(req, res, next) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = (page - 1) * limit;

    const { count, rows } = await ReadHistory.findAndCountAll({
      where: { user_id: req.user.id },
      include: [{ model: News, as: "news" }],
      order: [["read_at", "DESC"]],
      limit,
      offset,
    });

    const articles = rows
      .map((r) => {
        const a = r.news ? r.news.toJSON() : null;
        if (a) {
          a.tags = parseTags(a.tags);
          a.read_at = r.read_at;
          a.read_count = r.read_count;
        }
        return a;
      })
      .filter(Boolean);

    res.json({
      success: true,
      data: articles,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    next(error);
  }
}

async function clearReadHistory(req, res, next) {
  try {
    await ReadHistory.destroy({ where: { user_id: req.user.id } });
    res.json({ success: true, message: "Read history cleared." });
  } catch (error) {
    next(error);
  }
}

// ═══════════════════════════════════════════════════════════════
//  3. RELATED ARTICLES  —  GET /api/news/:id/related
// ═══════════════════════════════════════════════════════════════
async function getRelated(req, res, next) {
  try {
    const newsId = req.params.id || req.params.newsId;
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 30);

    const article = await News.findByPk(newsId, {
      attributes: ["id", "title", "category", "source"],
      raw: true,
    });
    if (!article)
      return res
        .status(404)
        .json({ success: false, error: "Article not found." });

    // Use FULLTEXT search on the first few words of the title
    const keywords = article.title.split(/\s+/).slice(0, 6).join(" ");
    const escaped = sequelize.escape(keywords);

    const [rows] = await sequelize.query(
      `SELECT *, MATCH(title, description) AGAINST(${escaped} IN NATURAL LANGUAGE MODE) AS relevance
       FROM news
       WHERE id != :newsId
         AND MATCH(title, description) AGAINST(${escaped} IN NATURAL LANGUAGE MODE)
       ORDER BY
         CASE WHEN category = :category THEN 0 ELSE 1 END,
         relevance DESC,
         published_at DESC
       LIMIT :limit`,
      { replacements: { newsId, category: article.category || "", limit } },
    );

    const data = rows.map((a) => ({ ...a, tags: parseTags(a.tags) }));
    const enriched = await enrichArticles(data, req.user?.id);

    res.json({ success: true, data: enriched });
  } catch (error) {
    next(error);
  }
}

// ═══════════════════════════════════════════════════════════════
//  4. OFFLINE SYNC  —  GET /api/news/sync?since=ISO_TIMESTAMP
// ═══════════════════════════════════════════════════════════════
async function syncNews(req, res, next) {
  try {
    const { since } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    if (!since) {
      return res.status(400).json({
        success: false,
        error: 'Query param "since" (ISO timestamp) is required.',
      });
    }

    const sinceDate = new Date(since);
    if (isNaN(sinceDate.getTime())) {
      return res
        .status(400)
        .json({ success: false, error: 'Invalid "since" timestamp.' });
    }

    const articles = await News.findAll({
      where: { created_at: { [Op.gt]: sinceDate } },
      order: [["created_at", "ASC"]],
      limit,
      raw: true,
    });

    const data = articles.map((a) => ({ ...a, tags: parseTags(a.tags) }));
    const enriched = req.user ? await enrichArticles(data, req.user.id) : data;

    res.json({
      success: true,
      data: enriched,
      count: enriched.length,
      sync_timestamp: new Date().toISOString(),
      has_more: enriched.length === limit,
    });
  } catch (error) {
    next(error);
  }
}

// ═══════════════════════════════════════════════════════════════
//  5. IMPRESSIONS  —  POST /api/news/:newsId/impression
// ═══════════════════════════════════════════════════════════════
async function trackImpression(req, res, next) {
  try {
    const { newsId } = req.params;
    const exists = await News.findByPk(newsId, {
      attributes: ["id"],
      raw: true,
    });
    if (!exists)
      return res
        .status(404)
        .json({ success: false, error: "Article not found." });

    await sequelize.query(
      "INSERT INTO impressions (id, news_id, user_id, created_at) VALUES (UUID(), :newsId, :userId, NOW())",
      { replacements: { newsId, userId: req.user?.id || null } },
    );

    const [[row]] = await sequelize.query(
      "SELECT COUNT(*) as cnt FROM impressions WHERE news_id = :newsId",
      { replacements: { newsId } },
    );
    const impressions_count = Number(row?.cnt || 0);
    res.json({ success: true, impressions_count });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getForYou,
  getPreferences,
  updatePreferences,
  markAsRead,
  getReadHistory,
  clearReadHistory,
  getRelated,
  syncNews,
  trackImpression,
  enrichArticles,
};
