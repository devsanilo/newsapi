/**
 * Page Routes
 * Public page fetch + admin CRUD
 */
const { Router } = require("express");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const {
  getPageBySlug,
  listPages,
  updatePage,
  createPage,
  deletePage,
} = require("../controllers/pageController");

const router = Router();

// Admin — list all pages (must be before /:slug)
router.get("/", requireAuth, requireAdmin, listPages);

// Admin — create page
router.post("/", requireAuth, requireAdmin, createPage);

// Public — get published page by slug
router.get("/:slug", getPageBySlug);

// Admin — update page
router.put("/:slug", requireAuth, requireAdmin, updatePage);

// Admin — delete page
router.delete("/:slug", requireAuth, requireAdmin, deletePage);

module.exports = router;
