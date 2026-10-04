// The shared cases of tests/notation-growth.json: reading a document whose
// constructs nest deep costs work that grows with its length, not with its
// square (tests/README.md). The work is the recognizer's items and the
// steps of the readers and walks, counted, not timed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repository, loaderWith } from "./shared.js";
import { recognizerCounters } from "../src/earley.js";
import { walkCounter } from "../src/trampoline.js";

const cases = JSON.parse(fs.readFileSync(path.join(repository, "tests", "notation-growth.json"), "utf8"));
const loader = loaderWith({});

/**
 * The work of reading the case's document nested `n` deep.
 * @param {any} testCase
 * @param {(text: string) => unknown} read
 * @param {number} n
 */
function work(testCase, read, n) {
  const text = "```jbogenbau\n" + testCase.prefix + testCase.open.repeat(n) + testCase.middle + testCase.close.repeat(n) + testCase.suffix + "\n```\n";
  recognizerCounters.items = 0;
  walkCounter.steps = 0;
  try {
    read(text);
  } catch {
    // An error is an outcome too; its place is the notation cases' concern.
  }
  return recognizerCounters.items + walkCounter.steps;
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
      const large = work(testCase, read, 1000);
      assert.ok(large <= 5 * small, `${testCase.name} (${reader}): ${small} for 250 levels, ${large} for 1000`);
    }
  }
});
