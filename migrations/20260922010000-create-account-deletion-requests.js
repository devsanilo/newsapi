'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const t = await queryInterface.sequelize.transaction();
    try {
      const exists = await queryInterface
        .describeTable('account_deletion_requests', { transaction: t })
        .then(() => true)
        .catch(() => false);

      if (!exists) {
        await queryInterface.createTable(
          'account_deletion_requests',
          {
            id: {
              type: Sequelize.DataTypes.CHAR(36),
              primaryKey: true,
              allowNull: false,
            },
            // Deliberately NOT a foreign key: this row is the audit trail and
            // must outlive the user it refers to. A constraint would either
            // block the user delete or cascade the trail away with it.
            user_id: {
              type: Sequelize.DataTypes.CHAR(36),
              allowNull: false,
            },
            email: {
              type: Sequelize.DataTypes.STRING(255),
              allowNull: false,
            },
            reason: {
              type: Sequelize.DataTypes.STRING(500),
              allowNull: true,
            },
            status: {
              type: Sequelize.DataTypes.ENUM(
                'pending',
                'completed',
                'cancelled',
              ),
              allowNull: false,
              defaultValue: 'pending',
            },
            requested_at: {
              type: Sequelize.DataTypes.DATE,
              allowNull: false,
            },
            processed_at: {
              type: Sequelize.DataTypes.DATE,
              allowNull: true,
            },
            processed_by: {
              type: Sequelize.DataTypes.CHAR(36),
              allowNull: true,
            },
            created_at: {
              type: Sequelize.DataTypes.DATE,
              allowNull: false,
              defaultValue: Sequelize.DataTypes.NOW,
            },
            updated_at: {
              type: Sequelize.DataTypes.DATE,
              allowNull: false,
              defaultValue: Sequelize.DataTypes.NOW,
            },
          },
          { transaction: t },
        );
      }

      const existingIndexes = await queryInterface.showIndex(
        'account_deletion_requests',
        { transaction: t },
      );
      const names = new Set(existingIndexes.map((index) => index.name));

      if (!names.has('idx_adr_user')) {
        await queryInterface.addIndex(
          'account_deletion_requests',
          ['user_id'],
          { name: 'idx_adr_user', transaction: t },
        );
      }
      if (!names.has('idx_adr_status')) {
        await queryInterface.addIndex(
          'account_deletion_requests',
          ['status'],
          { name: 'idx_adr_status', transaction: t },
        );
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
      await queryInterface
        .dropTable('account_deletion_requests', { transaction: t })
        .catch(() => {});
      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },
};
