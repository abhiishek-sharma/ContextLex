"use strict";

// Runs the content scripts the way Chrome does: every file listed in the
// manifest, in order, in one shared global scope. The page is a minimal
// stand-in, so this checks the wiring between core.js and content.js,
// not the tooltip's behaviour.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const scripts = manifest.content_scripts[0].js;

function listenerRecorder() {
  const types = [];
  return { types, addEventListener: (type) => types.push(type) };
}

function runContentScripts() {
  const documentEvents = listenerRecorder();
  const windowEvents = listenerRecorder();

  const page = {
    document: {
      addEventListener: documentEvents.addEventListener,
      documentElement: {},
      body: {},
    },
    addEventListener: windowEvents.addEventListener,
  };
  page.window = page;

  const context = vm.createContext(page);
  for (const file of scripts) {
    vm.runInContext(read(file), context, { filename: file });
  }
  return { page, documentEvents: documentEvents.types, windowEvents: windowEvents.types };
}

describe("content scripts in the page", () => {
  test("core.js exposes ContextLexCore", () => {
    const { page } = runContentScripts();
    assert.equal(typeof page.ContextLexCore, "object");
    assert.notEqual(page.ContextLexCore, null);
  });

  test("everything content.js uses from core.js exists", () => {
    const { page } = runContentScripts();
    const code = read("content.js")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const used = new Set(
      [...code.matchAll(/\bcore\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1]),
    );

    assert.ok(used.size > 0, "content.js uses nothing from core.js");
    for (const name of used) {
      const value = page.ContextLexCore[name];
      if (/^[A-Z][A-Z0-9_]*$/.test(name)) {
        assert.notEqual(value, undefined, `core.${name} is missing`);
      } else {
        assert.equal(typeof value, "function", `core.${name} is not a function`);
      }
    }
  });

  test("content.js sets itself up and listens for selections", () => {
    const { documentEvents, windowEvents } = runContentScripts();

    for (const type of [
      "mousedown",
      "mouseup",
      "dblclick",
      "selectionchange",
      "click",
      "scroll",
      "keydown",
    ]) {
      assert.ok(documentEvents.includes(type), `no ${type} listener`);
    }
    assert.deepEqual(windowEvents, ["beforeunload"]);
  });
});
