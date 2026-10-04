// The shared cases of tests/notation-growth.json: reading a document whose
// constructs nest deep costs work that grows with its length, not with its
// square (tests/README.md). The work is the recognizer's items and the
// steps of the readers and walks, counted, not timed. A few cases of this
// library's own hold the walks of the DOM to many parts at once.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repository, loaderWith } from "./shared.js";
import { countedWork } from "./linear.js";
import { WorkBudget } from "../src/testing.js";

const cases = JSON.parse(fs.readFileSync(path.join(repository, "tests", "notation-growth.json"), "utf8"));
const loader = loaderWith({});

/**
 * The work of reading a document of grammar text, the items and the walk
 * steps, which stops at the first count past the budget.
 * @param {string} grammar
 * @param {(text: string) => unknown} read
 * @param {{items: number, walkSteps: number}} [budget]
 */
function work(grammar, read, budget) {
  const text = "```jbogenbau\n" + grammar + "\n```\n";
  const counted = countedWork(() => {
    try {
      read(text);
    } catch (error) {
      // An error of the document is an outcome too, and its place is the
      // notation cases' concern. A count past the budget is not.
      if (error instanceof WorkBudget) throw error;
    }
  }, budget);
  return { items: counted.items, walkSteps: counted.walkSteps };
}

/**
 * Asserts that reading the document of size 1000 costs at most five times
 * the work of size 250, in each reader, under that budget.
 * @param {string} name
 * @param {(n: number) => string} grammar
 */
async function assertGrowth(name, grammar) {
  const { readDocument } = await import("../../../tools/bootstrap-reader.js");
  for (const [reader, read] of /** @type {[string, (text: string) => unknown][]} */ ([
    ["library", (text) => loader.readDocument(text, "t.md")], ["bootstrap", (text) => readDocument(text, "t.md")]])) {
    // Once first, so that loading the notation counts in neither.
    work(grammar(250), read);
    const small = work(grammar(250), read);
    const budget = { items: 5 * small.items, walkSteps: 5 * small.walkSteps };
    const large = work(grammar(1000), read, budget);
    assert.ok(small.items + small.walkSteps > 0, `${name} (${reader}): no work counted`);
    assert.ok(large.items <= budget.items && large.walkSteps <= budget.walkSteps, `${name} (${reader}): ${JSON.stringify(small)} for 250, ${JSON.stringify(large)} for 1000`);
  }
}

/**
 * Documents of this library's own, n wide or n deep, whose walks of the
 * DOM hold many parts at once: a flat sequence of tested captures, tag
 * terms and a condition of many parts, a long text that cannot be read as
 * tokens, and nested sequences and choices of distinct capture names,
 * whose merges move many names.
 * @type {{name: string, text: (n: number) => string}[]}
 */
const ownCases = [
  {
    name: "wide-document",
    text: (n) => {
      const range = Array.from({ length: n }, (_, index) => index);
      return `%const $K ${range.map((index) => `~k${index}`).join(" ∪ ")}\n` +
        `%rule text ${range.map((index) => `$c${index}(A⊇~a)`).join(" ")} <${range.map(() => "$K").join(" ∪ ")}>\n` +
        `%conditions ${range.map((index) => `tags($c${index})`).join(" ∪ ")} ⊆ ~a`;
    },
  },
  {
    name: "distinct-capture-names",
    text: (n) => `%rule text ${Array.from({ length: n }, (_, index) => `$x${index}(A) (`).join("")}A${")".repeat(n)}`,
  },
  {
    // The bootstrap reader finds how far a reading of tokens gets, from
    // every place it reaches, before it reports the character it stops at.
    name: "unreadable-after-many-names",
    text: (n) => `%rule a ${"b ".repeat(n)}@`,
  },
  {
    // A sound test whose string is not a canonical sound, deep in
    // parentheses: the error stands at the string, found by a walk down
    // the operand that holds the rest of each level on its stack.
    name: "sound-test-in-parentheses",
    text: (n) => `%rule text A = ${"(".repeat(n)}"X"${")".repeat(n)}`,
  },
  {
    // A chain of tests, the one left recursion of the notation, whose
    // first token lies n rules down. The reader refuses it at the last
    // test, and a walk to a first token goes down from where it stands.
    name: "test-chain",
    text: (n) => `%rule text A${' = "x"'.repeat(n)}`,
  },
  {
    name: "test-chain-in-an-elidable-optional",
    text: (n) => `%rule text [+A${' = "x"'.repeat(n)}]`,
  },
  {
    name: "distinct-capture-choices",
    text: (n) => `%rule text ${Array.from({ length: n }, (_, index) => `$x${index}(A) | (`).join("")}A${")".repeat(n)}`,
  },
];

test("the work of reading a wide document, or distinct captures nested deep, grows with its size, not with its square", async () => {
  for (const ownCase of ownCases) await assertGrowth(ownCase.name, ownCase.text);
});

test("the work of reading deep nesting grows with its depth, not with its square (tests/notation-growth.json)", async () => {
  assert.ok(cases.length > 5);
  for (const testCase of cases) {
    await assertGrowth(testCase.name, (n) => testCase.prefix + testCase.open.repeat(n) + testCase.middle + testCase.close.repeat(n) + testCase.suffix);
  }
});
