/**
 * Interaction Routes
 * Comments, likes, bookmarks — mix of public and protected
 */
const { Router } = require('express');
const ic = require('../controllers/interactionController');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = Router();

// ─── Comments ─────────────────────────────────────────────────
// Public: view comments
router.get('/news/:newsId/comments', ic.getComments);
// Protected: add comment
router.post('/news/:newsId/comments', requireAuth, ic.addComment);
// Protected: edit/delete own comment
router.put('/comments/:id', requireAuth, ic.updateComment);
router.delete('/comments/:id', requireAuth, ic.deleteComment);

// ─── Likes ────────────────────────────────────────────────────
// Public (with optional auth to show if user liked)
router.get('/news/:newsId/likes', optionalAuth, ic.getLikeCount);
// Protected: toggle like
router.post('/news/:newsId/like', requireAuth, ic.toggleLike);
// Protected: user's liked articles
router.get('/likes', requireAuth, ic.getLikedArticles);

// ─── Reactions ────────────────────────────────────────────────
router.get('/news/:newsId/reactions', optionalAuth, ic.getReactions);
router.post('/news/:newsId/reaction', requireAuth, ic.toggleReaction);

// ─── Bookmarks ────────────────────────────────────────────────
// Protected: toggle bookmark
router.post('/news/:newsId/bookmark', requireAuth, ic.toggleBookmark);
// Protected: user's bookmarks
router.get('/bookmarks', requireAuth, ic.getBookmarks);

// ─── Collections ──────────────────────────────────────────────
router.get('/collections', requireAuth, ic.getCollections);
router.post('/collections', requireAuth, ic.createCollection);
router.get('/collections/:id/items', requireAuth, ic.getCollectionItems);
router.post('/collections/:id/items/:newsId', requireAuth, ic.addCollectionItem);
router.delete('/collections/:id/items/:newsId', requireAuth, ic.removeCollectionItem);

module.exports = router;
