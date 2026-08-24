/**
 * Content Cleaner Utility
 * Strips HTML, removes scripts/styles, normalizes whitespace
 */
const cheerio = require('cheerio');

/**
 * Strip all HTML tags from a string
 * @param {string} html - Raw HTML string
 * @returns {string} - Clean text
 */
function stripHtml(html) {
  if (!html) return '';
  const $ = cheerio.load(html);

  // Remove script and style elements entirely
  $('script, style, noscript, iframe, object, embed').remove();

  // Get text content
  let text = $.text();

  // Normalize whitespace
  text = text
    .replace(/\s+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim();

  return text;
}

/**
 * Clean and normalize article content
 * @param {string} content - Raw content (may contain HTML)
 * @param {number} maxLength - Maximum content length (default: 5000)
 * @returns {string} - Cleaned content
 */
function cleanContent(content, maxLength = 5000) {
  if (!content) return '';

  let cleaned = stripHtml(content);

  // Remove common unwanted patterns
  cleaned = cleaned
    .replace(/Advertisement\s*/gi, '')
    .replace(/Read more\.{0,3}/gi, '')
    .replace(/Continue reading\.{0,3}/gi, '')
    .replace(/Share this article/gi, '')
    .replace(/Follow us on .+/gi, '')
    .replace(/Subscribe .+/gi, '')
    .replace(/\[.*?\]/g, '')           // Remove bracket content
    .replace(/\(.*?photo.*?\)/gi, '')  // Remove photo credits
    .trim();

  // Limit content length
  if (cleaned.length > maxLength) {
    cleaned = cleaned.substring(0, maxLength).trim();
    // Cut at last complete sentence
    const lastPeriod = cleaned.lastIndexOf('.');
    if (lastPeriod > maxLength * 0.8) {
      cleaned = cleaned.substring(0, lastPeriod + 1);
    } else {
      cleaned += '...';
    }
  }

  return cleaned;
}

/**
 * Clean and normalize a description/summary
 * @param {string} description
 * @param {number} maxLength
 * @returns {string}
 */
function cleanDescription(description, maxLength = 500) {
  if (!description) return '';
  let cleaned = stripHtml(description);
  if (cleaned.length > maxLength) {
    cleaned = cleaned.substring(0, maxLength).trim() + '...';
  }
  return cleaned;
}

/**
 * Extract tags from content using simple keyword extraction
 * @param {string} text - Clean text content
 * @param {number} maxTags - Maximum number of tags
 * @returns {Array<string>}
 */
function extractTags(text, maxTags = 10) {
  if (!text) return [];

  // Common stop words to exclude
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'shall', 'can', 'need', 'dare',
    'it', 'its', 'this', 'that', 'these', 'those', 'he', 'she', 'they',
    'we', 'you', 'i', 'me', 'him', 'her', 'us', 'them', 'my', 'your',
    'his', 'our', 'their', 'what', 'which', 'who', 'whom', 'when',
    'where', 'why', 'how', 'not', 'no', 'nor', 'as', 'if', 'then',
    'than', 'too', 'very', 'just', 'about', 'above', 'after', 'again',
    'all', 'also', 'am', 'any', 'because', 'before', 'between', 'both',
    'each', 'few', 'more', 'most', 'other', 'over', 'same', 'so',
    'some', 'such', 'only', 'own', 'said', 'says', 'new', 'one', 'two',
    'first', 'last', 'many', 'much', 'now', 'old', 'see', 'way', 'who',
    'get', 'got', 'make', 'made', 'like', 'still', 'since', 'back',
    'also', 'well', 'even', 'into', 'year', 'years', 'up', 'out',
  ]);

  // Tokenize and count word frequency
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((word) => word.length > 3 && !stopWords.has(word));

  const frequency = {};
  for (const word of words) {
    frequency[word] = (frequency[word] || 0) + 1;
  }

  // Sort by frequency and return top tags
  return Object.entries(frequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTags)
    .map(([word]) => word);
}

/**
 * Simple language detection based on character analysis
 * @param {string} text
 * @returns {string} - Language code (en, ar, fr, etc.)
 */
function detectLanguage(text) {
  if (!text) return 'en';

  // Arabic characters
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  // Chinese characters
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';
  // Japanese
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'ja';
  // Korean
  if (/[\uAC00-\uD7AF]/.test(text)) return 'ko';
  // Cyrillic (Russian, etc.)
  if (/[\u0400-\u04FF]/.test(text)) return 'ru';
  // French indicators
  if (/\b(le|la|les|des|une|est|sont|dans|pour|avec|qui|que)\b/i.test(text)) return 'fr';
  // Spanish indicators
  if (/\b(el|los|las|una|unos|está|son|para|con|por|que|del)\b/i.test(text)) return 'es';
  // German indicators
  if (/\b(der|die|das|ein|eine|ist|sind|für|mit|und|oder)\b/i.test(text)) return 'de';

  return 'en';
}

module.exports = {
  stripHtml,
  cleanContent,
  cleanDescription,
  extractTags,
  detectLanguage,
};
