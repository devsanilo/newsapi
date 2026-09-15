'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const t = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.sequelize.query(
        `SET SESSION sql_mode = REPLACE(REPLACE(@@sql_mode, 'NO_ZERO_DATE', ''), 'NO_ZERO_IN_DATE', '')`,
        { transaction: t },
      );

      await queryInterface.sequelize.query(
        `UPDATE news SET published_at = NULL WHERE published_at < '1000-01-01 00:00:00'`,
        { transaction: t },
      );

      const table = await queryInterface.describeTable('news');

      if (!table.is_original) {
        await queryInterface.addColumn(
          'news',
          'is_original',
          {
            type: Sequelize.DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
          },
          { transaction: t },
        );
      }

      if (!table.is_published) {
        await queryInterface.addColumn(
          'news',
          'is_published',
          {
            type: Sequelize.DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
          },
          { transaction: t },
        );
      }

      if (!table.author_id) {
        await queryInterface.addColumn(
          'news',
          'author_id',
          {
            type: Sequelize.DataTypes.CHAR(36),
            allowNull: true,
          },
          { transaction: t },
        );
      }

      if (!table.updated_at) {
        await queryInterface.addColumn(
          'news',
          'updated_at',
          {
            type: Sequelize.DataTypes.DATE,
            allowNull: true,
          },
          { transaction: t },
        );
      }

      const [idxRows] = await queryInterface.sequelize.query(
        `SELECT index_name FROM information_schema.statistics
         WHERE table_schema = DATABASE() AND table_name = 'news'`,
        { transaction: t },
      );
      const idx = new Set(idxRows.map((r) => r.index_name));

      if (!idx.has('idx_is_original')) {
        await queryInterface.addIndex('news', ['is_original'], {
          name: 'idx_is_original',
          transaction: t,
        });
      }
      if (!idx.has('idx_is_published')) {
        await queryInterface.addIndex('news', ['is_published'], {
          name: 'idx_is_published',
          transaction: t,
        });
      }
      if (!idx.has('idx_author_id')) {
        await queryInterface.addIndex('news', ['author_id'], {
          name: 'idx_author_id',
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
      const table = await queryInterface.describeTable('news');

      if (table.author_id) {
        await queryInterface.removeIndex('news', 'idx_author_id', {
          transaction: t,
        }).catch(() => {});
        await queryInterface.removeColumn('news', 'author_id', {
          transaction: t,
        });
      }

      if (table.is_published) {
        await queryInterface.removeIndex('news', 'idx_is_published', {
          transaction: t,
        }).catch(() => {});
        await queryInterface.removeColumn('news', 'is_published', {
          transaction: t,
        });
      }

      if (table.is_original) {
        await queryInterface.removeIndex('news', 'idx_is_original', {
          transaction: t,
        }).catch(() => {});
        await queryInterface.removeColumn('news', 'is_original', {
          transaction: t,
        });
      }

      if (table.updated_at) {
        await queryInterface.removeColumn('news', 'updated_at', {
          transaction: t,
        });
      }

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },
};
