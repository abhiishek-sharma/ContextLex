"use strict";

// Syntax check: every .js file must parse (`node --check`) and every
// .json file must be valid JSON. Run with `npm run check`.
// Uses only Node built-ins.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const SKIPPED_DIRS = new Set([".git", "node_modules"]);

function listFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) files.push(...listFiles(full));
    } else {
      files.push(full);
    }
  }
  return files.sort();
}

// Returns an error message, or null when the file is fine.
function check(file) {
  if (file.endsWith(".js")) {
    const result = spawnSync(process.execPath, ["--check", file], {
      encoding: "utf8",
    });
    return result.status === 0 ? null : result.stderr.trim();
  }

  try {
    JSON.parse(fs.readFileSync(file, "utf8"));
    return null;
  } catch (error) {
    return error.message;
  }
}

let checked = 0;
let failed = 0;

for (const file of listFiles(root)) {
  if (!file.endsWith(".js") && !file.endsWith(".json")) continue;

  const name = path.relative(root, file);
  const problem = check(file);
  checked++;

  if (problem) {
    failed++;
    console.error(`FAIL ${name}\n${problem}\n`);
  } else {
    console.log(`ok   ${name}`);
  }
}

console.log(`\n${checked} files checked, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
