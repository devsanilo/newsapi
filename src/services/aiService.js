/**
 * AI Service — article summarization using OpenAI / Gemini
 * Requires OPENAI_API_KEY in env
 */
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

module.exports = { summarize };
