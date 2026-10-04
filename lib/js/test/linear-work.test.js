// Reads, scans and formatters whose work must grow linearly with their
// input. Where no counter measures the work, a test times the function on
// a synthetic input of size n and 4n, and a quadratic cost shows as a
// sixteenfold time where a linear one shows as fourfold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertLinear } from "./linear.js";
import { explainWarnings, formatItem, sideBySide, audit } from "../src/diagnostics.js";
import { ParseContext, recognize, recognizerCounters, evaluate, asSet, testHolds, readingOf } from "../src/earley.js";
import { implied } from "../src/stage.js";
import { Grammar, Lowering } from "../src/grammar.js";
import { splicePipeline } from "../src/pipeline.js";
import { DOM_FORMAT, captureSequences, definitionProblem } from "../src/dom.js";
import { loadEngineCase, caseTokens } from "./shared.js";

test("explaining a warning on each line of a text costs linear time in the text, not the text once per warning", () => {
  assertLinear("explainWarnings", 3000, (n) => {
    const text = Array.from({ length: n }, () => "coi do").join("\n");
    const warnings = Array.from({ length: n }, (_, line) => ({ stage: "syntax", feature: "f", rule: "r", source: [line * 7, line * 7 + 3] }));
    const result = /** @type {any} */ ({ text, warnings });
    return () => explainWarnings(result);
  });
});

/**
 * The chart of a grammar over n tokens A, recognized from `text`.
 * @param {string} grammar
 * @param {number} n
 */
function chartOver(grammar, n) {
  const loaded = loadEngineCase({ grammar });
  const lowered = loaded.dialect.stages[0].grammar.lower(new Set());
  const { tokens, text } = caseTokens(Array.from({ length: n }, () => ({ text: "a", tags: ["A"] })));
  return () => recognize(new ParseContext(lowered, tokens, [...text], loaded.dialect.loader.unicode), "text", 0, tokens.length);
}

test("an item built in many ways checks each new way against those found in a bounded number of comparisons", () => {
  const run = chartOver("%rule text t\n%rule t t t | A", 64);
  recognizerCounters.edgeChecks = 0;
  const chart = run();
  let edges = 0;
  for (const set of chart.sets) for (const item of set.items) edges += 1 + (item.more ? item.more.length : 0);
  assert.ok(recognizerCounters.edgeChecks <= 8 * edges, `${recognizerCounters.edgeChecks} checks for ${edges} edges`);
});

test("advancing over the captures of a production costs linear time in their number", () => {
  assertLinear("recognize", 400, (n) => {
    const names = Array.from({ length: n }, (_, index) => `$c${index}(A)`).join(" ");
    return chartOver(`%rule text ${names}`, n);
  });
});

test("formatting an item of a production with many captures costs linear time in their number", () => {
  assertLinear("formatItem", 8000, (n) => {
    const captures = Array.from({ length: n }, (_, index) => ({ name: `c${index}`, index }));
    const production = /** @type {any} */ ({
      lhs: "text", helper: false, owner: "text",
      rhs: captures.map(() => ({ name: "A", terminal: true })),
      captures, captureAt: captures.map((_, index) => index), captureSlot: new Map(captures.map((capture, index) => [capture.name, index])),
    });
    return () => formatItem(production, 0);
  });
});

test("checking a condition on each capture of a production costs linear time in their number", () => {
  assertLinear("recognize", 300, (n) => {
    const names = Array.from({ length: n }, (_, index) => `$c${index}(A)`).join(" ");
    const conditions = Array.from({ length: n }, (_, index) => `text($c${index}) = "a"`).join(", ");
    return chartOver(`%rule text ${names}\n%conditions ${conditions}`, n);
  });
});

test("the implications of a stage close a token's tags in linear time, also over a chain written in reverse order", () => {
  assertLinear("implied", 500, (n) => {
    // T0 ⟹ T1 ⟹ … ⟹ Tn, written last link first.
    const implications = Array.from({ length: n }, (_, index) => ({ if: new Set([`T${n - 1 - index}`]), then: new Set([`T${n - index}`]) }));
    return () => implied(new Set(["T0"]), implications);
  });
});

const unicode = loadEngineCase({ grammar: "%rule text A" }).dialect.loader.unicode;

/**
 * A grammar of a rule `text`, from its DOM, which skips reading the
 * notation: a long rule costs the notation's reader more than the code
 * under test.
 * @param {any} rule the rule's alternatives and clauses
 * @param {any} [more] more rules and classifiers
 */
function domGrammar(rule, more = {}) {
  const dom = {
    format: DOM_FORMAT,
    rules: [{ name: "text", op: "define", conditions: [], at: [1, 1], ...rule }, ...(more.rules ?? [])],
    directives: [{ name: "ambiguity-resolution", args: ["greedy"], at: [1, 1] }],
    constants: [], classifiers: more.classifiers ?? [], implications: [],
  };
  return new Grammar("main", [{ path: "g.md", dom }], unicode);
}

/** @param {number} n */
const capturedSequence = (n) => Array.from({ length: n }, (_, index) => ({ capture: `c${index}`, expr: { terminal: "A" } }));

test("the capture sequences of a sequence of captures cost linear time in its length", () => {
  assertLinear("captureSequences", 1000, (n) => {
    const seq = capturedSequence(n);
    return () => captureSequences({ seq });
  });
});

test("lowering a sequence of symbols costs linear time in its length", () => {
  assertLinear("lower", 8000, (n) => {
    const alternatives = [{ guards: [], expr: { seq: capturedSequence(n) } }];
    return () => domGrammar({ alternatives }).lower(new Set());
  });
});

test("checking an emission of many inserted tags costs linear time in their number", () => {
  assertLinear("definitionProblem", 8000, (n) => {
    const rule = {
      name: "text", alternatives: [{ guards: [], expr: { capture: "c", expr: { terminal: "A" } } }], conditions: [],
      emit: { items: [...Array.from({ length: n }, () => ({ insert: "t" })), { capture: "c" }] },
    };
    return () => assert.equal(definitionProblem(rule), null);
  });
});

test("a union of many tag sets costs linear time in their number", () => {
  assertLinear("evaluate", 4000, (n) => {
    const term = /** @type {any} */ ({ union: Array.from({ length: n }, (_, index) => ({ tag: `t${index}` })) });
    return () => assert.equal(asSet(evaluate(/** @type {any} */ ({}), term, /** @type {any} */ (null))).size, n);
  });
});

test("sound tests over spans that end in one run of silent tokens cost linear time in all, not each span's length", () => {
  assertLinear("testHolds", 20000, (n) => {
    // One sounding token after n silent ones; each span from a silent token
    // to the end sounds like it.
    const tokens = [...Array.from({ length: n }, () => ({ phonemes: "" })), { phonemes: "a" }];
    const test = /** @type {any} */ ({ op: "=", sound: "a" });
    return () => {
      const context = /** @type {any} */ ({ tokens, sounds: new Array(tokens.length), nextSounding: null, unicode: { canonical: (/** @type {string} */ text) => text } });
      for (let from = 0; from < n; from++) assert.ok(testHolds(context, test, from, n + 1, new Set()));
    };
  });
});

test("trimming lines side by side costs linear time in a long inner run of spaces", () => {
  assertLinear("sideBySide", 2000, (n) => {
    const line = `a${" ".repeat(n)}b`;
    return () => sideBySide(line, line, "first", "second");
  });
});

test("a rule extended many times costs linear time in the extensions", () => {
  assertLinear("extend-rule", 8000, (n) => {
    const alternatives = [{ guards: [], expr: { ref: "A" } }];
    const rules = Array.from({ length: n }, () => ({ name: "text", op: "extend", alternatives, conditions: [], at: [1, 1] }));
    return () => domGrammar({ alternatives }, { rules });
  });
});

test("a classifier with many entries for one key, and clauses naming many classifiers, cost linear time in their number", () => {
  assertLinear("classifiers", 4000, (n) => {
    const entries = Array.from({ length: n }, (_, index) => ({ guards: [], keys: ["a"], op: "∈", class: `K${index}`, at: [1, 1] }));
    const classifiers = Array.from({ length: n }, (_, index) => ({ name: `c${index}`, entries: index === 0 ? entries : [], at: [1, 1] }));
    const tags = { union: classifiers.map(({ name }) => ({ call: "classify", args: [{ string: "a" }, { classifier: name }] })) };
    const alternatives = [{ guards: [], expr: { ref: "A" } }];
    return () => assert.equal(domGrammar({ alternatives, tags }, { classifiers }).classifiers(new Set()).get("c0")?.get("a")?.size, n);
  });
});


test("lowering a sequence of many optionals, each a helper, costs linear time in their number", () => {
  assertLinear("lower", 16000, (n) => {
    const alternatives = [{ guards: [], expr: { seq: Array.from({ length: n }, () => ({ optional: { terminal: "A" } })) } }];
    return () => domGrammar({ alternatives }).lower(new Set());
  });
});

/**
 * A chain of rules, each naming the next, written first to last, so that a
 * pass over the rules in order learns one more fact about them per pass.
 * The last rule is `last`.
 * @param {number} n
 * @param {any} last
 */
function ruleChain(n, last) {
  const rules = Array.from({ length: n }, (_, index) => ({ name: `r${index}`, op: "define", alternatives: [{ guards: [], expr: { ref: `r${index + 1}` } }], conditions: [], at: [1, 1] }));
  rules.push({ name: `r${n}`, op: "define", conditions: [], at: [1, 1], ...last });
  return domGrammar({ alternatives: [{ guards: [], expr: { ref: "r0" } }] }, { rules });
}

test("finding which rules are nullable, which can read and which can emit costs linear time in a chain of rules", () => {
  assertLinear("nullable", 2000, (n) => {
    // The check of braces alone, on the productions lowering found: a whole
    // lowering makes enough garbage to blur its time.
    const grammar = ruleChain(n, { alternatives: [{ guards: [], expr: { seq: [] } }] });
    const lowering = new Lowering(grammar, new Set());
    lowering.run();
    return () => lowering.checkBraceItems();
  });
  assertLinear("readingOf", 2000, (n) => {
    const lowered = ruleChain(n, { alternatives: [{ guards: [], expr: { terminal: "A" } }] }).lower(new Set());
    // A lowered grammar remembers its reading, so each round reads a copy.
    return () => assert.equal(readingOf({ ...lowered }).last.size, n + 2);
  });
  assertLinear("audit", 2000, (n) => {
    const grammar = ruleChain(n, { alternatives: [{ guards: [], expr: { capture: "c", expr: { terminal: "A" } } }], emit: { items: [{ capture: "c" }] } });
    return () => audit(/** @type {any} */ ({ stages: [{ name: "main", grammar }] }));
  });
});

test("auditing a rule extended many times, each extension emitting nothing, costs linear time in the extensions", () => {
  assertLinear("audit", 2000, (n) => {
    const alternatives = [{ guards: [], expr: { ref: "A" } }];
    const rules = Array.from({ length: n }, () => ({ name: "text", op: "extend", alternatives, conditions: [], emit: { items: [] }, at: [1, 1] }));
    const grammar = domGrammar({ alternatives }, { rules });
    return () => audit(/** @type {any} */ ({ stages: [{ name: "main", grammar }] }));
  });
});

test("splicing a pipeline costs linear time in its chain of includes, its features and its stages", () => {
  // A document of directives, each but an include followed by a rule, since
  // a stage needs one.
  /** @param {any[]} directives */
  const dom = (directives) => {
    /** @type {any} */
    const result = { format: DOM_FORMAT, rules: [], directives: [], constants: [], classifiers: [], implications: [] };
    directives.forEach((directive, index) => {
      result.directives.push({ ...directive, at: [2 * index + 1, 1] });
      if (directive.name !== "include") result.rules.push({ name: "text", op: "define", alternatives: [{ guards: [], expr: { ref: "A" } }], conditions: [], at: [2 * index + 2, 1] });
    });
    return result;
  };
  assertLinear("include chain", 250, (n) => {
    const documents = new Map(Array.from({ length: n }, (_, index) => [`d${index}.md`, dom(index + 1 < n ? [{ name: "include", args: [`d${index + 1}.md`] }] : [{ name: "stage", args: ["s"] }])]));
    return () => splicePipeline("d0.md", (path) => documents.get(path));
  });
  assertLinear("features", 20000, (n) => {
    const documents = new Map([["p.md", dom([{ name: "stage", args: ["s"] }, { name: "features", args: Array.from({ length: n }, (_, index) => `f${index}`) }])]]);
    return () => assert.equal(splicePipeline("p.md", (path) => documents.get(path)).features.length, n);
  });
  assertLinear("stages", 5000, (n) => {
    const documents = new Map([["p.md", dom(Array.from({ length: n }, (_, index) => ({ name: "stage", args: [`s${index}`] })))]]);
    return () => assert.equal(splicePipeline("p.md", (path) => documents.get(path)).stages.length, n);
  });
});
