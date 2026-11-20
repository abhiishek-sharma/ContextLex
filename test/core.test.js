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
