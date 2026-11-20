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
  const LOOKUP_TIMEOUT_MS = 8000;
  const CACHE_MAX_ENTRIES = 100;

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

  function buildApiUrl(apiWord) {
    return API_BASE + encodeURIComponent(apiWord);
  }

  // ---------------------------------------------------------------------
  // Editable content
  // ---------------------------------------------------------------------

  // True when a DOM node is, or sits inside, something the user types in:
  // an <input> of any type (password fields included), a <textarea> or
  // contenteditable content. It only reads plain properties, so the tests
  // can pass in simple objects.
  function isEditableNode(node) {
    for (let current = node; current; current = current.parentNode) {
      if (current.nodeType !== 1) continue;

      const tag = String(current.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA") return true;
      if (current.isContentEditable === true) return true;
    }
    return false;
  }

  // Input types that hold typed text but report a null selectionStart.
  const TEXT_TYPES_WITHOUT_SELECTION_API = new Set(["email", "number"]);

  // True when the focused element holds the selection the user is making:
  // a text field with selected text in it, or contenteditable content. A
  // field with only the caret in it does not count, so page text can still
  // be looked up while a search box keeps focus. Email and number fields
  // do not report their selection, so they are counted whenever they have
  // focus. Other inputs that report null (checkbox, radio, range, button,
  // file, color...) hold no text to select and are not counted.
  function isSelectingInFocusedField(active) {
    if (!active || active.nodeType !== 1) return false;

    const tag = String(active.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA") {
      const { selectionStart, selectionEnd } = active;
      if (typeof selectionStart === "number") {
        return selectionStart !== selectionEnd;
      }
      const type = String(active.type || "").toLowerCase();
      return TEXT_TYPES_WITHOUT_SELECTION_API.has(type);
    }
    return isEditableNode(active);
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

  // ---------------------------------------------------------------------
  // Lookup: cache, timeout, cancellation
  // ---------------------------------------------------------------------

  // A small least-recently-used cache keyed by the word sent to the API.
  function createCache(maxEntries = CACHE_MAX_ENTRIES) {
    const entries = new Map();

    return {
      get(key) {
        if (!entries.has(key)) return undefined;
        const value = entries.get(key);
        entries.delete(key);
        entries.set(key, value);
        return value;
      },
      set(key, value) {
        entries.delete(key);
        entries.set(key, value);
        if (entries.size > maxEntries) {
          entries.delete(entries.keys().next().value);
        }
      },
      get size() {
        return entries.size;
      },
    };
  }

  // Look up cleaned selection text. One word is shown as its dictionary
  // entry; several words are looked up one by one (the first three only)
  // and shown together.
  //
  //   options.fetchImpl  fetch-compatible function
  //   options.signal     AbortSignal that cancels the lookup
  //   options.cache      cache from createCache()
  //   options.isOnline   returns false when the browser reports no
  //                      connection; only used to label a failed request
  //   options.timeoutMs  time allowed for the whole lookup
  //
  // Resolves (it does not reject) with one of:
  //   { status: "ok", data }             something to show
  //   { status: "not_found" }            the dictionary has no definition
  //   { status: "offline" }              no connection
  //   { status: "timeout" }              no answer within timeoutMs
  //   { status: "error", httpStatus? }   request failed or bad response
  //   { status: "aborted" }              cancelled through options.signal
  //
  // Definitions and "not found" answers are cached; failures are not.
  async function lookup(text, options) {
    const {
      fetchImpl,
      signal,
      cache,
      isOnline = () => true,
      timeoutMs = LOOKUP_TIMEOUT_MS,
    } = options;

    const allWords = splitWords(text);
    const words = allWords.slice(0, MAX_PHRASE_WORDS);
    if (words.length === 0) return { status: "not_found" };

    // One controller serves both the caller's cancellation and the timeout.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const cancel = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", cancel, { once: true });
    }

    function failure() {
      if (timedOut) return { status: "timeout" };
      if (controller.signal.aborted) return { status: "aborted" };
      if (!isOnline()) return { status: "offline" };
      return { status: "error" };
    }

    async function lookupWord(word) {
      const cached = cache ? cache.get(word) : undefined;
      if (cached) return cached;
      if (controller.signal.aborted) return failure();

      let result;
      try {
        const response = await fetchImpl(buildApiUrl(word), {
          signal: controller.signal,
          credentials: "omit",
          referrerPolicy: "no-referrer",
          // Keep answers out of the browser's HTTP cache: the in-memory
          // cache above is the only one, and it ends with the page.
          cache: "no-store",
        });

        if (response.status === 404) {
          result = { status: "not_found" };
        } else if (!response.ok) {
          return { status: "error", httpStatus: response.status };
        } else {
          const entry = parseEntry(await response.json(), word);
          result = entry ? { status: "ok", entry } : { status: "not_found" };
        }
      } catch (error) {
        return failure();
      }

      if (cache) cache.set(word, result);
      return result;
    }

    try {
      const entries = [];
      let failed = null;

      for (const word of words) {
        const result = await lookupWord(word);
        if (result.status === "aborted") return result;
        if (result.status === "ok") {
          entries.push(result.entry);
        } else if (result.status !== "not_found") {
          // Offline, timed out or failing: the next word would go the same way.
          failed = result;
          break;
        }
      }

      if (entries.length === 0) return failed || { status: "not_found" };
      if (allWords.length === 1) return { status: "ok", data: entries[0] };
      return { status: "ok", data: combinePhrase(text, entries) };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", cancel);
    }
  }

  // The message shown for every lookup result that is not "ok".
  function describeFailure(result, text) {
    switch (result.status) {
      case "not_found":
        return `No definition found for "${text}".`;
      case "offline":
        return "You appear to be offline. Reconnect and try again.";
      case "timeout":
        return "The dictionary did not respond in time. Try again.";
      default:
        return result.httpStatus
          ? `The dictionary returned an error (HTTP ${result.httpStatus}). Try again later.`
          : "Could not reach the dictionary. Try again later.";
    }
  }

  return {
    MAX_SELECTION_LENGTH,
    MAX_MEANINGS,
    MAX_PHRASE_WORDS,
    LOOKUP_TIMEOUT_MS,
    CACHE_MAX_ENTRIES,
    cleanSelection,
    isValidText,
    toApiWord,
    splitWords,
    buildApiUrl,
    isEditableNode,
    isSelectingInFocusedField,
    parseEntry,
    combinePhrase,
    computePosition,
    createCache,
    lookup,
    describeFailure,
  };
});
