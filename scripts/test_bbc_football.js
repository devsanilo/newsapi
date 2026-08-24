/**
 * Quick test: crawl only the bbc-football source and report results.
 */
const { sequelize } = require("../src/database/connection");
const rssCrawler = require("../src/crawlers/rssCrawler");
const newsService = require("../src/services/newsService");

(async () => {
  await sequelize.authenticate();

  const feedConfig = {
    name: "BBC Sport Football",
    source: "bbc-football",
    category: "sports",
    url: "http://feeds.bbci.co.uk/sport/football/rss.xml",
    language: "en",
  };

  console.log("Fetching BBC Sport Football RSS feed...");
  const articles = await rssCrawler.fetchFeed(feedConfig);
  console.log(`Fetched ${articles.length} articles`);

  if (articles.length > 0) {
    console.log("\nSample titles:");
    articles.slice(0, 5).forEach((a, i) => {
      console.log(`  ${i + 1}. ${a.title}`);
    });

    console.log("\nStoring articles...");
    const result = await newsService.storeArticles(articles);
    console.log("Store result:", JSON.stringify(result));
  }

  process.exit();
})();
