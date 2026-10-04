import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repository, runEngineCase, loadEngineCase, parseEngineCase, matches, resultProblems, resultMutants, applyMutant } from "./shared.js";
import { Token, toBrackets } from "../src/index.js";
import { loadDialect } from "../src/node.js";

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
  // The invariants hold of every result, whatever the case expects
  // (tests/README.md).
  assert.deepEqual(resultProblems(outcome.json), [], `${label} breaks an invariant of the result`);
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

test("an until of null or the empty string names no stage, so it is a usage error, not every stage", () => {
  const loaded = loadEngineCase({ grammar: "%rule text 'a'" });
  for (const until of [null, ""]) {
    assert.throws(() => loaded.dialect.parse("a", { until }), { name: "GencmuError", kind: "usage" }, JSON.stringify(until));
  }
  // run, which parse calls, checks the name in the same way.
  for (const until of ["nonesuch", null, ""]) {
    assert.throws(() => loaded.dialect.run("a", { features: new Set(), until }, null), { name: "GencmuError", kind: "usage" }, JSON.stringify(until));
  }
  // The check comes before the probe of auto features. Without it, the
  // probe runs every stage without sa-su.
  const dialect = loadDialect("cll-ebnf");
  for (const until of [null, ""]) {
    assert.throws(() => dialect.parse("mi klama sa do", { until }), { name: "GencmuError", kind: "usage" }, JSON.stringify(until));
  }
});

test("a caller's source must lie within the text, and a caller's span must be in order, but sources can overlap or lie out of order", () => {
  const loaded = loadEngineCase({ grammar: "%rule text A B\n%emits $" });
  const tokens = (first, second, span = [1, 2]) => [
    new Token(new Set(["A"]), [0, 1], first, "a", null, undefined),
    new Token(new Set(["B"]), span, second, "b", null, undefined),
  ];
  const parse = (list) => loaded.dialect.parse("ab", { tokens: list, autoFeatures: false });
  for (const source of [[0, 6], [-2, 1], [2, 1], [3, 3]]) {
    assert.throws(() => parse(tokens([0, 1], source)), { name: "GencmuError", kind: "usage", message: /source/ }, JSON.stringify(source));
  }
  for (const span of [[-1, 0], [2, 1]]) {
    assert.throws(() => parse(tokens([0, 1], [1, 2], span)), { name: "GencmuError", kind: "usage", message: /span/ }, JSON.stringify(span));
  }
  const result = parse(tokens([1, 2], [0, 2]));
  assert.ok(result.ok);
  assert.deepEqual([result.stages[0].output[0].source, result.stages[0].output[0].text], [[0, 2], "ab"]);
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

test("names that no gate uses share one lowered grammar, and the result keeps every name the caller turned on", () => {
  const loaded = loadEngineCase({ grammar: "%rule text f? 'x' | 'y'" });
  const grammar = loaded.dialect.stages[0].grammar;
  for (let index = 0; index < 50; index++) {
    const result = loaded.dialect.parse("y", { features: [`unused-${index}`], autoFeatures: false });
    assert.equal(result.ok, true);
    assert.deepEqual(result.features, [`unused-${index}`]);
  }
  assert.equal(grammar.lowered.size, 1);
  assert.equal(grammar.classifierTables.size, 1);
});

test("a stage keeps a bounded number of lowered grammars, however many sets of its gates are on", () => {
  const names = ["a", "b", "c", "d", "e", "f", "g"];
  const loaded = loadEngineCase({ grammar: `%rule text ${names.map((name) => `${name}? 'x'`).join(" | ")} | 'y'` });
  const grammar = loaded.dialect.stages[0].grammar;
  for (let set = 0; set < 1 << names.length; set++) {
    const features = names.filter((_, index) => set & (1 << index));
    // The stage accepts its input whenever a feature is on, and ties
    // when two are.
    const result = loaded.dialect.parse("x", { features, autoFeatures: false });
    assert.equal(result.stages[0].verdict !== null, features.length > 0, JSON.stringify(features));
    assert.equal(result.ok, features.length === 1, JSON.stringify(features));
  }
  assert.ok(grammar.lowered.size <= 16, `${grammar.lowered.size} lowered grammars`);
  assert.ok(grammar.classifierTables.size <= 16, `${grammar.classifierTables.size} classifier tables`);
});

test("a stage keeps a bounded number of classifier tables, and one it dropped is resolved again the same", () => {
  const names = ["a", "b", "c", "d", "e"];
  const entries = names.map((name) => `  ${name}? "x" ∈ ${name.toUpperCase()}`).join("\n");
  const loaded = loadEngineCase({ grammar: `%classifier c\n  "x" ∈ X\n${entries}\n%rule text $w('x') <classify(text($w), c)>` });
  const grammar = loaded.dialect.stages[0].grammar;
  // Every set of the gates twice: the second round revisits tables that
  // the first round dropped.
  for (let round = 0; round < 2; round++) {
    for (let set = 0; set < 1 << names.length; set++) {
      const features = names.filter((_, index) => set & (1 << index));
      const result = loaded.dialect.parse("x", { features, autoFeatures: false });
      assert.deepEqual([...result.stages[0].tree.tags].sort(), ["X", ...features.map((name) => name.toUpperCase())].sort());
    }
  }
  assert.ok(grammar.classifierTables.size <= 16, `${grammar.classifierTables.size} classifier tables`);
});

test("the runner refuses a result that breaks an invariant, whatever the case expects", () => {
  // Each shared mutant of tests/result-mutants.json breaks an invariant.
  for (const mutant of resultMutants()) {
    const outcome = runEngineCase(mutant.engineCase);
    assert.deepEqual(resultProblems(outcome.json), [], mutant.case);
    applyMutant(outcome.json, mutant);
    assert.notDeepEqual(resultProblems(outcome.json), [], mutant.name);
    assert.throws(() => check({ error: "ambiguous" }, outcome, ""), undefined, mutant.name);
  }
});
