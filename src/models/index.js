/**
 * Models Index — all models + associations
 */
const News = require("./News");
const User = require("./User");
const Source = require("./Source");
const Comment = require("./Comment");
const Like = require("./Like");
const Bookmark = require("./Bookmark");
const ReadHistory = require("./ReadHistory");
const UserPreference = require("./UserPreference");
const Impression = require("./Impression");
const NewsReaction = require("./NewsReaction");
const BookmarkCollection = require("./BookmarkCollection");
const BookmarkCollectionItem = require("./BookmarkCollectionItem");
const CrawlerSchedule = require("./CrawlerSchedule");
const Notification = require("./Notification");
const Follow = require("./Follow");
const ReadingStreak = require("./ReadingStreak");
const Page = require("./Page");
const Reward = require("./Reward");
const AdSetting = require("./AdSetting");
const Setting = require("./Setting");
const LeagueStanding = require("./LeagueStanding");
const Match = require("./Match");
const TopScorer = require("./TopScorer");

// ─── User ↔ Comment ──────────────────────────────────────────
User.hasMany(Comment, {
  foreignKey: "user_id",
  as: "comments",
  onDelete: "CASCADE",
});
Comment.belongsTo(User, { foreignKey: "user_id", as: "user" });

// ─── News ↔ Comment ──────────────────────────────────────────
News.hasMany(Comment, {
  foreignKey: "news_id",
  as: "comments",
  onDelete: "CASCADE",
});
Comment.belongsTo(News, { foreignKey: "news_id", as: "news" });

// ─── Comment ↔ Replies (self) ─────────────────────────────────
Comment.hasMany(Comment, {
  foreignKey: "parent_id",
  as: "replies",
  onDelete: "CASCADE",
});
Comment.belongsTo(Comment, { foreignKey: "parent_id", as: "parent" });

// ─── User ↔ Like ─────────────────────────────────────────────
User.hasMany(Like, { foreignKey: "user_id", as: "likes", onDelete: "CASCADE" });
Like.belongsTo(User, { foreignKey: "user_id", as: "user" });
News.hasMany(Like, { foreignKey: "news_id", as: "likes", onDelete: "CASCADE" });
Like.belongsTo(News, { foreignKey: "news_id", as: "news" });

// ─── User ↔ Bookmark ─────────────────────────────────────────
User.hasMany(Bookmark, {
  foreignKey: "user_id",
  as: "bookmarks",
  onDelete: "CASCADE",
});
Bookmark.belongsTo(User, { foreignKey: "user_id", as: "user" });
News.hasMany(Bookmark, {
  foreignKey: "news_id",
  as: "bookmarks",
  onDelete: "CASCADE",
});
Bookmark.belongsTo(News, { foreignKey: "news_id", as: "news" });

// ─── User ↔ ReadHistory ──────────────────────────────────────
User.hasMany(ReadHistory, {
  foreignKey: "user_id",
  as: "readHistory",
  onDelete: "CASCADE",
});
ReadHistory.belongsTo(User, { foreignKey: "user_id", as: "user" });
News.hasMany(ReadHistory, {
  foreignKey: "news_id",
  as: "readHistory",
  onDelete: "CASCADE",
});
ReadHistory.belongsTo(News, { foreignKey: "news_id", as: "news" });

// ─── News/User ↔ Impression ──────────────────────────────────
News.hasMany(Impression, {
  foreignKey: "news_id",
  as: "impressions",
  onDelete: "CASCADE",
});
Impression.belongsTo(News, { foreignKey: "news_id", as: "news" });
User.hasMany(Impression, {
  foreignKey: "user_id",
  as: "impressions",
  onDelete: "SET NULL",
});
Impression.belongsTo(User, { foreignKey: "user_id", as: "user" });

// ─── User ↔ UserPreference ───────────────────────────────────
User.hasOne(UserPreference, {
  foreignKey: "user_id",
  as: "preferences",
  onDelete: "CASCADE",
});
UserPreference.belongsTo(User, { foreignKey: "user_id", as: "user" });

// ─── Reactions ────────────────────────────────────────────────
User.hasMany(NewsReaction, {
  foreignKey: "user_id",
  as: "reactions",
  onDelete: "CASCADE",
});
NewsReaction.belongsTo(User, { foreignKey: "user_id", as: "user" });
News.hasMany(NewsReaction, {
  foreignKey: "news_id",
  as: "reactions",
  onDelete: "CASCADE",
});
NewsReaction.belongsTo(News, { foreignKey: "news_id", as: "news" });

// ─── User ↔ Notification ──────────────────────────────────────
User.hasMany(Notification, {
  foreignKey: "user_id",
  as: "notifications",
  onDelete: "CASCADE",
});
Notification.belongsTo(User, { foreignKey: "user_id", as: "user" });

// ─── User ↔ Follow ─────────────────────────────────────────
User.hasMany(Follow, {
  foreignKey: "follower_id",
  as: "following",
  onDelete: "CASCADE",
});
User.hasMany(Follow, {
  foreignKey: "following_id",
  as: "followers",
  onDelete: "CASCADE",
});
Follow.belongsTo(User, { foreignKey: "follower_id", as: "follower" });
Follow.belongsTo(User, { foreignKey: "following_id", as: "followed" });

// ─── User ↔ ReadingStreak ──────────────────────────────────
User.hasOne(ReadingStreak, {
  foreignKey: "user_id",
  as: "streak",
  onDelete: "CASCADE",
});
ReadingStreak.belongsTo(User, { foreignKey: "user_id", as: "user" });

// ─── Bookmark Collections ─────────────────────────────────────
User.hasMany(BookmarkCollection, {
  foreignKey: "user_id",
  as: "collections",
  onDelete: "CASCADE",
});
BookmarkCollection.belongsTo(User, { foreignKey: "user_id", as: "user" });
BookmarkCollection.hasMany(BookmarkCollectionItem, {
  foreignKey: "collection_id",
  as: "items",
  onDelete: "CASCADE",
});
BookmarkCollectionItem.belongsTo(BookmarkCollection, {
  foreignKey: "collection_id",
  as: "collection",
});
News.hasMany(BookmarkCollectionItem, {
  foreignKey: "news_id",
  as: "collectionItems",
  onDelete: "CASCADE",
});
BookmarkCollectionItem.belongsTo(News, { foreignKey: "news_id", as: "news" });

// ─── Many-to-many shortcuts ──────────────────────────────────
User.belongsToMany(News, {
  through: Like,
  foreignKey: "user_id",
  otherKey: "news_id",
  as: "likedNews",
});
News.belongsToMany(User, {
  through: Like,
  foreignKey: "news_id",
  otherKey: "user_id",
  as: "likedBy",
});
User.belongsToMany(News, {
  through: Bookmark,
  foreignKey: "user_id",
  otherKey: "news_id",
  as: "bookmarkedNews",
});
News.belongsToMany(User, {
  through: Bookmark,
  foreignKey: "news_id",
  otherKey: "user_id",
  as: "bookmarkedBy",
});

module.exports = {
  News,
  User,
  Source,
  Comment,
  Like,
  Bookmark,
  ReadHistory,
  UserPreference,
  Impression,
  NewsReaction,
  BookmarkCollection,
  BookmarkCollectionItem,
  CrawlerSchedule,
  Notification,
  Follow,
  ReadingStreak,
  Page,
  Reward,
  AdSetting,
  LeagueStanding,
  Match,
  TopScorer,
};
