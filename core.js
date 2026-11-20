/*
 * ContextLex core: logic with no DOM access.
 *
 * Chrome loads this file as a content script before content.js (see
 * manifest.json), where it is exposed as `ContextLexCore`. The Node tests in
 * test/ load the same file with require(), so there is no build step.
 */
(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof document === "undefined") {
    module.exports = api; // Node: the tests
  } else {
    root.ContextLexCore = api; // Chrome: read by content.js
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const API_BASE = "https://api.dictionaryapi.dev/api/v2/entries/en/";
  const MAX_SELECTION_LENGTH = 100;
  const MAX_MEANINGS = 3;
  const MAX_PHRASE_WORDS = 3;

  // ASCII letters plus the Latin-1 accented letters (so "café" and "naïve"
  // work). The two gaps skip the multiplication and division signs.
  const LETTERS = "A-Za-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u00FF";
  const TEXT_PATTERN = new RegExp(`^[${LETTERS}'-]+( [${LETTERS}'-]+)*$`);
  const HAS_LETTER = new RegExp(`[${LETTERS}]`);

  // Soft hyphens and zero-width characters that pages insert inside words.
  const INVISIBLE_CHARS = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;
  const TYPOGRAPHIC_APOSTROPHES = /[\u2018\u2019\u02BC]/g;
  const EDGE_PUNCTUATION = /^['-]+|['-]+$/g;

  // ---------------------------------------------------------------------
  // Word clean-up
  // ---------------------------------------------------------------------

  // Normalise raw selection text: drop invisible characters, turn curly
  // apostrophes into straight ones, collapse whitespace and trim.
  function cleanSelection(raw) {
    if (typeof raw !== "string") return "";
    return raw
      .replace(INVISIBLE_CHARS, "")
      .replace(TYPOGRAPHIC_APOSTROPHES, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  // True when cleaned text is one or more plain words worth looking up.
  function isValidText(text) {
    if (typeof text !== "string") return false;
    if (text.length === 0 || text.length > MAX_SELECTION_LENGTH) return false;
    return TEXT_PATTERN.test(text) && HAS_LETTER.test(text);
  }

  // The form of a word that is sent to the API: lower case, without leading
  // or trailing apostrophes and hyphens ("Dogs'" becomes "dogs").
  function toApiWord(token) {
    if (typeof token !== "string") return "";
    return token.replace(EDGE_PUNCTUATION, "").toLowerCase();
  }

  // The words of a cleaned selection that can be looked up.
  function splitWords(text) {
    if (typeof text !== "string") return [];
    return text
      .split(" ")
      .map(toApiWord)
      .filter((word) => word.length > 0);
  }

  function isSingleWord(text) {
    return splitWords(text).length === 1;
  }

  function buildApiUrl(apiWord) {
    return API_BASE + encodeURIComponent(apiWord);
  }

  // ---------------------------------------------------------------------
  // Response parsing
  // ---------------------------------------------------------------------

  function asText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function pickPhonetic(entry) {
    const direct = asText(entry.phonetic);
    if (direct) return direct;

    const phonetics = Array.isArray(entry.phonetics) ? entry.phonetics : [];
    for (const item of phonetics) {
      const text = asText(item && item.text);
      if (text) return text;
    }
    return null;
  }

  function pickMeanings(entry) {
    const meanings = [];
    const source = Array.isArray(entry.meanings) ? entry.meanings : [];

    for (const meaning of source) {
      if (meanings.length >= MAX_MEANINGS) break;
      if (!meaning || typeof meaning !== "object") continue;

      const definitions = Array.isArray(meaning.definitions)
        ? meaning.definitions
        : [];
      const first = definitions.find((item) => asText(item && item.definition));
      if (!first) continue;

      meanings.push({
        partOfSpeech: asText(meaning.partOfSpeech),
        definition: asText(first.definition),
        example: asText(first.example) || null,
      });
    }
    return meanings;
  }

  // Turn a Free Dictionary API response body into what the tooltip shows:
  // the first entry that has a usable definition, with one definition for
  // each of its first three parts of speech. Returns null when the body has
  // nothing usable. Every field that comes back is a string or null.
  function parseEntry(body, fallbackWord) {
    if (!Array.isArray(body)) return null;

    for (const entry of body) {
      if (!entry || typeof entry !== "object") continue;

      const meanings = pickMeanings(entry);
      if (meanings.length === 0) continue;

      return {
        word: asText(entry.word) || asText(fallbackWord),
        phonetic: pickPhonetic(entry),
        meanings,
      };
    }
    return null;
  }

  // A multi-word selection is shown as the first meaning of each word.
  function combinePhrase(phrase, entries) {
    return {
      word: phrase,
      phonetic: null,
      isPhrase: true,
      meanings: entries.map((entry) => {
        const first = entry.meanings[0];
        return {
          partOfSpeech: `${entry.word} (${first.partOfSpeech || "word"})`,
          definition: first.definition,
          example: first.example,
        };
      }),
    };
  }

  // ---------------------------------------------------------------------
  // Positioning maths
  // ---------------------------------------------------------------------

  function clamp(value, min, max) {
    // When the range is empty (tooltip larger than the viewport) min wins,
    // so the top-left corner of the tooltip stays visible.
    return Math.max(min, Math.min(value, max));
  }

  // Work out where the tooltip goes.
  //
  //   rect      selection rectangle in viewport coordinates
  //   tooltip   { width, height } of the rendered tooltip
  //   viewport  { width, height } of the visible area
  //   scroll    { x, y } page scroll offsets
  //
  // The tooltip is centred under the selection, flipped above it when there
  // is no room below, and kept `margin` pixels inside the viewport. The
  // result is in document coordinates for a `position: absolute` element.
  function computePosition({
    rect,
    tooltip,
    viewport,
    scroll,
    gap = 8,
    margin = 8,
  }) {
    const centred = rect.left + rect.width / 2 - tooltip.width / 2;
    const left = clamp(centred, margin, viewport.width - tooltip.width - margin);

    const below = rect.bottom + gap;
    const above = rect.top - gap - tooltip.height;
    const fitsBelow = below + tooltip.height + margin <= viewport.height;
    const fitsAbove = above >= margin;

    let placement = "below";
    if (!fitsBelow) {
      const roomBelow = viewport.height - rect.bottom;
      const roomAbove = rect.top;
      if (fitsAbove || roomAbove > roomBelow) placement = "above";
    }

    const wanted = placement === "below" ? below : above;
    const top = clamp(wanted, margin, viewport.height - tooltip.height - margin);

    return {
      top: Math.round(top + scroll.y),
      left: Math.round(left + scroll.x),
      placement,
    };
  }

  return {
    MAX_SELECTION_LENGTH,
    MAX_MEANINGS,
    MAX_PHRASE_WORDS,
    cleanSelection,
    isValidText,
    toApiWord,
    splitWords,
    isSingleWord,
    buildApiUrl,
    parseEntry,
    combinePhrase,
    computePosition,
  };
});
