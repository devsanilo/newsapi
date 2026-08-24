/**
 * Follow Controller — follow/unfollow users, get followers/following
 */
const { sequelize } = require("../database/connection");

async function toggleFollow(req, res, next) {
  try {
    const followerId = req.user.id;
    const followingId = req.params.userId;

    if (followerId === followingId) {
      return res
        .status(400)
        .json({ success: false, error: "Cannot follow yourself" });
    }

    // Check if already following
    const [[existing]] = await sequelize.query(
      "SELECT id FROM follows WHERE follower_id = :followerId AND following_id = :followingId",
      { replacements: { followerId, followingId } },
    );

    if (existing) {
      await sequelize.query(
        "DELETE FROM follows WHERE follower_id = :followerId AND following_id = :followingId",
        { replacements: { followerId, followingId } },
      );
      return res.json({ success: true, following: false });
    }

    await sequelize.query(
      "INSERT INTO follows (id, follower_id, following_id, created_at) VALUES (UUID(), :followerId, :followingId, NOW())",
      { replacements: { followerId, followingId } },
    );

    res.json({ success: true, following: true });
  } catch (error) {
    next(error);
  }
}

async function getFollowers(req, res, next) {
  try {
    const userId = req.params.userId || req.user.id;
    const [rows] = await sequelize.query(
      `SELECT u.id, u.name, u.avatar, u.bio, f.created_at AS followed_at
       FROM follows f JOIN users u ON u.id = f.follower_id
       WHERE f.following_id = :userId ORDER BY f.created_at DESC LIMIT 100`,
      { replacements: { userId } },
    );
    const [[countRow]] = await sequelize.query(
      "SELECT COUNT(*) AS cnt FROM follows WHERE following_id = :userId",
      { replacements: { userId } },
    );
    res.json({ success: true, data: rows, count: Number(countRow?.cnt || 0) });
  } catch (error) {
    next(error);
  }
}

async function getFollowing(req, res, next) {
  try {
    const userId = req.params.userId || req.user.id;
    const [rows] = await sequelize.query(
      `SELECT u.id, u.name, u.avatar, u.bio, f.created_at AS followed_at
       FROM follows f JOIN users u ON u.id = f.following_id
       WHERE f.follower_id = :userId ORDER BY f.created_at DESC LIMIT 100`,
      { replacements: { userId } },
    );
    const [[countRow]] = await sequelize.query(
      "SELECT COUNT(*) AS cnt FROM follows WHERE follower_id = :userId",
      { replacements: { userId } },
    );
    res.json({ success: true, data: rows, count: Number(countRow?.cnt || 0) });
  } catch (error) {
    next(error);
  }
}

async function getSocialFeed(req, res, next) {
  try {
    const userId = req.user.id;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const offset = (page - 1) * limit;

    // Get activity from followed users (their likes, bookmarks, comments)
    const [rows] = await sequelize.query(
      `SELECT 'like' AS activity_type, u.id AS user_id, u.name AS user_name, u.avatar AS user_avatar,
              n.id AS news_id, n.title, n.source, n.image_url, n.category, l.created_at AS activity_at
       FROM follows f
       JOIN likes l ON l.user_id = f.following_id
       JOIN users u ON u.id = f.following_id
       JOIN news n ON n.id = l.news_id
       WHERE f.follower_id = :userId
       UNION ALL
       SELECT 'bookmark' AS activity_type, u.id AS user_id, u.name AS user_name, u.avatar AS user_avatar,
              n.id AS news_id, n.title, n.source, n.image_url, n.category, b.created_at AS activity_at
       FROM follows f
       JOIN bookmarks b ON b.user_id = f.following_id
       JOIN users u ON u.id = f.following_id
       JOIN news n ON n.id = b.news_id
       WHERE f.follower_id = :userId
       ORDER BY activity_at DESC
       LIMIT :limit OFFSET :offset`,
      { replacements: { userId, limit, offset } },
    );

    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
}

module.exports = { toggleFollow, getFollowers, getFollowing, getSocialFeed };
