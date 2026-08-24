/**
 * League Routes — full sports module
 */
const { Router } = require("express");
const c = require("../controllers/leagueController");
const { optionalAuth } = require("../middleware/auth");

const router = Router();

// ── Match detail routes (must be before /:code routes) ──
router.get("/match/:externalId", optionalAuth, c.getMatchDetail);
router.get("/match/:externalId/h2h", optionalAuth, c.getHead2Head);

router.get("/", c.getLeagues);
router.get("/:code/standings", optionalAuth, c.getStandings);
router.get("/:code/mini", optionalAuth, c.getMiniTable);
router.get("/:code/fixtures", optionalAuth, c.getFixtures);
router.get("/:code/scores", optionalAuth, c.getScores);
router.get("/:code/live", optionalAuth, c.getLive);
router.get("/:code/matchdays", optionalAuth, c.getMatchdays);
router.get("/:code/matchday/:matchday", optionalAuth, c.getMatchesByMatchday);
router.get("/:code/scorers", optionalAuth, c.getTopScorers);

module.exports = router;
