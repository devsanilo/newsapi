/**
 * Admin Routes — user management, analytics, SMTP test
 */
const { Router } = require("express");
const adminController = require("../controllers/adminController");
const socialController = require("../controllers/socialController");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = Router();

router.use(requireAuth, requireAdmin);

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
