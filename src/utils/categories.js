const CANONICAL_CATEGORIES = [
  "general",
  "technology",
  "business",
  "sports",
  "world",
  "politics",
  "entertainment",
  "health",
  "science",
  "education",
  "travel",
  "local",
];

const KEYWORD_MAP = [
  {
    category: "technology",
    keywords: [
      "tech",
      "ai",
      "artificial intelligence",
      "startup",
      "gadgets",
      "cyber",
      "software",
    ],
  },
  {
    category: "business",
    keywords: [
      "business",
      "finance",
      "economy",
      "market",
      "stock",
      "trade",
      "money",
    ],
  },
  {
    category: "sports",
    keywords: [
      "sport",
      "football",
      "soccer",
      "nba",
      "nfl",
      "tennis",
      "olympic",
    ],
  },
  {
    category: "politics",
    keywords: [
      "politic",
      "election",
      "government",
      "senate",
      "president",
      "policy",
    ],
  },
  {
    category: "world",
    keywords: [
      "world",
      "international",
      "global",
      "africa",
      "europe",
      "asia",
      "middle east",
    ],
  },
  {
    category: "entertainment",
    keywords: [
      "entertainment",
      "movie",
      "film",
      "music",
      "celebrity",
      "tv",
      "series",
      "show",
      "hollywood",
      "bollywood",
    ],
  },
  {
    category: "health",
    keywords: [
      "health",
      "wellness",
      "medical",
      "medicine",
      "covid",
      "virus",
      "disease",
      "mental health",
      "fitness",
      "diet",
    ],
  },
  {
    category: "science",
    keywords: [
      "science",
      "space",
      "nasa",
      "research",
      "study",
      "physics",
      "chemistry",
      "biology",
      "astronomy",
    ],
  },
  {
    category: "education",
    keywords: [
      "education",
      "school",
      "university",
      "college",
      "student",
      "curriculum",
      "exam",
    ],
  },
  {
    category: "travel",
    keywords: [
      "travel",
      "tourism",
      "flight",
      "hotel",
      "visa",
      "destination",
      "trip",
      "holiday",
    ],
  },
  {
    category: "local",
    keywords: ["local", "city", "state", "community", "metro"],
  },
];

function cleanText(value) {
  if (!value) return "";
  const text = String(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[_/|>]+/g, " ")
    .replace(/[^a-z0-9 -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 100);
}

function toCanonicalCategory(value, fallback = "general") {
  const cleaned = cleanText(value);
  if (!cleaned) return fallback;
  if (CANONICAL_CATEGORIES.includes(cleaned)) return cleaned;

  for (const group of KEYWORD_MAP) {
    if (group.keywords.some((keyword) => cleaned.includes(keyword))) {
      return group.category;
    }
  }

  return fallback;
}

module.exports = {
  CANONICAL_CATEGORIES,
  toCanonicalCategory,
  cleanText,
};
