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

router.get("/articles", adminController.getArticles);

router.get("/analytics", adminController.getAnalytics);
router.post("/test-email", adminController.testEmail);

// Social publishing
router.get("/social/config", socialController.getConfig);
router.put("/social/config", socialController.saveConfig);
router.post("/social/publish", socialController.publish);
router.post("/social/test", socialController.test);

module.exports = router;
