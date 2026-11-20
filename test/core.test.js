"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const core = require("../core.js");

describe("cleanSelection", () => {
  test("trims and collapses whitespace", () => {
    assert.equal(core.cleanSelection("  hello \n\t world  "), "hello world");
  });

  test("treats a non-breaking space as whitespace", () => {
    assert.equal(core.cleanSelection("hello\u00A0world"), "hello world");
  });

  test("removes soft hyphens and zero-width characters", () => {
    assert.equal(core.cleanSelection("dic\u00ADtion\u200Bary\uFEFF"), "dictionary");
  });

  test("turns typographic apostrophes into straight ones", () => {
    assert.equal(core.cleanSelection("don\u2019t"), "don't");
    assert.equal(core.cleanSelection("\u2018tis"), "'tis");
  });

  test("returns an empty string for non-string input", () => {
    assert.equal(core.cleanSelection(null), "");
    assert.equal(core.cleanSelection(undefined), "");
    assert.equal(core.cleanSelection(42), "");
  });
});

describe("isValidText", () => {
  test("accepts single words, including hyphens, apostrophes and accents", () => {
    for (const text of ["word", "Word", "well-known", "don't", "café", "naïve"]) {
      assert.equal(core.isValidText(text), true, text);
    }
  });

  test("accepts several words separated by single spaces", () => {
    assert.equal(core.isValidText("ice cream"), true);
    assert.equal(core.isValidText("a b c d"), true);
  });

  test("rejects empty and non-string input", () => {
    assert.equal(core.isValidText(""), false);
    assert.equal(core.isValidText(null), false);
    assert.equal(core.isValidText(undefined), false);
  });

  test("rejects digits, punctuation and symbols", () => {
    for (const text of ["abc123", "hello,", "a.b", "50%", "x=y", "<b>", "a/b"]) {
      assert.equal(core.isValidText(text), false, text);
    }
  });

  test("rejects the multiplication and division signs", () => {
    assert.equal(core.isValidText("a\u00D7b"), false);
    assert.equal(core.isValidText("a\u00F7b"), false);
  });

  test("rejects text with no letter in it", () => {
    for (const text of ["-", "'", "--", "' -"]) {
      assert.equal(core.isValidText(text), false, JSON.stringify(text));
    }
  });

  test("rejects uncleaned whitespace", () => {
    assert.equal(core.isValidText(" word"), false);
    assert.equal(core.isValidText("two  spaces"), false);
    assert.equal(core.isValidText("line\nbreak"), false);
  });

  test("enforces the length limit", () => {
    const limit = core.MAX_SELECTION_LENGTH;
    assert.equal(core.isValidText("a".repeat(limit)), true);
    assert.equal(core.isValidText("a".repeat(limit + 1)), false);
  });
});

describe("toApiWord and splitWords", () => {
  test("lower-cases the word", () => {
    assert.equal(core.toApiWord("Hello"), "hello");
    assert.equal(core.toApiWord("CAFÉ"), "café");
  });

  test("strips apostrophes and hyphens from the edges only", () => {
    assert.equal(core.toApiWord("dogs'"), "dogs");
    assert.equal(core.toApiWord("'tis"), "tis");
    assert.equal(core.toApiWord("-well-known-"), "well-known");
    assert.equal(core.toApiWord("don't"), "don't");
  });

  test("returns an empty string when nothing is left", () => {
    assert.equal(core.toApiWord("-"), "");
    assert.equal(core.toApiWord(undefined), "");
  });

  test("splits a selection into words that can be looked up", () => {
    assert.deepEqual(core.splitWords("Ice Cream"), ["ice", "cream"]);
    assert.deepEqual(core.splitWords("cats - dogs"), ["cats", "dogs"]);
    assert.deepEqual(core.splitWords(""), []);
  });

  test("isSingleWord counts the words that can be looked up", () => {
    assert.equal(core.isSingleWord("word"), true);
    assert.equal(core.isSingleWord("word -"), true);
    assert.equal(core.isSingleWord("two words"), false);
    assert.equal(core.isSingleWord(""), false);
  });
});

describe("buildApiUrl", () => {
  test("points at the English endpoint of the Free Dictionary API", () => {
    assert.equal(
      core.buildApiUrl("hello"),
      "https://api.dictionaryapi.dev/api/v2/entries/en/hello",
    );
  });

  test("percent-encodes the word", () => {
    assert.equal(
      core.buildApiUrl("café"),
      "https://api.dictionaryapi.dev/api/v2/entries/en/caf%C3%A9",
    );
    assert.ok(core.buildApiUrl("a/b?c").endsWith("/en/a%2Fb%3Fc"));
  });
});

// Shaped like a real response from api.dictionaryapi.dev; the wording is
// made up for the tests.
function sampleBody() {
  return [
    {
      word: "sample",
      phonetics: [{ audio: "https://example.test/sample.mp3" }, { text: "/ˈsæmpəl/" }],
      meanings: [
        {
          partOfSpeech: "noun",
          definitions: [
            { definition: "A small part shown as an example.", example: "A sample of cloth." },
            { definition: "A second noun sense." },
          ],
        },
        {
          partOfSpeech: "verb",
          definitions: [{ definition: "To try a small part of something." }],
        },
        {
          partOfSpeech: "adjective",
          definitions: [{ definition: "Serving as an example." }],
        },
        {
          partOfSpeech: "interjection",
          definitions: [{ definition: "A fourth meaning that is not shown." }],
        },
      ],
    },
    {
      word: "sample",
      meanings: [
        { partOfSpeech: "noun", definitions: [{ definition: "From a second entry." }] },
      ],
    },
  ];
}

describe("parseEntry", () => {
  test("keeps the first definition of the first three parts of speech", () => {
    assert.deepEqual(core.parseEntry(sampleBody(), "sample"), {
      word: "sample",
      phonetic: "/ˈsæmpəl/",
      meanings: [
        {
          partOfSpeech: "noun",
          definition: "A small part shown as an example.",
          example: "A sample of cloth.",
        },
        {
          partOfSpeech: "verb",
          definition: "To try a small part of something.",
          example: null,
        },
        {
          partOfSpeech: "adjective",
          definition: "Serving as an example.",
          example: null,
        },
      ],
    });
  });

  test("prefers the top-level phonetic field", () => {
    const body = sampleBody();
    body[0].phonetic = "/top/";
    assert.equal(core.parseEntry(body, "sample").phonetic, "/top/");
  });

  test("returns a null phonetic when none has text", () => {
    const body = sampleBody();
    body[0].phonetics = [{ audio: "x" }, { text: "" }, null];
    assert.equal(core.parseEntry(body, "sample").phonetic, null);

    delete body[0].phonetics;
    assert.equal(core.parseEntry(body, "sample").phonetic, null);
  });

  test("falls back to the looked-up word when the entry has no word", () => {
    const body = sampleBody();
    delete body[0].word;
    assert.equal(core.parseEntry(body, "fallback").word, "fallback");
  });

  test("skips an entry without usable meanings", () => {
    const body = sampleBody();
    body[0].meanings = [{ partOfSpeech: "noun", definitions: [] }];
    const parsed = core.parseEntry(body, "sample");
    assert.equal(parsed.meanings.length, 1);
    assert.equal(parsed.meanings[0].definition, "From a second entry.");
  });

  test("skips definitions that are missing or not strings", () => {
    const body = [
      {
        word: "odd",
        meanings: [
          { partOfSpeech: "noun", definitions: [{ definition: { nested: true } }] },
          { partOfSpeech: "verb", definitions: [{}, { definition: "  Usable.  " }] },
          null,
          "text",
        ],
      },
    ];
    assert.deepEqual(core.parseEntry(body, "odd").meanings, [
      { partOfSpeech: "verb", definition: "Usable.", example: null },
    ]);
  });

  test("never returns non-string fields", () => {
    const body = [
      {
        word: 7,
        phonetic: { text: "x" },
        meanings: [
          {
            partOfSpeech: ["noun"],
            definitions: [{ definition: "Fine.", example: 12 }],
          },
        ],
      },
    ];
    assert.deepEqual(core.parseEntry(body, "seven"), {
      word: "seven",
      phonetic: null,
      meanings: [{ partOfSpeech: "", definition: "Fine.", example: null }],
    });
  });

  test("returns null for bodies with nothing usable", () => {
    const notFound = {
      title: "No Definitions Found",
      message: "Sorry pal, we couldn't find definitions for the word you were looking for.",
    };
    for (const body of [null, undefined, "text", 5, {}, [], [null], [{}], notFound]) {
      assert.equal(core.parseEntry(body, "x"), null, JSON.stringify(body));
    }
  });
});

describe("combinePhrase", () => {
  test("shows the first meaning of each word under the selected text", () => {
    const ice = {
      word: "ice",
      phonetic: "/aɪs/",
      meanings: [
        { partOfSpeech: "noun", definition: "Frozen water.", example: "Ice on the road." },
        { partOfSpeech: "verb", definition: "To cover with ice.", example: null },
      ],
    };
    const cream = {
      word: "cream",
      phonetic: null,
      meanings: [{ partOfSpeech: "", definition: "The fatty part of milk.", example: null }],
    };

    assert.deepEqual(core.combinePhrase("Ice Cream", [ice, cream]), {
      word: "Ice Cream",
      phonetic: null,
      isPhrase: true,
      meanings: [
        {
          partOfSpeech: "ice (noun)",
          definition: "Frozen water.",
          example: "Ice on the road.",
        },
        {
          partOfSpeech: "cream (word)",
          definition: "The fatty part of milk.",
          example: null,
        },
      ],
    });
  });
});

describe("computePosition", () => {
  const tooltip = { width: 200, height: 100 };
  const viewport = { width: 1000, height: 800 };
  const noScroll = { x: 0, y: 0 };

  function rectAt(left, top, width = 60, height = 20) {
    return { left, top, width, height, right: left + width, bottom: top + height };
  }

  test("centres the tooltip under the selection", () => {
    const position = core.computePosition({
      rect: rectAt(400, 300),
      tooltip,
      viewport,
      scroll: noScroll,
    });
    // Selection centre is x=430, so left = 430 - 100. Top = 320 + 8 gap.
    assert.deepEqual(position, { top: 328, left: 330, placement: "below" });
  });

  test("adds the page scroll offsets", () => {
    const position = core.computePosition({
      rect: rectAt(400, 300),
      tooltip,
      viewport,
      scroll: { x: 50, y: 1200 },
    });
    assert.deepEqual(position, { top: 1528, left: 380, placement: "below" });
  });

  test("keeps the margin from the left edge", () => {
    const position = core.computePosition({
      rect: rectAt(0, 300, 20),
      tooltip,
      viewport,
      scroll: noScroll,
    });
    assert.equal(position.left, 8);
  });

  test("keeps the margin from the right edge", () => {
    const position = core.computePosition({
      rect: rectAt(960, 300, 40),
      tooltip,
      viewport,
      scroll: noScroll,
    });
    assert.equal(position.left, 1000 - 200 - 8);
  });

  test("clamps against the visible area on a horizontally scrolled page", () => {
    const position = core.computePosition({
      rect: rectAt(960, 300, 40),
      tooltip,
      viewport,
      scroll: { x: 500, y: 0 },
    });
    // 792 inside the viewport, which is 1292 in document coordinates.
    assert.equal(position.left, 1292);
  });

  test("flips above the selection when there is no room below", () => {
    const position = core.computePosition({
      rect: rectAt(400, 740),
      tooltip,
      viewport,
      scroll: { x: 0, y: 2000 },
    });
    // 740 - 8 gap - 100 height = 632 in the viewport.
    assert.deepEqual(position, { top: 2632, left: 330, placement: "above" });
  });

  test("stays below when it fits exactly", () => {
    // bottom 684 + 8 gap + 100 height + 8 margin = 800.
    const position = core.computePosition({
      rect: rectAt(400, 664),
      tooltip,
      viewport,
      scroll: noScroll,
    });
    assert.equal(position.placement, "below");
    assert.equal(position.top, 692);
  });

  test("stays inside the viewport when neither side has room", () => {
    const small = { width: 1000, height: 150 };

    const nearTop = core.computePosition({
      rect: rectAt(400, 40),
      tooltip,
      viewport: small,
      scroll: { x: 0, y: 300 },
    });
    // More room below (90px) than above (40px): pinned to the bottom margin.
    assert.deepEqual(nearTop, { top: 300 + 42, left: 330, placement: "below" });

    const nearBottom = core.computePosition({
      rect: rectAt(400, 100),
      tooltip,
      viewport: small,
      scroll: { x: 0, y: 300 },
    });
    // More room above (100px) than below (30px): pinned to the top margin.
    assert.deepEqual(nearBottom, { top: 300 + 8, left: 330, placement: "above" });
  });

  test("keeps the top-left corner visible when the tooltip is larger than the viewport", () => {
    const position = core.computePosition({
      rect: rectAt(10, 10),
      tooltip: { width: 400, height: 300 },
      viewport: { width: 300, height: 200 },
      scroll: noScroll,
    });
    assert.equal(position.left, 8);
    assert.equal(position.top, 8);
  });

  test("accepts a custom gap and margin", () => {
    const position = core.computePosition({
      rect: rectAt(0, 300, 20),
      tooltip,
      viewport,
      scroll: noScroll,
      gap: 4,
      margin: 16,
    });
    assert.deepEqual(position, { top: 324, left: 16, placement: "below" });
  });
});

describe("createCache", () => {
  test("returns what was stored and undefined for a miss", () => {
    const cache = core.createCache();
    cache.set("a", { status: "ok" });
    assert.deepEqual(cache.get("a"), { status: "ok" });
    assert.equal(cache.get("b"), undefined);
    assert.equal(cache.size, 1);
  });

  test("drops the least recently used entry when full", () => {
    const cache = core.createCache(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // "b" is now the oldest
    cache.set("c", 3);

    assert.equal(cache.size, 2);
    assert.equal(cache.get("a"), 1);
    assert.equal(cache.get("b"), undefined);
    assert.equal(cache.get("c"), 3);
  });

  test("overwriting a key does not grow the cache", () => {
    const cache = core.createCache(2);
    cache.set("a", 1);
    cache.set("a", 2);
    assert.equal(cache.size, 1);
    assert.equal(cache.get("a"), 2);
  });
});

// A fetch stand-in that records its calls and answers through `handler`.
function fakeFetch(handler) {
  const calls = [];
  const fetchImpl = (url, init) => {
    calls.push({ url, init, word: decodeURIComponent(url.split("/").pop()) });
    return handler(calls[calls.length - 1]);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status });
}

function entryFor(word) {
  return [
    {
      word,
      meanings: [
        { partOfSpeech: "noun", definitions: [{ definition: `Meaning of ${word}.` }] },
      ],
    },
  ];
}

// Never answers; rejects the way fetch does once its signal is aborted.
function hangUntilAborted({ init }) {
  return new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("lookup", () => {
  test("returns the parsed entry for one word", async () => {
    const fetchImpl = fakeFetch(({ word }) => json(200, entryFor(word)));
    const result = await core.lookup("Sample", { fetchImpl });

    assert.equal(result.status, "ok");
    assert.equal(result.data.word, "sample");
    assert.equal(result.data.meanings[0].definition, "Meaning of sample.");
    assert.equal(result.data.isPhrase, undefined);
    assert.equal(fetchImpl.calls.length, 1);
    assert.equal(
      fetchImpl.calls[0].url,
      "https://api.dictionaryapi.dev/api/v2/entries/en/sample",
    );
  });

  test("sends no cookies and no referrer, bypasses the HTTP cache and passes an abort signal", async () => {
    const fetchImpl = fakeFetch(({ word }) => json(200, entryFor(word)));
    await core.lookup("sample", { fetchImpl });

    const { init } = fetchImpl.calls[0];
    assert.equal(init.credentials, "omit");
    assert.equal(init.referrerPolicy, "no-referrer");
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
  });

  test("fetches a word once and answers later lookups from the cache", async () => {
    const fetchImpl = fakeFetch(({ word }) => json(200, entryFor(word)));
    const cache = core.createCache();

    const first = await core.lookup("sample", { fetchImpl, cache });
    const second = await core.lookup("SAMPLE", { fetchImpl, cache });

    assert.equal(fetchImpl.calls.length, 1);
    assert.deepEqual(second, first);
  });

  test("reports not_found for a 404 and caches it", async () => {
    const fetchImpl = fakeFetch(() => json(404, { title: "No Definitions Found" }));
    const cache = core.createCache();

    assert.deepEqual(await core.lookup("qwzx", { fetchImpl, cache }), {
      status: "not_found",
    });
    assert.deepEqual(await core.lookup("qwzx", { fetchImpl, cache }), {
      status: "not_found",
    });
    assert.equal(fetchImpl.calls.length, 1);
  });

  test("reports not_found when a 200 response has nothing usable", async () => {
    const fetchImpl = fakeFetch(() => json(200, []));
    assert.deepEqual(await core.lookup("sample", { fetchImpl }), {
      status: "not_found",
    });
  });

  test("reports an HTTP error with its status and does not cache it", async () => {
    const fetchImpl = fakeFetch(() => json(500, { message: "boom" }));
    const cache = core.createCache();

    assert.deepEqual(await core.lookup("sample", { fetchImpl, cache }), {
      status: "error",
      httpStatus: 500,
    });
    await core.lookup("sample", { fetchImpl, cache });
    assert.equal(fetchImpl.calls.length, 2);
    assert.equal(cache.size, 0);
  });

  test("reports an error when the request fails while online", async () => {
    const fetchImpl = fakeFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    assert.deepEqual(await core.lookup("sample", { fetchImpl }), { status: "error" });
  });

  test("reports an error when the body is not JSON", async () => {
    const fetchImpl = fakeFetch(() => new Response("<html>", { status: 200 }));
    assert.deepEqual(await core.lookup("sample", { fetchImpl }), { status: "error" });
  });

  test("sends the request even when the browser reports no connection", async () => {
    // navigator.onLine can be false while requests still get through.
    const fetchImpl = fakeFetch(({ word }) => json(200, entryFor(word)));
    const result = await core.lookup("sample", { fetchImpl, isOnline: () => false });

    assert.equal(result.status, "ok");
    assert.equal(fetchImpl.calls.length, 1);
  });

  test("labels a failed request offline when the browser reports no connection", async () => {
    const fetchImpl = fakeFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    const result = await core.lookup("sample", { fetchImpl, isOnline: () => false });

    assert.deepEqual(result, { status: "offline" });
    assert.equal(fetchImpl.calls.length, 1);
  });

  test("labels an HTTP error by its status even when the browser reports no connection", async () => {
    const fetchImpl = fakeFetch(() => json(503, {}));
    const result = await core.lookup("sample", { fetchImpl, isOnline: () => false });
    assert.deepEqual(result, { status: "error", httpStatus: 503 });
  });

  test("reports offline when the connection drops during the request", async () => {
    let online = true;
    const fetchImpl = fakeFetch(() => {
      online = false;
      return Promise.reject(new TypeError("Failed to fetch"));
    });
    const result = await core.lookup("sample", { fetchImpl, isOnline: () => online });
    assert.deepEqual(result, { status: "offline" });
  });

  test("still answers from the cache while offline", async () => {
    const fetchImpl = fakeFetch(({ word }) => json(200, entryFor(word)));
    const cache = core.createCache();
    await core.lookup("sample", { fetchImpl, cache });

    const result = await core.lookup("sample", { fetchImpl, cache, isOnline: () => false });
    assert.equal(result.status, "ok");
    assert.equal(fetchImpl.calls.length, 1);
  });

  test("times out and aborts the request", async () => {
    const fetchImpl = fakeFetch(hangUntilAborted);
    const result = await core.lookup("sample", { fetchImpl, timeoutMs: 20 });

    assert.deepEqual(result, { status: "timeout" });
    assert.equal(fetchImpl.calls[0].init.signal.aborted, true);
  });

  test("does not cache a timeout", async () => {
    const cache = core.createCache();
    await core.lookup("sample", { fetchImpl: fakeFetch(hangUntilAborted), cache, timeoutMs: 10 });
    assert.equal(cache.size, 0);
  });

  test("leaves the request alone once it has answered in time", async () => {
    const fetchImpl = fakeFetch(({ word }) => json(200, entryFor(word)));
    await core.lookup("sample", { fetchImpl, timeoutMs: 10 });
    await sleep(30);
    assert.equal(fetchImpl.calls[0].init.signal.aborted, false);
  });

  test("is cancelled through the caller's signal", async () => {
    const fetchImpl = fakeFetch(hangUntilAborted);
    const controller = new AbortController();

    const pending = core.lookup("sample", { fetchImpl, signal: controller.signal });
    await sleep(5);
    controller.abort();

    assert.deepEqual(await pending, { status: "aborted" });
    assert.equal(fetchImpl.calls[0].init.signal.aborted, true);
  });

  test("does not send a request when already cancelled", async () => {
    const fetchImpl = fakeFetch(({ word }) => json(200, entryFor(word)));
    const controller = new AbortController();
    controller.abort();

    const result = await core.lookup("sample", { fetchImpl, signal: controller.signal });
    assert.deepEqual(result, { status: "aborted" });
    assert.equal(fetchImpl.calls.length, 0);
  });

  test("looks up the first three words of a longer selection, in order", async () => {
    const fetchImpl = fakeFetch(({ word }) => json(200, entryFor(word)));
    const result = await core.lookup("One two THREE four", { fetchImpl });

    assert.deepEqual(
      fetchImpl.calls.map((call) => call.word),
      ["one", "two", "three"],
    );
    assert.equal(result.status, "ok");
    assert.equal(result.data.word, "One two THREE four");
    assert.equal(result.data.isPhrase, true);
    assert.deepEqual(
      result.data.meanings.map((meaning) => meaning.partOfSpeech),
      ["one (noun)", "two (noun)", "three (noun)"],
    );
  });

  test("shows the words it found when another word has no definition", async () => {
    const fetchImpl = fakeFetch(({ word }) =>
      word === "qwzx" ? json(404, {}) : json(200, entryFor(word)),
    );
    const result = await core.lookup("ice qwzx", { fetchImpl });

    assert.equal(result.status, "ok");
    assert.equal(result.data.isPhrase, true);
    assert.deepEqual(
      result.data.meanings.map((meaning) => meaning.definition),
      ["Meaning of ice."],
    );
  });

  test("reports not_found when no word of the selection has a definition", async () => {
    const fetchImpl = fakeFetch(() => json(404, {}));
    assert.deepEqual(await core.lookup("qwzx zzxq", { fetchImpl }), {
      status: "not_found",
    });
    assert.equal(fetchImpl.calls.length, 2);
  });

  test("stops at the first failed request", async () => {
    const fetchImpl = fakeFetch(() => json(503, {}));
    const result = await core.lookup("one two three", { fetchImpl });

    assert.deepEqual(result, { status: "error", httpStatus: 503 });
    assert.equal(fetchImpl.calls.length, 1);
  });

  test("keeps earlier words when a later request fails", async () => {
    const fetchImpl = fakeFetch(({ word }) =>
      word === "one" ? json(200, entryFor(word)) : json(503, {}),
    );
    const result = await core.lookup("one two three", { fetchImpl });

    assert.equal(result.status, "ok");
    assert.equal(result.data.meanings.length, 1);
    assert.equal(fetchImpl.calls.length, 2);
  });

  test("reports not_found for text with no word in it", async () => {
    const fetchImpl = fakeFetch(() => json(200, []));
    assert.deepEqual(await core.lookup("- -", { fetchImpl }), { status: "not_found" });
    assert.equal(fetchImpl.calls.length, 0);
  });
});

describe("describeFailure", () => {
  test("names the text that was not found", () => {
    assert.equal(
      core.describeFailure({ status: "not_found" }, "qwzx"),
      'No definition found for "qwzx".',
    );
  });

  test("gives offline, timeout and error their own messages", () => {
    const messages = [
      core.describeFailure({ status: "not_found" }, "x"),
      core.describeFailure({ status: "offline" }, "x"),
      core.describeFailure({ status: "timeout" }, "x"),
      core.describeFailure({ status: "error" }, "x"),
      core.describeFailure({ status: "error", httpStatus: 429 }, "x"),
    ];

    assert.equal(new Set(messages).size, messages.length);
    assert.match(messages[1], /offline/i);
    assert.match(messages[2], /did not respond in time/);
    assert.match(messages[3], /Could not reach/);
    assert.match(messages[4], /HTTP 429/);
  });
});

describe("isSelectingInFocusedField", () => {
  function field(tagName, selectionStart, selectionEnd, extra = {}) {
    return { nodeType: 1, tagName, parentNode: null, selectionStart, selectionEnd, ...extra };
  }

  test("is true for a text field with selected text", () => {
    assert.equal(core.isSelectingInFocusedField(field("INPUT", 0, 6)), true);
    assert.equal(core.isSelectingInFocusedField(field("TEXTAREA", 2, 9)), true);
  });

  test("is false for a text field with only the caret in it", () => {
    assert.equal(core.isSelectingInFocusedField(field("INPUT", 3, 3)), false);
    assert.equal(core.isSelectingInFocusedField(field("TEXTAREA", 0, 0)), false);
  });

  test("is true for a field that does not report its selection", () => {
    // Chrome returns null for email and number inputs.
    assert.equal(core.isSelectingInFocusedField(field("INPUT", null, null, { type: "email" })), true);
  });

  test("is true for focused contenteditable content", () => {
    const editor = { nodeType: 1, tagName: "DIV", parentNode: null, isContentEditable: true };
    assert.equal(core.isSelectingInFocusedField(editor), true);
  });

  test("is false for other focused elements and for no element", () => {
    const body = { nodeType: 1, tagName: "BODY", parentNode: null, isContentEditable: false };
    assert.equal(core.isSelectingInFocusedField(body), false);
    assert.equal(core.isSelectingInFocusedField(null), false);
  });
});

describe("isEditableNode", () => {
  // Stand-ins with the few DOM properties the function reads.
  function el(tagName, parentNode = null, extra = {}) {
    return { nodeType: 1, tagName, parentNode, isContentEditable: false, ...extra };
  }
  function textIn(parentNode) {
    return { nodeType: 3, parentNode };
  }

  test("is true for inputs of any type and for textareas", () => {
    assert.equal(core.isEditableNode(el("INPUT", null, { type: "text" })), true);
    assert.equal(core.isEditableNode(el("INPUT", null, { type: "password" })), true);
    assert.equal(core.isEditableNode(el("TEXTAREA")), true);
    assert.equal(core.isEditableNode(el("textarea")), true);
  });

  test("is true for contenteditable elements and what is inside them", () => {
    const editor = el("DIV", el("BODY"), { isContentEditable: true });
    const paragraph = el("P", editor, { isContentEditable: true });

    assert.equal(core.isEditableNode(editor), true);
    assert.equal(core.isEditableNode(paragraph), true);
    assert.equal(core.isEditableNode(textIn(paragraph)), true);
    // Still found through the ancestors if the flag is only on the host.
    assert.equal(core.isEditableNode(textIn(el("SPAN", editor))), true);
  });

  test("is false for ordinary page content", () => {
    const paragraph = el("P", el("ARTICLE", el("BODY", el("HTML"))));

    assert.equal(core.isEditableNode(paragraph), false);
    assert.equal(core.isEditableNode(textIn(paragraph)), false);
    assert.equal(core.isEditableNode(el("BUTTON")), false);
  });

  test("is false when there is no node", () => {
    assert.equal(core.isEditableNode(null), false);
    assert.equal(core.isEditableNode(undefined), false);
  });
});
