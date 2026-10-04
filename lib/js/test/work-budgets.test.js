// Each count of `hooks.work` is made before the step it counts, one for
// each step, so that a budget stops the work at the first count past it
// (src/testing.js). A count made after a loop, or of a whole loop at
// once, lets the loop run to its end past the budget.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertStopsAtBudget } from "./linear.js";
import { ParseContext, testHolds } from "../src/earley.js";
import { DOM_FORMAT, duplicateCaptures } from "../src/dom.js";
import { Grammar } from "../src/grammar.js";
import { sourceExcerpt } from "../src/diagnostics.js";
import { Token } from "../src/tokens.js";
import { UnicodeTable } from "../src/unicode.js";
import { loadDialectSources } from "../src/node.js";
import { loadEngineCase } from "./shared.js";
import { wordLabels, rejectionWindows } from "../../../tools/quoted-texts.js";

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
