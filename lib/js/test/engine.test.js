import { test } from "node:test";
import { runtimeGrammarError, runtimeErrorLocations } from "../src/errors.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repository, runEngineCase, loadEngineCase, parseEngineCase, matches, sameJson, assertJsonEqual, caseTokens, resultProblems, resultMutants, applyMutant, checkEngineOutcome as check, afterLoad, pinsMessage, validateEngineCase, validateNotationCase } from "./shared.js";
import { Token, toBrackets, loaderFromSources as portableLoader } from "../src/index.js";
import { ParseContext, recognize } from "../src/earley.js";
import { loadPipeline, loadPipelineSources, GencmuError, fnv1a64 } from "../src/node.js";

const directory = path.join(repository, "tests", "engine");

test("exact JSON comparisons equate signed zeros and preserve JSON types", () => {
  for (const [left,right] of [
    [-0,0], [0,-0],
    [{a:[-0,{value:0}],b:true},{b:true,a:[0,{value:-0}]}],
  ]) {
    assert.equal(sameJson(left,right),true);
    assertJsonEqual(left,right,"equal numeric values");
  }
  for (const [left,right] of [
    [false,0], [true,1], [0,false], [1,true], ["0",0], [null,0],
    [{a:[false]},{a:[0]}], [{a:[0]},{a:[false]}],
    [{a:0},{b:-0}], [[0],{0:0}], [[0],[0,0]],
  ]) {
    assert.equal(sameJson(left,right),false);
    assert.throws(()=>assertJsonEqual(left,right,"unequal JSON values"),assert.AssertionError);
  }
});

test("JSON comparisons require own array elements at every index", () => {
  const hole=Array(1), inherited=Array(1);
  Object.setPrototypeOf(inherited,Object.assign(Object.create(Array.prototype),{0:123}));
  for (const missing of [hole,inherited]) {
    for (const [left,right] of [[missing,[123]],[[123],missing],[missing,missing],[{a:missing},{a:[123]}],[{a:[123]},{a:missing}]]) {
      assert.equal(sameJson(left,right),false);
      assert.equal(matches(left,right),false);
      assert.throws(()=>assertJsonEqual(left,right,"missing array element"),assert.AssertionError);
    }
  }
  for (const [left,right] of [[[],[]],[[0],[-0]],[[{a:[-0,true]}],[{a:[0,true]}]]]) {
    assert.equal(sameJson(left,right),true);
    assert.equal(matches(left,right),true);
    assertJsonEqual(left,right,"complete arrays");
  }
});

test("the engine outcome check refuses missing warnings and coordinates", () => {
  const fixture=JSON.parse(fs.readFileSync(path.join(directory,"warning-on.json"),"utf8"));
  for (const remove of [
    warnings=>{delete warnings[0];},
    warnings=>{delete warnings[0].span[0];},
    warnings=>{delete warnings[0].span[1];},
    warnings=>{delete warnings[0].source[0];},
    warnings=>{delete warnings[0].source[1];},
  ]) {
    const outcome=runEngineCase(fixture);
    check(fixture.expect,outcome,"complete warning");
    remove(outcome.json.warnings);
    assert.throws(()=>check(fixture.expect,outcome,"missing warning data"),assert.AssertionError);
  }
});

test("the runner reads patterns, results and token specs nested 20,000 deep on an ordinary stack", () => {
  const depth = 20000;
  // JSON.stringify recurses, so the values are built by hand.
  /** @type {(leaf: object, kind?: string) => any} */
  const nested = (leaf, kind) => {
    let value = leaf;
    for (let index = 0; index < depth; index++) value = kind ? { kind, children: [value] } : { children: [value] };
    return value;
  };
  const pattern = nested({ terminal: "A" });
  assert.equal(matches(pattern, nested({ kind: "token", terminal: "A" }, "rule")), true);
  assert.equal(matches(pattern, nested({ kind: "token", terminal: "B" }, "rule")), false);
  assert.equal(pinsMessage({ error: pattern }), false);
  assert.equal(pinsMessage({ error: nested({ message: "A" }) }), true);
  /** @type {any} */
  let spec = { text: "a", tags: ["A"] };
  for (let index = 0; index < depth; index++) spec = { text: "a", tags: ["A"], before: [spec] };
  let token = caseTokens([spec]).tokens[0];
  let levels = 1;
  for (; token.before.length > 0; levels++) token = token.before[0];
  assert.equal(levels, depth + 1);
});

test("the runner checks results, copies mutants and compares values nested 20,000 deep on an ordinary stack", () => {
  /** @type {(terminal: string) => any} */
  const tree = (terminal) => {
    let value = { kind: "token", terminal };
    for (let index = 0; index < 20000; index++) value = { kind: "rule", children: [value] };
    return value;
  };
  const deep = tree("A");
  const outcome = { json: { format:17, ok: true, tree: deep, error: null, stages: [] }, features: [], lostWitnesses: 0 };
  // A passing check writes no message, and a failing one fails as an
  // assertion, whatever the depth.
  check({ result: { ok: true } }, outcome, "");
  assert.throws(() => check({ result: { ok: false } }, outcome, ""), assert.AssertionError);
  const failed = { ...outcome, json: { ...outcome.json, ok: false, error: { kind: "ambiguous", reason: "tie", readings: [deep, deep] } } };
  assert.throws(() => check({ result: { ok: false } }, failed, ""), assert.AssertionError);
  const mutated = applyMutant({ value: null }, { name: "deep", case: "", path: ["value"], set: deep });
  assert.ok(sameJson(mutated.value, deep));
  assert.notEqual(mutated.value, deep);
  assert.ok(!sameJson(deep, tree("B")));
});

test("the runner refuses wrong agreed error reasons", () => {
  for (const name of ["unicode-categories-conflict.json", "suffix-recursion-local.json"]) {
    const fixture = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
    const outcome = runEngineCase(fixture);
    check(fixture.expect, outcome, name);
    assert.throws(() => check({...fixture.expect, message: "a wrong reason"}, outcome, name));
  }
});

test("runtime error expectations compare bare reasons and retain public locations", () => {
  const located=runEngineCase({grammar:"%rule text {ε}",input:""});
  const reason="an item of braces in text can match no tokens";
  const publicMessage=located.json.error.message;
  assert.match(publicMessage,/^case\/main\.md:3:1: /);
  check({error:"grammar",message:reason},located,"bare runtime reason");
  for (const message of [publicMessage,"a wrong reason"]) {
    assert.throws(()=>check({error:"grammar",message},located,"wrong runtime reason"),assert.AssertionError);
  }
  assert.equal(located.json.error.message,publicMessage);
  assert.equal(located.result.error.message,publicMessage);
  const fixture=JSON.parse(fs.readFileSync(path.join(directory,"reparse-competing-evaluation-error.json"),"utf8"));
  const unlocated=runEngineCase(fixture);
  assert.equal(unlocated.json.error.message,"split has an empty delimiter");
  check({error:"grammar",message:"split has an empty delimiter"},unlocated,"unlocated runtime reason");
  assert.throws(()=>check({error:"grammar",message:"a wrong reason"},unlocated,"wrong unlocated reason"),assert.AssertionError);
});

test("runtime reasons use structured locations for complete document names", () => {
  const reason="an item of braces in text can match no tokens";
  for (const name of ["g.md","g:7: part.md","g:7: part:8: next.md"]) {
    const fixture={documents:{
      "pipeline.md":'```jbogenbau\n%stage main\n%include '+JSON.stringify(name)+'\n```',
      [name]:'```jbogenbau\n%ambiguity-resolution greedy\n%rule text {ε}\n```',
    },pipelineDocument:"pipeline.md",input:""};
    const outcome=runEngineCase(fixture);
    const where=runtimeErrorLocations.get(outcome.result.error);
    assert.equal(where.document,`case/${name}`);
    assert.equal(where.line,3);
    assert.equal(where.column,1);
    const message=outcome.json.error.message;
    assert.equal(message,`${where.document}:3:1: ${reason}`);
    check({error:"grammar",message:reason},outcome,name);
    for (const wrong of [message,"part.md:3:1: "+reason,"a wrong reason"]) {
      assert.throws(()=>check({error:"grammar",message:wrong},outcome,name),assert.AssertionError);
    }
    assert.equal(outcome.result.error.message,message);
    assert.equal(outcome.json.error.message,message);
  }
});

test("runtime reasons retain location-like text and optional location fields", () => {
  const original=runEngineCase({grammar:"%rule text {ε}",input:""});
  const reason="literal:7: part.md:3:1: remains in the reason";
  for (const where of [{},{document:"g:7: part.md"},{document:"g:7: part.md",line:3},{document:"g:7: part.md",line:3,column:1}]) {
    const error=runtimeGrammarError(new GencmuError("grammar",reason,where),"main");
    const outcome={...original,result:{...original.result,error},json:{...original.json,error:JSON.parse(JSON.stringify(error))}};
    const message=outcome.json.error.message;
    check({error:"grammar",message:reason},outcome,"structured runtime reason");
    assert.throws(()=>check({error:"grammar",message:"a wrong reason"},outcome,"wrong reason"),assert.AssertionError);
    assert.equal(outcome.json.error.message,message);
    assert.deepEqual(Object.keys(outcome.json.error),["kind","stage","message"]);
  }
});

test("no shared engine case pins the wording of an error's message", () => {
  const pinned = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).filter((name) => {
    const testCase = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
    return [testCase.expect, ...(testCase.parses || []).map((run) => run.expect)].some((expect) => expect && pinsMessage(expect.result));
  });
  assert.deepEqual(pinned, []);
});
const engineCases = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort();
assert.ok(engineCases.length > 0,"no shared engine cases");
for (const file of engineCases) {
  const testCase = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
  test(`engine: ${file}`, () => {
    // A case with `parses` parses its input several times with the one
    // loaded pipeline (tests/README.md).
    if (testCase.parses) {
      const loaded = loadEngineCase(testCase);
      if (loaded.loadError) throw loaded.loadError;
      testCase.parses.forEach((run, index) => check(run.expect, parseEngineCase(loaded.pipeline, testCase, run), `parse ${index}`));
      return;
    }
    check(testCase.expect, runEngineCase(testCase), "");
  });
}

test("an elided terminator with an = test keeps the test's string inside, and its output is that of any elided node", () => {
  const outcome = runEngineCase({
    grammar: "%rule text A [+KU=\"ku\"]",
    tokens: [{ text: "a", tags: ["A"], value: "a" }],
  });
  const elided = outcome.result.tree.children[1];
  assert.equal(elided.kind, "elided");
  assert.equal(elided.value, "ku");
  assert.deepEqual(Object.keys(outcome.json.tree.children[1]).sort(), ["kind", "source", "span", "terminal", "value"]);
});

test("an until of null or the empty string names no stage, so it is a usage error, not every stage", () => {
  const loaded = loadEngineCase({ grammar: "%rule text \"a\"" });
  for (const until of [null, ""]) {
    assert.throws(() => loaded.pipeline.parse("a", { until }), { name: "GencmuError", kind: "usage" }, JSON.stringify(until));
  }
  // run, which parse calls, checks the name in the same way.
  for (const until of ["nonesuch", null, ""]) {
    assert.throws(() => loaded.pipeline.run("a", { features: new Set(), until }, null), { name: "GencmuError", kind: "usage" }, JSON.stringify(until));
  }
  const pipeline = loadPipeline("lojban/cll");
  for (const until of [null, ""]) {
    assert.throws(() => pipeline.parse("mi klama sa do", { until }), { name: "GencmuError", kind: "usage" }, JSON.stringify(until));
  }
});

test("a caller's source must lie within the text, and a caller's span must be in order, but sources can overlap or lie out of order", () => {
  const loaded = loadEngineCase({ grammar: "%rule text A B\n%emits $" });
  const tokens = (first, second, span = [1, 2]) => [
    new Token(new Set(["A"]), [0, 1], first, "a", undefined, undefined),
    new Token(new Set(["B"]), span, second, "b", undefined, undefined),
  ];
  const parse = (list) => loaded.pipeline.parse("ab", { tokens: list, });
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

test("a token that a caller supplies retains its supplied image, and the caller's token stays as it is", () => {
  const loaded = loadEngineCase({ grammar: "%rule text $a:A\n%emits $a ::X" });
  const token = new Token(new Set(["A"]), [0, 1], [0, 1], "a", "a", undefined, "CUSTOM");
  const result = loaded.pipeline.parse("a", { tokens: [token], });
  assert.equal(result.stages[0].input[0].image, "CUSTOM");
  assert.equal(result.stages[0].output[0].image, "CUSTOM");
  assert.equal(toBrackets(result), "CUSTOM");
  assert.equal(token.image, "CUSTOM", "the caller's token changed");
});

test("the engine runner fails a case whose pipeline does not load, when the case expects more than the error", () => {
  const outcome = runEngineCase({ grammar: "%rule text A\n%rule text A" });
  assert.equal(outcome.loadError.kind, "grammar");
  check({ error: "grammar" }, outcome, "");
  assert.throws(() => check({ error: "usage" }, outcome, ""), assert.AssertionError);
  assert.throws(() => check({}, outcome, ""), assert.AssertionError);
  for (const name of afterLoad) {
    assert.throws(() => check({ error: "grammar", [name]: [] }, outcome, ""), assert.AssertionError, name);
  }
  const runtime = runEngineCase({grammar:"%rule text {ε}", input:""});
  assert.equal(runtime.loadError, undefined);
  check({error:"grammar"},runtime,"");
  assert.throws(()=>check({error:"grammar",where:{document:"main.md"}},runtime,""),assert.AssertionError);

});

test("the engine runner holds a usage error of loading to the expected kind", () => {
  // A document held in memory with a lone surrogate is a mistake of the
  // caller (engine §1), found at load (tests/README.md).
  const outcome = runEngineCase({ grammar: "%rule text \"a\ud800\"" });
  assert.equal(outcome.loadError.kind, "usage");
  check({ error: "usage" }, outcome, "");
  assert.throws(() => check({ error: "grammar" }, outcome, ""), assert.AssertionError);
  assert.throws(() => check({ error: "usage", result: {} }, outcome, ""), assert.AssertionError);
  // A usage error has no line or column, so a case gives no `where` for it.
  assert.throws(() => check({ error: "usage", where: { document: "main.md" } }, outcome, ""), assert.AssertionError);
});

test("names that no gate uses share one lowered grammar, and the result keeps every name the caller turned on", () => {
  const loaded = loadEngineCase({ grammar: "%rule text f? \"x\" | \"y\"" });
  const grammar = loaded.pipeline.stages[0].grammar;
  for (let index = 0; index < 50; index++) {
    const result = loaded.pipeline.parse("y", { features: [`unused-${index}`], });
    assert.equal(result.ok, true);
    assert.deepEqual(result.features, [`unused-${index}`]);
  }
  assert.equal(grammar.lowered.size, 1);
  assert.equal(grammar.classifierTables.size, 1);
});

test("a stage keeps a bounded number of lowered grammars, however many sets of its gates are on", () => {
  const names = ["a", "b", "c", "d", "e", "f", "g"];
  const loaded = loadEngineCase({ grammar: `%rule text ${names.map((name) => `${name}? "x"`).join(" | ")} | "y"` });
  const grammar = loaded.pipeline.stages[0].grammar;
  for (let set = 0; set < 1 << names.length; set++) {
    const features = names.filter((_, index) => set & (1 << index));
    // The stage accepts its input whenever a feature is on, and ties
    // when two are.
    const result = loaded.pipeline.parse("x", { features, });
    assert.equal(result.stages[0].verdict !== null, features.length > 0, JSON.stringify(features));
    assert.equal(result.ok, features.length === 1, JSON.stringify(features));
  }
  assert.ok(grammar.lowered.size <= 16, `${grammar.lowered.size} lowered grammars`);
  assert.ok(grammar.classifierTables.size <= 16, `${grammar.classifierTables.size} classifier tables`);
});

test("a stage keeps a bounded number of classifier tables, and one it dropped is resolved again the same", () => {
  const names = ["a", "b", "c", "d", "e"];
  const entries = names.map((name) => `  ${name}? "x" ∈ ${name.toUpperCase()}`).join("\n");
  const loaded = loadEngineCase({ grammar: `%classifier c
  "x" ∈ X
${entries}
%rule text $w:"x" ::$w.source-text.classify(c)` });
  const grammar = loaded.pipeline.stages[0].grammar;
  // Every set of the gates twice: the second round revisits tables that
  // the first round dropped.
  for (let round = 0; round < 2; round++) {
    for (let set = 0; set < 1 << names.length; set++) {
      const features = names.filter((_, index) => set & (1 << index));
      const result = loaded.pipeline.parse("x", { features, });
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
        "p.md": "```jbogenbau\n%stage main\n%ambiguity-resolution late #·_<_Elided>\n%elision-only\n" +
          "%rule text a | b\n%rule a *w\n%rule w A [+T=\"ta\"] [+U] %warning \"warning w\" %emits $ ::X\n%rule b A [+T=\"ta\"] [+U] [+U]\n" +
          "%stage later\n%ambiguity-resolution greedy\n%rule text X\n```\n",
      },
      pipelineDocument: "p.md",
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
    assert.deepEqual(Object.keys(json.error), ["kind", "stage", "code", "warnings", "message", "chosen", "completion"]);
    assert.equal(json.error.kind, "grammar");
    assert.equal(json.error.stage, "main");
    assert.equal(json.error.code, "elision-witness-lost");
    assert.equal(json.error.message, "the main stage could not reconstruct its chosen derivation for elision-only");
    // The chosen tree is that of the main stage, as a run that ends there
    // shows it.
    const main = runEngineCase({ ...testCase, options: { ...testCase.options, elisionOnly: false, until: "main" } });
    assertJsonEqual(json.error.chosen, main.json.tree);
    // The records in their order of insertion, with the sound only for the
    // tested terminator.
    assertJsonEqual(json.error.completion, [{ terminal: "T", at: 1, source: [1, 1], value: "ta" }, { terminal: "U", at: 1, source: [1, 1] }]);
    // The stage keeps its verdict and warnings, has no output, and no later
    // stage runs.
    assertJsonEqual(json.stages, [{ name: "main", verdict: "resolved" }]);
    assertJsonEqual(json.warnings, clean.json.warnings.filter((warning) => warning.stage === "main"));
    assert.equal(json.warnings.length, 1);
  });
}

test("a missing counted witness wins over a better reconstruction", async () => {
  const { Ranker } = await import("../src/rank.js");
  const { faults } = await import("../src/testing.js");
  const testCase = JSON.parse(fs.readFileSync(path.join(directory, "rule-leftmost-longest-reconstruction-equal-and-better.json"), "utf8"));
  const original = Ranker.prototype.rank;
  let profile;
  Ranker.prototype.rank = function (roots) {
    const ranking = original.call(this, roots);
    if (this.check && ranking !== null) {
      profile = ranking.profile;
      // Engine §7.10: raw membership has a separate count channel.
    }
    return ranking;
  };
  let outcome;
  faults.add("lost:count");
  try {
    outcome = runEngineCase(testCase);
  } finally {
    Ranker.prototype.rank = original;
    faults.delete("lost:count");
  }
  assert.equal(profile[0], 0);
  assert.deepEqual(profile.slice(0,3), [0,0,0]);
  assert.deepEqual(profile[3], [[0, 2, 1]]);
  assert.equal(profile[4].size, 0);
  assert.equal(outcome.json.error.code, "elision-witness-lost");
  assert.ok(outcome.lostWitnesses > 0);
});

test("an ordinary error of the grammar in the check keeps its own message and has no code", () => {
  const testCase = JSON.parse(fs.readFileSync(path.join(directory, "reparse-competing-evaluation-error.json"), "utf8"));
  const outcome = runEngineCase(testCase);
  assert.equal(outcome.json.error.kind, "grammar");
  assert.ok(!("code" in outcome.json.error));
  assert.ok(!("chosen" in outcome.json.error) && !("completion" in outcome.json.error));
  assert.notEqual(outcome.json.error.message, "the main stage could not reconstruct its chosen derivation for elision-only");
});

test("an error of lowering is a result of the parse whose message names the definition at fault, and the pipeline loads (engine §3)", () => {
  const sources = {
    "p.md": "```jbogenbau\n%stage main\n%include \"a.md\"\n%include \"b.md\"\n```\n",
    "a.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text {r} | c\n%rule c {... A} | f? B\n```\n",
    "b.md": "```jbogenbau\n%rule r A\n%extend-rule r\n  ε\n```\n",
  };
  const loaded = loadEngineCase({ documents: sources, pipelineDocument: "p.md" });
  assert.equal(loaded.loadError, undefined);
  const parse = (features) => parseEngineCase(loaded.pipeline, { tokens: [{ text: "a", tags: ["A"] }] }, { options: { features } }).json;
  // The empty item of text's braces, made so by b.md, is reported at the
  // definition of text in a.md, line 3, column 1.
  const empty = parse([]);
  assert.deepEqual(Object.keys(empty.error), ["kind", "stage", "message"]);
  assert.equal(empty.stages[0].verdict, null);
  assert.equal(empty.tree, null);
  assert.match(empty.error.message, /^case\/a\.md:3:1: /);
  // With f on, c's chain stands beside B, which comes before the empty
  // item of an earlier rule.
  const both = parse(["f"]);
  assert.match(both.error.message, /^case\/a\.md:4:1: c is a chain/);
});

test("in one rule, a chain beside another alternative is reported before an empty item of its braces (engine §3)", () => {
  const loaded = loadEngineCase({ grammar: "%rule text r\n%rule r {... [A]} | B" });
  const result = parseEngineCase(loaded.pipeline, { tokens: [{ text: "b", tags: ["B"] }] }).json;
  assert.match(result.error.message, /^case\/main\.md:4:1: r is a chain/);
});


test("query helpers have no written source and follow written productions in tag order", () => {
  const text = "%rule text $x:A %conditions $x.matches(Z | T | Z)";
  const aux = "%rule aux ($q:A ≻ B) ::∅ %conditions $q.without-elision.matches(Q)";
  for (const grammar of [text + "\n" + aux, aux + "\n" + text]) {
    const loaded = loadEngineCase({ grammar });
    assert.equal(loaded.loadError, undefined);
    const lowered = loaded.pipeline.stages[0].grammar.lower(new Set());
    const helpers = lowered.productions.filter(p => p.lhs.startsWith("\0query:"));
    assert.deepEqual(helpers.map(p => p.lhs), ["\0query:Q", "\0query:T", "\0query:Z"]);
    assert.deepEqual(helpers.map(p => p.id), [lowered.productions.length - 3, lowered.productions.length - 2, lowered.productions.length - 1]);
    for (const helper of helpers) {
      assert.equal(helper.logicalSource, undefined);
      assert.equal(helper.source, undefined);
      assert.equal(helper.writtenExpression, undefined);
      assert.equal(helper.rankedGroup, undefined);
      assert.ok(!helper.contextual);
      assert.deepEqual([...helper.sourcePrivate], []);
      assert.deepEqual([...helper.rankedPrivate], []);
      assert.ok(!Object.hasOwn(helper, "categories"));
      assert.deepEqual(helper.conditions, []);
      assert.deepEqual(helper.captures, [{name: "\0child", index: 0}]);
      assert.deepEqual(helper.tags, {method: "tags", receiver: {capture: "\0child"}, args: []});
      assert.equal(helper.emit, null);
      const {tokens, text} = caseTokens([{text: "a", tags: ["Q", "T", "Z", "EXTRA"]}]);
      const context = new ParseContext(lowered, tokens, [...text], loaded.pipeline.loader.unicode);
      const chart = recognize(context, helper.lhs, 0, 1);
      const roots = chart.setAt(1).items.filter(item => item.complete && item.origin === 0 && item.production.lhs === helper.lhs);
      assert.equal(roots.length, 1);
      assert.deepEqual([...context.interner.get(roots[0].tagId)].sort(), ["EXTRA", "Q", "T", "Z"]);
    }
  }
});


test("source maps reject every non-scalar resource before parsing", () => {
  for (const path of ["data/unicode/unicode.txt", "data/unicode/unicode-properties.txt", "data/unicode/unicode-names.txt",
    "data/unicode/unicode-names-reference.txt", "extra-names.txt", "data/preparsed/gencmu.json", "data/preparsed/test.json", "unused.md"]) {
    for (const load of [sources => loadPipelineSources(sources, "missing.md"), portableLoader]) {
      assert.throws(() => load({[path]:"header\n\ud800"}), error => {
        assert.ok(error instanceof GencmuError);
        assert.equal(error.kind, "usage");
        assert.deepEqual(error.where, {document:path});
        return true;
      });
    }
  }
  assert.throws(() => portableLoader(new Map([["z", "\ud800"], ["a", "\ud800"]])), error => error.where.document === "a");
  const sources = new Map(["data/unicode/unicode.txt", "data/unicode/unicode-properties.txt", "data/preparsed/gencmu.json"]
    .map(path => [path, fs.readFileSync(new URL("../../../" + path, import.meta.url), "utf8")]));
  sources.set("extra-names.txt", "original");
  const loader = portableLoader(sources);
  sources.set("extra-names.txt", "\ud800");
  assert.equal(loader.read("extra-names.txt"), "original");

});


test("caller insertion provenance is ignored and never retained", () => {
  const loaded = loadEngineCase({grammar:'%rule text "a"'});
  for (const insertedBy of ["caller", 17]) {
    const token = {text:"a", tags:[], source:[0,1], span:[0,1], insertedBy};
    const result = loaded.pipeline.parse("a", {tokens:[token]});
    assert.ok(result.ok);
    assert.equal(result.stages[0].input[0].insertedBy, undefined);
    assert.equal(token.insertedBy, insertedBy);
  }
});

// Usage diagnostics follow categories before any stage runs (docs/api.md).
test("parse usage errors inspect text, tokens, features, then until", () => {
  const pipeline = loadPipelineSources({"p.md": '```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule text A\n```\n'}, "p.md");
  const options = {features:["f"], withoutFeatures:["f"], until:"missing"};
  const tokens = ["first invalid tag", "second invalid tag"].map(tag => ({text:"a", tags:[tag], span:[0,1], source:[0,1]}));
  assert.throws(() => pipeline.parse("\ud800", {...options, tokens}), /the text is not a sequence/);
  assert.throws(() => pipeline.parse("a", {...options, tokens}), /token 0: invalid tags/);
  assert.throws(() => pipeline.parse("a", options), /the feature f is named both/);
  assert.throws(() => pipeline.parse("a", {until:"missing"}), /no stage is named/);
});

test("classifier and lowering failures reuse their cached result", () => {
  for (const source of [
    '%rule text {["a"]}',
    '%classifier c\n "a" ∈ A\n "a" ∈ A\n%rule text "a"',
  ]) {
    const loaded = loadEngineCase({ grammar: source });
    assert.ifError(loaded.loadError);
    const grammar = loaded.pipeline.stages[0].grammar;
    let original;
    for (let attempt = 0; attempt < 3; attempt++) {
      assert.throws(() => grammar.lower(new Set()), error => {
        assert.equal(error.kind, "grammar");
        if (original) assert.equal(error, original);
        original = error;
        return true;
      });
    }
    assert.equal(grammar.lowered.size, 1);
    if (source.startsWith('%classifier')) {
      assert.throws(() => grammar.classifiers(new Set()), error => error === original);
    }
  }
});

test("constant cycle diagnostics exclude entry paths and identify versions", () => {
  for (const [declarations, expected] of [
    ['%const $A $B\n%const $B $C\n%const $C $B', '$B → $C → $B'],
    ['%const $A $B\n%const $B $A\n%redefine-const $A $A', '$A [case/main.md:3:1] → $B [case/main.md:4:1] → $A [case/main.md:5:1] → $A [case/main.md:3:1]'],
  ]) {
    const { loadError } = loadEngineCase({ grammar: `${declarations}\n%rule text "a"` });
    assert.ok(loadError);
    assert.ok(loadError.message.endsWith(`constant dependency cycle: ${expected}`), loadError.message);
  }
});


test("a lost reconstructed witness skips admission preparation and ranking", async () => {
  const {Stage} = await import("../src/stage.js");
  const {Ranker} = await import("../src/rank.js");
  const {faults,hooks} = await import("../src/testing.js");
  const pipeline = loadPipelineSources({"p.md":'```jbogenbau\n%stage main\n%ambiguity-resolution late #·_<_Elided>\n%elision-only\n%rule text (a ≻ b) ::∅\n%rule a "a" [+T]\n%rule b "a" [+T] [+U]\n```'},"p.md");
  const rank = Ranker.prototype.rank, elisionCheck = Stage.prototype.elisionCheck;
  for (const loss of ["roots","walk"]) {
    let scans=0, rankings=0, observations=0;
    Ranker.prototype.rank = function(roots) {if(this.check) rankings++;return rank.call(this,roots);};
    hooks.elisionCheck = run => {
      assert.equal(run.roots.length > 0,loss === "walk");
      const sets = run.chart.sets;
      Object.defineProperty(run.chart,"sets",{get(){scans++;return sets;}});
      return {ranked(event){observations++;assert.equal(event.ranking,null);assert.equal(event.counted,false);}};
    };
    if (loss === "roots") faults.add("lost:roots");
    else Stage.prototype.elisionCheck = function(chosen,tree,main,features) {
      return elisionCheck.call(this,{...chosen,production:{...chosen.production,id:-1}},tree,main,features);
    };
    try {
      const result = pipeline.parse("a");
      assert.equal(result.error.code,"elision-witness-lost");
      assert.equal(scans,0,loss);
      assert.equal(rankings,0,loss);
      assert.equal(observations,1,loss);
    } finally {
      faults.delete("lost:roots");
      hooks.elisionCheck=null;
      Stage.prototype.elisionCheck=elisionCheck;
      Ranker.prototype.rank=rank;
    }
  }
});


test("the runner refuses malformed controls and misplaced expectations", () => {
  const good = {grammar:'%rule text "a"',input:"a",expect:{result:{ok:true}}};
  for (const change of [
    {typo:true}, {options:{typo:true}}, {options:{features:"f"}},
    {options:{withoutFeatures:3}}, {options:{until:4}}, {options:{elisionOnly:"off"}},
    {parses:false}, {parses:[]}, {expect:{typo:true}}, {expect:{where:3}},
    {expect:{warnings:false}}, {expect:{message:3}}, {tokens:[{text:"a",tags:[],typo:true}]},
  ]) assert.throws(() => runEngineCase({...good,...change}),assert.AssertionError);
  const clean = runEngineCase(good);
  for (const expect of [
    {error:"grammar",where:{document:"main.md",line:99}},
    {error:"grammar",diagnostic:"not-a-code"},
  ]) assert.throws(() => check(expect,clean,"misplaced"),/load error/);
  for (const field of ["result","brackets","warnings","enabledFeatures","message"]) {
    const extra = {result:{ok:true},brackets:"a",warnings:[],enabledFeatures:[],message:"x"};
    assert.throws(() => check({error:"usage",[field]:extra[field]}, {usageError:{message:"x"}}, "usage"),/usage errors cannot satisfy/);
  }
  for (const change of [{unknown:true},{cacheMisses:"yes"},{expect:{dom:{},error:{line:1}}},{expect:{error:{unknown:1}}},{expect:{error:{line:"one"}}}]) {
    assert.throws(() => validateNotationCase({document:"",expect:{dom:{}},...change}),assert.AssertionError);
  }
  assert.throws(() => validateEngineCase({...good,parses:[{expect:{}}]}),/parses replaces/);
});

test("engine case entries refuse the parameter-only name member", () => {
  const fixture={name:"parameter only",grammar:'%rule text "a"',input:"a",expect:{result:{ok:true}}};
  const pipeline=loadEngineCase({grammar:fixture.grammar}).pipeline;
  for (const entry of [()=>validateEngineCase(fixture),()=>loadEngineCase(fixture),()=>runEngineCase(fixture),()=>parseEngineCase(pipeline,fixture)]) {
    assert.throws(entry,/unknown member name/);
  }
});

test("every runner entry refuses error messages inside result patterns", () => {
  const fixture={grammar:'%rule text "a"',input:"a",expect:{result:{error:{message:"anything"}}}};
  assert.throws(() => runEngineCase(fixture),/result pattern cannot assert an error message/);
  assert.throws(() => check(fixture.expect,{},"invalid pattern"),/result pattern cannot assert an error message/);
  const repeated = {grammar:fixture.grammar,input:fixture.input,parses:[{expect:fixture.expect}]};
  assert.throws(() => loadEngineCase(repeated),/result pattern cannot assert an error message/);
});

test("matching requires own members and compares falsy result patterns", () => {
  for (const key of ["__proto__","constructor","toString"]) {
    assert.equal(matches(JSON.parse('{"'+key+'":{}}'),{}),false);
  }
  const outcome=runEngineCase({grammar:'%rule text "a"',input:"a"});
  for (const pattern of [false,null,0,""]) assert.throws(() => check({result:pattern},outcome,"falsy"),/result does not match/);
});

test("token usage cases retain invalid present payload fields", () => {
  for (const field of ["span","source","before","after","tags","value","image"]) {
    const token={text:"a",tags:["A"],[field]:null};
    const built=caseTokens([token]);
    assert.equal(built.tokens[0][field],null,field);
    const fixture={grammar:"%rule text A",tokens:[token],expect:{error:"usage"}};
    check(fixture.expect,runEngineCase(fixture),field);
  }
  const tags=caseTokens([{text:"a",tags:"AB"}]).tokens[0].tags;
  assert.equal(tags,"AB");
  for (const token of [{text:3,tags:[]},{tags:[]},{text:"a"}]) {
    const fixture={grammar:"%rule text A",tokens:[token],expect:{error:"usage"}};
    check(fixture.expect,runEngineCase(fixture),"invalid text or tags");
  }
  const defaults=caseTokens([{text:"a",tags:[]}]).tokens[0];
  assert.deepEqual(defaults.span,[0,1]);
  assert.deepEqual(defaults.source,[0,1]);
  assert.deepEqual(defaults.before,[]);
});


test("cached tree comparisons keep the cycle position", () => {
  const sources = {
    "grammars/test/p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```\n',
    "grammars/test/g.md": '```jbogenbau\n%ambiguity-resolution greedy\n%rule text $x:w $y:w\n%conditions $x ≅ $y\n%rule w "a" | w\n```\n',
  };
  const fresh = loadPipelineSources(sources,"grammars/test/p.md");
  const dom = fresh.loader.readDocument(sources["grammars/test/g.md"],"grammars/test/g.md");
  const cache = JSON.stringify({
    format:dom.format, bootstrap:fresh.loader.bootstrapHash, unicode:fresh.loader.unicodeHash,
    properties:fresh.loader.propertiesHash, documents:{"grammars/test/g.md":{hash:fnv1a64(sources["grammars/test/g.md"]),dom}},
  });
  for (const [name,pipeline] of [["fresh",fresh],["cached",loadPipelineSources({...sources,"data/preparsed/test.json":cache},"grammars/test/p.md")]]) {
    const result = pipeline.parse("aa");
    assert.equal(result.error.kind,"grammar");
    assert.ok(result.error.message.startsWith("grammars/test/g.md:4:13: "), name+": "+result.error.message);
  }
});
