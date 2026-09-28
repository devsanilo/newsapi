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

const PROMPT_VERSION = "rewrite-v2";

const MIN_WORDS = Number(process.env.REWRITE_MIN_WORDS || 250);
const MAX_WORDS = Number(process.env.REWRITE_MAX_WORDS || 1200);
const MAX_ATTEMPTS = Number(process.env.REWRITE_MAX_ATTEMPTS || 3);

// A row claimed but never finished — because the process restarted or the batch
// crashed — would sit in 'processing' forever, since claiming only ever picks up
// 'none' or 'failed'. Anything claimed longer ago than this is returned to the
// queue. Generous by default so a legitimately slow article is not stolen from
// a run that is still working on it.
const CLAIM_TIMEOUT_MINUTES = Number(process.env.REWRITE_CLAIM_TIMEOUT_MINUTES || 15);

// Measuring the LONGEST shared run turned out to be the wrong question, and it
// was rejecting almost everything. News copy is dense with unbreakable chains
// of names, titles and figures — "Shell Nigeria Exploration and Production
// Company Limited (SNEPCo), Esso Exploration and Production Nigeria
// (Deepwater) Limited, and Nigerian Agip Exploration Limited" is one 22-word
// stretch that MUST be reproduced exactly; it is a company name, not
// plagiarism. A flat 12-word limit failed genuinely well-rewritten articles
// (a 671-word rewrite was rejected on a single 56-word proper-noun chain).
//
// Measured on real output, this guard was rejecting 6 of 10 good rewrites.
//
// The question that actually matters is: how much of the OUTPUT is verbatim?
// A faithful rewrite that repeats a 56-word entity chain inside 671 words of
// its own prose is 8% copied and clearly original. An article that lifts a
// 269-word block is mostly transcription. So: judge by COVERAGE RATIO.
const MAX_COPY_RATIO = Number(process.env.REWRITE_MAX_COPY_RATIO || 0.25);

// Runs shorter than this are ordinary phrasing ("the company said in a
// statement") and are not evidence of copying, so they are not counted.
const MIN_RUN_TO_COUNT = Number(process.env.REWRITE_MIN_RUN_TO_COUNT || 8);

// Backstop for a single unbroken run. Redundant with the ratio for short
// articles, but it catches a long article that lifts one huge block and pads
// the rest — a 269- or 319-word run is always transcription, even at 20%
// coverage.
const MAX_SHARED_RUN = Number(process.env.REWRITE_MAX_SHARED_RUN || 60);

// Absolute ceiling even for quoted material. The prompt permits reproducing a
// direct quotation verbatim, which is ordinary journalism — but a single quote
// running to 80+ words means the model is quoting the article rather than
// writing one.
const MAX_TOTAL_SHARED_RUN = Number(process.env.REWRITE_MAX_QUOTE_RUN || 80);

// The word floor is capped against the source's own length. Demanding 250 words
// from a 205-word source is impossible without padding, and it was rejecting
// complete, faithful rewrites of 189-234 words purely on length (4 of 10
// failures). Below this cap the floor is 85% of the source, never under 120.
const MIN_WORDS_SOURCE_FACTOR = Number(process.env.REWRITE_MIN_WORDS_FACTOR || 0.85);
const MIN_WORDS_FLOOR = Number(process.env.REWRITE_MIN_WORDS_FLOOR || 120);

// Below this the source text cannot support an honest rewrite. Applies both to
// scraped text and to the post body we already hold for WordPress rows.
const MIN_SOURCE_WORDS = Number(process.env.REWRITE_MIN_SOURCE_WORDS || 120);
const SOURCE_CHAR_LIMIT = Number(process.env.REWRITE_SOURCE_CHARS || 8000);

const SYSTEM_PROMPT = `You are a careful news desk editor for Trenxi, a Nigerian news publication.

You are given a source article from another publisher. Write a NEW article that reports the same events in your own words.

Rules you must follow:
- REWRITE EVERY SENTENCE. Rebuild each sentence in your own words and your own clause order. Do not reuse the source's sentences or phrasing.
- Keep the FACTS, not the wording. Names, numbers, dates and places must stay accurate and may be repeated exactly — but everything AROUND them must be your own writing.
- The most common mistake is copying a whole sentence because it contains figures. Keep the figures; replace the sentence. A sentence that matches the source for more than a few consecutive words is a failure.
- Use ONLY facts present in the source. Never invent names, numbers, quotes, dates, places or causes. If the source does not state something, leave it out.
- No fabricated quotations. Direct quotes may only be reproduced if they appear verbatim in the source, and must be attributed as they are there.
- Lead with what matters most. Write for a general Nigerian and international audience.
- Neutral, factual tone. No opinion, no sensationalism, no clickbait.
- Do not mention the source publication by name, and do not refer to "the source" or "this article".

Example of the transformation required:
  Source: "The regulator is expected to confirm later this week a 4% increase, the highest level since the summer of 2023."
  Good:   "A 4% rise is set to be confirmed by the regulator within days, the steepest since the summer of 2023."
  Bad:    "The regulator is expected to confirm later this week a 4% increase, the highest level since the summer of 2023."

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

/** Normalise to comparable lowercase word tokens. */
const toTokens = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * Measure how much of `a` (the model's output) was lifted from `b` (the source).
 *
 * Returns the longest run, that run's text, and `coverage` — the number of
 * words of `a` that sit inside a shared run of at least `minRun` words. Each
 * output word is counted once, so overlapping spans cannot inflate the figure.
 *
 * Coverage is what distinguishes a real rewrite that legitimately repeats a
 * company name from a model that transcribed the article: the first is a small
 * fraction of a long text, the second is most of it.
 */
function overlapReport(a, b, minRun = MIN_RUN_TO_COUNT) {
  const rows = toTokens(a);
  const cols = toTokens(b);
  if (rows.length === 0 || cols.length === 0) {
    return { longest: 0, longestText: "", coverage: 0, ratio: 0, words: rows.length };
  }

  // Collect maximal shared runs. For a fixed diagonal (i - j constant) the run
  // length grows with j, so the largest j on each diagonal is the maximal run.
  const byDiagonal = new Map();
  let prev = new Uint32Array(cols.length + 1);
  let curr = new Uint32Array(cols.length + 1);

  for (let i = 1; i <= rows.length; i += 1) {
    for (let j = 1; j <= cols.length; j += 1) {
      if (rows[i - 1] === cols[j - 1]) {
        const run = prev[j - 1] + 1;
        curr[j] = run;
        if (run >= minRun) {
          const key = i - j;
          const seen = byDiagonal.get(key);
          if (!seen || run > seen.len) {
            byDiagonal.set(key, { end: i, len: run });
          }
        }
      } else {
        curr[j] = 0;
      }
    }
    const swap = prev;
    prev = curr;
    curr = swap;
    curr.fill(0);
  }

  const spans = [...byDiagonal.values()]
    .map(({ end, len }) => ({ start: end - len, end }))
    .sort((x, y) => x.start - y.start);

  let coverage = 0;
  let cursor = 0;
  for (const span of spans) {
    const start = Math.max(span.start, cursor);
    if (span.end > start) {
      coverage += span.end - start;
      cursor = span.end;
    }
  }

  let longest = 0;
  let longestSpan = null;
  for (const span of spans) {
    const len = span.end - span.start;
    if (len > longest) {
      longest = len;
      longestSpan = span;
    }
  }

  return {
    longest,
    longestText: longestSpan ? rows.slice(longestSpan.start, longestSpan.end).join(" ") : "",
    coverage,
    ratio: rows.length ? coverage / rows.length : 0,
    words: rows.length,
  };
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

  // Never demand more words than the source can actually support, or the model
  // is forced to pad. Short sources get a proportionally lower floor.
  const sourceWords = wordCount(sourceText);
  const minWords =
    sourceWords > 0
      ? Math.min(MIN_WORDS, Math.max(MIN_WORDS_FLOOR, Math.floor(sourceWords * MIN_WORDS_SOURCE_FACTOR)))
      : MIN_WORDS;

  if (words < minWords) {
    return {
      ok: false,
      reason: `Too short: ${words} words (minimum ${minWords}, source had ${sourceWords})`,
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
  //
  // Quoted spans are removed first: the prompt permits reproducing a direct
  // quotation verbatim, and news copy is full of them. The prose check judges
  // COVERAGE — what fraction of the output is verbatim — not the single longest
  // run, because news prose contains long unbreakable chains of names and
  // figures that must be reproduced exactly and are not evidence of copying.
  const prose = overlapReport(stripQuoted(content), stripQuoted(sourceText));

  if (prose.longest >= MAX_SHARED_RUN) {
    return {
      ok: false,
      reason: `Still verbatim: ${prose.longest}-word run shared with the source`,
      detail: prose.longestText.slice(0, 300),
    };
  }

  if (prose.ratio > MAX_COPY_RATIO) {
    return {
      ok: false,
      reason: `Copies too much: ${Math.round(prose.ratio * 100)}% of the output (${prose.coverage} of ${prose.words} words) is verbatim from the source, limit ${Math.round(MAX_COPY_RATIO * 100)}%`,
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
      proseShared: prose.longest,
      proseRatio: prose.ratio,
      minWords,
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

  // A publisher whose posts never produce a usable rewrite still burns an
  // attempt on every row and crowds out sources that do work, so it is cheaper
  // to skip the source outright than to retry each of its articles three times.
  const skipSources = String(process.env.REWRITE_SKIP_SOURCES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const skipClause = skipSources.length ? "AND source NOT IN (:skipSources)" : "";

  return sequelize.transaction(async (t) => {
    // Recover anything a previous interrupted run left behind, so a restart
    // cannot permanently strand a row.
    const [, recovered] = await sequelize.query(
      `UPDATE news
          SET rewrite_status = 'failed',
              rewrite_error = 'Claim expired (previous run did not finish)'
        WHERE rewrite_status = 'processing'
          AND updated_at < DATE_SUB(NOW(), INTERVAL :timeout MINUTE)`,
      { replacements: { timeout: CLAIM_TIMEOUT_MINUTES }, transaction: t },
    );
    if (recovered && recovered.affectedRows > 0) {
      logger.warn(
        `rewriteService.claimBatch: recovered ${recovered.affectedRows} stranded row(s).`,
      );
    }

    // Only WordPress rows are claimed. An RSS row is a headline highlight: it
    // links out to the publisher and must never acquire a Trenxi article page,
    // so it is excluded here rather than being filtered later.
    //
    // `content` is selected because a WordPress row already holds the complete
    // post — see fetchSourceText.
    const [rows] = await sequelize.query(
      `SELECT id, url, source, title, description, content, ingest_type
         FROM news
        WHERE ingest_type = 'wordpress'
          AND rewrite_status IN ('none', 'failed')
          AND rewrite_attempts < :maxAttempts
          AND url IS NOT NULL
          AND url <> ''
          ${skipClause}
        ORDER BY ${orderBy}
        LIMIT :limit
        FOR UPDATE SKIP LOCKED`,
      {
        replacements: {
          limit: safeLimit,
          maxAttempts: MAX_ATTEMPTS,
          ...(skipSources.length ? { skipSources } : {}),
        },
        transaction: t,
      },
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
 * Fetch the source text to rewrite from.
 *
 * WordPress rows already hold the complete post: the REST API supplied it at
 * ingest. Using it directly removes the article-page scrape from the path
 * entirely, and that scrape was the reason rewrites kept coming out thin — RSS
 * only ever carried a summary, so the full text had to be recovered from the
 * publisher's page and frequently came back empty or truncated.
 *
 * Scraping remains the fallback for any row without usable stored content
 * (a non-WordPress row, or a post whose body was too short to be worth storing),
 * so nothing that used to work stops working.
 *
 * `htmlScraper` is required lazily: it pulls in puppeteer, and a missing or
 * broken Chromium install would otherwise take down every consumer of this
 * module — including the admin endpoints that never scrape anything.
 *
 * Returns null when the source genuinely has nothing to read. Throws with
 * `scraperUnavailable` when the scraper itself could not be loaded, because
 * that is an environment fault rather than a property of this article, and the
 * caller must not mark the row permanently un-rewritable over it.
 */
async function fetchSourceText(row) {
  const stored = String(row.content || "").trim();
  if (row.ingest_type === "wordpress" && wordCount(stored) >= MIN_SOURCE_WORDS) {
    return {
      title: row.title,
      description: row.description || "",
      text: stored.slice(0, SOURCE_CHAR_LIMIT),
    };
  }

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

function buildUserPrompt(source) {
  return `SOURCE TITLE: ${source.title}

SOURCE STANDFIRST: ${source.description}

SOURCE ARTICLE:
${source.text}

Write the new Trenxi article now, as a JSON object.`;
}

/**
 * Second-pass prompt used when the first draft failed validation.
 *
 * The model is shown its own rejected text and the passage that matched the
 * source, so the instruction is concrete rather than abstract ("be more
 * original"). Returns null when the failure was not about copying, because
 * repeating the same request would not help.
 */
function buildRepairPrompt(source, parsed, verdict) {
  const copied = verdict.detail
    ? `\nThis passage from your draft was copied almost word-for-word from the source:\n"${verdict.detail}"\n`
    : "";

  return `Your previous draft was rejected. Reason: ${verdict.reason}
${copied}
Here is your rejected draft:
${parsed?.content || ""}

Rewrite the article again from the source below. This time rebuild EVERY sentence in your own words and your own order. Keep all names, numbers, dates and quotes accurate, but do not reuse the source's sentences — especially sentences that contain figures, which is where you copied before. Do not include the passage above in its original form.

SOURCE TITLE: ${source.title}

SOURCE STANDFIRST: ${source.description}

SOURCE ARTICLE:
${source.text}

Return the corrected JSON object now.`;
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
    if (!source || wordCount(source.text) < MIN_SOURCE_WORDS) {
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
      user: buildUserPrompt(source),
      json: true,
      maxTokens: 3000,
      temperature: 0.6,
    });

    let parsed = aiService.parseJson(response.content);
    let verdict = validateRewrite(parsed, {
      sourceText: source.text,
      sourceTitle: source.title,
    });
    let repair = null;

    // A rejection used to throw away a paid call. Measured on real output, the
    // dominant failure was the model transcribing dense factual passages
    // verbatim — 41-49% of the finished article matched the source word for
    // word. Telling the model exactly what it copied and asking again converts
    // most of those into usable articles for one extra call, which is far
    // cheaper than losing the article (and the attempt) entirely.
    if (!verdict.ok) {
      repair = await chat({
        system: SYSTEM_PROMPT,
        user: buildRepairPrompt(source, parsed, verdict),
        json: true,
        maxTokens: 3000,
        // Higher than the first pass: paraphrase divergence is exactly what is
        // missing, and there is no second chance after this.
        temperature: 0.85,
      });

      const repaired = aiService.parseJson(repair.content);
      const recheck = validateRewrite(repaired, {
        sourceText: source.text,
        sourceTitle: source.title,
      });

      if (recheck.ok) {
        parsed = repaired;
        verdict = recheck;
      }
    }

    if (!verdict.ok) {
      await markFailed(row.id, verdict.reason, { retryable: true });
      return { ok: false, reason: verdict.reason };
    }

    const meta = {
      prompt_version: PROMPT_VERSION,
      model: response.model,
      usage: response.usage,
      cost_usd: Number(response.costUsd || 0) + Number(repair?.costUsd || 0),
      ms: (response.ms || 0) + (repair?.ms || 0),
      finish_reason: response.finishReason || null,
      repaired: Boolean(repair),
      words: verdict.value.words,
      shared_run: verdict.value.proseShared,
      copy_ratio: verdict.value.proseRatio,
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
    // Applying the rewrite is the publish step. WordPress rows are ingested
    // unpublished so the publisher's own text is never served to readers; this
    // is what puts the finished Trenxi article live. It covers both paths —
    // auto-publish, and an admin approving a staged rewrite.
    is_published: true,
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

/**
 * Publish a WordPress post exactly as the publisher wrote it.
 *
 * The alternative to rewriting: the row already holds the complete post, so it
 * only has to be released. It becomes `content_type='syndicated'` — a distinct
 * value because it is neither our writing nor a bare highlight, and unlike an
 * 'aggregated' row it DOES get an article page and belongs in the article feed.
 *
 * Deliberately refused for anything that is not a WordPress row. An RSS row is
 * a headline with a ~2000-character summary scraped from the feed; publishing
 * it as an article would put a stub on a page of its own, which is the opposite
 * of Google-News-style highlighting.
 *
 * `rewrite_status='skipped'` takes it out of the claim query (which takes only
 * 'none' and 'failed') permanently, without pretending a rewrite was applied.
 */
async function publishAsIs(id, { publishedBy = null } = {}) {
  const row = await News.findByPk(id);
  if (!row) return { ok: false, reason: "not_found" };

  if (row.ingest_type !== "wordpress") {
    return { ok: false, reason: "not_wordpress" };
  }
  if (row.content_type === "syndicated" || row.content_type === "rewritten") {
    return { ok: false, reason: "already_published" };
  }
  // Nothing to publish: the ingest pass skips posts below the minimum length,
  // so an empty body means something went wrong rather than being brief.
  if (!String(row.content || "").trim()) {
    return { ok: false, reason: "no_content" };
  }

  const meta = { ...(row.rewrite_meta || {}) };
  meta.published_as_is_at = new Date().toISOString();
  meta.published_as_is_by = publishedBy;

  await row.update({
    content_type: "syndicated",
    rewrite_status: "skipped",
    is_published: true,
    // A staged rewrite makes no sense on a row published verbatim.
    staged_title: null,
    staged_description: null,
    staged_content: null,
    staged_at: null,
    rewrite_meta: meta,
    rewrite_error: null,
    updated_at: new Date(),
  });

  return { ok: true, id };
}

/**
 * Publish a batch of WordPress posts as-is.
 *
 * Bounded on purpose: this releases publisher text verbatim, and running it
 * over the whole backlog in one call is not something that should be possible
 * by accident.
 */
async function publishManyAsIs({ limit = 20, publishedBy = null } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));

  const rows = await News.findAll({
    where: {
      ingest_type: "wordpress",
      content_type: "aggregated",
      is_published: false,
    },
    order: [
      ["published_at", "DESC"],
      ["created_at", "DESC"],
    ],
    limit: safeLimit,
    raw: true,
  });

  let published = 0;
  const skipped = [];

  for (const row of rows) {
    const result = await publishAsIs(row.id, { publishedBy });
    if (result.ok) published += 1;
    else skipped.push({ id: row.id, reason: result.reason });
  }

  return { published, scanned: rows.length, skipped, limit: safeLimit };
}

/** Rows published verbatim, and rows still waiting on a decision. */
async function getWordPressStats() {
  const [[row]] = await sequelize.query(`
    SELECT
      SUM(ingest_type = 'wordpress' AND is_published = 0)                        AS awaiting,
      SUM(content_type = 'syndicated')                                           AS syndicated,
      SUM(content_type = 'rewritten')                                            AS rewritten,
      SUM(ingest_type = 'wordpress' AND rewrite_status = 'skipped')              AS skipped,
      SUM(ingest_type = 'wordpress' AND rewrite_status = 'failed'
          AND rewrite_attempts >= ${MAX_ATTEMPTS})                               AS exhausted
    FROM news
  `);
  const num = (v) => Number(v || 0);
  return {
    awaiting: num(row?.awaiting),
    syndicated: num(row?.syndicated),
    rewritten: num(row?.rewritten),
    skipped: num(row?.skipped),
    exhausted: num(row?.exhausted),
  };
}

/** Queue depth, for the admin page and the scheduler's logging. */
async function getQueueStats() {  const [[row]] = await sequelize.query(`
    SELECT
      SUM(ingest_type = 'wordpress' AND rewrite_status IN ('none','failed') AND rewrite_attempts < ${MAX_ATTEMPTS}) AS pending,
      SUM(rewrite_status = 'processing') AS processing,
      SUM(rewrite_status = 'ready')      AS ready,
      SUM(content_type = 'rewritten')    AS applied,
      SUM(content_type = 'original')     AS originals,
      SUM(ingest_type = 'wordpress')     AS wordpress_total,
      SUM(ingest_type = 'rss')           AS highlights,
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
    wordpressTotal: num(row?.wordpress_total),
    highlights: num(row?.highlights),
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
  overlapReport,
  stripQuoted,
  applyStaged,
  publishAsIs,
  publishManyAsIs,
  getWordPressStats,
  discardStaged,
  markFailed,
  release,
  isEnvironmentError,
  getQueueStats,
  SYSTEM_PROMPT,
  buildUserPrompt,
  buildRepairPrompt,
  PROMPT_VERSION,
  MIN_WORDS,
  MAX_WORDS,
  MAX_ATTEMPTS,
  MAX_SHARED_RUN,
  MAX_COPY_RATIO,
  MIN_RUN_TO_COUNT,
  MIN_WORDS_SOURCE_FACTOR,
  MIN_WORDS_FLOOR,
  MAX_TOTAL_SHARED_RUN,
  CLAIM_TIMEOUT_MINUTES,
};
