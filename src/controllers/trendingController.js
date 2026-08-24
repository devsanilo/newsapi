/**
 * Trending Topics Controller — extract popular keywords/topics
 */
const { sequelize } = require("../database/connection");

async function getTrendingTopics(req, res, next) {
  try {
    const hours = parseInt(req.query.hours, 10) || 24;
    const limit = Math.min(parseInt(req.query.limit, 10) || 15, 30);

    // Get categories with article counts from recent articles
    const [categories] = await sequelize.query(
      `SELECT category AS topic, COUNT(*) AS count, 'category' AS type
       FROM news
       WHERE published_at >= DATE_SUB(NOW(), INTERVAL :hours HOUR)
         AND category IS NOT NULL AND category != ''
       GROUP BY category
       ORDER BY count DESC
       LIMIT :limit`,
      { replacements: { hours, limit } },
    );

    // Get popular sources
    const [sources] = await sequelize.query(
      `SELECT source AS topic, COUNT(*) AS count, 'source' AS type
       FROM news
       WHERE published_at >= DATE_SUB(NOW(), INTERVAL :hours HOUR)
         AND source IS NOT NULL
       GROUP BY source
       ORDER BY count DESC
       LIMIT 10`,
      { replacements: { hours } },
    );

    // Extract most common words from recent titles (simple keyword extraction)
    const [recentTitles] = await sequelize.query(
      `SELECT title FROM news
       WHERE published_at >= DATE_SUB(NOW(), INTERVAL :hours HOUR)
       ORDER BY published_at DESC LIMIT 200`,
      { replacements: { hours } },
    );

    const stopWords = new Set([
      "the",
      "a",
      "an",
      "and",
      "or",
      "but",
      "in",
      "on",
      "at",
      "to",
      "for",
      "of",
      "with",
      "by",
      "from",
      "is",
      "it",
      "its",
      "this",
      "that",
      "are",
      "was",
      "were",
      "be",
      "been",
      "being",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "could",
      "should",
      "may",
      "might",
      "can",
      "not",
      "no",
      "so",
      "if",
      "than",
      "into",
      "over",
      "after",
      "before",
      "new",
      "says",
      "said",
      "also",
      "more",
      "most",
      "just",
      "about",
      "out",
      "up",
      "one",
      "two",
      "how",
      "what",
      "when",
      "where",
      "who",
      "why",
      "which",
      "their",
      "they",
      "them",
      "he",
      "she",
      "his",
      "her",
      "him",
      "we",
      "us",
      "our",
      "my",
      "your",
      "you",
      "i",
      "s",
      "t",
      "d",
      "ve",
      "re",
      "ll",
      "don",
      "won",
      "ain",
      "now",
      "get",
      "got",
      "like",
      "as",
      "all",
      "some",
      "any",
      "each",
      "every",
      "much",
      "many",
      "such",
      "own",
      "then",
    ]);

    const wordFreq = {};
    recentTitles.forEach((row) => {
      const words = (row.title || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/);
      words.forEach((w) => {
        if (w.length >= 3 && !stopWords.has(w)) {
          wordFreq[w] = (wordFreq[w] || 0) + 1;
        }
      });
    });

    const keywords = Object.entries(wordFreq)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word, count]) => ({ topic: word, count, type: "keyword" }));

    res.json({
      success: true,
      data: {
        categories,
        sources,
        keywords,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getTrendingTopics };
