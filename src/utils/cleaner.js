/**
 * Content Cleaner Utility
 * Strips HTML, removes scripts/styles, normalizes whitespace
 */
const cheerio = require('cheerio');

/**
 * Named HTML entities that show up in news feeds.
 * Numeric references (&#8211; / &#x2013;) are handled generically.
 */
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '', zwj: '',
  ndash: '\u2013', mdash: '\u2014', minus: '\u2212', hyphen: '\u2010',
  lsquo: '\u2018', rsquo: '\u2019', sbquo: '\u201A',
  ldquo: '\u201C', rdquo: '\u201D', bdquo: '\u201E',
  laquo: '\u00AB', raquo: '\u00BB', lsaquo: '\u2039', rsaquo: '\u203A',
  hellip: '\u2026', bull: '\u2022', middot: '\u00B7', permil: '\u2030',
  copy: '\u00A9', reg: '\u00AE', trade: '\u2122', deg: '\u00B0',
  plusmn: '\u00B1', times: '\u00D7', divide: '\u00F7', micro: '\u00B5',
  frac12: '\u00BD', frac14: '\u00BC', frac34: '\u00BE',
  sup2: '\u00B2', sup3: '\u00B3', para: '\u00B6', sect: '\u00A7',
  euro: '\u20AC', pound: '\u00A3', yen: '\u00A5', cent: '\u00A2', curren: '\u00A4',
  aacute: '\u00E1', agrave: '\u00E0', acirc: '\u00E2', auml: '\u00E4', aring: '\u00E5',
  eacute: '\u00E9', egrave: '\u00E8', ecirc: '\u00EA', euml: '\u00EB',
  iacute: '\u00ED', igrave: '\u00EC', icirc: '\u00EE', iuml: '\u00EF',
  oacute: '\u00F3', ograve: '\u00F2', ocirc: '\u00F4', ouml: '\u00F6', otilde: '\u00F5',
  uacute: '\u00FA', ugrave: '\u00F9', ucirc: '\u00FB', uuml: '\u00FC',
  ccedil: '\u00E7', ntilde: '\u00F1', szlig: '\u00DF', oslash: '\u00F8',
  Aacute: '\u00C1', Agrave: '\u00C0', Acirc: '\u00C2', Auml: '\u00C4', Aring: '\u00C5',
  Eacute: '\u00C9', Egrave: '\u00C8', Ecirc: '\u00CA', Euml: '\u00CB',
  Iacute: '\u00CD', Igrave: '\u00CC', Icirc: '\u00CE', Iuml: '\u00CF',
  Oacute: '\u00D3', Ograve: '\u00D2', Ocirc: '\u00D4', Ouml: '\u00D6', Otilde: '\u00D5',
  Uacute: '\u00DA', Ugrave: '\u00D9', Ucirc: '\u00DB', Uuml: '\u00DC',
  Ccedil: '\u00C7', Ntilde: '\u00D1', Oslash: '\u00D8',
};

const ENTITY_RE = /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]{1,31});/g;

/**
 * Decode one layer of HTML entities (numeric + named)
 * @param {string} value
 * @returns {string}
 */
function decodeEntitiesOnce(value) {
  if (typeof value !== 'string' || value.indexOf('&') === -1) return value;
  return value.replace(ENTITY_RE, (match, body) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      // Reject out-of-range and lone surrogates
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      if (code >= 0xd800 && code <= 0xdfff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body)) {
      return NAMED_ENTITIES[body];
    }
    const lower = body.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, lower)) {
      return NAMED_ENTITIES[lower];
    }
    return match;
  });
}

/**
 * Decode HTML entities, repeating until the value stops changing so that
 * double-encoded feeds ("&amp;#8211;") resolve fully.
 * @param {string} value
 * @param {number} maxPasses - Safety cap on decode passes
 * @returns {string}
 */
function decodeEntities(value, maxPasses = 2) {
  if (typeof value !== 'string' || value.indexOf('&') === -1) return value;
  let out = value;
  for (let i = 0; i < maxPasses; i++) {
    const next = decodeEntitiesOnce(out);
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * Strip all HTML tags from a string
 * @param {string} html - Raw HTML string
 * @returns {string} - Clean text
 */
function stripHtml(html) {
  if (!html) return '';
  const $ = cheerio.load(String(html));

  // Remove script and style elements entirely
  $('script, style, noscript, iframe, object, embed').remove();

  // Get text content, then resolve any entities that survived parsing
  let text = decodeEntities($.text());

  // Normalize whitespace (including non-breaking spaces)
  text = text
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim();

  return text;
}

/**
 * Clean an article title: strip markup, decode entities, collapse whitespace
 * @param {string} title - Raw title
 * @param {number} maxLength - Maximum title length (default: 500)
 * @returns {string}
 */
function cleanTitle(title, maxLength = 500) {
  if (!title) return '';
  const cleaned = stripHtml(title);
  return cleaned.length > maxLength
    ? cleaned.substring(0, maxLength).trim()
    : cleaned;
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
    .replace(/Share this article/gi, '')
    .replace(/Follow us on .+/gi, '')
    .replace(/Subscribe .+/gi, '')
    .replace(/\[.*?\]/g, '')           // Remove bracket content
    .replace(/\(.*?photo.*?\)/gi, '')  // Remove photo credits
    .trim();

  cleaned = stripFeedBoilerplate(cleaned);

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
 * Remove publisher boilerplate that feeds append to summaries, e.g.
 * "Read More: https://punchng.com/..." or "The post X appeared first on Y."
 * Left in place it ends up in the rendered description and in the page's
 * meta description, which makes the page look machine-generated.
 *
 * Only trailing boilerplate is removed, so legitimate prose that happens to
 * contain the words "read more" is left intact.
 *
 * @param {string} text
 * @returns {string}
 */
function stripFeedBoilerplate(text) {
  if (!text) return '';

  let out = text;

  // WordPress footer: "The post <title> appeared first on <site>."
  out = out.replace(/\s*the post .*?appeared first on .*?\.?\s*$/i, '');

  // "Read More: <url>", "Read more at <url>", "Continue reading…"
  out = out.replace(
    /\s*\b(?:read|see|learn|continue reading)\s*(?:more)?\s*:?\s*(?:at\s+)?https?:\/\/\S+\s*$/i,
    '',
  );
  out = out.replace(/\s*\b(?:read|see|learn)\s+more\s*:?\s*$/i, '');
  out = out.replace(/\s*\bcontinue reading\b.*$/i, '');

  // "Source: <url>" or a trailing bare URL
  out = out.replace(/\s*\bsource\s*:\s*https?:\/\/\S+\s*$/i, '');
  out = out.replace(/\s*https?:\/\/\S+\s*$/i, '');

  return out.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Clean and normalize a description/summary
 * @param {string} description
 * @param {number} maxLength
 * @returns {string}
 */
function cleanDescription(description, maxLength = 500) {
  if (!description) return '';
  let cleaned = stripFeedBoilerplate(stripHtml(description));
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

/**
 * Convert article HTML into plain text that KEEPS its paragraph structure.
 *
 * `stripHtml` must NOT be used for article bodies: it collapses every run of
 * whitespace to a single space (`\s+` -> ' '), which flattens a 2,000-word
 * WordPress post into one unbroken block. The rewrite model is then given text
 * with no paragraph structure at all, and the reader gets a wall of text.
 *
 * Block-level closing tags become blank lines BEFORE any tag is stripped, so
 * paragraph boundaries survive as "\n\n" — the same convention the front ends
 * use to split content into paragraphs.
 *
 * Empty markup is removed outright rather than left to become stray text:
 * `<figure>` blocks (images and their captions), scripts, styles and comments
 * are dropped whole, and WordPress' "[...]" read-more markers are stripped.
 *
 * @param {string} html - Raw HTML from the publisher
 * @param {number} maxLength - Maximum characters to keep
 * @returns {string} - Plain text with blank-line paragraph breaks
 */
function htmlToParagraphText(html, maxLength = 20000) {
  if (!html) return '';

  let text = String(html);

  // Drop elements whose content is never article prose. The `[\s\S]*?` form is
  // used rather than a backreference so nested/imbalanced cases cannot escape.
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(
    /<(script|style|noscript|iframe|object|embed|form|figure|svg|video|audio)[\s\S]*?<\/\1>/gi,
    ' ',
  );

  // Paragraph and line boundaries, recorded while the tags are still there.
  text = text.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  text = text.replace(/<\s*\/\s*(p|div|section|article|li|ul|ol|h[1-6]|blockquote|tr|td|th|header|footer|aside|main|pre)\s*>/gi, '\n\n');

  // Everything still tagged is inline emphasis, links or images; drop the tags.
  text = text.replace(/<[^>]+>/g, '');

  text = decodeEntities(text);

  text = text
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    // WordPress read-more markers and stray bracketed placeholders.
    .replace(/\[\s*(?:&hellip;|\.\.\.|…)\s*\]/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/Advertisement\s*/gi, '')
    .replace(/Share this (?:article|story)\s*/gi, '')
    .replace(/^\s*Subscribe\s+.*$/gim, '')
    .replace(/^\s*(?:Read|See|Learn) more\s*:?\s*$/gim, '')
    .replace(/^\(.*?photo.*?\)\s*$/gim, '');

  // Tidy per line, then collapse the blank-line runs that doubled tags create.
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .trim();

  // Trailing publisher boilerplate.
  //
  // stripFeedBoilerplate() is NOT called here. It finishes with
  // `\s{2,} -> ' '`, which is right for a one-line RSS summary but turns every
  // "\n\n" paragraph break into a space — it collapsed a 2,023-word article
  // into a single paragraph. The same trailing rules are applied inline, with
  // the blank-line runs tidied afterwards instead of flattened.
  text = text
    .replace(/\s*the post .*?appeared first on .*?\.?\s*$/i, '')
    .replace(
      /\s*\b(?:read|see|learn|continue reading)\s*(?:more)?\s*:?\s*(?:at\s+)?https?:\/\/\S*\s*$/i,
      '',
    )
    .replace(/\s*\b(?:read|see|learn)\s+more\s*:?\s*$/i, '')
    .replace(/\s*\bcontinue reading\b.*$/i, '')
    .replace(/\s*\bsource\s*:\s*https?:\/\/\S*\s*$/i, '')
    .replace(/\s*https?:\/\/\S*\s*$/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (maxLength && text.length > maxLength) {
    text = text.substring(0, maxLength).trim();
    // Prefer cutting at a sentence end so the source does not stop mid-thought.
    const lastStop = Math.max(
      text.lastIndexOf('. '),
      text.lastIndexOf('\n\n'),
    );
    text = lastStop > maxLength * 0.8 ? text.substring(0, lastStop + 1) : text + '...';
  }

  return text.trim();
}

module.exports = {
  stripHtml,
  cleanTitle,
  decodeEntities,
  decodeEntitiesOnce,
  stripFeedBoilerplate,
  cleanContent,
  cleanDescription,
  htmlToParagraphText,
  extractTags,
  detectLanguage,
};
