// The repository's files, as every tool under tools/ lists them
// (tools/documents.js): git's files in a checkout of its own, and every
// file elsewhere, an export inside another checkout included.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { markdownFiles, ownCheckout } from "../../../tools/documents.js";

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });

test("a checkout of its own lists what git tracks, and anything else lists every file", () => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), "documents-"));
  git(outer, "init", "-q");
  fs.writeFileSync(path.join(outer, "outer.md"), "# Outer\n");
  git(outer, "add", "outer.md");
  // An export placed inside the outer checkout has no .git of its own.
  const tree = path.join(outer, "export");
  fs.mkdirSync(path.join(tree, "docs"), { recursive: true });
  fs.writeFileSync(path.join(tree, "docs", "a.md"), "# A\n");
  fs.mkdirSync(path.join(tree, "node_modules"));
  fs.writeFileSync(path.join(tree, "node_modules", "b.md"), "# B\n");
  assert.equal(ownCheckout(tree), false);
  assert.deepEqual(markdownFiles(tree), ["docs/a.md"]);
  // Its own checkout lists only what it tracks.
  git(tree, "init", "-q");
  assert.equal(ownCheckout(tree), true);
  assert.deepEqual(markdownFiles(tree), []);
  git(tree, "add", "docs/a.md");
  fs.writeFileSync(path.join(tree, "notes.md"), "# Notes\n");
  assert.deepEqual(markdownFiles(tree), ["docs/a.md"]);
});
