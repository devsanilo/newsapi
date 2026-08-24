/**
 * Source Controller
 * Handles news source listing and management
 */
const Source = require('../models/Source');

class SourceController {
  /**
   * GET /api/sources  (public)
   * List all active sources, optionally filter by local/international
   */
  async getSources(req, res, next) {
    try {
      const { local, country, category } = req.query;
      const where = { is_active: true };

      if (local === 'true') where.is_local = true;
      if (local === 'false') where.is_local = false;
      if (country) where.country = country.toLowerCase();
      if (category) where.category = category.toLowerCase();

      const sources = await Source.findAll({
        where,
        order: [['is_local', 'DESC'], ['name', 'ASC']],
        raw: true,
      });

      res.json({ success: true, data: sources, count: sources.length });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/sources/:slug  (public)
   */
  async getSourceBySlug(req, res, next) {
    try {
      const source = await Source.findOne({
        where: { slug: req.params.slug },
        raw: true,
      });
      if (!source) {
        return res.status(404).json({ success: false, error: 'Source not found.' });
      }
      res.json({ success: true, data: source });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/sources  (admin)
   */
  async createSource(req, res, next) {
    try {
      const source = await Source.create(req.body);
      res.status(201).json({ success: true, data: source });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/sources/:slug  (admin)
   */
  async updateSource(req, res, next) {
    try {
      const source = await Source.findOne({ where: { slug: req.params.slug } });
      if (!source) {
        return res.status(404).json({ success: false, error: 'Source not found.' });
      }
      await source.update(req.body);
      res.json({ success: true, data: source });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/sources/:slug  (admin)
   */
  async deleteSource(req, res, next) {
    try {
      const source = await Source.findOne({ where: { slug: req.params.slug } });
      if (!source) {
        return res.status(404).json({ success: false, error: 'Source not found.' });
      }
      await source.destroy();
      res.json({ success: true, message: 'Source deleted.' });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new SourceController();
