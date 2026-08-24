/**
 * Follow Routes
 */
const { Router } = require("express");
const { requireAuth, optionalAuth } = require("../middleware/auth");
const followController = require("../controllers/followController");

const router = Router();

router.post("/:userId/follow", requireAuth, followController.toggleFollow);
router.get("/:userId/followers", optionalAuth, followController.getFollowers);
router.get("/:userId/following", optionalAuth, followController.getFollowing);
router.get("/social-feed", requireAuth, followController.getSocialFeed);

module.exports = router;
