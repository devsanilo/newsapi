/**
 * Video Routes — public video feed
 */
const { Router } = require("express");
const videoController = require("../controllers/videoController");

const router = Router();

router.get("/", videoController.getVideos);

module.exports = router;
