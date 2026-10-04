// A dialect loaded from disk knows each document by its absolute path, so
// an error names the file the same way from any working directory, and in
// every library.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadDialectFile, GencmuError } from "../src/node.js";

const roots = [];
const home = process.cwd();
after(() => {
  process.chdir(home);
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
/** @type {(files: Record<string, string>) => string} */
function directory(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gencmu-paths-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  return root;
}
const slashed = (file) => path.resolve(file).split(path.sep).join("/");

test("an error in a pipeline or an included document names its absolute path, from another working directory", () => {
  const included = directory({
    "p.md": "```jbogenbau\n%stage main\n%include \"sub/g.md\"\n```\n",
    "sub/g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text (\n```\n",
  });
  const pipeline = directory({ "p.md": "```jbogenbau\n%stage main\n%rule text (\n```\n" });
  const elsewhere = directory({});
  process.chdir(elsewhere);
  for (const [root, bad] of [[included, "sub/g.md"], [pipeline, "p.md"]]) {
    const expected = slashed(path.join(root, bad));
    for (const given of [path.join(root, "p.md"), path.relative(elsewhere, path.join(root, "p.md"))]) {
      assert.throws(() => loadDialectFile(given), (error) => {
        assert.ok(error instanceof GencmuError, String(error));
        assert.equal(error.where.document, expected, given);
        assert.ok(error.message.startsWith(`${expected}:`), error.message);
        return true;
      }, given);
    }
  }
});
