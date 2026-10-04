// Each count of `hooks.work` is made before the step it counts, one for
// each step, so that a budget stops the work at the first count past it
// (src/testing.js). A count made after a loop, or of a whole loop at
// once, lets the loop run to its end past the budget.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertStopsAtBudget, countedWork } from "./linear.js";
import { TagUnion, tagUnion } from "../src/tags.js";
import { ParseContext, readingOf, recognize, testHolds } from "../src/earley.js";
import { DOM_FORMAT, duplicateCaptures } from "../src/dom.js";
import { Grammar } from "../src/grammar.js";
import { implied } from "../src/stage.js";
import { audit, sideBySide, sourceExcerpt } from "../src/diagnostics.js";
import { Token } from "../src/tokens.js";
import { UnicodeTable } from "../src/unicode.js";
import { loadDialectSources } from "../src/node.js";
import { caseTokens, loadEngineCase } from "./shared.js";
import { hasNodeWithWords, wordLabels, rejectionWindows } from "../../../tools/quoted-texts.js";
import { suggestLayout } from "../../../tools/alternatives.js";

const unicode = loadEngineCase({ grammar: "%rule text A" }).dialect.loader.unicode;
const greedy = { name: "ambiguity-resolution", args: ["greedy"], at: [1, 1] };

/**
 * The dialect whose one stage is `grammar`, reading the text's characters.
 * @param {string} grammar
 */
function single(grammar) {
  return loadDialectSources({
    "p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n",
    "g.md": "# A grammar\n\n```jbogenbau\n%ambiguity-resolution greedy\n" + grammar + "\n```\n",
  }, "p.md");
}

test("a search for a captured part counts each step it takes", () => {
  // The condition is ready at the last capture, and reads the first of
  // 300 from there.
  const captures = Array.from({ length: 300 }, (_, index) => `$c${index}('a')`).join(" ");
  const dialect = single(`%rule text ${captures}\n%conditions text($c0) = text($c299)`);
  const text = "a".repeat(300);
  assertStopsAtBudget("captureSteps", () => assert.ok(dialect.parse(text, { autoFeatures: false }).ok), "captureSteps");
});

test("the table of sounding tokens counts each token it reads", () => {
  const tokens = Array.from({ length: 200 }, (_, index) => new Token(new Set(["A"]), [index, index + 1], [index, index + 1], "a", index % 2 ? "" : "a", undefined));
  const lowered = /** @type {any} */ ({ productions: [] });
  const run = () => testHolds(new ParseContext(lowered, tokens, [..."a".repeat(200)], new UnicodeTable(""), undefined), { op: "=", sound: "a", written: "" }, 0, 2, new Set());
  assertStopsAtBudget("soundSteps", run, "soundSteps");
});

test("the merge of the captures of a choice counts each capture it moves", () => {
  // The last merge moves 100 captures of one name at once.
  const branch = (count) => ({ choice: Array.from({ length: count }, () => ({ capture: "x" })) });
  assertStopsAtBudget("walkSteps", () => duplicateCaptures({ choice: [branch(100), branch(101)] }), "walkSteps");
});

test("an excerpt of a long line counts each character it reads", () => {
  const text = "a".repeat(300) + "\n" + "b".repeat(300);
  assertStopsAtBudget("text", () => sourceExcerpt(text, [400, 401]), "text");
});

test("the labels of words and the windows of a rejection count each character they read", () => {
  assertStopsAtBudget("wordLabels", () => wordLabels("." + ".".repeat(200) + "a" + ",".repeat(200)), "text");
  assertStopsAtBudget("rejectionWindows", () => rejectionWindows("mi ".repeat(100) + "klama", "klama"), "text");
});

test("an extension of a rule counts each alternative it adds", () => {
  // The DOMs skip the notation's reader, whose own counts would come
  // first.
  const alternatives = (/** @type {number} */ count) => Array.from({ length: count }, () => ({ guards: [], expr: { ref: "A" } }));
  const rule = (/** @type {string} */ op, /** @type {number} */ count) => ({ name: "text", op, alternatives: alternatives(count), conditions: [], at: [1, 1] });
  const dom = (/** @type {any[]} */ rules, /** @type {any[]} */ directives) => ({ format: DOM_FORMAT, rules, directives, constants: [], classifiers: [], implications: [] });
  const documents = [{ path: "g.md", dom: dom([rule("define", 1)], [greedy]) }, { path: "h.md", dom: dom([rule("extend", 200)], []) }];
  assertStopsAtBudget("clauses", () => new Grammar("main", documents, unicode), "clauses");
});

test("lowering counts each helper it moves to its stack", () => {
  // 200 helpers of one alternative wait at once.
  const expr = { seq: Array.from({ length: 200 }, () => ({ repeat: { ref: "A" } })) };
  const dom = { format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr }], conditions: [], at: [1, 1] }], directives: [greedy], constants: [], classifiers: [], implications: [] };
  // A grammar keeps what it lowered, so each run lowers a new one.
  assertStopsAtBudget("lowering", () => new Grammar("main", [{ path: "g.md", dom }], unicode).lower(new Set()), "lowering");
});

test("a union of tag sets counts each tag it copies, and a long union copies each tag once", () => {
  const left = new Set(Array.from({ length: 100 }, (_, index) => `l${index}`));
  const right = new Set(Array.from({ length: 100 }, (_, index) => `r${index}`));
  assert.equal(assertStopsAtBudget("tagUnion", () => tagUnion(left, right), "tags"), 200);
  // 300 sets of one tag each: the first is taken as it is, the second
  // copies it and adds its own, and each other adds one. A union that
  // copied what it held at each set would count the square of 300.
  const sets = Array.from({ length: 300 }, (_, index) => new Set([`t${index}`]));
  const union = () => {
    const all = new TagUnion();
    for (const set of sets) all.add(set);
    assert.equal(all.result().size, 300);
  };
  assert.equal(countedWork(union, { tags: 300 }).tags, 300);
  assertStopsAtBudget("TagUnion", union, "tags");
});

test("two blocks side by side count each character they split, measure, pad and trim", () => {
  // 200 lines of one letter each side: the letters and line feeds of both
  // blocks, the letters of the left, a step for each output line, its
  // padding to 8 columns, and the one letter that ends its trim. A width
  // found again for each line would count the square of the lines.
  const lines = Array.from({ length: 200 }, () => "x").join("\n");
  const short = () => sideBySide(lines, lines, "first", "right");
  assert.equal(countedWork(short, { text: 14 * 200 + 8 }).text, 14 * 200 + 8);
  assertStopsAtBudget("sideBySide", short, "text");
  // One line with an inner run of 200 spaces each side. A trim that tried
  // each start in the run, as /\s+$/ does, would count its square.
  const line = `a${" ".repeat(200)}b`;
  const long = () => sideBySide(line, line, "first", "right");
  assert.equal(countedWork(long, { text: 4 * 200 + 18 }).text, 4 * 200 + 18);
});

test("a node found by its words counts each label it compares", () => {
  // One node of 300 words, compared with the 300 words. A comparison that
  // joined the labels again for each label would count their square.
  const input = Array.from({ length: 300 }, (_, index) => ({ label: `w${index}` }));
  const tree = { kind: "rule", rule: "chain", children: input.map((_, index) => ({ kind: "token", token: index })) };
  const wanted = input.map((token) => token.label).join(" ");
  const run = () => assert.ok(hasNodeWithWords(tree, input, "chain", wanted));
  assert.equal(countedWork(run, { text: 300 }).text, 300);
  assertStopsAtBudget("hasNodeWithWords", run, "text");
});

/**
 * A production of `count` captures with a condition ready at each, its
 * grammar and the tokens it reads.
 * @param {number} count
 */
function conditionAtEachCapture(count) {
  const names = Array.from({ length: count }, (_, index) => `$c${index}(A)`).join(" ");
  const conditions = Array.from({ length: count }, (_, index) => `text($c${index}) = "a"`).join(", ");
  const loaded = loadEngineCase({ grammar: `%rule text ${names}\n%conditions ${conditions}` });
  const { tokens, text } = caseTokens(Array.from({ length: count }, () => ({ text: "a", tags: ["A"] })));
  return { loaded, grammar: loaded.dialect.stages[0].grammar, tokens, text };
}

test("an advance reads only the conditions ready at its dot", () => {
  // 300 advances, each with one condition ready. A selection that scanned
  // every condition of the production at each advance would count the
  // square of 300.
  const { loaded, grammar, tokens, text } = conditionAtEachCapture(300);
  const lowered = grammar.lower(new Set());
  const run = () => {
    const chart = recognize(new ParseContext(lowered, tokens, [...text], loaded.dialect.loader.unicode), "text", 0, tokens.length);
    assert.equal(chart.setAt(300).items.filter((item) => item.complete && item.production.lhs === "text").length, 1);
  };
  assert.equal(countedWork(run, { conditions: 300 }).conditions, 300);
});

test("lowering indexes each position, capture and condition of a production once", () => {
  // 300 symbols copied, and 300 each of positions, captures and
  // conditions indexed. An index that scanned every condition for each
  // position would count the square of 300.
  const { grammar } = conditionAtEachCapture(300);
  // A grammar keeps what it lowered, so each run clears what it kept.
  const run = () => {
    grammar.lowered.clear();
    grammar.lower(new Set());
  };
  assert.equal(countedWork(run, { lowering: 4 * 300 }).lowering, 4 * 300);
  assertStopsAtBudget("addProduction", run, "lowering");
});

test("the closures over a grammar count each symbol they read", () => {
  // One production of 300 references to b, and b → A. Nullability reads
  // each production and its symbols, and indexes each reference. What can
  // read also reads each reference again for each use of b, and once more
  // for the last symbol that can read. A test of every other symbol at
  // each would count the square of 300.
  const loaded = loadEngineCase({ grammar: `%rule text ${Array(300).fill("b").join(" ")}\n%rule b A` });
  const grammar = loaded.dialect.stages[0].grammar;
  const lower = () => {
    grammar.lowered.clear();
    return grammar.lower(new Set());
  };
  assert.equal(countedWork(lower, { closures: 2 * 300 + 3 }).closures, 2 * 300 + 3);
  assertStopsAtBudget("checkBraceItems", lower, "closures");
  const lowered = lower();
  assert.equal(countedWork(() => readingOf(lowered), { closures: 4 * 300 + 7 }).closures, 4 * 300 + 7);
  // A grammar keeps what it found can read, so each run finds it for a
  // copy.
  assertStopsAtBudget("readingOf", () => readingOf({ ...lowered }), "closures");
  // An item of braces of 300 nullable references and a terminal. Its two
  // helpers read their symbols up to the terminal, and the check of the
  // item reads each of its symbols until one cannot match no tokens.
  const braces = loadEngineCase({ grammar: `%rule text {${Array(300).fill("e").join(" ")} A}\n%rule e ε | A` }).dialect.stages[0].grammar;
  const lowerBraces = () => {
    braces.lowered.clear();
    braces.lower(new Set());
  };
  assert.equal(countedWork(lowerBraces, { closures: 3 * 300 + 12 }).closures, 3 * 300 + 12);
  assertStopsAtBudget("checkBraceItems", lowerBraces, "closures");
});

test("the audit counts each part, emission item and node of an expression it reads", () => {
  /** @param {any[]} rules */
  const auditOf = (rules) => {
    const grammar = new Grammar("main", [{ path: "g.md", dom: { format: DOM_FORMAT, rules, directives: [greedy], constants: [], classifiers: [], implications: [] } }], unicode);
    return () => audit(/** @type {any} */ ({ stages: [{ name: "main", grammar }] }));
  };
  // 300 captures, and an emission of 300 items of which only the last
  // names one. Whether the rule emits reads each capture and each item. A
  // test of each item against every capture would count the square of 300.
  const seq = Array.from({ length: 300 }, (_, index) => ({ capture: `c${index}`, expr: { terminal: "A" } }));
  const items = Array.from({ length: 300 }, (_, index) => ({ capture: index === 299 ? "c0" : `x${index}` }));
  const captures = auditOf([{ name: "text", op: "define", alternatives: [{ guards: [], expr: { seq } }], conditions: [], emit: { items }, at: [1, 1] }]);
  assert.equal(countedWork(captures, { closures: 2 * 300 + 1 }).closures, 2 * 300 + 1);
  assertStopsAtBudget("emittingRules", captures, "closures");
  // 300 references to b under `%emits ε`. The audit walks them for what
  // reaches b, and again for whether anything under the erasure emits. A
  // walk of the whole sequence for each of its parts would count the
  // square of 300.
  const refs = Array.from({ length: 300 }, () => ({ ref: "b" }));
  const erasure = auditOf([
    { name: "text", op: "define", alternatives: [{ guards: [], expr: { seq: refs } }], conditions: [], emit: { items: [] }, at: [1, 1] },
    { name: "b", op: "define", alternatives: [{ guards: [], expr: { terminal: "A" } }], conditions: [], at: [1, 1] },
  ]);
  assert.equal(countedWork(erasure, { clauses: 2 * 300 + 6 }).clauses, 2 * 300 + 6);
  assertStopsAtBudget("audit", erasure, "clauses");
});

test("the grouping of rules for the cycle context counts each item, edge, rule and arc it reads", () => {
  // text → b0 | … | b(n-1), each b over the one character: n unit arcs
  // from text, over the same span. The groupings of a parse read each item
  // and edge, and follow each arc, a fixed number of times. A search of the
  // arcs found so far for each new one would count the square of n.
  /** @param {number} count */
  const alternatives = (count) => {
    const names = Array.from({ length: count }, (_, index) => `b${index}`);
    const dialect = single(`%rule text ${names.join(" | ")}\n${names.map((name) => `%rule ${name} 'a'`).join("\n")}`);
    return () => assert.equal(dialect.parse("a", { autoFeatures: false }).stages[0].verdict, "tie");
  };
  assert.equal(countedWork(alternatives(300), { groups: 11 * 300 + 3 }).groups, 11 * 300 + 3);
  assertStopsAtBudget("groupRules", alternatives(30), "groups");
});

test("an item built in many ways indexes each way once", () => {
  // text → b over the one character, where b has n productions: the item
  // of text has n ways, through each b. The first ways are compared in a
  // scan, then indexed, and each later one is a lookup. An index built
  // again for each new way would count the square of n.
  /** @param {number} count */
  const ways = (count) => {
    const names = Array.from({ length: count }, (_, index) => `c${index}`);
    const dialect = single(`%rule text b\n%rule b ${names.join(" | ")}\n${names.map((name) => `%rule ${name} 'a'`).join("\n")}`);
    return () => assert.equal(dialect.parse("a", { autoFeatures: false }).stages[0].verdict, "tie");
  };
  assert.equal(countedWork(ways(300), { edgeChecks: 300 + 27 }).edgeChecks, 300 + 27);
  assertStopsAtBudget("edgeChecks", ways(30), "edgeChecks");
});

test("the closure of a token's tags counts each implication and tag it reads", () => {
  // A chain of 300 implications, T0 → T1 → … → T300, from T0. The index
  // reads each implication and its tag, and the closure reads the token's
  // tag, then fires each implication and reads its tag. A closure that
  // copied what it held for each tag it added would count the square of
  // 300.
  const run = () => {
    const implications = Array.from({ length: 300 }, (_, index) => ({ if: new Set([`T${index}`]), then: new Set([`T${index + 1}`]) }));
    assert.equal(implied(new Set(["T0"]), implications).size, 301);
  };
  const work = countedWork(run, { implications: 4 * 300 + 1, tags: 1 });
  assert.deepEqual([work.implications, work.tags], [4 * 300 + 1, 1]);
  assertStopsAtBudget("implied", run, "implications");
});

test("a layout of alternatives counts each other line of a symbol it reads", () => {
  // Three symbols, the middle one of 301 lines. The rows that start at the
  // first two symbols each read its 300 other lines once. A row that found
  // the longest line again at each of them would count the square of 300.
  const symbols = ["a", "x\n" + Array(300).fill("y").join("\n"), "b"];
  const run = () => assert.equal(suggestLayout(symbols, "  ", 80).length, 301);
  assert.equal(countedWork(run, { text: 2 * 300 + 10 }).text, 2 * 300 + 10);
  assertStopsAtBudget("suggestLayout", run, "text");
});
