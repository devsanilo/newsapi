/**
 * Source detection: decide whether a publisher is read via WordPress or RSS.
 *
 * One implementation, used by both `scripts/setup-wordpress-sources.js` and the
 * admin endpoint, because the two answers must never diverge — a source flagged
 * WordPress by one path and RSS by the other would silently stop ingesting.
 *
 * The result is stored on the source row rather than derived at ingest time, so
 * a crawl does not pay for a probe on every run and a transient failure cannot
 * silently flip a publisher's whole feed type.
 */

const Source = require("../models/Source");
const wpCrawler = require("../crawlers/wpCrawler");
const logger = require("../utils/logger");

class SourceDetectionService {
  /**
   * Probe every active source (or a given subset) without writing anything.
   *
   * @param {Object} [opts] - { only: string[] of slugs }
   * @returns {Promise<{wordpress: Array, rss: Array, changed: Array, total: number}>}
   */
  async detect({ only = null } = {}) {
    const where = { is_active: true };
    const sources = await Source.findAll({
      where,
      order: [
        ["is_local", "DESC"],
        ["slug", "ASC"],
      ],
      raw: true,
    });

    const targets = only ? sources.filter((s) => only.includes(s.slug)) : sources;

    const wordpress = [];
    const rss = [];

    for (const source of targets) {
      const result = await wpCrawler.detect(source.url);

      if (result.supported) {
        wordpress.push({
          slug: source.slug,
          name: source.name,
          previous: source.feed_type,
          wpApiUrl: result.wpApiUrl,
          sampleWords: result.sample?.words ?? null,
        });
      } else {
        rss.push({
          slug: source.slug,
          name: source.name,
          previous: source.feed_type,
          reason: result.reason,
        });
      }
    }

    // Only rows whose stored setting differs from the probe result are a
    // change. A source that was WordPress and is now unreachable is included:
    // it needs to fall back to RSS, which is a real change, not a no-op.
    const changed = [
      ...wordpress.filter((w) => w.previous !== "wordpress"),
      ...rss.filter((r) => r.previous !== "rss"),
    ];

    logger.info(
      `Source detection: ${wordpress.length} WordPress, ${rss.length} RSS, ${changed.length} needing a change`,
    );

    return {
      wordpress,
      rss,
      changed,
      total: targets.length,
      detectedAt: new Date().toISOString(),
    };
  }

  /**
   * Write a detection result to the source rows.
   *
   * `wp_api_url` is cleared for RSS sources: leaving a stale URL behind would be
   * preferred over re-deriving one, and would point at an API that no longer
   * serves that publisher.
   */
  async apply(detection) {
    for (const item of detection.wordpress) {
      await Source.update(
        { feed_type: "wordpress", wp_api_url: item.wpApiUrl },
        { where: { slug: item.slug } },
      );
    }
    for (const item of detection.rss) {
      await Source.update(
        { feed_type: "rss", wp_api_url: null },
        { where: { slug: item.slug } },
      );
    }

    return {
      wordpress: detection.wordpress.length,
      rss: detection.rss.length,
      changed: detection.changed.length,
    };
  }

  /** Convenience: detect then apply. */
  async detectAndApply({ only = null } = {}) {
    const detection = await this.detect({ only });
    const applied = await this.apply(detection);
    return { ...applied, detection };
  }
}

module.exports = new SourceDetectionService();
