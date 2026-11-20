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

describe("manifest.json", () => {
  test("is Manifest V3 with a name, a semantic version and a description", () => {
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.name, "ContextLex");
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
    assert.ok(manifest.description.length > 0);
    // The manifest format allows at most 132 characters.
    assert.ok(manifest.description.length <= 132, "description is too long");
  });

  test("requests no API permissions and no host permissions", () => {
    // The README says so. Update it if this ever changes.
    assert.deepEqual(manifest.permissions, []);
    assert.equal(manifest.host_permissions, undefined);
    assert.equal(manifest.optional_permissions, undefined);
    assert.equal(manifest.optional_host_permissions, undefined);
  });

  test("declares one content script entry, for the top frame of every page", () => {
    assert.equal(manifest.content_scripts.length, 1);
    const [entry] = manifest.content_scripts;
    assert.deepEqual(entry.matches, ["<all_urls>"]);
    assert.equal(entry.all_frames, undefined);
  });

  test("only refers to files that exist", () => {
    const files = [
      ...manifest.content_scripts.flatMap((entry) => [
        ...(entry.js || []),
        ...(entry.css || []),
      ]),
      ...Object.values(manifest.icons),
    ];
    for (const file of files) {
      assert.ok(fs.existsSync(path.join(root, file)), `${file} is missing`);
    }
  });

  test("has PNG icons at 16, 48 and 128 pixels", () => {
    assert.deepEqual(Object.keys(manifest.icons), ["16", "48", "128"]);

    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (const [size, file] of Object.entries(manifest.icons)) {
      const png = fs.readFileSync(path.join(root, file));
      assert.deepEqual(png.subarray(0, 8), pngSignature, `${file} is not a PNG`);
      // Width and height sit at the start of the IHDR chunk.
      assert.equal(png.readUInt32BE(16), Number(size), `${file} width`);
      assert.equal(png.readUInt32BE(20), Number(size), `${file} height`);
    }
  });
});

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
