// Reads, scans and formatters whose work must grow linearly with their
// input. A test counts the work of the function on a synthetic input of
// size n and 4n, where the function does it, and a quadratic cost shows as
// a sixteenfold count where a linear one shows as fourfold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertLinearWork, countedWork } from "./linear.js";
import { explainWarnings, formatItem, sideBySide, audit } from "../src/diagnostics.js";
import { ParseContext, recognize, evaluate, asSet, testHolds, readingOf } from "../src/earley.js";
import { implied } from "../src/stage.js";
import { Grammar } from "../src/grammar.js";
import { splicePipeline } from "../src/pipeline.js";
import { DOM_FORMAT, captureSequences, definitionProblem, duplicateCaptures } from "../src/dom.js";
import { loadEngineCase, parseEngineCase, caseTokens } from "./shared.js";
import { loadDialectSources } from "../src/node.js";

test("explaining a warning on each line of a text costs linear work in the text, not the text once per warning", () => {
  assertLinearWork("explainWarnings", 3000, (n) => {
    const text = Array.from({ length: n }, () => "coi do").join("\n");
    const warnings = Array.from({ length: n }, (_, line) => ({ stage: "syntax", feature: "f", rule: "r", source: [line * 7, line * 7 + 3] }));
    const result = /** @type {any} */ ({ text, warnings });
    return () => explainWarnings(result);
  }, ["text"]);
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
  // The edges, from a parse that counts nothing, give the budget of the
  // counted parse, which stops at the first comparison past it.
  let edges = 0;
  for (const set of run().sets) for (const item of set.items) edges += 1 + (item.more ? item.more.length : 0);
  const work = countedWork(run, { edgeChecks: 8 * edges });
  assert.ok(work.edgeChecks > 0, "no comparison counted");
});

test("restoring the elided terminators of many rules at one position costs linear work in the rules", () => {
  // Each rule has two optional terminators, so the check of elision-only
  // restores 2n helpers in one set that holds about n items. A restoration
  // that scanned its set would cost the square of n.
  assertLinearWork("restore", 250, (n) => {
    const rules = Array.from({ length: n }, (_, index) => `%rule r${index} A [+KU] [+KU] B${index}`).join("\n");
    const names = Array.from({ length: n }, (_, index) => `r${index}`).join(" | ");
    const testCase = {
      grammar: `%ambiguity-resolution late-elision elision-only\n%rule text ${names}\n${rules}`,
      tokens: [{ text: "a", tags: ["A"] }, { text: "ku", tags: ["KU"] }, { text: "b", tags: ["B0"] }],
    };
    const { dialect } = loadEngineCase(testCase);
    return () => assert.equal(parseEngineCase(dialect, testCase).json.ok, true);
  }, ["items", "edgeChecks"]);
});

test("advancing over the captures of a production costs linear work in their number", () => {
  assertLinearWork("recognize", 100, (n) => {
    const names = Array.from({ length: n }, (_, index) => `$c${index}(A)`).join(" ");
    return chartOver(`%rule text ${names}`, n);
  }, ["captureLookups"]);
});

test("formatting an item of a production with many captures costs linear work in their number", () => {
  assertLinearWork("formatItem", 8000, (n) => {
    const captures = Array.from({ length: n }, (_, index) => ({ name: `c${index}`, index }));
    const production = /** @type {any} */ ({
      lhs: "text", helper: false, owner: "text",
      rhs: captures.map(() => ({ name: "A", terminal: true })),
      captures, captureAt: captures.map((_, index) => index), captureSlot: new Map(captures.map((capture, index) => [capture.name, index])),
    });
    return () => formatItem(production, 0);
  }, ["captureLookups"]);
});

test("checking a condition on each capture of a production costs linear work in their number", () => {
  assertLinearWork("recognize", 100, (n) => {
    const names = Array.from({ length: n }, (_, index) => `$c${index}(A)`).join(" ");
    const conditions = Array.from({ length: n }, (_, index) => `text($c${index}) = "a"`).join(", ");
    return chartOver(`%rule text ${names}\n%conditions ${conditions}`, n);
  }, ["conditions"]);
});

test("the implications of a stage close a token's tags in linear work, also over a chain written in reverse order", () => {
  assertLinearWork("implied", 500, (n) => {
    // T0 ⟹ T1 ⟹ … ⟹ Tn, written last link first.
    const implications = Array.from({ length: n }, (_, index) => ({ if: new Set([`T${n - 1 - index}`]), then: new Set([`T${n - index}`]) }));
    return () => implied(new Set(["T0"]), implications);
  }, ["implications"]);
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
    constants: more.constants ?? [], classifiers: more.classifiers ?? [], implications: [],
  };
  return new Grammar("main", [{ path: "g.md", dom }], unicode);
}

/** @param {number} n */
const capturedSequence = (n) => Array.from({ length: n }, (_, index) => ({ capture: `c${index}`, expr: { terminal: "A" } }));

test("the capture sequences of a sequence of captures cost linear work in its length", () => {
  assertLinearWork("captureSequences", 1000, (n) => {
    const seq = capturedSequence(n);
    return () => captureSequences({ seq });
  }, ["lowering"]);
});

test("lowering a sequence of symbols costs linear work in its length", () => {
  assertLinearWork("lower", 8000, (n) => {
    const alternatives = [{ guards: [], expr: { seq: capturedSequence(n) } }];
    return () => domGrammar({ alternatives }).lower(new Set());
  }, ["lowering"]);
});

/**
 * The nodes of a value, counted with no hook, as the size of an output.
 * @param {unknown} value
 */
function nodesOf(value) {
  let count = 0;
  const stack = [value];
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    if (!current || typeof current !== "object") continue;
    count++;
    for (const item of Object.values(current)) stack.push(item);
  }
  return count;
}

// A choice of n captures with clauses whose parts each belong to one
// capture: each production keeps one part, so the output is linear in n.
// The definition check, lowering and the audit simplify each clause and
// filter the emission for each production or alternative, and a scan of
// every part or item for each would cost n². The work is budgeted at a
// constant times n and the output, during the work.
test("clauses whose parts are guarded by the captures of many productions cost linear work in them and the output", () => {
  /** @param {number} n */
  const range = (n) => Array.from({ length: n }, (_, index) => index);
  /** @param {number} index */
  const holds = (index) => ({ op: "=", left: { call: "text", args: [{ capture: `c${index}` }] }, right: { string: "a" } });
  /** @param {number} n */
  const choice = (n) => range(n).map((index) => ({ guards: [], expr: { capture: `c${index}`, expr: { terminal: "A" } } }));
  /** @type {Record<string, (n: number) => any>} */
  const clauses = {
    "a union of guarded tags": (n) => ({ tags: { union: range(n).map((index) => ({ if: { captured: `c${index}` }, then: { tag: `t${index}` } })) } }),
    "a list of guarded conditions": (n) => ({ conditions: range(n).map((index) => ({ if: { captured: `c${index}` }, then: holds(index) })) }),
    "a conjunction of guarded conditions": (n) => ({ conditions: [{ all: range(n).map((index) => ({ if: { captured: `c${index}` }, then: holds(index) })) }] }),
    // A constant, which the loader resolves in the clauses the
    // alternatives share, and a part that tests no presence.
    "guarded tags and a constant": (n) => ({ tags: { union: [{ const: "K", at: [1, 1] }, ...range(n).map((index) => ({ if: { captured: `c${index}` }, then: { tag: `t${index}` } }))] } }),
    // Conditions that use a capture with no guard, which a production
    // without it drops.
    "conditions that use the captures": (n) => ({ conditions: range(n).map(holds) }),
    // One conjunction of such conditions, which only a last production
    // with every capture keeps.
    "a conjunction of conditions that use the captures": (n) => ({
      alternatives: [...choice(n), { guards: [], expr: { seq: range(n).map((index) => ({ capture: `c${index}`, expr: { terminal: "A" } })) } }],
      conditions: [{ all: range(n).map(holds) }],
    }),
    // An emission of each capture, with tags of its own.
    "an emission of the captures": (n) => ({ emit: { items: range(n).map((index) => ({ capture: `c${index}`, tags: { tag: `t${index}` } })) } }),
    // Productions of two captures, each emitted with the other attached.
    "an emission with attachments": (n) => ({
      alternatives: range(n).map((index) => ({ guards: [], expr: { seq: [{ capture: `a${index}`, expr: { terminal: "A" } }, { capture: `c${index}`, expr: { terminal: "A" } }] } })),
      emit: { items: range(n).map((index) => ({ capture: `c${index}`, before: [`a${index}`] })) },
    }),
    // A ∨ of guarded conditions, true for each production that lacks one
    // of its captures, and kept by the one production that has them all.
    "a disjunction of guarded conditions": (n) => ({
      alternatives: [...choice(n), { guards: [], expr: { seq: range(n).map((index) => ({ capture: `c${index}`, expr: { terminal: "A" } })) } }],
      conditions: [{ any: range(n).map((index) => ({ if: { captured: `c${index}` }, then: holds(index) })) }],
    }),
  };
  const constants = [{ name: "K", op: "define", value: { tag: "k" }, at: [1, 1] }];
  for (const [name, clause] of Object.entries(clauses)) {
    /** @param {number} n */
    const rule = (n) => ({ alternatives: choice(n), ...clause(n) });
    for (const n of [250, 1000]) {
      // The output, from a grammar of its own, since preparing a clause
      // once is part of the work counted.
      const output = domGrammar(rule(n), { constants }).lower(new Set()).productions.reduce((sum, production) => sum + nodesOf(production.tags) + nodesOf(production.conditions.map((ready) => ready.condition)) + nodesOf(production.emit), 0);
      const most = 16 * (n + output);
      const counted = rule(n);
      const work = countedWork(() => {
        assert.equal(definitionProblem({ name: "text", op: "define", conditions: [], at: [1, 1], ...counted }), null);
        const grammar = domGrammar(counted, { constants });
        grammar.lower(new Set());
        // The audit simplifies the clauses for each alternative too.
        audit(/** @type {any} */ ({ stages: [{ name: "main", grammar }] }));
      }, { walkSteps: most, clauses: most, lowering: most, closures: most });
      assert.ok(work.walkSteps > 0, `${name}: no step counted at ${n}`);
    }
  }
});

test("checking an emission of many inserted tags costs linear work in their number", () => {
  assertLinearWork("definitionProblem", 8000, (n) => {
    const rule = {
      name: "text", alternatives: [{ guards: [], expr: { capture: "c", expr: { terminal: "A" } } }], conditions: [],
      emit: { items: [...Array.from({ length: n }, () => ({ insert: "t" })), { capture: "c" }] },
    };
    return () => assert.equal(definitionProblem(rule), null);
  }, ["clauses"]);
});

test("a union of many tag sets costs linear work in their number", () => {
  assertLinearWork("evaluate", 4000, (n) => {
    const term = /** @type {any} */ ({ union: Array.from({ length: n }, (_, index) => ({ tag: `t${index}` })) });
    return () => assert.equal(asSet(evaluate(/** @type {any} */ ({}), term, /** @type {any} */ (null))).size, n);
  }, ["tags"]);
});

test("lowering braces around a choice of many items costs linear work in them", () => {
  // The helper's productions are each item, and the helper, the separator
  // and each item again. A product that went over all it had made for each
  // sequence it added would count the square of n.
  assertLinearWork("lower", 4000, (n) => {
    const choice = Array.from({ length: n }, (_, index) => ({ terminal: `T${index}` }));
    const alternatives = [{ guards: [], expr: { repeat: { choice }, separator: { terminal: "S" } } }];
    return () => domGrammar({ alternatives }).lower(new Set());
  }, ["lowering"]);
});

test("emitting many inserted tags before a capture costs linear work in their number", () => {
  // Each inserted tag's anchor is the capture after all of them. A search
  // of the items after each would count the square of n.
  assertLinearWork("emit", 2000, (n) => {
    const dialect = loadDialectSources({
      "p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n",
      "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text $c('a')\n%emits " + Array(n).fill("T").join(", ") + ", $c\n```\n",
    }, "p.md");
    return () => assert.equal(dialect.parse("a", { autoFeatures: false }).stages[0].output.length, n + 1);
  }, ["clauses"]);
});

test("checking a definition of many productions costs linear work in them", () => {
  // A choice of n captures is n productions, each of its own name. A
  // search of every production for each name would count the square of n.
  assertLinearWork("definitionProblem", 4000, (n) => {
    const rule = {
      name: "text", conditions: [], tags: { tag: "t" },
      alternatives: [{ guards: [], expr: { choice: Array.from({ length: n }, (_, index) => ({ capture: `c${index}`, expr: { terminal: "A" } })) } }],
    };
    return () => assert.equal(definitionProblem(rule), null);
  }, ["clauses"]);
});

test("a grammar whose tag term names a constant many times costs linear work in them", () => {
  assertLinearWork("constants", 4000, (n) => {
    const constants = [{ name: "K", op: "define", value: { tag: "k" }, at: [1, 1] }];
    const tags = { union: Array.from({ length: n }, () => ({ const: "K", at: [1, 1] })) };
    return () => domGrammar({ alternatives: [{ guards: [], expr: { ref: "A" } }], tags }, { constants }).lower(new Set());
  }, ["walkSteps"]);
});

test("an intersection and a difference of large tag sets cost linear work in their tags", () => {
  // Each side is a union of n tags, which the operation reads once each.
  // One that scanned the other side for each tag, or copied what it had
  // found for each tag it added, would count the square of n.
  for (const op of ["intersection", "difference"]) {
    assertLinearWork(op, 4000, (n) => {
      const side = () => ({ union: Array.from({ length: n }, (_, index) => ({ tag: `t${index}` })) });
      const term = /** @type {any} */ ({ [op]: [side(), side()] });
      return () => assert.equal(asSet(evaluate(/** @type {any} */ ({}), term, /** @type {any} */ (null))).size, op === "intersection" ? n : 0);
    }, ["tags"]);
  }
});

test("set tests of a symbol cost linear work in the tags they read", () => {
  // A test of n tags reads each of them once: against n other tags for
  // ∩, and against the same n for ⊇. A scan of the symbol's tags for each
  // would count the square of n.
  for (const op of ["∩=∅", "⊇"]) {
    assertLinearWork(op, 4000, (n) => {
      const test = /** @type {any} */ ({ op, tags: new Set(Array.from({ length: n }, (_, index) => `t${index}`)) });
      const tags = new Set(Array.from({ length: n }, (_, index) => `${op === "⊇" ? "t" : "u"}${index}`));
      return () => assert.ok(testHolds(/** @type {any} */ ({}), test, 0, 1, tags));
    }, ["tags"]);
  }
});

test("the classes of a capture of many tags cost linear work in them", () => {
  // classes($c) reads each of the token's n tags, and the comparison reads
  // each class it keeps. A copy of the classes kept so far for each would
  // count the square of n.
  assertLinearWork("classes", 2000, (n) => {
    const loaded = loadEngineCase({ grammar: "%rule text $c(A)\n%conditions classes($c) = classes($c)" });
    const lowered = loaded.dialect.stages[0].grammar.lower(new Set());
    const { tokens, text } = caseTokens([{ text: "a", tags: ["A", ...Array.from({ length: n }, (_, index) => `K${index}`)] }]);
    return () => {
      const chart = recognize(new ParseContext(lowered, tokens, [...text], loaded.dialect.loader.unicode), "text", 0, tokens.length);
      assert.equal(chart.setAt(1).items.filter((item) => item.complete && item.production.lhs === "text").length, 1);
    };
  }, ["tags"]);
});

test("sound tests over spans that end in one run of silent tokens cost linear work in all, not each span's length", () => {
  assertLinearWork("testHolds", 20000, (n) => {
    // One sounding token after n silent ones; each span from a silent token
    // to the end sounds like it.
    const tokens = [...Array.from({ length: n }, () => ({ phonemes: "" })), { phonemes: "a" }];
    const test = /** @type {any} */ ({ op: "=", sound: "a" });
    return () => {
      const context = /** @type {any} */ ({ tokens, sounds: new Array(tokens.length), nextSounding: null, unicode: { canonical: (/** @type {string} */ text) => text } });
      for (let from = 0; from < n; from++) assert.ok(testHolds(context, test, from, n + 1, new Set()));
    };
  }, ["soundSteps"]);
});

test("trimming lines side by side costs linear work in a long inner run of spaces", () => {
  assertLinearWork("sideBySide", 2000, (n) => {
    const line = `a${" ".repeat(n)}b`;
    return () => sideBySide(line, line, "first", "second");
  }, ["text"]);
});

test("a rule extended many times costs linear work in the extensions", () => {
  assertLinearWork("extend-rule", 8000, (n) => {
    const alternatives = [{ guards: [], expr: { ref: "A" } }];
    const rules = Array.from({ length: n }, () => ({ name: "text", op: "extend", alternatives, conditions: [], at: [1, 1] }));
    return () => domGrammar({ alternatives }, { rules });
  }, ["clauses"]);
});

test("a classifier with many entries for one key, and clauses naming many classifiers, cost linear work in their number", () => {
  assertLinearWork("classifiers", 4000, (n) => {
    const entries = Array.from({ length: n }, (_, index) => ({ guards: [], keys: ["a"], op: "∈", class: `K${index}`, at: [1, 1] }));
    const classifiers = Array.from({ length: n }, (_, index) => ({ name: `c${index}`, entries: index === 0 ? entries : [], at: [1, 1] }));
    const tags = { union: classifiers.map(({ name }) => ({ call: "classify", args: [{ string: "a" }, { classifier: name }] })) };
    const alternatives = [{ guards: [], expr: { ref: "A" } }];
    return () => assert.equal(domGrammar({ alternatives, tags }, { classifiers }).classifiers(new Set()).get("c0")?.get("a")?.size, n);
  }, ["tags", "clauses"]);
});


test("lowering a sequence of many optionals, each a helper, costs linear work in their number", () => {
  assertLinearWork("lower", 16000, (n) => {
    const alternatives = [{ guards: [], expr: { seq: Array.from({ length: n }, () => ({ optional: { terminal: "A" } })) } }];
    return () => domGrammar({ alternatives }).lower(new Set());
  }, ["lowering"]);
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

test("lowering an optional of many optionals, each a helper, costs linear work in their number", () => {
  // The outer helper's expansion waits for n nested helpers at once.
  assertLinearWork("lower", 8000, (n) => {
    const inner = Array.from({ length: n }, () => ({ optional: { terminal: "A" } }));
    const alternatives = [{ guards: [], expr: { optional: { seq: [{ terminal: "B" }, ...inner] } } }];
    return () => domGrammar({ alternatives }).lower(new Set());
  }, ["lowering"]);
});

test("finding which rules are nullable, which can read and which can emit costs linear work in a chain of rules", () => {
  assertLinearWork("nullable", 2000, (n) => {
    // Lowering finds the nullable rules for its check of braces.
    const grammar = ruleChain(n, { alternatives: [{ guards: [], expr: { seq: [] } }] });
    return () => grammar.lower(new Set());
  }, ["closures"]);
  assertLinearWork("readingOf", 2000, (n) => {
    const lowered = ruleChain(n, { alternatives: [{ guards: [], expr: { terminal: "A" } }] }).lower(new Set());
    return () => assert.equal(readingOf(lowered).last.size, n + 2);
  }, ["closures"]);
  assertLinearWork("audit", 2000, (n) => {
    const grammar = ruleChain(n, { alternatives: [{ guards: [], expr: { capture: "c", expr: { terminal: "A" } } }], emit: { items: [{ capture: "c" }] } });
    return () => audit(/** @type {any} */ ({ stages: [{ name: "main", grammar }] }));
  }, ["closures", "clauses"]);
});

test("auditing a rule extended many times, each extension emitting nothing, costs linear work in the extensions", () => {
  assertLinearWork("audit", 2000, (n) => {
    const alternatives = [{ guards: [], expr: { ref: "A" } }];
    const rules = Array.from({ length: n }, () => ({ name: "text", op: "extend", alternatives, conditions: [], emit: { items: [] }, at: [1, 1] }));
    const grammar = domGrammar({ alternatives }, { rules });
    return () => audit(/** @type {any} */ ({ stages: [{ name: "main", grammar }] }));
  }, ["closures", "clauses"]);
});

test("splicing a pipeline costs linear work in its chain of includes, its features and its stages", () => {
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
  assertLinearWork("include chain", 250, (n) => {
    const documents = new Map(Array.from({ length: n }, (_, index) => [`d${index}.md`, dom(index + 1 < n ? [{ name: "include", args: [`d${index + 1}.md`] }] : [{ name: "stage", args: ["s"] }])]));
    return () => splicePipeline("d0.md", (path) => documents.get(path));
  }, ["splice"]);
  assertLinearWork("features", 20000, (n) => {
    const documents = new Map([["p.md", dom([{ name: "stage", args: ["s"] }, { name: "features", args: Array.from({ length: n }, (_, index) => `f${index}`) }])]]);
    return () => assert.equal(splicePipeline("p.md", (path) => documents.get(path)).features.length, n);
  }, ["splice"]);
  assertLinearWork("stages", 5000, (n) => {
    const documents = new Map([["p.md", dom(Array.from({ length: n }, (_, index) => ({ name: "stage", args: [`s${index}`] })))]]);
    return () => assert.equal(splicePipeline("p.md", (path) => documents.get(path)).stages.length, n);
  }, ["splice"]);
});

test("finding repeated captures in a balanced tree of sequences marks each capture a bounded number of times", () => {
  // T(0) = $x and T(d) = (T(d-1) $x T(d-1)): at every meeting the side
  // that comes second is the smaller, so its captures are marked and its
  // list is emptied. A list left full there would be marked again at each
  // level above, the captures times the depth, past a budget per capture.
  /** @type {(depth: number) => any} */
  const tree = (depth) => (depth === 0 ? { capture: "x", expr: { ref: "A" } } : { seq: [tree(depth - 1), { capture: "x", expr: { ref: "A" } }, tree(depth - 1)] });
  for (const depth of [10, 12]) {
    const captures = 2 ** (depth + 1) - 1;
    const work = countedWork(() => assert.equal(duplicateCaptures(tree(depth)).length, captures - 1), { walkSteps: 8 * captures });
    assert.ok(work.walkSteps > 0);
  }
});

/**
 * A cycle of g unit rules, r0 to r(g-1), of which r0 also reads A, all of
 * one group.
 * @param {number} g
 */
const unitCycle = (g) => `%rule r0 r1 | A\n` + Array.from({ length: g - 1 }, (_, index) => `%rule r${index + 1} r${(index + 2) % g}`).join("\n");

test("the contexts of a traversal along a cycle of unit rules cost the square of its length, not its cube", () => {
  // Over one token, the derivation goes down the whole cycle, and the
  // context below each level holds every rule above it in the group. So
  // the contexts copied cost the square of the cycle's length. A key of a
  // context that read the context again for each rule would cost its cube.
  for (const g of [25, 100]) {
    const testCase = { grammar: `%rule text r0\n${unitCycle(g)}`, tokens: [{ text: "a", tags: ["A"] }] };
    const { dialect } = loadEngineCase(testCase);
    countedWork(() => assert.equal(parseEngineCase(dialect, testCase).json.ok, true), { traversal: 4 * g * g });
  }
  // Over many tokens, the contexts are bounded by the cycle, and the work
  // grows with the text.
  assertLinearWork("traversal", 50, (n) => {
    const testCase = { grammar: `%rule text {r0}\n${unitCycle(25)}`, tokens: Array.from({ length: n }, () => ({ text: "a", tags: ["A"] })) };
    const { dialect } = loadEngineCase(testCase);
    return () => assert.equal(parseEngineCase(dialect, testCase).json.ok, true);
  }, ["traversal"]);
});

test("many items, each built in many ways, index each way once", () => {
  // Each b over one token has 30 ways, through each c. The first ways of
  // each are compared in a scan and then indexed once, so the work grows
  // with the tokens times the ways.
  const names = Array.from({ length: 30 }, (_, index) => `c${index}`);
  const grammar = `%rule text {b}\n%rule b ${names.join(" | ")}\n${names.map((name) => `%rule ${name} A`).join("\n")}`;
  assertLinearWork("ways", 50, (n) => {
    const testCase = { grammar, tokens: Array.from({ length: n }, () => ({ text: "a", tags: ["A"] })) };
    const { dialect } = loadEngineCase(testCase);
    return () => parseEngineCase(dialect, testCase);
  }, ["edgeChecks"]);
});
