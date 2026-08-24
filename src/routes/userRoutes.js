/**
 * User Feature Routes — read history, preferences
 */
const { Router } = require('express');
const feedController = require('../controllers/feedController');
const { requireAuth } = require('../middleware/auth');

const router = Router();

// Read history (protected)
router.get('/history', requireAuth, feedController.getReadHistory);
router.delete('/history', requireAuth, feedController.clearReadHistory);

// Preferences (protected)
router.get('/preferences', requireAuth, feedController.getPreferences);
router.put('/preferences', requireAuth, feedController.updatePreferences);

module.exports = router;
