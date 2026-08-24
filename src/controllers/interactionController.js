/**
 * Interaction Controller
 * Handles comments, likes, and bookmarks (all protected routes)
 */
const { Op } = require('sequelize');
const { sequelize } = require('../database/connection');
const { Comment, Like, Bookmark, News, User, NewsReaction, BookmarkCollection, BookmarkCollectionItem } = require('../models');
const logger = require('../utils/logger');
const { enrichArticles } = require('./feedController');

function parseTags(tags) {
  if (!tags) return [];
  if (typeof tags === 'string') {
    try { return JSON.parse(tags); } catch { return []; }
  }
  return tags;
}

class InteractionController {
  // ═══════════════════════════════════════════════════════════
  //  COMMENTS
  // ═══════════════════════════════════════════════════════════

  /**
   * GET /api/news/:newsId/comments  (public)
   */
  async getComments(req, res, next) {
    try {
      const { newsId } = req.params;
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
      const offset = (page - 1) * limit;

      const { count, rows } = await Comment.findAndCountAll({
        where: { news_id: newsId, parent_id: null },
        include: [
          { model: User, as: 'user', attributes: ['id', 'name', 'avatar'] },
          {
            model: Comment,
            as: 'replies',
            include: [{ model: User, as: 'user', attributes: ['id', 'name', 'avatar'] }],
            separate: true,
            order: [['created_at', 'ASC']],
          },
        ],
        order: [['created_at', 'DESC']],
        limit,
        offset,
      });

      res.json({
        success: true,
        data: rows,
        pagination: {
          page, limit, total: count,
          totalPages: Math.ceil(count / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/news/:newsId/comments  (protected)
   */
  async addComment(req, res, next) {
    try {
      const { newsId } = req.params;
      const { body, parent_id } = req.body;

      if (!body || body.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'Comment body is required.' });
      }

      // Verify news exists
      const news = await News.findByPk(newsId, { attributes: ['id'] });
      if (!news) {
        return res.status(404).json({ success: false, error: 'Article not found.' });
      }

      // If replying, verify parent exists
      if (parent_id) {
        const parent = await Comment.findOne({ where: { id: parent_id, news_id: newsId } });
        if (!parent) {
          return res.status(404).json({ success: false, error: 'Parent comment not found.' });
        }
      }

      const comment = await Comment.create({
        user_id: req.user.id,
        news_id: newsId,
        parent_id: parent_id || null,
        body: body.trim(),
      });

      // Reload with user info
      const full = await Comment.findByPk(comment.id, {
        include: [{ model: User, as: 'user', attributes: ['id', 'name', 'avatar'] }],
      });

      res.status(201).json({ success: true, data: full });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/comments/:id  (protected — owner only)
   */
  async updateComment(req, res, next) {
    try {
      const { id } = req.params;
      const { body } = req.body;

      if (!body || body.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'Comment body is required.' });
      }

      const comment = await Comment.findByPk(id);
      if (!comment) {
        return res.status(404).json({ success: false, error: 'Comment not found.' });
      }
      if (comment.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Not authorized to edit this comment.' });
      }

      comment.body = body.trim();
      comment.is_edited = true;
      comment.updated_at = new Date();
      await comment.save();

      res.json({ success: true, data: comment });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/comments/:id  (protected — owner or admin)
   */
  async deleteComment(req, res, next) {
    try {
      const { id } = req.params;

      const comment = await Comment.findByPk(id);
      if (!comment) {
        return res.status(404).json({ success: false, error: 'Comment not found.' });
      }
      if (comment.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Not authorized to delete this comment.' });
      }

      await comment.destroy();
      res.json({ success: true, message: 'Comment deleted.' });
    } catch (error) {
      next(error);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  LIKES
  // ═══════════════════════════════════════════════════════════

  /**
   * POST /api/news/:newsId/like  (protected — toggle)
   */
  async toggleLike(req, res, next) {
    try {
      const { newsId } = req.params;

      const news = await News.findByPk(newsId, { attributes: ['id'] });
      if (!news) {
        return res.status(404).json({ success: false, error: 'Article not found.' });
      }

      const existing = await Like.findOne({
        where: { user_id: req.user.id, news_id: newsId },
      });

      if (existing) {
        await existing.destroy();
        const count = await Like.count({ where: { news_id: newsId } });
        return res.json({ success: true, liked: false, likes_count: count });
      }

      await Like.create({ user_id: req.user.id, news_id: newsId });
      const count = await Like.count({ where: { news_id: newsId } });
      res.json({ success: true, liked: true, likes_count: count });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/news/:newsId/likes  (public)
   */
  async getLikeCount(req, res, next) {
    try {
      const { newsId } = req.params;
      const count = await Like.count({ where: { news_id: newsId } });

      let liked = false;
      if (req.user) {
        const existing = await Like.findOne({
          where: { user_id: req.user.id, news_id: newsId },
        });
        liked = !!existing;
      }

      res.json({ success: true, likes_count: count, liked });
    } catch (error) {
      next(error);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  REACTIONS
  // ═══════════════════════════════════════════════════════════

  /**
   * GET /api/news/:newsId/reactions  (public)
   */
  async getReactions(req, res, next) {
    try {
      const { newsId } = req.params;
      const counts = await NewsReaction.findAll({
        attributes: ['reaction_type', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
        where: { news_id: newsId },
        group: ['reaction_type'],
        raw: true,
      });

      const data = { insightful: 0, shocking: 0, useful: 0, total: 0 };
      counts.forEach((r) => {
        const n = Number(r.cnt || 0);
        data[r.reaction_type] = n;
        data.total += n;
      });

      let user_reaction = null;
      if (req.user) {
        const mine = await NewsReaction.findOne({
          where: { user_id: req.user.id, news_id: newsId },
          attributes: ['reaction_type'],
          raw: true,
        });
        user_reaction = mine?.reaction_type || null;
      }

      res.json({ success: true, data, user_reaction });
    } catch (error) { next(error); }
  }

  /**
   * POST /api/news/:newsId/reaction  (protected)
   * body: { reaction_type: 'insightful'|'shocking'|'useful' }
   */
  async toggleReaction(req, res, next) {
    try {
      const { newsId } = req.params;
      const { reaction_type } = req.body || {};
      const allowed = ['insightful', 'shocking', 'useful'];
      if (!allowed.includes(reaction_type)) {
        return res.status(400).json({ success: false, error: 'reaction_type must be insightful, shocking, or useful.' });
      }

      const news = await News.findByPk(newsId, { attributes: ['id'] });
      if (!news) return res.status(404).json({ success: false, error: 'Article not found.' });

      const existing = await NewsReaction.findOne({ where: { user_id: req.user.id, news_id: newsId } });
      let user_reaction = reaction_type;

      if (!existing) {
        await NewsReaction.create({ user_id: req.user.id, news_id: newsId, reaction_type });
      } else if (existing.reaction_type === reaction_type) {
        await existing.destroy();
        user_reaction = null;
      } else {
        existing.reaction_type = reaction_type;
        existing.updated_at = new Date();
        await existing.save();
      }

      const rows = await NewsReaction.findAll({
        attributes: ['reaction_type', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
        where: { news_id: newsId },
        group: ['reaction_type'],
        raw: true,
      });
      const data = { insightful: 0, shocking: 0, useful: 0, total: 0 };
      rows.forEach((r) => {
        const n = Number(r.cnt || 0);
        data[r.reaction_type] = n;
        data.total += n;
      });

      res.json({ success: true, data, user_reaction });
    } catch (error) { next(error); }
  }

  // ═══════════════════════════════════════════════════════════
  //  BOOKMARKS
  // ═══════════════════════════════════════════════════════════

  /**
   * POST /api/news/:newsId/bookmark  (protected — toggle)
   */
  async toggleBookmark(req, res, next) {
    try {
      const { newsId } = req.params;

      const news = await News.findByPk(newsId, { attributes: ['id'] });
      if (!news) {
        return res.status(404).json({ success: false, error: 'Article not found.' });
      }

      const existing = await Bookmark.findOne({
        where: { user_id: req.user.id, news_id: newsId },
      });

      if (existing) {
        await existing.destroy();
        return res.json({ success: true, bookmarked: false });
      }

      await Bookmark.create({ user_id: req.user.id, news_id: newsId });
      res.json({ success: true, bookmarked: true });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/bookmarks  (protected — user's bookmarks)
   */
  async getBookmarks(req, res, next) {
    try {
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
      const offset = (page - 1) * limit;

      const { count, rows } = await Bookmark.findAndCountAll({
        where: { user_id: req.user.id },
        include: [{ model: News, as: 'news' }],
        order: [['created_at', 'DESC']],
        limit,
        offset,
      });

      const articles = rows
        .map((b) => (b.news ? { ...b.news.toJSON(), tags: parseTags(b.news.tags) } : null))
        .filter(Boolean);
      const enriched = await enrichArticles(articles, req.user.id);

      res.json({
        success: true,
        data: enriched,
        pagination: {
          page, limit, total: count,
          totalPages: Math.ceil(count / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/likes  (protected — user's liked articles)
   */
  async getLikedArticles(req, res, next) {
    try {
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
      const offset = (page - 1) * limit;

      const { count, rows } = await Like.findAndCountAll({
        where: { user_id: req.user.id },
        include: [{ model: News, as: 'news' }],
        order: [['created_at', 'DESC']],
        limit,
        offset,
      });

      const articles = rows
        .map((l) => (l.news ? { ...l.news.toJSON(), tags: parseTags(l.news.tags) } : null))
        .filter(Boolean);
      const enriched = await enrichArticles(articles, req.user.id);

      res.json({
        success: true,
        data: enriched,
        pagination: {
          page, limit, total: count,
          totalPages: Math.ceil(count / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/my/comments  (protected — articles the user commented on)
   */
  async getMyComments(req, res, next) {
    try {
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
      const offset = (page - 1) * limit;

      const { count, rows } = await Comment.findAndCountAll({
        where: { user_id: req.user.id },
        include: [{ model: News, as: 'news' }],
        order: [['created_at', 'DESC']],
        distinct: true,
        limit,
        offset,
      });

      // Collapse to one entry per article (latest comment), keep the snippet
      const byNews = {};
      for (const c of rows) {
        if (!c.news) continue;
        if (byNews[c.news_id]) continue;
        const article = c.news.toJSON();
        article.tags = parseTags(article.tags);
        article.comment_body = c.body;
        article.comment_created_at = c.created_at;
        byNews[c.news_id] = article;
      }
      const articles = Object.values(byNews);
      const enriched = await enrichArticles(articles, req.user.id);

      res.json({
        success: true,
        data: enriched,
        pagination: {
          page, limit, total: count,
          totalPages: Math.ceil(count / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  COLLECTIONS
  // ═══════════════════════════════════════════════════════════

  /**
   * GET /api/collections  (protected)
   */
  async getCollections(req, res, next) {
    try {
      const collections = await BookmarkCollection.findAll({
        where: { user_id: req.user.id },
        order: [['created_at', 'DESC']],
        raw: true,
      });

      const ids = collections.map((c) => c.id);
      let countMap = {};
      if (ids.length) {
        const rows = await BookmarkCollectionItem.findAll({
          attributes: ['collection_id', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
          where: { collection_id: { [Op.in]: ids } },
          group: ['collection_id'],
          raw: true,
        });
        rows.forEach((r) => { countMap[r.collection_id] = Number(r.cnt || 0); });
      }

      res.json({
        success: true,
        data: collections.map((c) => ({ ...c, items_count: countMap[c.id] || 0 })),
      });
    } catch (error) { next(error); }
  }

  /**
   * POST /api/collections  (protected)
   * body: { name }
   */
  async createCollection(req, res, next) {
    try {
      const name = String(req.body?.name || '').trim();
      if (!name) return res.status(400).json({ success: false, error: 'Collection name is required.' });

      const collection = await BookmarkCollection.create({
        user_id: req.user.id,
        name: name.slice(0, 80),
      });
      res.status(201).json({ success: true, data: collection });
    } catch (error) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ success: false, error: 'Collection with this name already exists.' });
      }
      next(error);
    }
  }

  /**
   * GET /api/collections/:id/items  (protected)
   */
  async getCollectionItems(req, res, next) {
    try {
      const { id } = req.params;
      const collection = await BookmarkCollection.findOne({
        where: { id, user_id: req.user.id },
        raw: true,
      });
      if (!collection) return res.status(404).json({ success: false, error: 'Collection not found.' });

      const rows = await BookmarkCollectionItem.findAll({
        where: { collection_id: id },
        include: [{ model: News, as: 'news' }],
        order: [['created_at', 'DESC']],
      });
      const articles = rows
        .map((r) => (r.news ? { ...r.news.toJSON(), tags: parseTags(r.news.tags) } : null))
        .filter(Boolean);
      const enriched = await enrichArticles(articles, req.user.id);

      res.json({ success: true, collection, data: enriched });
    } catch (error) { next(error); }
  }

  /**
   * POST /api/collections/:id/items/:newsId  (protected)
   */
  async addCollectionItem(req, res, next) {
    try {
      const { id, newsId } = req.params;
      const collection = await BookmarkCollection.findOne({
        where: { id, user_id: req.user.id },
        raw: true,
      });
      if (!collection) return res.status(404).json({ success: false, error: 'Collection not found.' });

      const news = await News.findByPk(newsId, { attributes: ['id'] });
      if (!news) return res.status(404).json({ success: false, error: 'Article not found.' });

      await BookmarkCollectionItem.findOrCreate({
        where: { collection_id: id, news_id: newsId },
        defaults: { collection_id: id, news_id: newsId },
      });

      // Keep bookmark in sync
      await Bookmark.findOrCreate({
        where: { user_id: req.user.id, news_id: newsId },
        defaults: { user_id: req.user.id, news_id: newsId },
      });

      res.json({ success: true, message: 'Added to collection.' });
    } catch (error) { next(error); }
  }

  /**
   * DELETE /api/collections/:id/items/:newsId  (protected)
   */
  async removeCollectionItem(req, res, next) {
    try {
      const { id, newsId } = req.params;
      const collection = await BookmarkCollection.findOne({
        where: { id, user_id: req.user.id },
        raw: true,
      });
      if (!collection) return res.status(404).json({ success: false, error: 'Collection not found.' });

      await BookmarkCollectionItem.destroy({ where: { collection_id: id, news_id: newsId } });
      res.json({ success: true, message: 'Removed from collection.' });
    } catch (error) { next(error); }
  }
}

module.exports = new InteractionController();
