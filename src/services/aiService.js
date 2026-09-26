/**
 * AI Service
 *
 * Two unrelated concerns live here because they share one credential story:
 *
 *  - `summarize()` — legacy TLDR helper for the reader-facing news routes.
 *    Uses OPENAI_API_KEY and silently degrades to "first two sentences" when
 *    that key is absent. Left as-is so newsRoutes keeps working.
 *  - `chat()` — DeepSeek transport used by the rewrite and originals
 *    pipelines. DeepSeek exposes an OpenAI-compatible /chat/completions API,
 *    so this is a thin axios client rather than a new SDK dependency.
 *
 * The key is read from the environment and never logged.
 */
const axios = require("axios");
const logger = require("../utils/logger");

const CACHE = new Map(); // in-memory summary cache
const CACHE_MAX = 2000;

/**
 * Generate a short TLDR summary for article content
 */
async function summarize(articleId, title, content, description) {
  if (CACHE.has(articleId)) return CACHE.get(articleId);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Fallback: return first 2 sentences of description/content
    const text = content || description || "";
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
    const summary =
      sentences.slice(0, 2).join(" ").trim() || text.slice(0, 200);
    return { summary, source: "fallback" };
  }

  try {
    const inputText = (content || description || "").slice(0, 3000);
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content:
              "You are a news summarizer. Generate a concise 2-sentence TLDR summary of the article. Be factual and neutral.",
          },
          {
            role: "user",
            content: `Title: ${title}\n\nArticle:\n${inputText}`,
          },
        ],
        max_tokens: 120,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim() || "";

    if (summary) {
      if (CACHE.size >= CACHE_MAX) {
        const firstKey = CACHE.keys().next().value;
        CACHE.delete(firstKey);
      }
      CACHE.set(articleId, { summary, source: "ai" });
    }

    return { summary, source: "ai" };
  } catch (error) {
    logger.warn(`AI summarize failed for ${articleId}: ${error.message}`);
    // Fallback
    const text = content || description || "";
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
    const summary =
      sentences.slice(0, 2).join(" ").trim() || text.slice(0, 200);
    return { summary, source: "fallback" };
  }
}

// ─── DeepSeek transport ────────────────────────────────────────────────────
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";

// Published deepseek-chat rates, USD per 1M tokens. For reporting only —
// never treat these as billing truth.
const PRICE_INPUT_PER_MTOK = 0.27;
const PRICE_OUTPUT_PER_MTOK = 1.1;

// Transient conditions worth another attempt. A 400/401/422 fails identically
// on retry, so retrying those only burns time and quota.
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/**
 * Raised for configuration problems (missing key) rather than transport
 * failures, so callers can avoid pointless retries.
 */
class AIConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "AIConfigError";
    this.isConfigError = true;
  }
}

function apiKey() {
  return (process.env.DEEPSEEK_API_KEY || "").trim();
}

function baseUrl() {
  return (process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function deepseekModel() {
  return (process.env.DEEPSEEK_MODEL || DEFAULT_MODEL).trim();
}

function isConfigured() {
  return apiKey().length > 0;
}

/** Estimated USD cost for a usage block. Reporting only. */
function estimateCost(usage = {}) {
  const inTok = Number(usage.prompt_tokens || 0);
  const outTok = Number(usage.completion_tokens || 0);
  return (
    (inTok / 1_000_000) * PRICE_INPUT_PER_MTOK +
    (outTok / 1_000_000) * PRICE_OUTPUT_PER_MTOK
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Reduce an error to something safe to log and store. axios echoes the request
 * config on failure, which carries the bearer token, so the raw error must
 * never be persisted or logged.
 */
function redact(err) {
  const status = err?.response?.status;
  const body = err?.response?.data;
  let detail = "";
  if (body) {
    detail =
      typeof body === "string"
        ? body
        : body?.error?.message || JSON.stringify(body);
  }
  return {
    status,
    message: String(detail || err?.message || "unknown error").slice(0, 400),
    // No status means network/timeout, which is worth retrying.
    retryable: status ? RETRYABLE_STATUS.has(status) : true,
  };
}

/**
 * Single chat completion.
 *
 * @param {Object}  options
 * @param {string}  options.system
 * @param {string}  options.user
 * @param {boolean} [options.json]        Request a JSON object response
 * @param {number}  [options.maxTokens]
 * @param {number}  [options.temperature]
 * @param {number}  [options.timeoutMs]
 * @param {number}  [options.retries]
 * @returns {Promise<{content: string, usage: Object, model: string, costUsd: number, ms: number}>}
 */
async function chat({
  system,
  user,
  json = false,
  maxTokens = 2000,
  temperature = 0.7,
  timeoutMs = Number(process.env.DEEPSEEK_TIMEOUT_MS || 120000),
  retries = Number(process.env.DEEPSEEK_MAX_RETRIES || 3),
} = {}) {
  if (!isConfigured()) {
    throw new AIConfigError(
      "DEEPSEEK_API_KEY is not set — AI features are disabled.",
    );
  }
  if (!user) throw new Error("aiService.chat requires a user prompt");

  const model = deepseekModel();
  const payload = {
    model,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: user },
    ],
    temperature,
    max_tokens: maxTokens,
    stream: false,
  };
  if (json) payload.response_format = { type: "json_object" };

  let lastError = null;
  const started = Date.now();

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await axios.post(`${baseUrl()}/chat/completions`, payload, {
        timeout: timeoutMs,
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          "Content-Type": "application/json",
        },
        // Classify statuses ourselves so a 4xx body is surfaced verbatim
        // instead of being swallowed into a generic axios error.
        validateStatus: () => true,
      });

      if (res.status >= 200 && res.status < 300) {
        const choice = res.data?.choices?.[0];
        const content = choice?.message?.content;
        if (typeof content !== "string" || content.trim() === "") {
          // Usually a filter hit or a truncated generation; worth one more go.
          lastError = {
            status: res.status,
            message: "Model returned an empty completion",
            retryable: true,
          };
        } else {
          const usage = res.data?.usage || {};
          return {
            content,
            usage,
            model: res.data?.model || model,
            costUsd: estimateCost(usage),
            ms: Date.now() - started,
            finishReason: choice?.finish_reason || null,
          };
        }
      } else {
        lastError = redact({ response: { status: res.status, data: res.data } });
      }
    } catch (err) {
      lastError = redact(err);
    }

    if (!lastError.retryable || attempt === retries) break;

    // Exponential backoff with jitter, so a burst of queued jobs does not
    // retry in lockstep after a rate limit.
    const wait = Math.min(2 ** attempt * 1000, 30000) + Math.floor(Math.random() * 500);
    logger.warn(
      `aiService: attempt ${attempt + 1} failed (${lastError.status || "network"}: ${lastError.message}); retrying in ${wait}ms`,
    );
    await sleep(wait);
  }

  const error = new Error(lastError?.message || "AI request failed after retries");
  error.status = lastError?.status;
  error.retryable = Boolean(lastError?.retryable);
  throw error;
}

/**
 * Parse a JSON response defensively — models sometimes wrap JSON in markdown
 * fences or add a sentence of preamble despite the json_object hint.
 */
function parseJson(content) {
  const raw = String(content || "").trim();
  const candidates = [raw];

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());

  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(raw.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* try the next shape */
    }
  }
  throw new Error("Could not parse JSON from model response");
}

module.exports = {
  // legacy
  summarize,
  // DeepSeek transport
  chat,
  parseJson,
  isConfigured,
  estimateCost,
  AIConfigError,
  PRICE_INPUT_PER_MTOK,
  PRICE_OUTPUT_PER_MTOK,
  deepseekModel,
};
