/**
 * Source Routes (public + admin)
 */
const { Router } = require('express');
const sourceController = require('../controllers/sourceController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = Router();

// Public
router.get('/', sourceController.getSources);
router.get('/:slug', sourceController.getSourceBySlug);

// Admin only
router.post('/', requireAuth, requireAdmin, sourceController.createSource);
router.put('/:slug', requireAuth, requireAdmin, sourceController.updateSource);
router.delete('/:slug', requireAuth, requireAdmin, sourceController.deleteSource);

module.exports = router;
