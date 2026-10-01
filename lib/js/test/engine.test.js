import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repository, runEngineCase, loadEngineCase, parseEngineCase, matches } from "./shared.js";
import { Token, toBrackets } from "../src/index.js";

const directory = path.join(repository, "tests", "engine");
for (const file of fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort()) {
  const testCase = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
  test(`engine: ${file}`, () => {
    // A case with `parses` parses its input several times with the one
    // loaded dialect (tests/README.md).
    if (testCase.parses) {
      const loaded = loadEngineCase(testCase);
      if (loaded.loadError) throw loaded.loadError;
      testCase.parses.forEach((run, index) => check(run.expect, parseEngineCase(loaded.dialect, testCase, run), `parse ${index}`));
      return;
    }
    check(testCase.expect, runEngineCase(testCase), "");
  });
}

// The members of `expect` that only a loaded dialect can meet.
const afterLoad = ["result", "brackets", "warnings", "features"];

// Whether an outcome meets a case's expectation (tests/README.md).
function check(expect, outcome, label) {
  if (outcome.loadError) {
    // A dialect that does not load gives the error alone, so a case that
    // expects anything that only a loaded dialect gives fails
    // (tests/README.md).
    assert.equal(outcome.loadError.kind, expect.error, `unexpected load error: ${outcome.loadError.message}`);
    const loadedOnly = afterLoad.filter((name) => expect[name] !== undefined);
    assert.deepEqual(loadedOnly, [], `the dialect did not load: ${outcome.loadError.message}`);
    // Where the error stands, in a document of the case, given only for a
    // grammar error (tests/README.md).
    if (expect.where !== undefined) {
      assert.equal(expect.error, "grammar", "expect.where is only for a grammar error");
      const where = outcome.loadError.where;
      assert.deepEqual({ document: where.document, line: where.line, column: where.column },
        { ...expect.where, document: `case/${expect.where.document}` }, outcome.loadError.message);
    }
    return;
  }
  if (expect.features !== undefined) assert.deepEqual(outcome.features, expect.features, label);
  if (outcome.usageError) {
    assert.equal(expect.error, "usage", `${label} unexpected usage error: ${outcome.usageError.message}`);
    return;
  }
  if (expect.warnings !== undefined) assert.deepEqual(outcome.json.warnings || [], expect.warnings, label);
  if (expect.result) {
    assert.ok(matches(expect.result, outcome.json), `${label} result does not match:\n${JSON.stringify(outcome.json, null, 1)}`);
  }
  if (expect.brackets !== undefined) assert.equal(outcome.brackets, expect.brackets, label);
  if (expect.error !== undefined) assert.equal(outcome.json.error && outcome.json.error.kind, expect.error, label);
  else assert.equal(outcome.json.error, null, `${label} unexpected error: ${JSON.stringify(outcome.json.error)}`);
}

test("an elided terminator with an = test keeps the test's string inside, and its output is that of any elided node", () => {
  const outcome = runEngineCase({
    grammar: "%elidable KU\n%rule text A [KU=\"ku\"]",
    tokens: [{ text: "a", tags: ["A"], phonemes: "a" }],
  });
  const elided = outcome.result.tree.children[1];
  assert.equal(elided.kind, "elided");
  assert.equal(elided.sound, "ku");
  assert.deepEqual(Object.keys(outcome.json.tree.children[1]).sort(), ["kind", "source", "span", "terminal"]);
});

test("a token that a caller supplies has its text as its label, and the caller's token stays as it is", () => {
  const loaded = loadEngineCase({ grammar: "%rule text $a(A)\n%emits $a <X>" });
  const token = new Token(new Set(["A"]), [0, 1], [0, 1], "a", "a", undefined, "CUSTOM");
  const result = loaded.dialect.parse("a", { tokens: [token], autoFeatures: false });
  assert.equal(result.stages[0].input[0].label, "a");
  assert.equal(result.stages[0].output[0].label, "a");
  assert.equal(toBrackets(result), "a");
  assert.equal(token.label, "CUSTOM", "the caller's token changed");
});

test("the engine runner fails a case whose dialect does not load, when the case expects more than the error", () => {
  const outcome = runEngineCase({ grammar: "%rule text A\n%rule text A" });
  assert.equal(outcome.loadError.kind, "grammar");
  check({ error: "grammar" }, outcome, "");
  assert.throws(() => check({ error: "usage" }, outcome, ""), assert.AssertionError);
  assert.throws(() => check({}, outcome, ""), assert.AssertionError);
  for (const name of afterLoad) {
    assert.throws(() => check({ error: "grammar", [name]: [] }, outcome, ""), assert.AssertionError, name);
  }
});

test("the engine runner holds a usage error of loading to the expected kind", () => {
  // A document held in memory with a lone surrogate is a mistake of the
  // caller (engine §1), found at load (tests/README.md).
  const outcome = runEngineCase({ grammar: "%rule text 'a\ud800'" });
  assert.equal(outcome.loadError.kind, "usage");
  check({ error: "usage" }, outcome, "");
  assert.throws(() => check({ error: "grammar" }, outcome, ""), assert.AssertionError);
  assert.throws(() => check({ error: "usage", result: {} }, outcome, ""), assert.AssertionError);
  // A usage error has no line or column, so a case gives no `where` for it.
  assert.throws(() => check({ error: "usage", where: { document: "main.md" } }, outcome, ""), assert.AssertionError);
});
