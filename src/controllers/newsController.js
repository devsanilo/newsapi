/**
 * News Controller — uses shared enrichment from feedController
 */
const newsService = require("../services/newsService");
const { enrichArticles } = require("./feedController");
const { sequelize } = require("../database/connection");
const logger = require("../utils/logger");

async function getNews(req, res, next) {
  try {
    const { page, limit, category, source, language } = req.query;
    const result = await newsService.getNews({
      page,
      limit,
      category,
      source,
      language,
    });
    result.data = await enrichArticles(result.data, req.user?.id);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function searchNews(req, res, next) {
  try {
    const { q, page, limit } = req.query;
    if (!q || q.trim().length === 0) {
      return res
        .status(400)
        .json({ success: false, error: 'Search query "q" is required' });
    }
    const result = await newsService.searchNews(q, { page, limit });
    result.data = await enrichArticles(result.data, req.user?.id);
    res.json({ success: true, query: q, ...result });
  } catch (error) {
    next(error);
  }
}

async function getSearchSuggestions(req, res, next) {
  try {
    const { q, limit } = req.query;
    if (!q || q.trim().length < 2) {
      return res.json({ success: true, suggestions: [] });
    }
    const suggestions = await newsService.getSearchSuggestions(q, limit);
    res.json({ success: true, suggestions });
  } catch (error) {
    next(error);
  }
}

async function searchByKeyword(req, res, next) {
  try {
    const { keyword, page, limit, category } = req.query;
    if (!keyword || keyword.trim().length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "Keyword is required" });
    }
    const result = await newsService.searchByKeyword(keyword, {
      page,
      limit,
      category,
    });
    result.data = await enrichArticles(result.data, req.user?.id);
    res.json({ success: true, keyword, ...result });
  } catch (error) {
    next(error);
  }
}

async function getTrending(req, res, next) {
  try {
    const { limit, hours } = req.query;
    let articles = await newsService.getTrending({
      limit: parseInt(limit, 10) || 20,
      hours: parseInt(hours, 10) || 24,
    });
    articles = await enrichArticles(articles, req.user?.id);
    res.json({ success: true, data: articles, count: articles.length });
  } catch (error) {
    next(error);
  }
}

async function getCategories(req, res, next) {
  try {
    res.json({ success: true, data: await newsService.getCategories() });
  } catch (error) {
    next(error);
  }
}

async function getSources(req, res, next) {
  try {
    res.json({ success: true, data: await newsService.getSources() });
  } catch (error) {
    next(error);
  }
}

async function getStats(req, res, next) {
  try {
    res.json({ success: true, data: await newsService.getStats() });
  } catch (error) {
    next(error);
  }
}

async function getNewsById(req, res, next) {
  try {
    const newsId = req.params.id;
    let article = await newsService.getNewsById(req.params.id);
    if (!article)
      return res
        .status(404)
        .json({ success: false, error: "Article not found" });

    // Fire-and-forget impression tracking — don't block API response
    sequelize
      .query(
        "INSERT INTO impressions (id, news_id, user_id, created_at) VALUES (UUID(), :newsId, :userId, NOW())",
        { replacements: { newsId, userId: req.user?.id || null } },
      )
      .catch((e) =>
        logger.warn(
          `Impression tracking failed for news ${newsId}: ${e.message}`,
        ),
      );

    const [enriched] = await enrichArticles([article], req.user?.id);
    res.json({ success: true, data: enriched });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getNews,
  searchNews,
  getSearchSuggestions,
  searchByKeyword,
  getTrending,
  getCategories,
  getSources,
  getStats,
  getNewsById,
};
