// The shared cases of tests/notation-growth.json: reading a document whose
// constructs nest deep costs work that grows with its length, not with its
// square (tests/README.md). The work is the recognizer's items and the
// steps of the readers and walks, counted, not timed.
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
 * The work of reading the case's document nested `n` deep, the items and
 * the walk steps, which stops at the first count past the budget.
 * @param {any} testCase
 * @param {(text: string) => unknown} read
 * @param {number} n
 * @param {{items: number, walkSteps: number}} [budget]
 */
function work(testCase, read, n, budget) {
  const text = "```jbogenbau\n" + testCase.prefix + testCase.open.repeat(n) + testCase.middle + testCase.close.repeat(n) + testCase.suffix + "\n```\n";
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

test("the work of reading deep nesting grows with its depth, not with its square (tests/notation-growth.json)", async () => {
  const { readDocument } = await import("../../../tools/bootstrap-reader.js");
  assert.ok(cases.length > 5);
  for (const testCase of cases) {
    for (const [reader, read] of /** @type {[string, (text: string) => unknown][]} */ ([
      ["library", (text) => loader.readDocument(text, "t.md")], ["bootstrap", (text) => readDocument(text, "t.md")]])) {
      // Once first, so that loading the notation counts in neither.
      work(testCase, read, 250);
      const small = work(testCase, read, 250);
      const budget = { items: 5 * small.items, walkSteps: 5 * small.walkSteps };
      const large = work(testCase, read, 1000, budget);
      assert.ok(small.items + small.walkSteps > 0, `${testCase.name} (${reader}): no work counted`);
      assert.ok(large.items <= budget.items && large.walkSteps <= budget.walkSteps, `${testCase.name} (${reader}): ${JSON.stringify(small)} for 250 levels, ${JSON.stringify(large)} for 1000`);
    }
  }
});
