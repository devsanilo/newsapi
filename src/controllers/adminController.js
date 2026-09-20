/**
 * Admin Controller
 * User management + platform analytics + SMTP test, all admin-only.
 */
const { Op } = require("sequelize");
const { sequelize } = require("../database/connection");
const User = require("../models/User");
const News = require("../models/News");
const Setting = require("../models/Setting");
const emailService = require("../services/emailService");
const logger = require("../utils/logger");
const { v4: uuidv4 } = require("uuid");
const { generateHash } = require("../utils/hash");
const { toCanonicalCategory } = require("../utils/categories");
const imageService = require("../services/articleImageService");
const { decodeEntities, cleanTitle, cleanDescription } = require("../utils/cleaner");

const PAGE_SIZE = 20;

/** Human-readable outcomes for the image-reload endpoint. */
const IMAGE_REFRESH_MESSAGES = {
  updated: "Image updated from the source page.",
  "would-update": "A better image is available (dry run, nothing written).",
  unchanged: "The stored image already matches the source page.",
  "no-url": "This article has no source URL to fetch from.",
  "no-og-image": "The source page exposes no og:image.",
  "fetch-failed": "Could not reach the source page.",
  "og-is-brand-asset":
    "The source page's og:image is itself a brand asset, so it was rejected.",
};

function toArrayTags(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input
      .map((t) => String(t || "").trim())
      .filter(Boolean)
      .slice(0, 25);
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 25);
  }
  return [];
}

function adminArticleDTO(article) {
  return {
    id: article.id,
    title: decodeEntities(article.title),
    description: decodeEntities(article.description),
    content: decodeEntities(article.content),
    image_url: article.image_url,
    source: article.source,
    category: article.category,
    url: article.url,
    tags: Array.isArray(article.tags) ? article.tags : [],
    language: article.language,
    is_original: Boolean(article.is_original),
    is_published: Boolean(article.is_published),
    author_id: article.author_id || null,
    published_at: article.published_at,
    updated_at: article.updated_at,
    created_at: article.created_at,
  };
}

function buildOriginalArticlePayload(body = {}) {
  const title = cleanTitle(body.title || "", 500);
  const descriptionInput = String(body.description || "").trim();
  const content = String(body.content || "").trim();
  const imageUrl = String(body.image_url || "").trim();
  const category = toCanonicalCategory(body.category || "general", "general");
  const tags = toArrayTags(body.tags);

  return {
    title,
    description: cleanDescription(descriptionInput || content.slice(0, 520), 500),
    content,
    image_url: imageUrl || null,
    category,
    tags,
    is_published: Boolean(body.is_published),
    published_at: body.published_at ? new Date(body.published_at) : null,
  };
}

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
 * Daily series of DISTINCT values (e.g. unique visitors per day)
 * Returns [{ date: 'YYYY-MM-DD', label: 'Mon', count }]
 */
async function dailyDistinctSeries(table, column, days = 14) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  const [rows] = await sequelize.query(
    `SELECT DATE(created_at) AS d, COUNT(DISTINCT \`${column}\`) AS cnt
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
 * Deep web analytics for a date range (page views, visits, behaviour,
 * geography, technology, top pages/articles, traffic sources).
 */
async function webAnalytics(days) {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));
  const rep = { replacements: { since } };

  const [[totalsRow]] = await sequelize.query(
    `SELECT COUNT(*) AS views,
            COUNT(DISTINCT visitor_id) AS visitors,
            COUNT(DISTINCT session_id) AS sessions
       FROM page_views WHERE created_at >= :since`,
    rep,
  );

  const [[allTime]] = await sequelize.query(
    "SELECT COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors FROM page_views",
  );

  // Bounce rate + average session duration
  const [[sessionStats]] = await sequelize.query(
    `SELECT COUNT(*) AS sessions,
            SUM(CASE WHEN c = 1 THEN 1 ELSE 0 END) AS bounced,
            AVG(dur) AS avg_duration
       FROM (
         SELECT session_id,
                COUNT(*) AS c,
                TIMESTAMPDIFF(SECOND, MIN(created_at), MAX(created_at)) AS dur
           FROM page_views
          WHERE created_at >= :since AND session_id IS NOT NULL
          GROUP BY session_id
       ) s`,
    rep,
  );

  // New vs returning visitors
  const [[visitorMix]] = await sequelize.query(
    `SELECT
        SUM(CASE WHEN first_seen >= :since THEN 1 ELSE 0 END) AS new_visitors,
        SUM(CASE WHEN first_seen < :since THEN 1 ELSE 0 END) AS returning_visitors
       FROM (
         SELECT visitor_id, MIN(created_at) AS first_seen
           FROM page_views
          WHERE visitor_id IS NOT NULL
          GROUP BY visitor_id
         HAVING MAX(created_at) >= :since
       ) v`,
    rep,
  );

  const [topPages] = await sequelize.query(
    `SELECT path,
            COUNT(*) AS views,
            COUNT(DISTINCT visitor_id) AS visitors
       FROM page_views
      WHERE created_at >= :since
      GROUP BY path
      ORDER BY views DESC
      LIMIT 25`,
    rep,
  );

  // Top performing articles (resolved to real titles)
  const [topArticles] = await sequelize.query(
    `SELECT pv.path,
            COUNT(*) AS views,
            COUNT(DISTINCT pv.visitor_id) AS visitors,
            n.title, n.source, n.category
       FROM page_views pv
       JOIN news n ON pv.path = CONCAT('/article/', n.id)
      WHERE pv.created_at >= :since
      GROUP BY pv.path, n.title, n.source, n.category
      ORDER BY views DESC
      LIMIT 15`,
    rep,
  );

  const [entryPages] = await sequelize.query(
    `SELECT path, COUNT(*) AS sessions
       FROM (
         SELECT session_id,
                SUBSTRING_INDEX(GROUP_CONCAT(path ORDER BY created_at ASC), ',', 1) AS path
           FROM page_views
          WHERE created_at >= :since AND session_id IS NOT NULL
          GROUP BY session_id
       ) e
      GROUP BY path
      ORDER BY sessions DESC
      LIMIT 10`,
    rep,
  );

  const groupBy = async (column, label, limit = 12) => {
    const [rows] = await sequelize.query(
      `SELECT COALESCE(NULLIF(\`${column}\`, ''), 'Unknown') AS label, COUNT(*) AS count,
              COUNT(DISTINCT visitor_id) AS visitors
         FROM page_views
        WHERE created_at >= :since
        GROUP BY label
        ORDER BY count DESC
        LIMIT ${limit}`,
      rep,
    );
    return rows.map((r) => ({
      [label]: r.label,
      count: Number(r.count || 0),
      visitors: Number(r.visitors || 0),
    }));
  };

  const [countries] = await sequelize.query(
    `SELECT COALESCE(country, country_code, 'Unknown') AS country,
            country_code,
            COUNT(*) AS count,
            COUNT(DISTINCT visitor_id) AS visitors
       FROM page_views
      WHERE created_at >= :since
      GROUP BY country, country_code
      ORDER BY count DESC
      LIMIT 20`,
    rep,
  );

  const [cities] = await sequelize.query(
    `SELECT city, country_code, COUNT(*) AS count
       FROM page_views
      WHERE created_at >= :since AND city IS NOT NULL AND city <> ''
      GROUP BY city, country_code
      ORDER BY count DESC
      LIMIT 15`,
    rep,
  );

  const [referrers] = await sequelize.query(
    `SELECT COALESCE(NULLIF(referrer, ''), 'Direct') AS ref, COUNT(*) AS count
       FROM page_views
      WHERE created_at >= :since
      GROUP BY ref
      ORDER BY count DESC
      LIMIT 10`,
    rep,
  );

  const views = Number(totalsRow?.views || 0);
  const visitors = Number(totalsRow?.visitors || 0);
  const sessions = Number(sessionStats?.sessions || 0);
  const bounced = Number(sessionStats?.bounced || 0);
  const avgDuration = Number(sessionStats?.avg_duration || 0);

  return {
    totals: {
      pageViews: views,
      visits: visitors,
      sessions,
      pageViewsAllTime: Number(allTime?.views || 0),
      visitsAllTime: Number(allTime?.visitors || 0),
      viewsPerVisit: sessions > 0 ? Number((views / sessions).toFixed(2)) : 0,
      avgSessionSeconds: Number(avgDuration.toFixed(0)),
      bounceRate: sessions > 0 ? Number(((bounced / sessions) * 100).toFixed(1)) : 0,
      newVisitors: Number(visitorMix?.new_visitors || 0),
      returningVisitors: Number(visitorMix?.returning_visitors || 0),
    },
    topPages: topPages.map((p) => ({
      path: p.path,
      views: Number(p.views || 0),
      visitors: Number(p.visitors || 0),
    })),
    topArticles: topArticles.map((a) => ({
      path: a.path,
      views: Number(a.views || 0),
      visitors: Number(a.visitors || 0),
      title: decodeEntities(a.title),
      source: a.source,
      category: a.category,
    })),
    entryPages: entryPages.map((e) => ({
      path: e.path,
      sessions: Number(e.sessions || 0),
    })),
    countries: countries.map((c) => ({
      country: c.country,
      country_code: c.country_code,
      count: Number(c.count || 0),
      visitors: Number(c.visitors || 0),
    })),
    cities: cities.map((c) => ({
      city: c.city,
      country_code: c.country_code,
      count: Number(c.count || 0),
    })),
    devices: await groupBy("device", "device"),
    browsers: await groupBy("browser", "browser"),
    os: await groupBy("os", "os"),
    languages: await groupBy("language", "language", 10),
    referrers: referrers.map((r) => ({
      referrer: r.ref,
      count: Number(r.count || 0),
    })),
  };
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

    // ─── Web analytics (page views, visits, behaviour, geo, tech) ───
    const web = await webAnalytics(days);

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
          ...web.totals,
        },
        series: {
          articles: await dailySeries("news", days),
          users: await dailySeries("users", days),
          impressions: await dailySeries("impressions", days),
          comments: await dailySeries("comments", days),
          reactions: await dailySeries("news_reactions", days),
          bookmarks: await dailySeries("bookmarks", days),
          pageViews: await dailySeries("page_views", days),
          visits: await dailyDistinctSeries("page_views", "visitor_id", days),
        },
        topPages: web.topPages,
        topArticles: web.topArticles,
        entryPages: web.entryPages,
        countries: web.countries,
        cities: web.cities,
        devices: web.devices,
        browsers: web.browsers,
        os: web.os,
        languages: web.languages,
        referrers: web.referrers,
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
 * POST /api/admin/articles — create a first-party Trenxi article (draft/published)
 */
async function createArticle(req, res) {
  try {
    const payload = buildOriginalArticlePayload(req.body || {});
    if (!payload.title || !payload.content) {
      return res.status(400).json({
        success: false,
        message: "Title and content are required.",
      });
    }

    const id = uuidv4();
    const now = new Date();
    const appUrl = (process.env.APP_URL || "https://trenxi.com").replace(/\/+$/, "");
    const shouldPublish = Boolean(payload.is_published);
    const publishedAt = shouldPublish
      ? (payload.published_at && !Number.isNaN(payload.published_at.getTime())
          ? payload.published_at
          : now)
      : null;

    const article = await News.create({
      id,
      title: payload.title,
      description: payload.description,
      content: payload.content,
      image_url: payload.image_url,
      source: "trenxi",
      category: payload.category,
      url: `${appUrl}/article/${id}`,
      hash: generateHash(`${payload.title}:${id}`, "trenxi", now),
      tags: payload.tags,
      language: "en",
      is_original: true,
      is_published: shouldPublish,
      author_id: req.user?.id || null,
      published_at: publishedAt,
      updated_at: now,
      created_at: now,
    });

    res.status(201).json({ success: true, data: adminArticleDTO(article.toJSON()) });
  } catch (err) {
    logger.error("admin.createArticle error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * POST /api/admin/articles/:id/refresh-image — re-fetch the lead image
 *
 * Aggregated articles store whatever the feed handed us, and ingestion uses
 * INSERT IGNORE, so a row that was saved with the publisher's masthead keeps
 * it forever. This re-reads og:image from the source page and updates the row.
 * Unlike PATCH /articles/:id it works on aggregated articles too.
 */
async function refreshArticleImage(req, res) {
  try {
    const persist = req.body?.dryRun !== true;
    const result = await imageService.refreshArticleImageById(req.params.id, {
      persist,
    });

    if (result.status === "not-found") {
      return res
        .status(404)
        .json({ success: false, message: "Article not found" });
    }

    res.json({
      success: result.changed,
      status: result.status,
      message: IMAGE_REFRESH_MESSAGES[result.status] || "Image not updated",
      data: {
        id: req.params.id,
        previous_image_url: result.previous ?? null,
        image_url: result.candidate || result.previous || null,
      },
    });
  } catch (err) {
    logger.error("admin.refreshArticleImage error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * POST /api/admin/articles/refresh-images — repair a batch of suspect rows
 *
 * Body: { source?, limit?, dryRun?, scanLimit? }
 * Runs synchronously with a bounded limit so the request stays responsive.
 */
async function refreshArticleImages(req, res) {
  try {
    const body = req.body || {};
    const source = body.source ? String(body.source).trim().toLowerCase() : null;
    const persist = body.dryRun !== true;
    // Cap the batch so a single request cannot run for minutes.
    const limit = Math.min(Math.max(parseInt(body.limit, 10) || 25, 1), 100);
    const scanLimit = Math.min(
      Math.max(parseInt(body.scanLimit, 10) || 500, 50),
      3000,
    );

    const report = await imageService.repairMany({
      source,
      scanLimit,
      limit,
      persist,
    });

    logger.info(
      `admin.refreshArticleImages ${persist ? "applied" : "dry-run"}` +
        `${source ? ` source=${source}` : ""} — scanned=${report.scanned} ` +
        `suspects=${report.suspects} processed=${report.processed}`,
    );

    res.json({
      success: true,
      dry_run: !persist,
      data: {
        scanned: report.scanned,
        suspects: report.suspects,
        processed: report.processed,
        remaining: report.remaining,
        tally: report.tally,
        // A few examples so the operator can sanity-check what changed.
        samples: report.results
          .filter((r) => r.status === "updated" || r.status === "would-update")
          .slice(0, 20)
          .map((r) => ({
            id: r.row.id,
            title: decodeEntities(r.row.title),
            source: r.row.source,
            previous_image_url: r.previous,
            image_url: r.candidate,
          })),
      },
    });
  } catch (err) {
    logger.error("admin.refreshArticleImages error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * GET /api/admin/articles/:id — fetch a single article for editor use
 */
async function getArticle(req, res) {
  try {
    const article = await News.findByPk(req.params.id, { raw: true });
    if (!article) {
      return res.status(404).json({ success: false, message: "Article not found" });
    }
    res.json({ success: true, data: adminArticleDTO(article) });
  } catch (err) {
    logger.error("admin.getArticle error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * PATCH /api/admin/articles/:id — edit first-party Trenxi article fields
 */
async function updateArticle(req, res) {
  try {
    const article = await News.findByPk(req.params.id);
    if (!article) {
      return res.status(404).json({ success: false, message: "Article not found" });
    }
    if (!article.is_original) {
      return res.status(400).json({
        success: false,
        message: "Only Trenxi original articles can be edited in admin.",
      });
    }

    const now = new Date();
    const body = req.body || {};

    if (body.title !== undefined) article.title = cleanTitle(body.title || "", 500);
    if (body.description !== undefined) {
      article.description = cleanDescription(String(body.description || ""), 500);
    }
    if (body.content !== undefined) {
      article.content = String(body.content || "").trim();
    }
    if (body.image_url !== undefined) {
      const image = String(body.image_url || "").trim();
      article.image_url = image || null;
    }
    if (body.category !== undefined) {
      article.category = toCanonicalCategory(body.category || "general", "general");
    }
    if (body.tags !== undefined) {
      article.tags = toArrayTags(body.tags);
    }
    if (body.is_published !== undefined) {
      article.is_published = Boolean(body.is_published);
      if (article.is_published && !article.published_at) {
        article.published_at = now;
      }
      if (!article.is_published) {
        article.published_at = null;
      }
    }
    if (body.published_at !== undefined && body.published_at) {
      const dt = new Date(body.published_at);
      if (!Number.isNaN(dt.getTime())) article.published_at = dt;
    }

    if (!article.title || !article.content) {
      return res.status(400).json({
        success: false,
        message: "Title and content are required.",
      });
    }

    article.updated_at = now;
    await article.save();

    res.json({ success: true, data: adminArticleDTO(article.toJSON()) });
  } catch (err) {
    logger.error("admin.updateArticle error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * POST /api/admin/articles/:id/publish — quick toggle publish state
 */
async function publishArticle(req, res) {
  try {
    const article = await News.findByPk(req.params.id);
    if (!article) {
      return res.status(404).json({ success: false, message: "Article not found" });
    }
    if (!article.is_original) {
      return res.status(400).json({
        success: false,
        message: "Only Trenxi original articles can be published/unpublished.",
      });
    }

    const publish = req.body?.publish !== undefined
      ? Boolean(req.body.publish)
      : !Boolean(article.is_published);

    article.is_published = publish;
    article.published_at = publish ? article.published_at || new Date() : null;
    article.updated_at = new Date();
    await article.save();

    res.json({ success: true, data: adminArticleDTO(article.toJSON()) });
  } catch (err) {
    logger.error("admin.publishArticle error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * DELETE /api/admin/articles/:id — delete first-party Trenxi original article
 */
async function deleteArticle(req, res) {
  try {
    const article = await News.findByPk(req.params.id, { raw: true });
    if (!article) {
      return res.status(404).json({ success: false, message: "Article not found" });
    }
    if (!article.is_original) {
      return res.status(400).json({
        success: false,
        message: "Only Trenxi original articles can be deleted from admin.",
      });
    }

    await News.destroy({ where: { id: article.id } });
    res.json({ success: true, message: "Article deleted" });
  } catch (err) {
    logger.error("admin.deleteArticle error:", err);
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
    const type = String(req.query.type || "all").toLowerCase();

    const clauses = [];
    const params = { limit, offset };
    if (search) {
      clauses.push("(n.title LIKE :s OR n.description LIKE :s OR n.source LIKE :s)");
      params.s = `%${search}%`;
    }
    if (type === "original") clauses.push("n.is_original = 1");
    if (type === "aggregated") clauses.push("n.is_original = 0");
    const where = clauses.length ? clauses.join(" AND ") : "1=1";

    const [rows] = await sequelize.query(
      `SELECT n.id, n.title, n.source, n.category, n.published_at,
              n.image_url, n.url,
              n.is_original, n.is_published, n.author_id, n.updated_at,
              u.name AS author_name,
              COALESCE(i.cnt,0) AS impressions_count,
              COALESCE(r.cnt,0) AS reactions_count,
              COALESCE(b.cnt,0) AS bookmarks_count,
              COALESCE(c.cnt,0) AS comments_count,
              COALESCE(l.cnt,0) AS likes_count
         FROM news n
         LEFT JOIN users u ON u.id = n.author_id
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

    // One URL reused by several articles from a source is a brand asset. The
    // windowed count only needs the pairs on this page, so a single grouped
    // query is enough — no correlated subquery per row.
    const sharedCounts = new Map();
    const pairs = [
      ...new Set(
        rows
          .filter((r) => r.image_url)
          .map((r) => `${r.source}||${r.image_url}`),
      ),
    ];
    if (pairs.length > 0) {
      const sources = [...new Set(rows.map((r) => r.source))];
      const images = [...new Set(rows.map((r) => r.image_url).filter(Boolean))];
      const [counts] = await sequelize.query(
        `SELECT source, image_url, COUNT(*) AS cnt
           FROM news
          WHERE source IN (:sources) AND image_url IN (:images)
          GROUP BY source, image_url`,
        { replacements: { sources, images } },
      );
      for (const c of counts) {
        sharedCounts.set(`${c.source}||${c.image_url}`, Number(c.cnt || 0));
      }
    }

    const totalCount = Number(total || 0);
    res.json({
      success: true,
      data: rows.map((r) => {
        const shared = r.image_url
          ? sharedCounts.get(`${r.source}||${r.image_url}`) || 0
          : 0;
        const brandAsset = imageService.looksLikeBrandAsset(r.image_url);
        return {
          id: r.id,
          title: decodeEntities(r.title),
          source: r.source,
          category: r.category,
          image_url: r.image_url || null,
          url: r.url || null,
          image_shared_count: shared,
          // True when the lead image is a brand asset, or one URL is reused
          // across this source — either way the real photo is missing.
          image_needs_repair: Boolean(
            r.url && (brandAsset || shared >= imageService.SHARED_IMAGE_THRESHOLD),
          ),
          is_original: Boolean(r.is_original),
          is_published: Boolean(r.is_published),
          author_id: r.author_id,
          author_name: r.author_name,
          published_at: r.published_at,
          updated_at: r.updated_at,
          impressions_count: Number(r.impressions_count || 0),
          reactions_count: Number(r.reactions_count || 0),
          bookmarks_count: Number(r.bookmarks_count || 0),
          comments_count: Number(r.comments_count || 0),
          likes_count: Number(r.likes_count || 0),
        };
      }),
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

module.exports = {
  getUsers,
  updateUser,
  deleteUser,
  getAnalytics,
  testEmail,
  getArticles,
  getArticle,
  createArticle,
  updateArticle,
  refreshArticleImage,
  refreshArticleImages,
  publishArticle,
  deleteArticle,
};
