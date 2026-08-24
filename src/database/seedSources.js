/**
 * News Sources Seeder
 * Seeds the `sources` table with Nigerian (local) and international news sources
 * Run: node src/database/seedSources.js
 */
require("dotenv").config();

const { v4: uuidv4 } = require("uuid");
const { sequelize } = require("./connection");
const Source = require("../models/Source");
const logger = require("../utils/logger");

const sources = [
  // ═══════════════════════════════════════════════════════════
  // 🇳🇬  NIGERIAN / LOCAL SOURCES
  // ═══════════════════════════════════════════════════════════
  {
    name: "Punch Newspapers",
    slug: "punch",
    url: "https://punchng.com",
    logo_url:
      "https://cdn.punchng.com/wp-content/uploads/2023/07/punch-logo.png",
    country: "ng",
    language: "en",
    category: "general",
    rss_url: "https://punchng.com/feed/",
    is_local: true,
    is_active: true,
    scraper_config: {
      titleSelector: "h1.post-title",
      contentSelector: ".post-content p",
      imageSelector: "meta[property='og:image']",
      imageAttr: "content",
      dynamic: false,
    },
  },
  {
    name: "Vanguard News",
    slug: "vanguard",
    url: "https://www.vanguardngr.com",
    logo_url:
      "https://www.vanguardngr.com/wp-content/uploads/2020/01/vanguard-logo.png",
    country: "ng",
    language: "en",
    category: "general",
    rss_url: "https://www.vanguardngr.com/feed/",
    is_local: true,
    is_active: true,
    scraper_config: {
      titleSelector: "h1.entry-title",
      contentSelector: ".entry-content p",
      imageSelector: "meta[property='og:image']",
      imageAttr: "content",
      dynamic: false,
    },
  },
  {
    name: "Premium Times",
    slug: "premiumtimes",
    url: "https://www.premiumtimesng.com",
    logo_url:
      "https://www.premiumtimesng.com/wp-content/uploads/2020/04/pt-logo.png",
    country: "ng",
    language: "en",
    category: "general",
    rss_url: "https://www.premiumtimesng.com/feed",
    is_local: true,
    is_active: true,
    scraper_config: {
      titleSelector: "h1.entry-title",
      contentSelector: ".entry-content p",
      imageSelector: "meta[property='og:image']",
      imageAttr: "content",
      dynamic: false,
    },
  },
  {
    name: "The Guardian Nigeria",
    slug: "guardian-ng",
    url: "https://guardian.ng",
    logo_url:
      "https://guardian.ng/wp-content/uploads/2019/10/guardian-logo.png",
    country: "ng",
    language: "en",
    category: "general",
    rss_url: "https://guardian.ng/feed/",
    is_local: true,
    is_active: true,
    scraper_config: {
      titleSelector: "h1.entry-title",
      contentSelector: ".entry-content p",
      imageSelector: "meta[property='og:image']",
      imageAttr: "content",
      dynamic: false,
    },
  },
  {
    name: "ThisDay Live",
    slug: "thisday",
    url: "https://www.thisdaylive.com",
    logo_url:
      "https://www.thisdaylive.com/wp-content/uploads/2020/01/thisday-logo.png",
    country: "ng",
    language: "en",
    category: "general",
    rss_url: "https://www.thisdaylive.com/feed",
    is_local: true,
    is_active: true,
    scraper_config: {
      titleSelector: "h1.entry-title",
      contentSelector: ".entry-content p",
      imageSelector: "meta[property='og:image']",
      imageAttr: "content",
      dynamic: false,
    },
  },
  {
    name: "Channels TV",
    slug: "channels",
    url: "https://www.channelstv.com",
    logo_url:
      "https://www.channelstv.com/wp-content/uploads/2020/04/channels-logo.png",
    country: "ng",
    language: "en",
    category: "general",
    rss_url: "https://www.channelstv.com/feed/",
    is_local: true,
    is_active: true,
    scraper_config: {
      titleSelector: "h1.post-title",
      contentSelector: ".post-content p",
      imageSelector: "meta[property='og:image']",
      imageAttr: "content",
      dynamic: false,
    },
  },
  {
    name: "Sahara Reporters",
    slug: "sahara",
    url: "http://saharareporters.com",
    logo_url: null,
    country: "ng",
    language: "en",
    category: "politics",
    rss_url: "http://saharareporters.com/rss.xml",
    is_local: true,
    is_active: true,
    scraper_config: {
      titleSelector: "h1",
      contentSelector: "article p",
      imageSelector: "meta[property='og:image']",
      imageAttr: "content",
      dynamic: false,
    },
  },
  {
    name: "Daily Trust",
    slug: "dailytrust",
    url: "https://dailytrust.com",
    logo_url: null,
    country: "ng",
    language: "en",
    category: "general",
    rss_url: "https://dailytrust.com/feed/",
    is_local: true,
    is_active: true,
    scraper_config: {
      titleSelector: "h1.entry-title",
      contentSelector: ".entry-content p",
      imageSelector: "meta[property='og:image']",
      imageAttr: "content",
      dynamic: false,
    },
  },
  {
    name: "The Nation Nigeria",
    slug: "thenation",
    url: "https://thenationonlineng.net",
    logo_url: null,
    country: "ng",
    language: "en",
    category: "general",
    rss_url: "https://thenationonlineng.net/feed/",
    is_local: true,
    is_active: true,
    scraper_config: {
      titleSelector: "h1.entry-title",
      contentSelector: ".entry-content p",
      imageSelector: "meta[property='og:image']",
      imageAttr: "content",
      dynamic: false,
    },
  },
  {
    name: "TechCabal",
    slug: "techcabal",
    url: "https://techcabal.com",
    logo_url: null,
    country: "ng",
    language: "en",
    category: "technology",
    rss_url: "https://techcabal.com/feed/",
    is_local: true,
    is_active: true,
    scraper_config: {
      titleSelector: "h1",
      contentSelector: "article p",
      imageSelector: "meta[property='og:image']",
      imageAttr: "content",
      dynamic: false,
    },
  },
  {
    name: "Nairametrics",
    slug: "nairametrics",
    url: "https://nairametrics.com",
    logo_url: null,
    country: "ng",
    language: "en",
    category: "business",
    rss_url: "https://nairametrics.com/feed/",
    is_local: true,
    is_active: true,
    scraper_config: {
      titleSelector: "h1.entry-title",
      contentSelector: ".entry-content p",
      imageSelector: "meta[property='og:image']",
      imageAttr: "content",
      dynamic: false,
    },
  },
  {
    name: "Leadership Nigeria",
    slug: "leadership",
    url: "https://leadership.ng",
    logo_url: null,
    country: "ng",
    language: "en",
    category: "politics",
    rss_url: "https://leadership.ng/feed/",
    is_local: true,
    is_active: true,
    scraper_config: {
      titleSelector: "h1.entry-title",
      contentSelector: ".entry-content p",
      imageSelector: "meta[property='og:image']",
      imageAttr: "content",
      dynamic: false,
    },
  },

  // ═══════════════════════════════════════════════════════════
  // 🌍  INTERNATIONAL SOURCES
  // ═══════════════════════════════════════════════════════════

  {
    name: "CNN",
    slug: "cnn",
    url: "https://www.cnn.com",
    logo_url:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/CNN.svg/200px-CNN.svg.png",
    country: "us",
    language: "en",
    category: "general",
    rss_url: "http://rss.cnn.com/rss/edition.rss",
    is_local: false,
    is_active: true,
    scraper_config: {
      titleSelector: "h1",
      contentSelector: ".article__content p",
      imageSelector: "meta[property='og:image']",
      imageAttr: "content",
      dynamic: false,
    },
  },

  {
    name: "Al Jazeera",
    slug: "aljazeera",
    url: "https://www.aljazeera.com",
    logo_url:
      "https://upload.wikimedia.org/wikipedia/en/thumb/f/f2/Aljazeera.svg/200px-Aljazeera.svg.png",
    country: "int",
    language: "en",
    category: "world",
    rss_url: "https://www.aljazeera.com/xml/rss/all.xml",
    is_local: false,
    is_active: true,
    scraper_config: {
      titleSelector: "h1",
      contentSelector: ".wysiwyg p",
      imageSelector: "meta[property='og:image']",
      imageAttr: "content",
      dynamic: false,
    },
  },
  {
    name: "TechCrunch",
    slug: "techcrunch",
    url: "https://techcrunch.com",
    logo_url:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/TechCrunch_logo.svg/200px-TechCrunch_logo.svg.png",
    country: "us",
    language: "en",
    category: "technology",
    rss_url: "https://techcrunch.com/feed/",
    is_local: false,
    is_active: true,
    scraper_config: {
      titleSelector: "h1.article__title",
      contentSelector: ".article-content p",
      imageSelector: "meta[property='og:image']",
      imageAttr: "content",
      dynamic: false,
    },
  },

  {
    name: "ESPN",
    slug: "espn",
    url: "https://www.espn.com",
    logo_url:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/200px-ESPN_wordmark.svg.png",
    country: "us",
    language: "en",
    category: "sports",
    rss_url: "https://www.espn.com/espn/rss/news",
    is_local: false,
    is_active: true,
    scraper_config: null,
  },
  {
    name: "The Guardian",
    slug: "guardian-uk",
    url: "https://www.theguardian.com",
    logo_url: null,
    country: "gb",
    language: "en",
    category: "general",
    rss_url: "https://www.theguardian.com/world/rss",
    is_local: false,
    is_active: true,
    scraper_config: null,
  },
  {
    name: "New York Times",
    slug: "nytimes",
    url: "https://www.nytimes.com",
    logo_url: null,
    country: "us",
    language: "en",
    category: "general",
    rss_url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
    is_local: false,
    is_active: true,
    scraper_config: null,
  },
  {
    name: "New York Times NY Region",
    slug: "nytimes-nyregion",
    url: "https://www.nytimes.com/section/nyregion",
    logo_url: null,
    country: "us",
    language: "en",
    category: "local",
    rss_url: "https://rss.nytimes.com/services/xml/rss/nyt/NYRegion.xml",
    is_local: false,
    is_active: true,
    scraper_config: null,
  },
  {
    name: "Los Angeles Times Local",
    slug: "latimes-local",
    url: "https://www.latimes.com/local",
    logo_url: null,
    country: "us",
    language: "en",
    category: "local",
    rss_url: "https://www.latimes.com/local/rss2.0.xml",
    is_local: false,
    is_active: true,
    scraper_config: null,
  },
  {
    name: "Financial Times",
    slug: "ft",
    url: "https://www.ft.com",
    logo_url:
      "https://upload.wikimedia.org/wikipedia/commons/5/5f/Financial_Times_corporate_logo.svg",
    country: "gb",
    language: "en",
    category: "business",
    rss_url: "https://www.ft.com/?format=rss",
    is_local: false,
    is_active: true,
    scraper_config: null,
  },
  {
    name: "Reuters Business",
    slug: "reuters-business",
    url: "https://www.reuters.com/business/",
    logo_url:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Reuters_Logo.svg/200px-Reuters_Logo.svg.png",
    country: "us",
    language: "en",
    category: "business",
    rss_url: "https://feeds.reuters.com/reuters/businessNews",
    is_local: false,
    is_active: true,
    scraper_config: null,
  },
  {
    name: "Politico",
    slug: "politico",
    url: "https://www.politico.com",
    logo_url:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/5/58/Politico_logo.svg/200px-Politico_logo.svg.png",
    country: "us",
    language: "en",
    category: "politics",
    rss_url: "https://www.politico.com/rss/politics08.xml",
    is_local: false,
    is_active: true,
    scraper_config: null,
  },
  {
    name: "The Hill",
    slug: "thehill",
    url: "https://thehill.com",
    logo_url:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/7/79/The_Hill_logo.svg/200px-The_Hill_logo.svg.png",
    country: "us",
    language: "en",
    category: "politics",
    rss_url: "https://thehill.com/feed",
    is_local: false,
    is_active: true,
    scraper_config: null,
  },
  {
    name: "Wired",
    slug: "wired",
    url: "https://www.wired.com",
    logo_url:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Wired_logo.svg/200px-Wired_logo.svg.png",
    country: "us",
    language: "en",
    category: "technology",
    rss_url: "https://www.wired.com/feed/rss",
    is_local: false,
    is_active: true,
    scraper_config: null,
  },
  {
    name: "Science News",
    slug: "sciencenews",
    url: "https://www.sciencenews.org",
    logo_url: null,
    country: "us",
    language: "en",
    category: "science",
    rss_url: "https://www.sciencenews.org/feed",
    is_local: false,
    is_active: true,
    scraper_config: null,
  },
  {
    name: "Nature Health Sciences",
    slug: "nature-health",
    url: "https://www.nature.com/subjects/health-sciences",
    logo_url: null,
    country: "gb",
    language: "en",
    category: "health",
    rss_url: "https://www.nature.com/subjects/health-sciences.rss",
    is_local: false,
    is_active: true,
    scraper_config: null,
  },
  {
    name: "Sky Sports",
    slug: "skysports",
    url: "https://www.skysports.com",
    logo_url: null,
    country: "gb",
    language: "en",
    category: "sports",
    rss_url: "https://www.skysports.com/rss/12040",
    is_local: false,
    is_active: true,
    scraper_config: null,
  },

  // ─── Football-Specific Sources ──────────────────────────────
  {
    name: "90min",
    slug: "90min",
    url: "https://www.90min.com",
    logo_url: "https://www.90min.com/images/90min-logo.png",
    country: "gb",
    language: "en",
    category: "sports",
    rss_url: "https://www.90min.com/posts.rss",
    is_local: false,
    is_active: true,
    scraper_config: {
      titleSelector: "h1",
      contentSelector: "article p",
      imageSelector: "meta[property='og:image']",
      imageAttr: "content",
      dynamic: false,
    },
  },
  {
    name: "FourFourTwo",
    slug: "fourfourtwo",
    url: "https://www.fourfourtwo.com",
    logo_url:
      "https://cdn.mos.cms.futurecdn.net/flexiimages/jacafc2jel1702296498.svg",
    country: "gb",
    language: "en",
    category: "sports",
    rss_url: "https://www.fourfourtwo.com/feeds.xml",
    is_local: false,
    is_active: true,
    scraper_config: {
      titleSelector: "h1",
      contentSelector: "#article-body p",
      imageSelector: "meta[property='og:image']",
      imageAttr: "content",
      dynamic: false,
    },
  },
  {
    name: "Football365",
    slug: "football365",
    url: "https://www.football365.com",
    logo_url:
      "https://www.football365.com/content/themes/flavour/assets/images/f365-logo.svg",
    country: "gb",
    language: "en",
    category: "sports",
    rss_url: "https://www.football365.com/rss",
    is_local: false,
    is_active: true,
    scraper_config: {
      titleSelector: "h1",
      contentSelector: ".article-body p, .entry-content p",
      imageSelector: "meta[property='og:image']",
      imageAttr: "content",
      dynamic: false,
    },
  },
];

/**
 * Seed all sources into the database
 */
async function seedSources() {
  try {
    await sequelize.authenticate();
    logger.info("Connected to database for seeding.");

    // Ensure table exists
    await Source.sync();

    let created = 0;
    let skipped = 0;

    for (const src of sources) {
      try {
        const [, wasCreated] = await Source.findOrCreate({
          where: { slug: src.slug },
          defaults: { id: uuidv4(), ...src },
        });
        if (wasCreated) created++;
        else skipped++;
      } catch (error) {
        logger.warn(`Skipped source "${src.name}": ${error.message}`);
        skipped++;
      }
    }

    logger.info(
      `Seeding complete: ${created} created, ${skipped} already existed.`,
    );
    return { created, skipped };
  } catch (error) {
    logger.error("Seeding failed:", error.message);
    throw error;
  }
}

// Run directly if called from CLI
if (require.main === module) {
  seedSources()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { seedSources, sources };
