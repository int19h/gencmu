import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repository, runEngineCase, loadEngineCase, parseEngineCase, matches, resultProblems, resultMutants, applyMutant, checkEngineOutcome as check, afterLoad } from "./shared.js";
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

// The error elision-witness-lost (engine §7.9). No grammar gives it while
// the witness of engine §7.8 holds, so these tests lose the witness through
// the library's private fault switches, after recognition: no completed item
// of text over R, or items with no counted derivation.
for (const lost of ["lost:roots", "lost:count"]) {
  test(`a check that loses its witness (${lost}) is the grammar error elision-witness-lost, and ends the run`, async () => {
    const { faults } = await import("../src/testing.js");
    const testCase = {
      documents: {
        "p.md": "```jbogenbau\n%stage main\n%ambiguity-resolution late-elision elision-only\n%elidable T U\n" +
          "%rule text a | b\n%rule a w! A [T=\"ta\"] [U] %emits $ <~x>\n%rule b A [T=\"ta\"] [U] [U]\n" +
          "%stage later\n%ambiguity-resolution greedy\n%rule text ~x\n```\n",
      },
      pipeline: "p.md",
      tokens: [{ text: "a", tags: ["A"] }],
      options: { features: ["w"] },
    };
    const clean = runEngineCase(testCase);
    assert.equal(clean.json.ok, true, JSON.stringify(clean.json.error));
    faults.add(lost);
    let outcome;
    try {
      outcome = runEngineCase(testCase);
    } finally {
      faults.delete(lost);
    }
    const json = outcome.json;
    // The witness hook sees the loss too, also where the chart still holds
    // W(D) but the ranking counted nothing.
    assert.ok(outcome.lostWitnesses > 0, `the witness hook missed ${lost}`);
    assert.deepEqual(resultProblems(json), []);
    // The runner fails it, whatever a case expects (tests/README.md).
    assert.throws(() => check({ error: "grammar" }, outcome, ""), /elision-witness-lost/);
    assert.equal(json.ok, false);
    assert.equal(json.tree, null);
    assert.deepEqual(Object.keys(json.error), ["kind", "stage", "code", "message", "chosen", "completion"]);
    assert.equal(json.error.kind, "grammar");
    assert.equal(json.error.stage, "main");
    assert.equal(json.error.code, "elision-witness-lost");
    assert.equal(json.error.message, "the main stage could not reconstruct its chosen derivation for elision-only");
    // The chosen tree is that of the main stage, as a run that ends there
    // shows it.
    const main = runEngineCase({ ...testCase, options: { ...testCase.options, elisionOnly: false, until: "main" } });
    assert.deepEqual(json.error.chosen, main.json.tree);
    // The records in their order of insertion, with the sound only for the
    // tested terminator.
    assert.deepEqual(json.error.completion, [{ terminal: "T", at: 1, source: [1, 1], sound: "ta" }, { terminal: "U", at: 1, source: [1, 1] }]);
    // The stage keeps its verdict and warnings, has no output, and no later
    // stage runs.
    assert.deepEqual(json.stages, [{ name: "main", verdict: "resolved" }]);
    assert.deepEqual(json.warnings, clean.json.warnings.filter((warning) => warning.stage === "main"));
    assert.equal(json.warnings.length, 1);
  });
}

test("an ordinary error of the grammar in the check keeps its own message and has no code", () => {
  const testCase = JSON.parse(fs.readFileSync(path.join(directory, "reparse-competing-evaluation-error.json"), "utf8"));
  const outcome = runEngineCase(testCase);
  assert.equal(outcome.json.error.kind, "grammar");
  assert.ok(!("code" in outcome.json.error));
  assert.ok(!("chosen" in outcome.json.error) && !("completion" in outcome.json.error));
  assert.notEqual(outcome.json.error.message, "the main stage could not reconstruct its chosen derivation for elision-only");
});
