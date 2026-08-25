/**
 * Admin Controller
 * User management + platform analytics + SMTP test, all admin-only.
 */
const { Op } = require("sequelize");
const { sequelize } = require("../database/connection");
const User = require("../models/User");
const Setting = require("../models/Setting");
const emailService = require("../services/emailService");
const logger = require("../utils/logger");

const PAGE_SIZE = 20;

/**
 * GET /api/admin/users — list users (search / role / status / paginated)
 */
async function getUsers(req, res) {
  try {
    const { search = "", role = "", status = "", page = 1 } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || PAGE_SIZE, 100);
    const offset = (Math.max(1, parseInt(page, 10) || 1) - 1) * limit;

    const where = {};
    if (search) {
      where[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } },
      ];
    }
    if (role === "admin" || role === "user") where.role = role;
    if (status === "active") where.is_active = true;
    if (status === "banned") where.is_active = false;

    const { rows, count } = await User.findAndCountAll({
      where,
      order: [["created_at", "DESC"]],
      limit,
      offset,
      attributes: [
        "id",
        "name",
        "email",
        "avatar",
        "role",
        "auth_provider",
        "is_active",
        "location",
        "created_at",
      ],
    });

    res.json({
      success: true,
      data: {
        users: rows,
        total: count,
        page: Math.max(1, parseInt(page, 10) || 1),
        pages: Math.ceil(count / limit),
      },
    });
  } catch (err) {
    logger.error("admin.getUsers error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * PATCH /api/admin/users/:id — update role / active status
 */
async function updateUser(req, res) {
  try {
    const { id } = req.params;
    const { role, is_active } = req.body;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Protect the requesting admin from self-lockout / self-demotion
    if (id === req.user.id && (role !== undefined || is_active === false)) {
      return res.status(400).json({
        success: false,
        message: "You cannot demote, ban, or remove your own admin access.",
      });
    }

    if (role === "admin" || role === "user") user.role = role;
    if (typeof is_active === "boolean") user.is_active = is_active;

    await user.save();

    res.json({ success: true, data: user.toSafeJSON() });
  } catch (err) {
    logger.error("admin.updateUser error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * DELETE /api/admin/users/:id — remove a user
 */
async function deleteUser(req, res) {
  try {
    const { id } = req.params;
    if (id === req.user.id) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete your own account.",
      });
    }

    const deleted = await User.destroy({ where: { id } });
    if (!deleted) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({ success: true, message: "User deleted" });
  } catch (err) {
    logger.error("admin.deleteUser error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * Build a daily series (last N days) for a table's created_at column.
 * Returns [{ date: 'YYYY-MM-DD', label: 'Mon', count }]
 */
async function dailySeries(table, days = 14) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  const [rows] = await sequelize.query(
    `SELECT DATE(created_at) AS d, COUNT(*) AS cnt
       FROM \`${table}\`
      WHERE created_at >= :start
      GROUP BY DATE(created_at)`,
    { replacements: { start } },
  );

  const map = new Map(rows.map((r) => [String(r.d).slice(0, 10), Number(r.cnt)]));

  const series = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    series.push({
      date: iso,
      label: d.toLocaleDateString("en-US", { weekday: "short" }),
      count: map.get(iso) || 0,
    });
  }
  return series;
}

/**
 * GET /api/admin/analytics — platform analytics
 */
async function getAnalytics(req, res) {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 14, 30);

    const [[articlesTotal]] = await sequelize.query("SELECT COUNT(*) AS cnt FROM news");
    const [[usersTotal]] = await sequelize.query("SELECT COUNT(*) AS cnt FROM users");
    const [[impressionsTotal]] = await sequelize.query("SELECT COUNT(*) AS cnt FROM impressions");
    const [[commentsTotal]] = await sequelize.query("SELECT COUNT(*) AS cnt FROM comments");
    const [[reactionsTotal]] = await sequelize.query("SELECT COUNT(*) AS cnt FROM news_reactions");
    const [[bookmarksTotal]] = await sequelize.query("SELECT COUNT(*) AS cnt FROM bookmarks");
    const [[sourcesTotal]] = await sequelize.query("SELECT COUNT(*) AS cnt FROM sources");

    const [trend] = await sequelize.query(`
      SELECT DATE(created_at) AS d, COUNT(*) AS cnt
        FROM news
       WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL :days DAY)
       GROUP BY DATE(created_at)`,
      { replacements: { days } });

    const [recentUsers] = await sequelize.query(
      `SELECT id, name, email, avatar, role, is_active, auth_provider, created_at
         FROM users ORDER BY created_at DESC LIMIT 8`,
    );

    const [topUsers] = await sequelize.query(`
      SELECT u.id, u.name, u.email, u.avatar,
             (COALESCE(c.cnt,0) + COALESCE(r.cnt,0) + COALESCE(b.cnt,0) + COALESCE(l.cnt,0)) AS interactions
        FROM users u
        LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM comments GROUP BY user_id) c ON c.user_id = u.id
        LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM news_reactions GROUP BY user_id) r ON r.user_id = u.id
        LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM bookmarks GROUP BY user_id) b ON b.user_id = u.id
        LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM likes GROUP BY user_id) l ON l.user_id = u.id
       ORDER BY interactions DESC, u.created_at DESC
       LIMIT 8`);

    const [reactionBreakdown] = await sequelize.query(
      "SELECT reaction_type, COUNT(*) AS cnt FROM news_reactions GROUP BY reaction_type",
    );

    res.json({
      success: true,
      data: {
        days,
        totals: {
          articles: Number(articlesTotal?.cnt || 0),
          users: Number(usersTotal?.cnt || 0),
          impressions: Number(impressionsTotal?.cnt || 0),
          comments: Number(commentsTotal?.cnt || 0),
          reactions: Number(reactionsTotal?.cnt || 0),
          bookmarks: Number(bookmarksTotal?.cnt || 0),
          sources: Number(sourcesTotal?.cnt || 0),
        },
        series: {
          articles: await dailySeries("news", days),
          users: await dailySeries("users", days),
          impressions: await dailySeries("impressions", days),
          comments: await dailySeries("comments", days),
          reactions: await dailySeries("news_reactions", days),
          bookmarks: await dailySeries("bookmarks", days),
        },
        topUsers: topUsers.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          avatar: u.avatar,
          interactions: Number(u.interactions || 0),
        })),
        recentUsers: recentUsers.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          avatar: u.avatar,
          role: u.role,
          is_active: !!u.is_active,
          auth_provider: u.auth_provider,
          created_at: u.created_at,
        })),
        reactionBreakdown: reactionBreakdown.map((r) => ({
          reaction_type: r.reaction_type,
          count: Number(r.cnt || 0),
        })),
      },
    });
  } catch (err) {
    logger.error("admin.getAnalytics error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * POST /api/admin/test-email — send a test email using stored SMTP settings
 */
async function testEmail(req, res) {
  try {
    const result = await emailService.sendTest({
      to: req.body?.to || req.user?.email,
    });

    if (!result.ok) {
      return res.status(400).json({ success: false, message: result.error });
    }

    res.json({ success: true, message: "Test email sent", data: { messageId: result.messageId } });
  } catch (err) {
    logger.error("admin.testEmail error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * GET /api/admin/articles — list articles with engagement counts
 */
async function getArticles(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
    const offset = (page - 1) * limit;
    const search = (req.query.q || "").trim();

    let where = "1=1";
    const params = { limit, offset };
    if (search) {
      where = "(n.title LIKE :s OR n.description LIKE :s OR n.source LIKE :s)";
      params.s = `%${search}%`;
    }

    const [rows] = await sequelize.query(
      `SELECT n.id, n.title, n.source, n.category, n.published_at,
              COALESCE(i.cnt,0) AS impressions_count,
              COALESCE(r.cnt,0) AS reactions_count,
              COALESCE(b.cnt,0) AS bookmarks_count,
              COALESCE(c.cnt,0) AS comments_count,
              COALESCE(l.cnt,0) AS likes_count
         FROM news n
         LEFT JOIN (SELECT news_id, COUNT(*) cnt FROM impressions GROUP BY news_id) i ON i.news_id = n.id
         LEFT JOIN (SELECT news_id, COUNT(*) cnt FROM news_reactions GROUP BY news_id) r ON r.news_id = n.id
         LEFT JOIN (SELECT news_id, COUNT(*) cnt FROM bookmarks GROUP BY news_id) b ON b.news_id = n.id
         LEFT JOIN (SELECT news_id, COUNT(*) cnt FROM comments GROUP BY news_id) c ON c.news_id = n.id
         LEFT JOIN (SELECT news_id, COUNT(*) cnt FROM likes GROUP BY news_id) l ON l.news_id = n.id
        WHERE ${where}
        ORDER BY n.published_at DESC, n.created_at DESC, n.id DESC
        LIMIT :limit OFFSET :offset`,
      { replacements: params },
    );

    const [[{ total }]] = await sequelize.query(
      `SELECT COUNT(*) AS total FROM news n WHERE ${where}`,
      { replacements: { ...params } },
    );

    const totalCount = Number(total || 0);
    res.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        title: r.title,
        source: r.source,
        category: r.category,
        published_at: r.published_at,
        impressions_count: Number(r.impressions_count || 0),
        reactions_count: Number(r.reactions_count || 0),
        bookmarks_count: Number(r.bookmarks_count || 0),
        comments_count: Number(r.comments_count || 0),
        likes_count: Number(r.likes_count || 0),
      })),
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasNext: page * limit < totalCount,
        hasPrev: page > 1,
      },
    });
  } catch (err) {
    logger.error("admin.getArticles error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

module.exports = { getUsers, updateUser, deleteUser, getAnalytics, testEmail, getArticles };
