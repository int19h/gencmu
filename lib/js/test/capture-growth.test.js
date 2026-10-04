// A captured part's span is part of an item's identity, so captures can
// multiply the items of a production (engine §4). This test pins that cost
// for a capture of a rule that can end in many places.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngineCase, caseTokens } from "./shared.js";
import { ParseContext, recognize } from "../src/earley.js";

/**
 * The completed items of the production `t → t t` or `t → $l(t) $r(t)`
 * over the whole input of n tokens A.
 * @param {string} grammar
 * @param {number} n
 */
function wholeItems(grammar, n) {
  const loaded = loadEngineCase({ grammar });
  const lowered = loaded.dialect.stages[0].grammar.lower(new Set());
  const { tokens, text } = caseTokens(Array.from({ length: n }, () => ({ text: "a", tags: ["A"] })));
  const chart = recognize(new ParseContext(lowered, tokens, [...text], loaded.dialect.loader.unicode), "text", 0, tokens.length);
  const set = chart.sets[n];
  return set.items.filter((item) => item.complete && item.origin === 0 && item.production.lhs === "t" && item.production.rhs.length === 2).length;
}

test("a capture of a rule that can end in many places keeps one completed item for each place, and the same production without captures keeps one (engine §4)", () => {
  for (let n = 2; n <= 5; n++) {
    assert.equal(wholeItems("%rule text t\n%rule t t t | A", n), 1, `t t over ${n}`);
    assert.equal(wholeItems("%rule text t\n%rule t $l(t) $r(t) | A", n), n - 1, `$l(t) $r(t) over ${n}`);
  }
});

test("an item shares the captured parts of the item it advanced, so one production of C captures over C tokens keeps C captured parts, not C², and reads them in a bounded number of walks (engine §4)", async () => {
  const { recognizerCounters } = await import("../src/earley.js");
  /** @param {number} count */
  const parts = (count) => {
    const names = Array.from({ length: count }, (_, index) => `$c${index}(A)`).join(" ");
    // A tag term that reads every capture, the first last.
    const tags = Array.from({ length: count }, (_, index) => `tags($c${count - 1 - index})`).join(" ∪ ");
    const loaded = loadEngineCase({ grammar: `%rule text ${names}\n%tags ~x ∪ ${tags}\n%conditions text($c0) = "a"` });
    const lowered = loaded.dialect.stages[0].grammar.lower(new Set());
    const { tokens, text } = caseTokens(Array.from({ length: count }, () => ({ text: "a", tags: ["A"] })));
    recognizerCounters.captures = 0;
    recognizerCounters.items = 0;
    recognizerCounters.captureSteps = 0;
    const chart = recognize(new ParseContext(lowered, tokens, [...text], loaded.dialect.loader.unicode), "text", 0, tokens.length);
    assert.equal(chart.setAt(count).items.filter((item) => item.complete && item.production.lhs === "text").length, 1);
    return { captures: recognizerCounters.captures, items: recognizerCounters.items, steps: recognizerCounters.captureSteps };
  };
  for (const count of [100, 200, 400]) {
    const found = parts(count);
    assert.equal(found.captures, count, `${count} captures`);
    assert.ok(found.items <= 2 * count + 4, `${found.items} items for ${count} captures`);
    // The tags and the condition read the parts in a bounded number of
    // walks, not one walk for each capture.
    assert.ok(found.steps <= 2 * count + 4, `${found.steps} steps for ${count} captures`);
  }
});
