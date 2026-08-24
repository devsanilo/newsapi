const { sequelize } = require("../src/database/connection");
const Source = require("../src/models/Source");

(async () => {
  await sequelize.authenticate();

  const [src, created] = await Source.findOrCreate({
    where: { slug: "bbc-football" },
    defaults: {
      name: "BBC Sport Football",
      slug: "bbc-football",
      url: "https://www.bbc.com/sport/football",
      country: "gb",
      language: "en",
      category: "sports",
      rss_url: "https://feeds.bbci.co.uk/sport/football/rss.xml",
      scraper_config: {
        dynamic: false,
        titleSelector: "h1",
        contentSelector: "article p",
        imageSelector: "meta[property='og:image']",
        imageAttr: "content",
        descriptionSelector: "meta[property='og:description']",
        descriptionAttr: "content",
      },
      is_active: true,
      is_local: false,
    },
  });

  console.log(created ? "CREATED" : "ALREADY EXISTS");
  console.log(JSON.stringify(src.toJSON(), null, 2));
  process.exit();
})();
