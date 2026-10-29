// A pipeline loaded from disk knows each document by its absolute path, so
// an error names the file the same way from any working directory, and in
// every library.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPipelineFile, loadPipelineSources, GencmuError } from "../src/node.js";

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
      assert.throws(() => loadPipelineFile(given), (error) => {
        assert.ok(error instanceof GencmuError, String(error));
        assert.equal(error.where.document, expected, given);
        assert.ok(error.message.startsWith(`${expected}:`), error.message);
        return true;
      }, given);
    }
  }
});

for (const item of JSON.parse(fs.readFileSync(new URL("../../../tests/disk-names.json", import.meta.url), "utf8"))) {
  test(item.description, () => {
    const root = directory(item.files);
    process.chdir(root);
    try {
      assert.throws(() => loadPipelineFile(path.join(root, "p.md")), error => {
        assert.ok(error instanceof GencmuError);
        assert.equal(error.kind, "grammar");
        assert.deepEqual(error.where, {...item.error, document: slashed(path.join(root, item.error.document))});
        return true;
      });
    } finally { process.chdir(home); }
  });
}

test("an unreadable document is a grammar error and a missing document stays missing", () => {
  for (const depth of [0, 1, 2]) {
    for (const exists of [false, true]) {
      const root = directory(depth > 0 ? {"p.md":'```jbogenbau\n%stage main\n%include "g.md"\n```\n'} : {});
      const file = path.join(root, ["p.md", "g.md", "h.md"][depth]);
      if (depth === 2) fs.writeFileSync(path.join(root, "g.md"), '```jbogenbau\n%include "h.md"\n```\n');
      if (exists) fs.mkdirSync(file);
      assert.throws(() => loadPipelineFile(path.join(root, "p.md")), error => {
        assert.ok(error instanceof GencmuError);
        assert.equal(error.kind, "grammar");
        assert.match(error.message, exists ? /the document could not be read:/ : /was not found/);
        assert.ok(error.message.includes(slashed(file)), error.message);
        assert.equal(error.toJSON().kind, "grammar");
        assert.equal(error.where.document, slashed(path.join(root, depth === 2 ? "g.md" : "p.md")));
        if (depth > 0) {
          assert.equal(error.where.line, depth === 2 ? 2 : 3);
          assert.equal(error.where.column, 1);
        }
        return true;
      });
    }
  }
});

test("grammar messages and JSON include the full known location once", () => {
  const root = directory({"p.md":'```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text other\n```\n'});
  assert.throws(() => loadPipelineFile(path.join(root, "p.md")), error => {
    assert.ok(error instanceof GencmuError);
    const prefix = `${slashed(path.join(root, "p.md"))}:4:1: `;
    assert.ok(error.message.startsWith(prefix), error.message);
    assert.equal(error.message.indexOf(prefix, prefix.length), -1);
    assert.equal(error.toJSON().message, error.message);
    return true;
  });
  const at = {document:"p.md", line:7, column:3};
  for (const message of ["bad grammar", "p.md: bad grammar", "p.md:7: bad grammar", "p.md:7:3: bad grammar"]) {
    const error = new GencmuError("grammar", message, at);
    assert.equal(error.message, "p.md:7:3: bad grammar");
    assert.equal(error.toJSON().message, error.message);
  }
});


test("a names path keeps parents above the source-map base", () => {
  const sources = {
    "dir/p.md": '```jbogenbau\n%names "../../extra.txt"\n%stage main\n%ambiguity-resolution greedy\n%rule text "‹TEST PRIVATE SCALAR›"\n```\n',
    "../extra.txt": "unicode-names 15.1.0\nname E000 TEST PRIVATE SCALAR\n",
    "extra.txt": "unicode-names 15.1.0\nname E001 TEST PRIVATE SCALAR\n",
  };
  assert.equal(loadPipelineSources(sources, "dir/p.md").parse("\ue000").ok, true);
});
