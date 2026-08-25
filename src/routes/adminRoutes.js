/**
 * Admin Routes — user management, analytics, SMTP test
 */
const { Router } = require("express");
const adminController = require("../controllers/adminController");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = Router();

router.use(requireAuth, requireAdmin);

router.get("/users", adminController.getUsers);
router.patch("/users/:id", adminController.updateUser);
router.delete("/users/:id", adminController.deleteUser);

router.get("/articles", adminController.getArticles);

router.get("/analytics", adminController.getAnalytics);
router.post("/test-email", adminController.testEmail);

module.exports = router;
