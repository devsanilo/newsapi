/**
 * League Controller — full sports module
 * Handles standings, fixtures, scores, live, matchdays, scorers
 */
const leagueService = require("../services/leagueService");

/* GET /api/leagues */
async function getLeagues(req, res, next) {
  try {
    res.json({ success: true, data: leagueService.getLeagues() });
  } catch (err) {
    next(err);
  }
}

/* GET /api/leagues/:code/standings */
async function getStandings(req, res, next) {
  try {
    const { code } = req.params;
    const { season } = req.query;
    const data = await leagueService.getStandings(code, {
      season: season ? Number(season) : undefined,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/* GET /api/leagues/:code/mini */
async function getMiniTable(req, res, next) {
  try {
    const { code } = req.params;
    const limit = Math.min(Number(req.query.limit) || 5, 20);
    const data = await leagueService.getMiniTable(code, limit);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/* GET /api/leagues/:code/fixtures */
async function getFixtures(req, res, next) {
  try {
    const { code } = req.params;
    const { season, matchday, limit } = req.query;
    const data = await leagueService.getFixtures(code, {
      season: season ? Number(season) : undefined,
      matchday: matchday ? Number(matchday) : undefined,
      limit: limit ? Math.min(Number(limit), 100) : 30,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/* GET /api/leagues/:code/scores */
async function getScores(req, res, next) {
  try {
    const { code } = req.params;
    const { season, matchday, limit } = req.query;
    const data = await leagueService.getScores(code, {
      season: season ? Number(season) : undefined,
      matchday: matchday ? Number(matchday) : undefined,
      limit: limit ? Math.min(Number(limit), 100) : 30,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/* GET /api/leagues/:code/live */
async function getLive(req, res, next) {
  try {
    const data = await leagueService.getLive(req.params.code);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/* GET /api/leagues/:code/matchdays */
async function getMatchdays(req, res, next) {
  try {
    const { code } = req.params;
    const { season } = req.query;
    const data = await leagueService.getMatchdays(code, {
      season: season ? Number(season) : undefined,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/* GET /api/leagues/:code/matchday/:matchday */
async function getMatchesByMatchday(req, res, next) {
  try {
    const { code, matchday } = req.params;
    const { season } = req.query;
    const data = await leagueService.getMatchesByMatchday(
      code,
      Number(matchday),
      {
        season: season ? Number(season) : undefined,
      },
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/* GET /api/leagues/:code/scorers */
async function getTopScorers(req, res, next) {
  try {
    const { code } = req.params;
    const { season, limit } = req.query;
    const data = await leagueService.getTopScorers(code, {
      season: season ? Number(season) : undefined,
      limit: limit ? Math.min(Number(limit), 50) : 20,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/* GET /api/leagues/match/:externalId */
async function getMatchDetail(req, res, next) {
  try {
    const { externalId } = req.params;
    const data = await leagueService.getMatchDetail(externalId);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/* GET /api/leagues/match/:externalId/h2h */
async function getHead2Head(req, res, next) {
  try {
    const { externalId } = req.params;
    const { limit } = req.query;
    const data = await leagueService.getHead2Head(externalId, {
      limit: limit ? Math.min(Number(limit), 20) : 10,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getLeagues,
  getStandings,
  getMiniTable,
  getFixtures,
  getScores,
  getLive,
  getMatchdays,
  getMatchesByMatchday,
  getTopScorers,
  getMatchDetail,
  getHead2Head,
};
