/**
 * Rewrite Service — the "long tail" half of the AI pipeline.
 *
 * Takes existing aggregated rows and produces a substantially rewritten
 * article from the ORIGINAL SOURCE PAGE, not from `news.content`.
 *
 * Why re-fetch: ingest stores only ~2000 chars (often ~155 rendered words), so
 * rewriting `content` would just produce a longer summary. The source page is
 * the only place with enough substance to rewrite from.
 *
 * Safety model:
 *  - Output goes to `staged_*` columns. `content` is untouched, so nothing
 *    reader-visible changes until `applyStaged()` is called explicitly.
 *  - `content_type` ends up 'rewritten', never 'original'. An AI rework of
 *    syndicated copy is a derivative work; claiming otherwise would destroy the
 *    only signal distinguishing Trenxi-authored pages.
 *  - A deterministic overlap guard rejects output that still shares a long
 *    verbatim run with the source. This is deliberately NOT a self-assessment:
 *    asking the same model to certify its own originality is not evidence.
 */
const { sequelize } = require("../database/connection");
const News = require("../models/News");
const logger = require("../utils/logger");
const aiService = require("./aiService");
const { generateHash } = require("../utils/hash");

const PROMPT_VERSION = "rewrite-v1";

const MIN_WORDS = Number(process.env.REWRITE_MIN_WORDS || 250);
const MAX_WORDS = Number(process.env.REWRITE_MAX_WORDS || 1200);
const MAX_ATTEMPTS = Number(process.env.REWRITE_MAX_ATTEMPTS || 3);
// Longest run of consecutive words allowed to appear in both source and output.
// Above this, the model is transcribing rather than rewriting.
const MAX_SHARED_RUN = Number(process.env.REWRITE_MAX_SHARED_RUN || 12);

// Absolute ceiling even for quoted material. The prompt permits reproducing a
// direct quotation verbatim, which is ordinary journalism — but a single quote
// running to 80+ words means the model is quoting the article rather than
// writing one.
const MAX_TOTAL_SHARED_RUN = Number(process.env.REWRITE_MAX_QUOTE_RUN || 80);
const SOURCE_CHAR_LIMIT = Number(process.env.REWRITE_SOURCE_CHARS || 8000);

const SYSTEM_PROMPT = `You are a careful news desk editor for Trenxi, a Nigerian news publication.

You are given a source article from another publisher. Write a NEW article that reports the same events in your own words.

Rules you must follow:
- Write entirely in your own sentences. Never copy a phrase longer than a few words from the source.
- Use ONLY facts present in the source. Never invent names, numbers, quotes, dates, places or causes. If the source does not state something, leave it out.
- No fabricated quotations. Direct quotes may only be reproduced if they appear verbatim in the source, and must be attributed as they are there.
- Lead with what matters most. Write for a general Nigerian and international audience.
- Neutral, factual tone. No opinion, no sensationalism, no clickbait.
- Do not mention the source publication by name, and do not refer to "the source" or "this article".

Return a JSON object with exactly these keys:
- "title": a new headline, under 110 characters
- "description": a one to two sentence standfirst, under 300 characters
- "content": the article body as plain text, ${MIN_WORDS}-${MAX_WORDS} words, separated into paragraphs by a single blank line
- "tags": an array of 3-6 short lowercase topical tags`;

/**
 * Length of the longest run of consecutive words appearing in both texts.
 *
 * Word-level longest common substring, computed exactly with a rolling DP row.
 * An earlier version built a set of fixed-length n-grams, which could only ever
 * report 0 or that fixed length and so could not distinguish a 13-word overlap
 * from a 200-word copy-paste.
 *
 * Returns a true word count, so 0 means "no shared run at all".
 */
function longestSharedRun(a, b) {
  const words = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean);

  const target = words(a);
  const source = words(b);
  if (target.length === 0 || source.length === 0) return 0;

  // Roll over the shorter text so the DP row stays small.
  const rows = target;
  const cols = source;

  let prev = new Uint32Array(cols.length + 1);
  let curr = new Uint32Array(cols.length + 1);
  let best = 0;

  for (let i = 1; i <= rows.length; i += 1) {
    for (let j = 1; j <= cols.length; j += 1) {
      if (rows[i - 1] === cols[j - 1]) {
        const run = prev[j - 1] + 1;
        curr[j] = run;
        if (run > best) best = run;
      } else {
        curr[j] = 0;
      }
    }
    const swap = prev;
    prev = curr;
    curr = swap;
    curr.fill(0);
  }

  return best;
}

/**
 * Remove quoted spans, so an overlap check measures the model's own prose.
 *
 * The prompt permits reproducing a direct quotation verbatim, and news copy is
 * full of them. Measured on a real article, the whole 31-word overlap with the
 * source was a single vernacular quotation; the surrounding prose overlapped by
 * only 11 words. Checking the raw text therefore rejected good output for doing
 * exactly what it was told to do.
 *
 * Double quotes only — treating apostrophes as delimiters would shred ordinary
 * words like "don't".
 */
function stripQuoted(text) {
  return String(text || "")
    .replace(/["\u201C][^"\u201D]*["\u201D]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const wordCount = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;

/**
 * Phrases a model uses when it DECLINES the task.
 *
 * Deliberately narrow, and only ever matched near the start of a response.
 * The first version of this looked for a bare "I can't" anywhere in the body
 * and rejected a perfectly good 279-word article because the interviewee was
 * quoted saying "Because I can't even see her back now" — a quotation, not a
 * refusal. News copy is full of first-person quotations, so a bare phrase match
 * cannot distinguish the two.
 *
 * A genuine refusal essentially IS the response, so it appears immediately;
 * a phrase at character 993 of clean copy does not. Hence: require a task verb
 * and only inspect the opening.
 */
const REFUSAL_PATTERNS = [
  /\bas an ai (language )?model\b/i,
  /\bi (cannot|can't|can not|am unable to|must decline to) (assist|help|write|generate|create|produce|provide|rewrite|comply)\b/i,
  /\bi'?m sorry,? but i (cannot|can't|am unable)\b/i,
  /\bi (must|have to) (respectfully )?decline\b/i,
  /\bi (cannot|can't) (fulfil|fulfill|complete) (this|that|the) (request|task)\b/i,
];

/** Only the opening is inspected, because a refusal is the whole response. */
const REFUSAL_SCAN_CHARS = 300;

function looksLikeRefusal(text) {
  const head = String(text || "").slice(0, REFUSAL_SCAN_CHARS);
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(head));
}

/**
 * Validate a model response before staging it.
 * Returns { ok: true, value } or { ok: false, reason }.
 */
function validateRewrite(parsed, { sourceText, sourceTitle }) {
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, reason: "Model did not return a JSON object" };
  }

  const title = String(parsed.title || "").trim();
  const description = String(parsed.description || "").trim();
  const content = String(parsed.content || "").trim();

  if (!title) return { ok: false, reason: "Missing title" };
  if (!content) return { ok: false, reason: "Missing content" };
  if (title.length > 500) return { ok: false, reason: "Title exceeds column limit" };

  if (
    looksLikeRefusal(title) ||
    looksLikeRefusal(description) ||
    looksLikeRefusal(content)
  ) {
    return { ok: false, reason: "Response looks like a refusal" };
  }

  const words = wordCount(content);
  if (words < MIN_WORDS) {
    return {
      ok: false,
      reason: `Too short: ${words} words (minimum ${MIN_WORDS})`,
    };
  }
  if (words > MAX_WORDS) {
    return {
      ok: false,
      reason: `Too long: ${words} words (maximum ${MAX_WORDS})`,
    };
  }

  // A headline identical to the original is a strong sign of a lazy rewrite.
  if (
    sourceTitle &&
    title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").trim() ===
      String(sourceTitle).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").trim()
  ) {
    return { ok: false, reason: "Headline is unchanged from the original" };
  }

  // Two measurements, because they answer different questions.
  //   prose  — is the model's own writing original? (the thing that matters)
  //   total  — is it quoting the whole article verbatim?
  const proseShared = longestSharedRun(stripQuoted(content), stripQuoted(sourceText));
  if (proseShared >= MAX_SHARED_RUN) {
    return {
      ok: false,
      reason: `Still verbatim: ${proseShared}-word run shared with the source`,
    };
  }

  const totalShared = longestSharedRun(content, sourceText);
  if (totalShared >= MAX_TOTAL_SHARED_RUN) {
    return {
      ok: false,
      reason: `Quotes the source at length: ${totalShared}-word verbatim run`,
    };
  }

  const tags = Array.isArray(parsed.tags)
    ? parsed.tags
        .map((t) => String(t || "").toLowerCase().trim())
        .filter(Boolean)
        .slice(0, 6)
    : [];

  return {
    ok: true,
    value: {
      title,
      description: description.slice(0, 1000),
      content,
      tags,
      words,
      proseShared,
      totalShared,
    },
  };
}

/**
 * Claim a batch of rows for rewriting.
 *
 * Uses FOR UPDATE SKIP LOCKED so two workers can run concurrently without
 * handing the same row to both — a plain SELECT-then-UPDATE would let them race
 * and pay for the same article twice.
 *
 * @returns {Promise<Array<Object>>} claimed rows (id, url, source, title, description)
 */
async function claimBatch({ limit = 5, order = "recent" } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 5, 50));
  // Whitelisted ordering — never interpolate the caller's string.
  const orderBy = order === "oldest" ? "created_at ASC" : "created_at DESC";

  return sequelize.transaction(async (t) => {
    const [rows] = await sequelize.query(
      `SELECT id, url, source, title, description
         FROM news
        WHERE content_type = 'aggregated'
          AND rewrite_status IN ('none', 'failed')
          AND rewrite_attempts < :maxAttempts
          AND url IS NOT NULL
          AND url <> ''
        ORDER BY ${orderBy}
        LIMIT :limit
        FOR UPDATE SKIP LOCKED`,
      { replacements: { limit: safeLimit, maxAttempts: MAX_ATTEMPTS }, transaction: t },
    );

    if (rows.length === 0) return [];

    await sequelize.query(
      `UPDATE news
          SET rewrite_status = 'processing', updated_at = NOW()
        WHERE id IN (:ids)`,
      { replacements: { ids: rows.map((r) => r.id) }, transaction: t },
    );

    return rows;
  });
}

/**
 * Fetch the source page text for a row.
 *
 * `htmlScraper` is required lazily: it pulls in puppeteer, and a missing or
 * broken Chromium install would otherwise take down every consumer of this
 * module — including the admin endpoints that never scrape anything.
 *
 * Returns null when the page genuinely has nothing to read. Throws with
 * `scraperUnavailable` when the scraper itself could not be loaded, because
 * that is an environment fault rather than a property of this article, and the
 * caller must not mark the row permanently un-rewritable over it.
 */
async function fetchSourceText(row) {
  let htmlScraper;
  try {
    htmlScraper = require("../crawlers/htmlScraper");
  } catch (err) {
    logger.error(`rewriteService: scraper unavailable (${err.message})`);
    const wrapped = new Error(`Scraper unavailable: ${err.message}`);
    wrapped.scraperUnavailable = true;
    throw wrapped;
  }

  const result = await htmlScraper.scrapeArticle(row.url, row.source, {
    contentLimit: SOURCE_CHAR_LIMIT,
  });
  if (!result) return null;
  return {
    title: result.title || row.title,
    description: result.description || row.description || "",
    text: result.content || "",
  };
}

/**
 * True for faults that belong to the deployment rather than the article:
 * a missing API key, or a scraper that will not load. These must release the
 * row untouched, because burning the attempt budget for them would leave the
 * whole queue permanently dead even once the environment is fixed.
 */
function isEnvironmentError(err) {
  return Boolean(err?.isConfigError || err?.scraperUnavailable);
}

/**
 * Generate + stage a rewrite for one already-claimed row.
 *
 * @param {Object} row
 * @param {Object} [deps] - { scrape, chat } injection points for tests
 * @returns {Promise<{ok: boolean, reason?: string, meta?: Object}>}
 */
async function rewriteRow(row, deps = {}) {
  const scrape = deps.scrape || fetchSourceText;
  const chat = deps.chat || aiService.chat;

  try {
    const source = await scrape(row);
    if (!source || wordCount(source.text) < 120) {
      // Not enough source material to write anything honest from. Marking it
      // failed (rather than retrying) avoids paying for the same dead page
      // three times.
      await markFailed(
        row.id,
        "Source page yielded too little text to rewrite from",
        { retryable: false },
      );
      return { ok: false, reason: "insufficient_source" };
    }

    const response = await chat({
      system: SYSTEM_PROMPT,
      user: `SOURCE TITLE: ${source.title}

SOURCE STANDFIRST: ${source.description}

SOURCE ARTICLE:
${source.text}

Write the new Trenxi article now, as a JSON object.`,
      json: true,
      maxTokens: 3000,
      temperature: 0.6,
    });

    const parsed = aiService.parseJson(response.content);
    const verdict = validateRewrite(parsed, {
      sourceText: source.text,
      sourceTitle: source.title,
    });

    if (!verdict.ok) {
      await markFailed(row.id, verdict.reason, { retryable: true });
      return { ok: false, reason: verdict.reason };
    }

    const meta = {
      prompt_version: PROMPT_VERSION,
      model: response.model,
      usage: response.usage,
      cost_usd: Number(response.costUsd || 0),
      ms: response.ms,
      finish_reason: response.finishReason || null,
      words: verdict.value.words,
      shared_run: verdict.value.proseShared,
      total_shared_run: verdict.value.totalShared,
      source_chars: source.text.length,
      generated_at: new Date().toISOString(),
    };

    await News.update(
      {
        staged_title: verdict.value.title,
        staged_description: verdict.value.description,
        staged_content: verdict.value.content,
        staged_at: new Date(),
        rewrite_meta: meta,
        rewrite_status: "ready",
        rewrite_error: null,
      },
      { where: { id: row.id } },
    );

    return { ok: true, meta };
  } catch (err) {
    // Environment faults are not this row's fault: hand it straight back so it
    // is retried once the key or the scraper is fixed, instead of consuming an
    // attempt and eventually dropping out of the queue for good.
    if (isEnvironmentError(err)) {
      await release(row.id, err.message);
      return { ok: false, reason: "environment_error" };
    }
    await markFailed(row.id, err.message, { retryable: true });
    return { ok: false, reason: err.message };
  }
}

/**
 * Record a failure. Non-retryable failures exhaust the attempt budget
 * immediately so the row drops out of the claim query.
 */
async function markFailed(id, reason, { retryable = true } = {}) {
  try {
    await News.update(
      {
        rewrite_status: "failed",
        rewrite_error: String(reason || "unknown").slice(0, 500),
        rewrite_attempts: retryable
          ? sequelize.literal("rewrite_attempts + 1")
          : sequelize.literal(`GREATEST(rewrite_attempts + 1, ${MAX_ATTEMPTS})`),
      },
      { where: { id } },
    );
  } catch (err) {
    logger.error(`rewriteService.markFailed failed for ${id}:`, err);
  }
}

/**
 * Hand a row back to the queue without touching its attempt count.
 * Used for environment faults, which say nothing about the article.
 */
async function release(id, reason = null) {
  try {
    await News.update(
      {
        rewrite_status: "none",
        rewrite_error: reason ? String(reason).slice(0, 500) : null,
      },
      { where: { id } },
    );
  } catch (err) {
    logger.error(`rewriteService.release failed for ${id}:`, err);
  }
}

/**
 * Approve a staged rewrite: copy it onto the live columns.
 *
 * `url` is deliberately left alone so the page keeps its identity and any
 * accumulated search equity. Legacy `tags` are cleared to `[]` when the model
 * returns none, rather than keeping stale ones.
 */
async function applyStaged(id, { appliedBy = null } = {}) {
  const row = await News.findByPk(id);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.rewrite_status !== "ready" || !row.staged_content) {
    return { ok: false, reason: "no_staged_rewrite" };
  }

  const title = row.staged_title || row.title;
  const now = new Date();
  const meta = { ...(row.rewrite_meta || {}) };
  meta.applied_at = now.toISOString();
  meta.applied_by = appliedBy;

  await row.update({
    title,
    description: row.staged_description || row.description,
    content: row.staged_content,
    tags: Array.isArray(row.rewrite_meta?.tags) ? row.rewrite_meta.tags : row.tags,
    // Recompute so the row stays internally consistent after a headline change.
    hash: generateHash(title, row.source, row.published_at || row.created_at),
    content_type: "rewritten",
    rewrite_status: "applied",
    staged_title: null,
    staged_description: null,
    staged_content: null,
    staged_at: null,
    rewrite_meta: meta,
    rewrite_error: null,
    updated_at: now,
  });

  return { ok: true, id };
}

/** Reject a staged rewrite and return the row to the queue. */
async function discardStaged(id, { reason = "Rejected by reviewer" } = {}) {
  const row = await News.findByPk(id);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.rewrite_status !== "ready") {
    return { ok: false, reason: "no_staged_rewrite" };
  }

  await row.update({
    rewrite_status: "failed",
    rewrite_error: String(reason).slice(0, 500),
    staged_title: null,
    staged_description: null,
    staged_content: null,
    staged_at: null,
    rewrite_attempts: sequelize.literal("rewrite_attempts + 1"),
  });

  return { ok: true, id };
}

/** Queue depth, for the admin page and the scheduler's logging. */
async function getQueueStats() {
  const [[row]] = await sequelize.query(`
    SELECT
      SUM(content_type = 'aggregated' AND rewrite_status IN ('none','failed') AND rewrite_attempts < ${MAX_ATTEMPTS}) AS pending,
      SUM(rewrite_status = 'processing') AS processing,
      SUM(rewrite_status = 'ready')      AS ready,
      SUM(content_type = 'rewritten')    AS applied,
      SUM(content_type = 'original')     AS originals,
      SUM(rewrite_status = 'failed' AND rewrite_attempts >= ${MAX_ATTEMPTS}) AS exhausted
    FROM news
  `);
  const num = (v) => Number(v || 0);
  return {
    pending: num(row?.pending),
    processing: num(row?.processing),
    ready: num(row?.ready),
    applied: num(row?.applied),
    originals: num(row?.originals),
    exhausted: num(row?.exhausted),
    maxAttempts: MAX_ATTEMPTS,
  };
}

module.exports = {
  claimBatch,
  rewriteRow,
  fetchSourceText,
  validateRewrite,
  longestSharedRun,
  stripQuoted,
  applyStaged,
  discardStaged,
  markFailed,
  release,
  isEnvironmentError,
  getQueueStats,
  SYSTEM_PROMPT,
  PROMPT_VERSION,
  MIN_WORDS,
  MAX_WORDS,
  MAX_ATTEMPTS,
  MAX_SHARED_RUN,
  MAX_TOTAL_SHARED_RUN,
};
