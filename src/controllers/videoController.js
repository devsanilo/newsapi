/**
 * Video Controller — lightweight RSS/Atom sourced video feed
 */
const videoService = require("../services/videoService");

async function getVideos(req, res, next) {
  try {
    const { page, limit } = req.query;
    const result = await videoService.getVideos({ page, limit });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

module.exports = { getVideos };
