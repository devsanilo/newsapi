/**
 * LeagueService — full sports module
 *
 * Fetches & caches league standings, fixtures, and scores
 * from football-data.org (free tier: 10 req/min, 12 competitions).
 *
 * Endpoints used:
 *   GET /v4/competitions/{code}/standings
 *   GET /v4/competitions/{code}/matches
 *   GET /v4/competitions/{code}/scorers
 */
const axios = require("axios");
const dns = require("dns");
const https = require("https");
const { Op } = require("sequelize");
const { sequelize } = require("../database/connection");
const LeagueStanding = require("../models/LeagueStanding");

// Custom DNS resolver — fallback to Google DNS (8.8.8.8) when local DNS fails
const resolver = new dns.Resolver();
resolver.setServers(["8.8.8.8", "8.8.4.4"]);

let cachedIp = null;
async function resolveFootballApi() {
  if (cachedIp) return cachedIp;
  try {
    const addrs = await new Promise((resolve, reject) =>
      resolver.resolve4("api.football-data.org", (err, a) =>
        err ? reject(err) : resolve(a),
      ),
    );
    cachedIp = addrs[0];
    // Refresh every 10 min
    setTimeout(
      () => {
        cachedIp = null;
      },
      10 * 60 * 1000,
    );
    return cachedIp;
  } catch {
    return null;
  }
}

// Helper: build axios config with resolved IP
async function footballAxiosConfig(apiKey, timeoutMs = 10000) {
  const ip = await resolveFootballApi();
  const config = {
    headers: { "X-Auth-Token": apiKey },
    timeout: timeoutMs,
  };
  if (ip) {
    config.httpsAgent = new https.Agent({
      lookup: (hostname, options, cb) => {
        if (typeof options === "function") {
          cb = options;
          options = {};
        }
        if (options.all) {
          cb(null, [{ address: ip, family: 4 }]);
        } else {
          cb(null, ip, 4);
        }
      },
    });
  }
  return config;
}
const Match = require("../models/Match");
const TopScorer = require("../models/TopScorer");
const logger = require("../utils/logger");

// ─── Supported competitions (free tier covers 12) ─────────────
const LEAGUES = {
  PL: {
    name: "Premier League",
    country: "England",
    emblem: "https://crests.football-data.org/PL.png",
  },
  CL: {
    name: "Champions League",
    country: "Europe",
    emblem: "https://crests.football-data.org/CL.png",
  },
  PD: {
    name: "La Liga",
    country: "Spain",
    emblem: "https://crests.football-data.org/laliga.png",
  },
  SA: {
    name: "Serie A",
    country: "Italy",
    emblem: "https://crests.football-data.org/c111.png",
  },
  BL1: {
    name: "Bundesliga",
    country: "Germany",
    emblem: "https://crests.football-data.org/BL1.png",
  },
  FL1: {
    name: "Ligue 1",
    country: "France",
    emblem: "https://crests.football-data.org/FL1.png",
  },
  PPL: {
    name: "Primeira Liga",
    country: "Portugal",
    emblem: "https://crests.football-data.org/PPL.png",
  },
  ELC: {
    name: "Championship",
    country: "England",
    emblem: "https://crests.football-data.org/ELC.png",
  },
  DED: {
    name: "Eredivisie",
    country: "Netherlands",
    emblem: "https://crests.football-data.org/ED.png",
  },
  BSA: {
    name: "Série A",
    country: "Brazil",
    emblem: "https://crests.football-data.org/bsa.png",
  },
  WC: {
    name: "World Cup",
    country: "International",
    emblem: "https://crests.football-data.org/qatar.png",
  },
  EC: {
    name: "European Championship",
    country: "Europe",
    emblem: "https://crests.football-data.org/ec.png",
  },
};

const API_BASE = "https://api.football-data.org/v4";
const STANDINGS_CACHE_MS = 30 * 60 * 1000; // 30 min
const MATCHES_CACHE_MS = 15 * 60 * 1000; // 15 min (scores delayed on free tier)
const SCORERS_CACHE_MS = 60 * 60 * 1000; // 60 min
const MATCH_DETAIL_CACHE_MS = 30 * 60 * 1000; // 30 min — single match detail
const CIRCUIT_BREAK_MS = 5 * 60 * 1000; // 5 min — skip API calls after failure

// In-memory cache for match details (keyed by external_id)
const matchDetailCache = new Map();

let circuitOpenUntil = 0; // timestamp when circuit breaker resets

class LeagueService {
  // ═══════════════════════════════════════════════════════════
  //  PUBLIC: LEAGUES
  // ═══════════════════════════════════════════════════════════

  getLeagues() {
    return Object.entries(LEAGUES).map(([code, info]) => ({ code, ...info }));
  }

  _currentSeason() {
    const now = new Date();
    return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  }

  _validateCode(code) {
    const c = (code || "PL").toUpperCase();
    if (!LEAGUES[c]) {
      const err = new Error(`Unsupported league: ${c}`);
      err.status = 400;
      throw err;
    }
    return c;
  }

  /**
   * Fetch from football-data API with automatic 404 retry and backoff.
   * Some competitions (CL, WC, EC) don't accept ?season=YYYY,
   * so on 404 we retry without the season parameter.
   */
  async _fetchApi(path, season, extraParams = "", timeoutMs = 15000) {
    const apiKey = process.env.FOOTBALL_DATA_API_KEY;
    if (!apiKey) return null;

    // ── Circuit breaker: skip API if it recently failed ──
    if (Date.now() < circuitOpenUntil) {
      const secsLeft = Math.round((circuitOpenUntil - Date.now()) / 1000);
      logger.info(`Circuit open – skipping ${path} (retry in ${secsLeft}s)`);
      return null;
    }

    const sep = path.includes("?") ? "&" : "?";
    const seasonParam = season ? `season=${season}` : "";
    const extra = extraParams ? `&${extraParams}` : "";
    const urlWithSeason = `${API_BASE}${path}${sep}${seasonParam}${extra}`;

    try {
      const cfg = await footballAxiosConfig(apiKey, timeoutMs);
      const { data } = await axios.get(urlWithSeason, cfg);
      circuitOpenUntil = 0; // success → reset breaker
      return data;
    } catch (err) {
      // If 404, retry without season param (CL, WC, EC)
      if (err.response?.status === 404 && seasonParam) {
        logger.info(
          `Retrying ${path} without season param (got 404 for season=${season})`,
        );
        try {
          const cfg = await footballAxiosConfig(apiKey, timeoutMs);
          const urlNoSeason = extraParams
            ? `${API_BASE}${path}${sep}${extraParams}`
            : `${API_BASE}${path}`;
          const { data } = await axios.get(urlNoSeason, cfg);
          circuitOpenUntil = 0;
          return data;
        } catch (inner) {
          err = inner; // fall through to breaker below
        }
      }

      // Connection / timeout errors → open circuit breaker
      if (
        err.code === "ECONNABORTED" ||
        err.code === "ETIMEDOUT" ||
        err.code === "ENOTFOUND" ||
        err.code === "ECONNREFUSED" ||
        err.code === "ECONNRESET" ||
        err.message?.includes("timeout")
      ) {
        circuitOpenUntil = Date.now() + CIRCUIT_BREAK_MS;
        logger.warn(
          `Circuit breaker OPEN for 5 min after ${path}: ${err.message}`,
        );
        return null; // don't throw — callers return cached/empty data
      }

      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC: STANDINGS
  // ═══════════════════════════════════════════════════════════

  async getStandings(leagueCode, { season } = {}) {
    const code = this._validateCode(leagueCode);
    const yr = season || this._currentSeason();

    // Check freshness
    const fresh = await LeagueStanding.findOne({
      where: {
        league_code: code,
        season: yr,
        fetched_at: { [Op.gte]: new Date(Date.now() - STANDINGS_CACHE_MS) },
      },
    });
    if (!fresh) await this._fetchStandings(code, yr);

    const rows = await LeagueStanding.findAll({
      where: { league_code: code, season: yr },
      order: [
        ["group", "ASC"],
        ["position", "ASC"],
      ],
    });

    const grouped = {};
    for (const r of rows) {
      const g = r.group || "TOTAL";
      if (!grouped[g]) grouped[g] = [];
      grouped[g].push(this._fmtStanding(r));
    }

    return {
      league: { code, ...LEAGUES[code] },
      season: yr,
      standings: grouped,
    };
  }

  async getMiniTable(leagueCode, limit = 5) {
    const data = await this.getStandings(leagueCode);
    const first = Object.keys(data.standings)[0];
    return {
      league: data.league,
      season: data.season,
      table: (data.standings[first] || []).slice(0, limit),
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC: FIXTURES (upcoming)
  // ═══════════════════════════════════════════════════════════

  async getFixtures(leagueCode, { season, matchday, limit = 30 } = {}) {
    const code = this._validateCode(leagueCode);
    const yr = season || this._currentSeason();

    await this._ensureMatchesFresh(code, yr);

    const where = {
      league_code: code,
      season: yr,
      status: { [Op.in]: ["SCHEDULED", "TIMED"] },
    };
    if (matchday) where.matchday = matchday;

    const rows = await Match.findAll({
      where,
      order: [["utc_date", "ASC"]],
      limit,
    });

    return {
      league: { code, ...LEAGUES[code] },
      season: yr,
      matches: rows.map(this._fmtMatch),
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC: SCORES / RESULTS (finished)
  // ═══════════════════════════════════════════════════════════

  async getScores(leagueCode, { season, matchday, limit = 30 } = {}) {
    const code = this._validateCode(leagueCode);
    const yr = season || this._currentSeason();

    await this._ensureMatchesFresh(code, yr);

    const where = {
      league_code: code,
      season: yr,
      status: "FINISHED",
    };
    if (matchday) where.matchday = matchday;

    const rows = await Match.findAll({
      where,
      order: [["utc_date", "DESC"]],
      limit,
    });

    return {
      league: { code, ...LEAGUES[code] },
      season: yr,
      matches: rows.map(this._fmtMatch),
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC: LIVE / IN-PLAY
  // ═══════════════════════════════════════════════════════════

  async getLive(leagueCode) {
    const code = this._validateCode(leagueCode);
    const yr = this._currentSeason();

    await this._ensureMatchesFresh(code, yr);

    const rows = await Match.findAll({
      where: {
        league_code: code,
        season: yr,
        status: { [Op.in]: ["IN_PLAY", "PAUSED"] },
      },
      order: [["utc_date", "ASC"]],
    });

    return {
      league: { code, ...LEAGUES[code] },
      season: yr,
      matches: rows.map(this._fmtMatch),
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC: MATCHDAYS list
  // ═══════════════════════════════════════════════════════════

  async getMatchdays(leagueCode, { season } = {}) {
    const code = this._validateCode(leagueCode);
    const yr = season || this._currentSeason();

    await this._ensureMatchesFresh(code, yr);

    const [rows] = await sequelize.query(
      `SELECT DISTINCT matchday, 
              MIN(utc_date) AS first_match,
              SUM(CASE WHEN status = 'FINISHED' THEN 1 ELSE 0 END) AS finished,
              COUNT(*) AS total
       FROM matches
       WHERE league_code = :code AND season = :yr AND matchday IS NOT NULL
       GROUP BY matchday
       ORDER BY matchday ASC`,
      { replacements: { code, yr } },
    );

    // Determine current matchday (first incomplete one)
    let currentMatchday = null;
    for (const r of rows) {
      if (Number(r.finished) < Number(r.total)) {
        currentMatchday = r.matchday;
        break;
      }
    }
    if (!currentMatchday && rows.length) {
      currentMatchday = rows[rows.length - 1].matchday;
    }

    return {
      league: { code, ...LEAGUES[code] },
      season: yr,
      currentMatchday,
      matchdays: rows.map((r) => ({
        matchday: r.matchday,
        firstMatch: r.first_match,
        finished: Number(r.finished),
        total: Number(r.total),
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC: matches by matchday (both fixtures & results)
  // ═══════════════════════════════════════════════════════════

  async getMatchesByMatchday(leagueCode, matchday, { season } = {}) {
    const code = this._validateCode(leagueCode);
    const yr = season || this._currentSeason();

    await this._ensureMatchesFresh(code, yr);

    const rows = await Match.findAll({
      where: { league_code: code, season: yr, matchday },
      order: [["utc_date", "ASC"]],
    });

    return {
      league: { code, ...LEAGUES[code] },
      season: yr,
      matchday,
      matches: rows.map(this._fmtMatch),
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC: TOP SCORERS
  // ═══════════════════════════════════════════════════════════

  async getTopScorers(leagueCode, { season, limit = 20 } = {}) {
    const code = this._validateCode(leagueCode);
    const yr = season || this._currentSeason();

    // Check cache freshness
    const fresh = await TopScorer.findOne({
      where: {
        league_code: code,
        season: yr,
        fetched_at: { [Op.gte]: new Date(Date.now() - SCORERS_CACHE_MS) },
      },
    });
    if (!fresh) await this._fetchScorers(code, yr);

    const rows = await TopScorer.findAll({
      where: { league_code: code, season: yr },
      order: [["rank", "ASC"]],
      limit,
    });

    const scorers = rows.map(this._fmtScorer);
    return { league: { code, ...LEAGUES[code] }, season: yr, scorers };
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC: SINGLE MATCH DETAIL (goals, bookings, lineups)
  // ═══════════════════════════════════════════════════════════

  async getMatchDetail(externalId) {
    if (!externalId || isNaN(Number(externalId))) {
      const err = new Error("Invalid match ID");
      err.status = 400;
      throw err;
    }

    const id = Number(externalId);

    // Check in-memory cache
    const cached = matchDetailCache.get(id);
    if (cached && Date.now() - cached.fetchedAt < MATCH_DETAIL_CACHE_MS) {
      return cached.data;
    }

    // Fetch from football-data.org
    const apiKey = process.env.FOOTBALL_DATA_API_KEY;
    if (!apiKey) {
      const err = new Error("Match detail not available (no API key)");
      err.status = 503;
      throw err;
    }

    try {
      const cfg = await footballAxiosConfig(apiKey, 15000);
      const { data } = await axios.get(`${API_BASE}/matches/${id}`, cfg);

      const detail = this._fmtMatchDetail(data);

      // Cache it
      matchDetailCache.set(id, { data: detail, fetchedAt: Date.now() });

      // Evict old entries (keep max 100)
      if (matchDetailCache.size > 100) {
        const oldest = [...matchDetailCache.entries()].sort(
          (a, b) => a[1].fetchedAt - b[1].fetchedAt,
        )[0];
        if (oldest) matchDetailCache.delete(oldest[0]);
      }

      return detail;
    } catch (err) {
      if (err.response?.status === 404) {
        const e = new Error("Match not found");
        e.status = 404;
        throw e;
      }
      logger.error(`Failed to fetch match detail ${id}: ${err.message}`);
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC: HEAD-TO-HEAD
  // ═══════════════════════════════════════════════════════════

  async getHead2Head(externalId, { limit = 10 } = {}) {
    if (!externalId || isNaN(Number(externalId))) {
      const err = new Error("Invalid match ID");
      err.status = 400;
      throw err;
    }

    const id = Number(externalId);
    const apiKey = process.env.FOOTBALL_DATA_API_KEY;
    if (!apiKey) {
      const err = new Error("Head-to-head not available (no API key)");
      err.status = 503;
      throw err;
    }

    try {
      const cfg = await footballAxiosConfig(apiKey, 15000);
      const { data } = await axios.get(
        `${API_BASE}/matches/${id}/head2head?limit=${limit}`,
        cfg,
      );

      return {
        aggregates: data.aggregates || {},
        matches: (data.matches || []).map((m) => ({
          id: m.id,
          utcDate: m.utcDate,
          status: m.status,
          matchday: m.matchday,
          stage: m.stage,
          homeTeam: {
            id: m.homeTeam?.id,
            name: m.homeTeam?.name,
            short: m.homeTeam?.tla,
            crest: m.homeTeam?.crest,
          },
          awayTeam: {
            id: m.awayTeam?.id,
            name: m.awayTeam?.name,
            short: m.awayTeam?.tla,
            crest: m.awayTeam?.crest,
          },
          score: {
            home: m.score?.fullTime?.home ?? null,
            away: m.score?.fullTime?.away ?? null,
            winner: m.score?.winner,
          },
          competition: {
            name: m.competition?.name,
            emblem: m.competition?.emblem,
          },
        })),
      };
    } catch (err) {
      logger.error(`Failed to fetch h2h for match ${id}: ${err.message}`);
      return { aggregates: {}, matches: [] };
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  INTERNAL: fetch & store standings
  // ═══════════════════════════════════════════════════════════

  async _fetchStandings(code, season) {
    try {
      const data = await this._fetchApi(
        `/competitions/${code}/standings`,
        season,
      );
      if (!data) {
        logger.warn("FOOTBALL_DATA_API_KEY not set — cached standings only");
        return;
      }

      const rows = [];
      for (const table of data.standings || []) {
        // Skip HOME / AWAY splits — only keep TOTAL
        if (table.type && table.type !== "TOTAL") continue;
        const groupName = table.group || null;
        for (const e of table.table || []) {
          rows.push({
            league_code: code,
            league_name: LEAGUES[code].name,
            season,
            group: groupName,
            position: e.position,
            team_id: e.team.id,
            team_name: e.team.name,
            team_short: e.team.tla,
            team_crest: e.team.crest,
            played: e.playedGames,
            won: e.won,
            draw: e.draw,
            lost: e.lost,
            goals_for: e.goalsFor,
            goals_against: e.goalsAgainst,
            goal_difference: e.goalDifference,
            points: e.points,
            form: e.form,
            fetched_at: new Date(),
          });
        }
      }

      if (rows.length === 0) return;

      await sequelize.transaction(async (t) => {
        await LeagueStanding.destroy({
          where: { league_code: code, season },
          transaction: t,
        });
        await LeagueStanding.bulkCreate(rows, { transaction: t });
      });

      logger.info(`Stored ${rows.length} standings for ${code} ${season}`);
    } catch (err) {
      logger.error(`Failed to fetch standings for ${code}: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  INTERNAL: fetch & store matches (fixtures + results)
  // ═══════════════════════════════════════════════════════════

  async _ensureMatchesFresh(code, season) {
    const fresh = await Match.findOne({
      where: {
        league_code: code,
        season,
        fetched_at: { [Op.gte]: new Date(Date.now() - MATCHES_CACHE_MS) },
      },
    });
    if (!fresh) await this._fetchMatches(code, season);
  }

  async _fetchMatches(code, season) {
    try {
      const data = await this._fetchApi(
        `/competitions/${code}/matches`,
        season,
        "",
        15000,
      );
      if (!data) {
        logger.warn("FOOTBALL_DATA_API_KEY not set — cached matches only");
        return;
      }

      const rows = [];
      for (const m of data.matches || []) {
        rows.push({
          league_code: code,
          league_name: LEAGUES[code].name,
          season,
          matchday: m.matchday,
          stage: m.stage,
          group: m.group,
          external_id: m.id,
          status: m.status,
          utc_date: new Date(m.utcDate),
          home_team_id: m.homeTeam?.id || 0,
          home_team_name: m.homeTeam?.name || "TBD",
          home_team_short: m.homeTeam?.tla,
          home_team_crest: m.homeTeam?.crest,
          away_team_id: m.awayTeam?.id || 0,
          away_team_name: m.awayTeam?.name || "TBD",
          away_team_short: m.awayTeam?.tla,
          away_team_crest: m.awayTeam?.crest,
          home_score: m.score?.fullTime?.home ?? null,
          away_score: m.score?.fullTime?.away ?? null,
          home_ht_score: m.score?.halfTime?.home ?? null,
          away_ht_score: m.score?.halfTime?.away ?? null,
          winner: m.score?.winner,
          duration: m.score?.duration,
          venue: m.venue,
          referee_name: m.referees?.[0]?.name || null,
          fetched_at: new Date(),
        });
      }

      if (rows.length === 0) return;

      await sequelize.transaction(async (t) => {
        await Match.destroy({
          where: { league_code: code, season },
          transaction: t,
        });
        await Match.bulkCreate(rows, { transaction: t });
      });

      logger.info(`Stored ${rows.length} matches for ${code} ${season}`);
    } catch (err) {
      logger.error(`Failed to fetch matches for ${code}: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  INTERNAL: fetch & store top scorers
  // ═══════════════════════════════════════════════════════════

  async _fetchScorers(code, season) {
    try {
      const data = await this._fetchApi(
        `/competitions/${code}/scorers`,
        season,
        "limit=50",
      );
      if (!data) {
        logger.warn("FOOTBALL_DATA_API_KEY not set — cached scorers only");
        return;
      }

      const rows = (data.scorers || []).map((s, idx) => ({
        league_code: code,
        league_name: LEAGUES[code].name,
        season,
        rank: idx + 1,
        player_id: s.player?.id || 0,
        player_name: s.player?.name || "Unknown",
        player_nationality: s.player?.nationality || null,
        player_position: s.player?.position || null,
        player_dob: s.player?.dateOfBirth || null,
        team_id: s.team?.id || 0,
        team_name: s.team?.name || "Unknown",
        team_short: s.team?.tla || null,
        team_crest: s.team?.crest || null,
        goals: s.goals || 0,
        assists: s.assists || 0,
        penalties: s.penalties || 0,
        played_matches: s.playedMatches || 0,
        fetched_at: new Date(),
      }));

      if (rows.length === 0) return;

      await sequelize.transaction(async (t) => {
        await TopScorer.destroy({
          where: { league_code: code, season },
          transaction: t,
        });
        await TopScorer.bulkCreate(rows, { transaction: t });
      });

      logger.info(`Stored ${rows.length} scorers for ${code} ${season}`);
    } catch (err) {
      logger.error(`Failed to fetch scorers for ${code}: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  FORMAT HELPERS
  // ═══════════════════════════════════════════════════════════

  _fmtScorer(r) {
    return {
      player: {
        id: r.player_id,
        name: r.player_name,
        nationality: r.player_nationality,
        position: r.player_position,
        dateOfBirth: r.player_dob,
      },
      team: {
        id: r.team_id,
        name: r.team_name,
        short: r.team_short,
        crest: r.team_crest,
      },
      goals: r.goals,
      assists: r.assists,
      penalties: r.penalties,
      playedMatches: r.played_matches,
    };
  }

  _fmtStanding(r) {
    return {
      position: r.position,
      team: {
        id: r.team_id,
        name: r.team_name,
        short: r.team_short,
        crest: r.team_crest,
      },
      played: r.played,
      won: r.won,
      draw: r.draw,
      lost: r.lost,
      goalsFor: r.goals_for,
      goalsAgainst: r.goals_against,
      goalDifference: r.goal_difference,
      points: r.points,
      form: r.form,
    };
  }

  _fmtMatch(r) {
    return {
      id: r.id,
      externalId: r.external_id,
      matchday: r.matchday,
      stage: r.stage,
      group: r.group,
      status: r.status,
      utcDate: r.utc_date,
      homeTeam: {
        id: r.home_team_id,
        name: r.home_team_name,
        short: r.home_team_short,
        crest: r.home_team_crest,
      },
      awayTeam: {
        id: r.away_team_id,
        name: r.away_team_name,
        short: r.away_team_short,
        crest: r.away_team_crest,
      },
      score: {
        home: r.home_score,
        away: r.away_score,
        htHome: r.home_ht_score,
        htAway: r.away_ht_score,
        winner: r.winner,
        duration: r.duration,
      },
      venue: r.venue,
      referee: r.referee_name,
    };
  }

  /**
   * Format a single match detail response from football-data.org /v4/matches/{id}
   * Extracts goals, bookings, substitutions, lineups, referees, etc.
   */
  _fmtMatchDetail(m) {
    const fmtTeam = (t) => ({
      id: t?.id,
      name: t?.name || "TBD",
      short: t?.tla,
      crest: t?.crest,
      coach: t?.coach?.name || null,
      formation: t?.formation || null,
      lineup: (t?.lineup || []).map((p) => ({
        id: p.id,
        name: p.name,
        position: p.position,
        shirtNumber: p.shirtNumber,
      })),
      bench: (t?.bench || []).map((p) => ({
        id: p.id,
        name: p.name,
        position: p.position,
        shirtNumber: p.shirtNumber,
      })),
    });

    return {
      id: m.id,
      utcDate: m.utcDate,
      status: m.status,
      matchday: m.matchday,
      stage: m.stage,
      group: m.group,
      venue: m.venue,
      attendance: m.attendance || null,
      competition: {
        name: m.competition?.name,
        code: m.competition?.code,
        emblem: m.competition?.emblem,
      },
      season: m.season?.startDate
        ? new Date(m.season.startDate).getFullYear()
        : null,
      score: {
        home: m.score?.fullTime?.home ?? null,
        away: m.score?.fullTime?.away ?? null,
        htHome: m.score?.halfTime?.home ?? null,
        htAway: m.score?.halfTime?.away ?? null,
        etHome: m.score?.extraTime?.home ?? null,
        etAway: m.score?.extraTime?.away ?? null,
        penHome: m.score?.penalties?.home ?? null,
        penAway: m.score?.penalties?.away ?? null,
        winner: m.score?.winner,
        duration: m.score?.duration,
      },
      homeTeam: fmtTeam(m.homeTeam),
      awayTeam: fmtTeam(m.awayTeam),
      goals: (m.goals || []).map((g) => ({
        minute: g.minute,
        injuryTime: g.injuryTime || null,
        type: g.type || "REGULAR", // REGULAR, OWN, PENALTY
        team: g.team?.name || null,
        teamId: g.team?.id || null,
        scorer: {
          id: g.scorer?.id,
          name: g.scorer?.name || "Unknown",
        },
        assist: g.assist
          ? {
              id: g.assist.id,
              name: g.assist.name,
            }
          : null,
      })),
      bookings: (m.bookings || []).map((b) => ({
        minute: b.minute,
        injuryTime: b.injuryTime || null,
        card: b.card, // YELLOW, YELLOW_RED, RED
        team: b.team?.name || null,
        teamId: b.team?.id || null,
        player: {
          id: b.player?.id,
          name: b.player?.name || "Unknown",
        },
      })),
      substitutions: (m.substitutions || []).map((s) => ({
        minute: s.minute,
        team: s.team?.name || null,
        teamId: s.team?.id || null,
        playerIn: {
          id: s.playerIn?.id,
          name: s.playerIn?.name || "Unknown",
        },
        playerOut: {
          id: s.playerOut?.id,
          name: s.playerOut?.name || "Unknown",
        },
      })),
      referees: (m.referees || []).map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type, // REFEREE, ASSISTANT_REFEREE_N1/2, FOURTH_OFFICIAL, VIDEO_ASSISTANT_REFEREE_N1/2
        nationality: r.nationality,
      })),
    };
  }
}

module.exports = new LeagueService();
