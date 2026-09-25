// The command line, run as a user runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.js");
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

test("parse prints brackets and exits 0 for an accepted text", () => {
  const out = run("parse", "mi", "klama", "le", "zarci");
  assert.equal(out.status, 0);
  assert.equal(out.stdout.trim(), "(mi [klama {le zarci}])");
});

test("parse explains a rejection with a caret and exits 1", () => {
  const out = run("parse", "mi klama le le zarci");
  assert.equal(out.status, 1);
  assert.match(out.stderr, /The syntax stage cannot read the text at the end of the text/);
  assert.match(out.stderr, /\^/);
  assert.match(out.stderr, /sumti-6: KU/);
});

test("parse reads standard input and knows the other formats", () => {
  const tree = spawnSync(process.execPath, [cli, "parse", "--format", "tree"], { input: "mi klama\n", encoding: "utf8" });
  assert.equal(tree.status, 0);
  assert.match(tree.stdout, /tanru-unit-2 · klama/);
  const json = run("parse", "--format", "canonical", "mi");
  assert.equal(JSON.parse(json.stdout).ok, true);
  const tokens = run("parse", "--format", "tokens", "--until", "words", "mi klama");
  assert.match(tokens.stdout, /words: 2 tokens/);
});

test("parse explains a tie on standard error", () => {
  const out = run("parse", "zoi ba'e bu ba'e bu cu broda");
  assert.match(out.stderr, /The words stage is ambiguous/);
});

test("trace shows what a stage did at a position", () => {
  const out = run("parse", "--trace", "syntax:2", "mi le le zarci");
  assert.equal(out.status, 1, "the text is rejected, whatever is traced");
  assert.match(out.stdout, /The syntax stage at position 2/);
  assert.match(out.stdout, /could read next:/);
});

test("audit, dialects and test run", () => {
  assert.match(run("audit", "--dialect", "zantufa").stdout, /paragraph replaced by syntax\/zantufa\.md/);
  assert.match(run("dialects").stdout, /^cll-ebnf\s+The CLL dialect, by its printed grammar$/m);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gencmu-")), "cases.jsonl");
  const accepted = { id: "a", text: "mi klama", dialect: "cll-ebnf", expect: "accept", verdict: "unique", words: ["mi", "klama"], brackets: "(mi klama)" };
  fs.writeFileSync(file, [accepted, { ...accepted, id: "b", expect: "reject" }, { ...accepted, id: "c", verdict: undefined }]
    .map((c) => JSON.stringify(c)).join("\n") + "\n");
  const out = run("test", file);
  assert.equal(out.status, 1);
  assert.match(out.stdout, /b: expect expected "reject", got "accept"/);
  // A field the result has and the case lacks is a difference too.
  assert.match(out.stdout, /c: verdict expected undefined, got "unique"/);
  assert.match(out.stdout, /1 of 3 cases pass/);
});

test("trace reads the stage's input as the parse does, auto features included", () => {
  const out = run("parse", "--trace", "syntax:0", "mi sa do klama");
  assert.match(out.stdout, /after the start and before "do"/);
  assert.equal(out.status, 0);
  const rejected = run("parse", "--trace", "syntax:0", "mi le le zarci");
  assert.equal(rejected.status, 1);
  const unknown = run("parse", "--trace", "nonesuch:0", "mi");
  assert.equal(unknown.status, 2);
  assert.doesNotMatch(unknown.stderr, /at /);
});

test("a defect of the grammar found while parsing exits 2", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gencmu-"));
  fs.writeFileSync(path.join(directory, "p.md"), "## Main <?stage main?>\n\n- [g](g.md) <?grammar?>\n");
  fs.writeFileSync(path.join(directory, "g.md"), "```jbogenbau\n%ambiguity-resolution greedy\n%rule text $a(x) %conditions ¬matches($a, text)\n%rule x \"a\"\n```\n");
  const out = run("parse", "--pipeline", path.join(directory, "p.md"), "a");
  assert.equal(out.status, 2);
  assert.match(out.stderr, /A grammar error/);
});

test("mistakes of the command exit 2", () => {
  assert.equal(run("parse", "--until", "nonesuch", "mi").status, 2);
  assert.equal(run("parse", "--format", "nonesuch", "mi").status, 2);
  assert.equal(run("frobnicate").status, 2);
});
