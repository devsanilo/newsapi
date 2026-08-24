/**
 * Page Controller
 * CRUD operations for dynamic CMS pages
 */
const Page = require("../models/Page");
const logger = require("../utils/logger");

/**
 * GET /api/pages/:slug  — public
 * Fetch a published page by slug
 */
async function getPageBySlug(req, res) {
  try {
    const page = await Page.findOne({
      where: { slug: req.params.slug, is_published: true },
    });
    if (!page) {
      return res
        .status(404)
        .json({ success: false, message: "Page not found" });
    }
    res.json({ success: true, data: page });
  } catch (err) {
    logger.error("getPageBySlug error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * GET /api/pages  — admin
 * List all pages (including unpublished)
 */
async function listPages(req, res) {
  try {
    const pages = await Page.findAll({ order: [["slug", "ASC"]] });
    res.json({ success: true, data: pages });
  } catch (err) {
    logger.error("listPages error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * PUT /api/pages/:slug  — admin
 * Update a page's title, content, meta_description, is_published
 */
async function updatePage(req, res) {
  try {
    const { title, content, meta_description, is_published } = req.body;
    const [updated] = await Page.update(
      {
        title,
        content,
        meta_description,
        is_published,
        updated_by: req.user?.id,
      },
      { where: { slug: req.params.slug } },
    );
    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: "Page not found" });
    }
    const page = await Page.findOne({ where: { slug: req.params.slug } });
    res.json({ success: true, data: page });
  } catch (err) {
    logger.error("updatePage error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * POST /api/pages  — admin
 * Create a new page
 */
async function createPage(req, res) {
  try {
    const { slug, title, content, meta_description, is_published } = req.body;
    if (!slug || !title || !content) {
      return res
        .status(400)
        .json({
          success: false,
          message: "slug, title, and content are required",
        });
    }
    const existing = await Page.findOne({ where: { slug } });
    if (existing) {
      return res
        .status(409)
        .json({
          success: false,
          message: "Page with this slug already exists",
        });
    }
    const page = await Page.create({
      slug,
      title,
      content,
      meta_description,
      is_published: is_published !== false,
      updated_by: req.user?.id,
    });
    res.status(201).json({ success: true, data: page });
  } catch (err) {
    logger.error("createPage error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

/**
 * DELETE /api/pages/:slug  — admin
 */
async function deletePage(req, res) {
  try {
    const deleted = await Page.destroy({ where: { slug: req.params.slug } });
    if (!deleted) {
      return res
        .status(404)
        .json({ success: false, message: "Page not found" });
    }
    res.json({ success: true, message: "Page deleted" });
  } catch (err) {
    logger.error("deletePage error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

module.exports = {
  getPageBySlug,
  listPages,
  updatePage,
  createPage,
  deletePage,
};
