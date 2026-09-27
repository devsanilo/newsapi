/**
 * Admin Routes — user management, analytics, SMTP test
 */
const { Router } = require("express");
const adminController = require("../controllers/adminController");
const socialController = require("../controllers/socialController");
const uploadController = require("../controllers/uploadController");
const { upload } = require("../middleware/upload");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = Router();

router.use(requireAuth, requireAdmin);

// Image upload (multipart, field name "file")
router.post("/upload", (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
}, uploadController.uploadImage);

router.get("/users", adminController.getUsers);
router.patch("/users/:id", adminController.updateUser);
router.delete("/users/:id", adminController.deleteUser);

// Account deletion requests filed from /account/delete on the web app.
router.get("/deletion-requests", adminController.getDeletionRequests);
router.post(
  "/deletion-requests/:id/erase",
  adminController.eraseDeletionRequest,
);

router.get("/articles", adminController.getArticles);
// Article-volume stats. Registered before "/articles/:id" so the literal path
// is not swallowed by a parameter match.
router.get("/articles/stats", adminController.getArticleStats);
router.get("/articles/:id", adminController.getArticle);
router.post("/articles", adminController.createArticle);
// Lead-image repair. Registered before the ":id" routes so the literal path is
// not swallowed by a parameter match.
router.post("/articles/refresh-images", adminController.refreshArticleImages);
router.post("/articles/:id/refresh-image", adminController.refreshArticleImage);
router.patch("/articles/:id", adminController.updateArticle);
router.post("/articles/:id/publish", adminController.publishArticle);
router.delete("/articles/:id", adminController.deleteArticle);

router.get("/analytics", adminController.getAnalytics);
router.post("/test-email", adminController.testEmail);

// ─── AI rewrite review queue ──────────────────────────────────────────────
// All literal paths, registered before any ":id" route so none is swallowed by
// a parameter match.
router.get("/rewrites", adminController.getRewriteQueue);
router.get("/rewrites/settings", adminController.getRewriteSettingsHandler);
router.patch("/rewrites/settings", adminController.updateRewriteSettingsHandler);
router.post("/rewrites/run", adminController.runRewriteBatchNow);
router.post("/rewrites/:id/approve", adminController.approveRewrite);
router.post("/rewrites/:id/reject", adminController.rejectRewrite);

// Social publishing
router.get("/social/config", socialController.getConfig);
router.put("/social/config", socialController.saveConfig);
router.post("/social/publish", socialController.publish);
router.post("/social/test", socialController.test);

module.exports = router;
