"use strict";

// Checks on the files Chrome loads, read from disk the way Chrome would.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const scripts = manifest.content_scripts.flatMap((entry) => entry.js || []);

describe("content scripts", () => {
  test("core.js is loaded before content.js", () => {
    assert.deepEqual(scripts, ["core.js", "content.js"]);
  });

  test("never write HTML strings into the page", () => {
    const htmlSinks = /innerHTML|outerHTML|insertAdjacentHTML|document\.write/;
    for (const file of scripts) {
      assert.doesNotMatch(read(file), htmlSinks, file);
    }
  });
});
