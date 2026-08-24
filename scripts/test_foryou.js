const { sequelize } = require("../src/database/connection");
const { News, UserPreference } = require("../src/models");
const { Op } = require("sequelize");

(async () => {
  const userId = "e0119a40-bf3f-4c8a-8fa0-15bf3dbd7468";
  const prefs = await UserPreference.findOne({
    where: { user_id: userId },
    raw: true,
  });

  const cats =
    typeof prefs.preferred_categories === "string"
      ? JSON.parse(prefs.preferred_categories)
      : prefs.preferred_categories || [];
  const srcs =
    typeof prefs.preferred_sources === "string"
      ? JSON.parse(prefs.preferred_sources)
      : prefs.preferred_sources || [];
  const langs =
    typeof prefs.preferred_languages === "string"
      ? JSON.parse(prefs.preferred_languages)
      : prefs.preferred_languages || ["en"];

  console.log("User prefs - cats:", cats, "| srcs:", srcs, "| langs:", langs);

  // Build WHERE like getForYou does
  const conditions = [];
  if (cats.length > 0) conditions.push({ category: { [Op.in]: cats } });
  if (srcs.length > 0) conditions.push({ source: { [Op.in]: srcs } });

  const where = conditions.length > 0 ? { [Op.or]: conditions } : {};
  if (langs.length > 0) where.language = { [Op.in]: langs };

  const result = await News.findAll({
    where,
    order: [["published_at", "DESC"]],
    limit: 15,
    raw: true,
    attributes: ["id", "title", "category", "source"],
  });

  console.log("\nFor-You results (" + result.length + "):");
  result.forEach((r) =>
    console.log(
      "  [" +
        r.category +
        "] " +
        r.source +
        " — " +
        (r.title || "").substring(0, 60),
    ),
  );

  // Check if preferred sources actually exist in DB
  const [allSources] = await sequelize.query(
    "SELECT source, COUNT(*) as cnt FROM news GROUP BY source ORDER BY cnt DESC LIMIT 25",
  );
  console.log("\nTop 25 sources in DB:");
  allSources.forEach((s) => console.log("  " + s.source + " (" + s.cnt + ")"));

  // Check if user's preferred sources match
  if (srcs.length > 0) {
    const [matchingSrcs] = await sequelize.query(
      "SELECT DISTINCT source FROM news WHERE source IN (:srcs)",
      { replacements: { srcs } },
    );
    console.log(
      "\nUser source matches in DB:",
      matchingSrcs.map((s) => s.source),
    );
  }

  process.exit(0);
})();
