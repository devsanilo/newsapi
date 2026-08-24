'use strict';

/**
 * Baseline migration — captures the full schema created by sequelize.sync().
 *
 * For EXISTING databases that were bootstrapped with sync(), mark this
 * migration as already-run WITHOUT executing it:
 *
 *   npx sequelize-cli db:seed --seed 00000000000000-mark-baseline.js
 *   — or simply —
 *   INSERT INTO SequelizeMeta (name) VALUES ('20250101000000-baseline.js');
 *
 * For FRESH databases, run normally:
 *
 *   npx sequelize-cli db:migrate
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const t = await queryInterface.sequelize.transaction();

    try {
      // ── 1. news ───────────────────────────────────────────
      await queryInterface.createTable(
        'news',
        {
          id: { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
          title: { type: DataTypes.STRING(500), allowNull: false },
          description: { type: DataTypes.TEXT, allowNull: true },
          content: { type: DataTypes.TEXT('medium'), allowNull: true },
          image_url: { type: DataTypes.STRING(1000), allowNull: true },
          source: { type: DataTypes.STRING(100), allowNull: true },
          category: { type: DataTypes.STRING(100), allowNull: true },
          url: { type: DataTypes.STRING(768), allowNull: false, unique: true },
          hash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
          tags: { type: DataTypes.JSON, allowNull: true, defaultValue: [] },
          language: { type: DataTypes.STRING(10), allowNull: true, defaultValue: 'en' },
          published_at: { type: DataTypes.DATE, allowNull: true },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction: t, engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
      );
      await queryInterface.addIndex('news', ['category'], { name: 'idx_category', transaction: t });
      await queryInterface.addIndex('news', ['source'], { name: 'idx_source', transaction: t });
      await queryInterface.addIndex('news', ['published_at'], { name: 'idx_published_at', transaction: t });
      await queryInterface.addIndex('news', ['language'], { name: 'idx_language', transaction: t });
      await queryInterface.addIndex('news', ['created_at'], { name: 'idx_created_at', transaction: t });

      // ── 2. users ──────────────────────────────────────────
      await queryInterface.createTable(
        'users',
        {
          id: { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
          name: { type: DataTypes.STRING(100), allowNull: false },
          email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
          password: { type: DataTypes.STRING(255), allowNull: true },
          avatar: { type: DataTypes.STRING(500), allowNull: true },
          role: { type: DataTypes.ENUM('user', 'admin'), allowNull: false, defaultValue: 'user' },
          auth_provider: { type: DataTypes.ENUM('local', 'google', 'apple'), allowNull: false, defaultValue: 'local' },
          auth_provider_id: { type: DataTypes.STRING(255), allowNull: true },
          bio: { type: DataTypes.STRING(500), allowNull: true },
          phone: { type: DataTypes.STRING(20), allowNull: true },
          location: { type: DataTypes.STRING(200), allowNull: true },
          website: { type: DataTypes.STRING(500), allowNull: true },
          fcm_token: { type: DataTypes.STRING(500), allowNull: true },
          notification_push: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
          notification_email: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
          notification_breaking: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
          notification_comments: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
          notification_likes: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
          is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction: t, engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
      );
      await queryInterface.addIndex('users', ['email'], { name: 'idx_users_email', unique: true, transaction: t });
      await queryInterface.addIndex('users', ['role'], { name: 'idx_users_role', transaction: t });
      await queryInterface.addIndex('users', ['auth_provider', 'auth_provider_id'], { name: 'idx_users_provider', transaction: t });

      // ── 3. sources ────────────────────────────────────────
      await queryInterface.createTable(
        'sources',
        {
          id: { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
          name: { type: DataTypes.STRING(150), allowNull: false },
          slug: { type: DataTypes.STRING(100), allowNull: false, unique: true },
          url: { type: DataTypes.STRING(500), allowNull: false },
          logo_url: { type: DataTypes.STRING(500), allowNull: true },
          country: { type: DataTypes.STRING(5), allowNull: false, defaultValue: 'int' },
          language: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'en' },
          category: { type: DataTypes.STRING(100), allowNull: true },
          rss_url: { type: DataTypes.STRING(500), allowNull: true },
          scraper_config: { type: DataTypes.JSON, allowNull: true },
          is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
          is_local: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction: t, engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
      );
      await queryInterface.addIndex('sources', ['slug'], { name: 'idx_sources_slug', unique: true, transaction: t });
      await queryInterface.addIndex('sources', ['country'], { name: 'idx_sources_country', transaction: t });
      await queryInterface.addIndex('sources', ['is_active'], { name: 'idx_sources_is_active', transaction: t });
      await queryInterface.addIndex('sources', ['is_local'], { name: 'idx_sources_is_local', transaction: t });

      // ── 4. comments ───────────────────────────────────────
      await queryInterface.createTable(
        'comments',
        {
          id: { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
          user_id: { type: DataTypes.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
          news_id: { type: DataTypes.CHAR(36), allowNull: false, references: { model: 'news', key: 'id' }, onDelete: 'CASCADE' },
          parent_id: { type: DataTypes.CHAR(36), allowNull: true, references: { model: 'comments', key: 'id' }, onDelete: 'CASCADE' },
          body: { type: DataTypes.TEXT, allowNull: false },
          is_edited: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction: t, engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
      );
      await queryInterface.addIndex('comments', ['news_id'], { name: 'idx_comments_news', transaction: t });
      await queryInterface.addIndex('comments', ['user_id'], { name: 'idx_comments_user', transaction: t });
      await queryInterface.addIndex('comments', ['parent_id'], { name: 'idx_comments_parent', transaction: t });
      await queryInterface.addIndex('comments', ['created_at'], { name: 'idx_comments_created', transaction: t });

      // ── 5. likes ──────────────────────────────────────────
      await queryInterface.createTable(
        'likes',
        {
          id: { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
          user_id: { type: DataTypes.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
          news_id: { type: DataTypes.CHAR(36), allowNull: false, references: { model: 'news', key: 'id' }, onDelete: 'CASCADE' },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction: t, engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
      );
      await queryInterface.addIndex('likes', ['user_id', 'news_id'], { name: 'idx_likes_unique', unique: true, transaction: t });
      await queryInterface.addIndex('likes', ['news_id'], { name: 'idx_likes_news', transaction: t });
      await queryInterface.addIndex('likes', ['user_id'], { name: 'idx_likes_user', transaction: t });

      // ── 6. bookmarks ──────────────────────────────────────
      await queryInterface.createTable(
        'bookmarks',
        {
          id: { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
          user_id: { type: DataTypes.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
          news_id: { type: DataTypes.CHAR(36), allowNull: false, references: { model: 'news', key: 'id' }, onDelete: 'CASCADE' },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction: t, engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
      );
      await queryInterface.addIndex('bookmarks', ['user_id', 'news_id'], { name: 'idx_bookmarks_unique', unique: true, transaction: t });
      await queryInterface.addIndex('bookmarks', ['user_id'], { name: 'idx_bookmarks_user', transaction: t });
      await queryInterface.addIndex('bookmarks', ['news_id'], { name: 'idx_bookmarks_news', transaction: t });

      // ── 7. read_history ───────────────────────────────────
      await queryInterface.createTable(
        'read_history',
        {
          id: { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
          user_id: { type: DataTypes.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
          news_id: { type: DataTypes.CHAR(36), allowNull: false, references: { model: 'news', key: 'id' }, onDelete: 'CASCADE' },
          read_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          read_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
        },
        { transaction: t, engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
      );
      await queryInterface.addIndex('read_history', ['user_id', 'news_id'], { name: 'idx_rh_unique', unique: true, transaction: t });
      await queryInterface.addIndex('read_history', ['user_id'], { name: 'idx_rh_user', transaction: t });
      await queryInterface.addIndex('read_history', ['read_at'], { name: 'idx_rh_read_at', transaction: t });

      // ── 8. user_preferences ───────────────────────────────
      await queryInterface.createTable(
        'user_preferences',
        {
          id: { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
          user_id: { type: DataTypes.CHAR(36), allowNull: false, unique: true, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
          preferred_categories: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
          preferred_sources: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
          preferred_languages: { type: DataTypes.JSON, allowNull: false, defaultValue: ['en'] },
          implicit_scores: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
          updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction: t, engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
      );
      await queryInterface.addIndex('user_preferences', ['user_id'], { name: 'idx_up_user', unique: true, transaction: t });

      // ── 9. impressions ────────────────────────────────────
      await queryInterface.createTable(
        'impressions',
        {
          id: { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
          news_id: { type: DataTypes.CHAR(36), allowNull: false, references: { model: 'news', key: 'id' }, onDelete: 'CASCADE' },
          user_id: { type: DataTypes.CHAR(36), allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction: t, engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
      );
      await queryInterface.addIndex('impressions', ['news_id'], { name: 'idx_impressions_news', transaction: t });
      await queryInterface.addIndex('impressions', ['user_id'], { name: 'idx_impressions_user', transaction: t });
      await queryInterface.addIndex('impressions', ['created_at'], { name: 'idx_impressions_created_at', transaction: t });

      // ── 10. news_reactions ────────────────────────────────
      await queryInterface.createTable(
        'news_reactions',
        {
          id: { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
          user_id: { type: DataTypes.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
          news_id: { type: DataTypes.CHAR(36), allowNull: false, references: { model: 'news', key: 'id' }, onDelete: 'CASCADE' },
          reaction_type: { type: DataTypes.ENUM('insightful', 'shocking', 'useful'), allowNull: false },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction: t, engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
      );
      await queryInterface.addIndex('news_reactions', ['user_id', 'news_id'], { name: 'idx_reactions_user_news_unique', unique: true, transaction: t });
      await queryInterface.addIndex('news_reactions', ['news_id'], { name: 'idx_reactions_news', transaction: t });
      await queryInterface.addIndex('news_reactions', ['reaction_type'], { name: 'idx_reactions_type', transaction: t });

      // ── 11. bookmark_collections ──────────────────────────
      await queryInterface.createTable(
        'bookmark_collections',
        {
          id: { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
          user_id: { type: DataTypes.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
          name: { type: DataTypes.STRING(80), allowNull: false },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction: t, engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
      );
      await queryInterface.addIndex('bookmark_collections', ['user_id'], { name: 'idx_collections_user', transaction: t });
      await queryInterface.addIndex('bookmark_collections', ['user_id', 'name'], { name: 'idx_collections_user_name_unique', unique: true, transaction: t });

      // ── 12. bookmark_collection_items ─────────────────────
      await queryInterface.createTable(
        'bookmark_collection_items',
        {
          id: { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
          collection_id: { type: DataTypes.CHAR(36), allowNull: false, references: { model: 'bookmark_collections', key: 'id' }, onDelete: 'CASCADE' },
          news_id: { type: DataTypes.CHAR(36), allowNull: false, references: { model: 'news', key: 'id' }, onDelete: 'CASCADE' },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction: t, engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
      );
      await queryInterface.addIndex('bookmark_collection_items', ['collection_id'], { name: 'idx_collection_items_collection', transaction: t });
      await queryInterface.addIndex('bookmark_collection_items', ['news_id'], { name: 'idx_collection_items_news', transaction: t });
      await queryInterface.addIndex('bookmark_collection_items', ['collection_id', 'news_id'], { name: 'idx_collection_items_unique', unique: true, transaction: t });

      // ── 13. crawler_schedule ──────────────────────────────
      await queryInterface.createTable(
        'crawler_schedule',
        {
          id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
          cron_schedule: { type: DataTypes.STRING(100), allowNull: false, defaultValue: '*/30 * * * *' },
          is_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
          updated_by: { type: DataTypes.STRING(120), allowNull: false, defaultValue: 'system' },
          updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction: t, engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
      );

      // ── 14. notifications ─────────────────────────────────
      await queryInterface.createTable(
        'notifications',
        {
          id: { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
          user_id: { type: DataTypes.CHAR(36), allowNull: false },
          type: {
            type: DataTypes.ENUM('breaking_news', 'article_recommendation', 'comment_reply', 'comment_on_article', 'like', 'follow', 'system'),
            allowNull: false,
            defaultValue: 'system',
          },
          title: { type: DataTypes.STRING(300), allowNull: false },
          body: { type: DataTypes.TEXT, allowNull: true },
          data: { type: DataTypes.JSON, allowNull: true, defaultValue: {} },
          image_url: { type: DataTypes.STRING(500), allowNull: true },
          is_read: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
          read_at: { type: DataTypes.DATE, allowNull: true },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction: t, engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
      );
      await queryInterface.addIndex('notifications', ['user_id'], { name: 'idx_notif_user', transaction: t });
      await queryInterface.addIndex('notifications', ['user_id', 'is_read'], { name: 'idx_notif_user_read', transaction: t });
      await queryInterface.addIndex('notifications', ['created_at'], { name: 'idx_notif_created', transaction: t });
      await queryInterface.addIndex('notifications', ['type'], { name: 'idx_notif_type', transaction: t });

      // ── 15. follows ───────────────────────────────────────
      await queryInterface.createTable(
        'follows',
        {
          id: { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
          follower_id: { type: DataTypes.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
          following_id: { type: DataTypes.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction: t, engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
      );
      await queryInterface.addIndex('follows', ['follower_id', 'following_id'], { unique: true, transaction: t });
      await queryInterface.addIndex('follows', ['following_id'], { transaction: t });

      // ── 16. reading_streaks ───────────────────────────────
      await queryInterface.createTable(
        'reading_streaks',
        {
          id: { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
          user_id: { type: DataTypes.CHAR(36), allowNull: false, unique: true, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
          current_streak: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
          longest_streak: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
          total_articles_read: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
          total_reading_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
          last_read_date: { type: DataTypes.DATEONLY, allowNull: true },
          badges: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction: t, engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
      );

      // ── 17. pages ─────────────────────────────────────────
      await queryInterface.createTable(
        'pages',
        {
          id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
          slug: { type: DataTypes.STRING(100), allowNull: false, unique: true },
          title: { type: DataTypes.STRING(255), allowNull: false },
          content: { type: DataTypes.TEXT('long'), allowNull: false },
          meta_description: { type: DataTypes.STRING(500), allowNull: true },
          is_published: { type: DataTypes.BOOLEAN, defaultValue: true },
          updated_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction: t, engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
      );

      // ── 18. rewards ───────────────────────────────────────
      await queryInterface.createTable(
        'rewards',
        {
          id: { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
          user_id: { type: DataTypes.CHAR(36), allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
          amount: { type: DataTypes.INTEGER, allowNull: false },
          type: { type: DataTypes.ENUM('watchAd', 'dailyLogin', 'shareArticle', 'readArticle', 'spend', 'bonus'), allowNull: false },
          description: { type: DataTypes.STRING(255), allowNull: true },
          metadata: { type: DataTypes.JSON, allowNull: true },
          created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction: t, engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
      );

      // ── 19. ad_settings ───────────────────────────────────
      await queryInterface.createTable(
        'ad_settings',
        {
          id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
          key: { type: DataTypes.STRING(100), allowNull: false, unique: true },
          value: { type: DataTypes.TEXT, allowNull: true },
          description: { type: DataTypes.STRING(255), allowNull: true },
          isEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
          createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction: t, engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
      );

      // ── 20. league_standings ──────────────────────────────
      await queryInterface.createTable(
        'league_standings',
        {
          id: { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
          league_code: { type: DataTypes.STRING(20), allowNull: false },
          league_name: { type: DataTypes.STRING(100), allowNull: false },
          season: { type: DataTypes.INTEGER, allowNull: false },
          group: { type: DataTypes.STRING(50), allowNull: true },
          position: { type: DataTypes.INTEGER, allowNull: false },
          team_id: { type: DataTypes.INTEGER, allowNull: false },
          team_name: { type: DataTypes.STRING(150), allowNull: false },
          team_short: { type: DataTypes.STRING(10), allowNull: true },
          team_crest: { type: DataTypes.STRING(500), allowNull: true },
          played: { type: DataTypes.INTEGER, defaultValue: 0 },
          won: { type: DataTypes.INTEGER, defaultValue: 0 },
          draw: { type: DataTypes.INTEGER, defaultValue: 0 },
          lost: { type: DataTypes.INTEGER, defaultValue: 0 },
          goals_for: { type: DataTypes.INTEGER, defaultValue: 0 },
          goals_against: { type: DataTypes.INTEGER, defaultValue: 0 },
          goal_difference: { type: DataTypes.INTEGER, defaultValue: 0 },
          points: { type: DataTypes.INTEGER, defaultValue: 0 },
          form: { type: DataTypes.STRING(20), allowNull: true },
          fetched_at: { type: DataTypes.DATE, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction: t, engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
      );
      await queryInterface.addIndex('league_standings', ['league_code', 'season'], { name: 'idx_league_season', transaction: t });
      await queryInterface.addIndex('league_standings', ['league_code', 'season', 'group'], { name: 'idx_league_group', transaction: t });
      await queryInterface.addIndex('league_standings', ['team_id'], { name: 'idx_team', transaction: t });

      // ── 21. matches ───────────────────────────────────────
      await queryInterface.createTable(
        'matches',
        {
          id: { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
          league_code: { type: DataTypes.STRING(20), allowNull: false },
          league_name: { type: DataTypes.STRING(100), allowNull: false },
          season: { type: DataTypes.INTEGER, allowNull: false },
          matchday: { type: DataTypes.INTEGER, allowNull: true },
          stage: { type: DataTypes.STRING(50), allowNull: true },
          group: { type: DataTypes.STRING(50), allowNull: true },
          external_id: { type: DataTypes.INTEGER, allowNull: false },
          status: { type: DataTypes.STRING(20), allowNull: false },
          utc_date: { type: DataTypes.DATE, allowNull: false },
          home_team_id: { type: DataTypes.INTEGER, allowNull: false },
          home_team_name: { type: DataTypes.STRING(150), allowNull: false },
          home_team_short: { type: DataTypes.STRING(10), allowNull: true },
          home_team_crest: { type: DataTypes.STRING(500), allowNull: true },
          away_team_id: { type: DataTypes.INTEGER, allowNull: false },
          away_team_name: { type: DataTypes.STRING(150), allowNull: false },
          away_team_short: { type: DataTypes.STRING(10), allowNull: true },
          away_team_crest: { type: DataTypes.STRING(500), allowNull: true },
          home_score: { type: DataTypes.INTEGER, allowNull: true },
          away_score: { type: DataTypes.INTEGER, allowNull: true },
          home_ht_score: { type: DataTypes.INTEGER, allowNull: true },
          away_ht_score: { type: DataTypes.INTEGER, allowNull: true },
          winner: { type: DataTypes.STRING(20), allowNull: true },
          duration: { type: DataTypes.STRING(20), allowNull: true },
          venue: { type: DataTypes.STRING(200), allowNull: true },
          referee_name: { type: DataTypes.STRING(100), allowNull: true },
          fetched_at: { type: DataTypes.DATE, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction: t, engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
      );
      await queryInterface.addIndex('matches', ['league_code', 'season'], { name: 'idx_match_league_season', transaction: t });
      await queryInterface.addIndex('matches', ['league_code', 'status'], { name: 'idx_match_status', transaction: t });
      await queryInterface.addIndex('matches', ['utc_date'], { name: 'idx_match_date', transaction: t });
      await queryInterface.addIndex('matches', ['external_id'], { name: 'idx_match_external', unique: true, transaction: t });
      await queryInterface.addIndex('matches', ['league_code', 'season', 'matchday'], { name: 'idx_match_matchday', transaction: t });

      // ── 22. top_scorers ───────────────────────────────────
      await queryInterface.createTable(
        'top_scorers',
        {
          id: { type: DataTypes.CHAR(36), primaryKey: true, defaultValue: DataTypes.UUIDV4 },
          league_code: { type: DataTypes.STRING(20), allowNull: false },
          league_name: { type: DataTypes.STRING(100), allowNull: false },
          season: { type: DataTypes.INTEGER, allowNull: false },
          rank: { type: DataTypes.INTEGER, allowNull: false },
          player_id: { type: DataTypes.INTEGER, allowNull: true },
          player_name: { type: DataTypes.STRING(150), allowNull: false },
          player_nationality: { type: DataTypes.STRING(50), allowNull: true },
          player_position: { type: DataTypes.STRING(30), allowNull: true },
          player_dob: { type: DataTypes.STRING(20), allowNull: true },
          team_id: { type: DataTypes.INTEGER, allowNull: true },
          team_name: { type: DataTypes.STRING(100), allowNull: true },
          team_short: { type: DataTypes.STRING(10), allowNull: true },
          team_crest: { type: DataTypes.STRING(500), allowNull: true },
          goals: { type: DataTypes.INTEGER, defaultValue: 0 },
          assists: { type: DataTypes.INTEGER, defaultValue: 0 },
          penalties: { type: DataTypes.INTEGER, defaultValue: 0 },
          played_matches: { type: DataTypes.INTEGER, defaultValue: 0 },
          fetched_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        },
        { transaction: t, engine: 'InnoDB', charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
      );
      await queryInterface.addIndex('top_scorers', ['league_code', 'season'], { name: 'idx_scorer_league_season', transaction: t });
      await queryInterface.addIndex('top_scorers', ['player_id'], { name: 'idx_scorer_player', transaction: t });

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  },

  async down(queryInterface) {
    // Drop in reverse FK-dependency order
    const tables = [
      'top_scorers', 'matches', 'league_standings', 'ad_settings', 'rewards',
      'pages', 'reading_streaks', 'follows', 'notifications', 'crawler_schedule',
      'bookmark_collection_items', 'bookmark_collections', 'news_reactions',
      'impressions', 'user_preferences', 'read_history', 'bookmarks', 'likes',
      'comments', 'sources', 'users', 'news',
    ];
    for (const table of tables) {
      await queryInterface.dropTable(table, { cascade: true });
    }
  },
};
