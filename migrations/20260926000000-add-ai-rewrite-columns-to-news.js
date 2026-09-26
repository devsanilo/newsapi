'use strict';

/**
 * AI rewrite pipeline: staging columns on `news`.
 *
 * Design notes that matter:
 *
 * 1. The model's output lands in `staged_content`, NOT in `content`. An
 *    unattended job rewriting 44k live pages would take the whole site down on
 *    one bad model day; staging means nothing user-visible changes until a row
 *    is explicitly approved.
 *
 * 2. `content_type` describes the LIVE content and is kept deliberately
 *    separate from `is_original`. A rewrite is a derivative of syndicated
 *    material, so it must not claim to be first-party — otherwise the
 *    stats panel's "originals" count becomes meaningless and there is no way
 *    left to tell a reviewer which pages Trenxi actually authored. The
 *    backfill therefore maps is_original=1 -> 'original' only.
 *
 * 3. `staged_content` is MEDIUMTEXT to match `content`, which is already
 *    TEXT('medium').
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const t = await queryInterface.sequelize.transaction();

    try {
      const columns = await queryInterface
        .describeTable('news', { transaction: t })
        .then((d) => new Set(Object.keys(d)))
        .catch(() => new Set());

      if (columns.size === 0) {
        throw new Error("Table `news` not found — run the baseline first.");
      }

      // `addColumn` per column rather than a single addColumns call so a
      // partially-applied migration can be re-run without erroring.
      if (!columns.has('content_type')) {
        await queryInterface.addColumn(
          'news',
          'content_type',
          {
            type: DataTypes.ENUM('aggregated', 'rewritten', 'original'),
            allowNull: false,
            defaultValue: 'aggregated',
            comment:
              "Provenance of the LIVE content: third-party feed, AI rewrite, or first-party",
          },
          { transaction: t },
        );
      }

      if (!columns.has('rewrite_status')) {
        await queryInterface.addColumn(
          'news',
          'rewrite_status',
          {
            type: DataTypes.ENUM(
              'none',
              'pending',
              'processing',
              'ready',
              'applied',
              'failed',
            ),
            allowNull: false,
            defaultValue: 'none',
            comment: "State of the AI rewrite for this row",
          },
          { transaction: t },
        );
      }

      if (!columns.has('rewrite_attempts')) {
        await queryInterface.addColumn(
          'news',
          'rewrite_attempts',
          {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            defaultValue: 0,
            comment: "Failed attempts, used to stop retrying hopeless rows",
          },
          { transaction: t },
        );
      }

      if (!columns.has('staged_content')) {
        await queryInterface.addColumn(
          'news',
          'staged_content',
          {
            type: DataTypes.TEXT('medium'),
            allowNull: true,
            comment:
              "AI rewrite awaiting approval; never served to readers",
          },
          { transaction: t },
        );
      }

      if (!columns.has('staged_title')) {
        await queryInterface.addColumn(
          'news',
          'staged_title',
          {
            type: DataTypes.STRING(500),
            allowNull: true,
            comment: "Rewritten headline awaiting approval",
          },
          { transaction: t },
        );
      }

      if (!columns.has('staged_description')) {
        await queryInterface.addColumn(
          'news',
          'staged_description',
          {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: "Rewritten standfirst awaiting approval",
          },
          { transaction: t },
        );
      }

      if (!columns.has('staged_at')) {
        await queryInterface.addColumn(
          'news',
          'staged_at',
          {
            type: DataTypes.DATE,
            allowNull: true,
            comment: "When the staged rewrite was generated",
          },
          { transaction: t },
        );
      }

      if (!columns.has('rewrite_meta')) {
        await queryInterface.addColumn(
          'news',
          'rewrite_meta',
          {
            type: DataTypes.JSON,
            allowNull: true,
            comment:
              "Model, prompt version, token usage and cost for the staged rewrite",
          },
          { transaction: t },
        );
      }

      if (!columns.has('rewrite_error')) {
        await queryInterface.addColumn(
          'news',
          'rewrite_error',
          {
            type: DataTypes.STRING(500),
            allowNull: true,
            comment: "Last failure reason, for the admin queue",
          },
          { transaction: t },
        );
      }

      // Backfill only genuine first-party rows. Everything else — including the
      // 43k aggregated rows — stays 'aggregated'.
      await queryInterface.sequelize.query(
        "UPDATE news SET content_type = 'original' WHERE is_original = 1 AND content_type <> 'original'",
        { transaction: t },
      );

      const existingIndexes = await queryInterface.showIndex('news', {
        transaction: t,
      });
      const names = new Set(existingIndexes.map((index) => index.name));

      // Batch selection scans "aggregated rows not yet rewritten", so the
      // leading column is content_type.
      if (!names.has('idx_news_rewrite_queue')) {
        await queryInterface.addIndex('news', ['content_type', 'rewrite_status'], {
          name: 'idx_news_rewrite_queue',
          transaction: t,
        });
      }

      // The review queue reads status='ready' ordered by staged_at.
      if (!names.has('idx_news_staged_at')) {
        await queryInterface.addIndex('news', ['staged_at'], {
          name: 'idx_news_staged_at',
          transaction: t,
        });
      }

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },

  async down(queryInterface) {
    const t = await queryInterface.sequelize.transaction();
    try {
      const columns = await queryInterface
        .describeTable('news', { transaction: t })
        .then((d) => new Set(Object.keys(d)))
        .catch(() => new Set());

      for (const name of [
        'staged_content',
        'staged_title',
        'staged_description',
        'staged_at',
        'rewrite_meta',
        'rewrite_error',
        'rewrite_attempts',
        'rewrite_status',
        'content_type',
      ]) {
        if (columns.has(name)) {
          await queryInterface
            .removeColumn('news', name, { transaction: t })
            .catch(() => {});
        }
      }

      await queryInterface
        .removeIndex('news', 'idx_news_rewrite_queue', { transaction: t })
        .catch(() => {});
      await queryInterface
        .removeIndex('news', 'idx_news_staged_at', { transaction: t })
        .catch(() => {});

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },
};
