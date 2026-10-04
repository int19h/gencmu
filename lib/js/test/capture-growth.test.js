// A captured part's span is part of an item's identity, so captures can
// multiply the items of a production (engine §4). This test pins that cost
// for a capture of a rule that can end in many places.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngineCase, caseTokens } from "./shared.js";
import { ParseContext, recognize } from "../src/earley.js";
import { countedWork } from "./linear.js";

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
  /** @param {number} count */
  const parts = (count) => {
    const names = Array.from({ length: count }, (_, index) => `$c${index}(A)`).join(" ");
    // A tag term that reads every capture, the first last.
    const tags = Array.from({ length: count }, (_, index) => `tags($c${count - 1 - index})`).join(" ∪ ");
    const loaded = loadEngineCase({ grammar: `%rule text ${names}\n%tags ~x ∪ ${tags}\n%conditions text($c0) = "a"` });
    const lowered = loaded.dialect.stages[0].grammar.lower(new Set());
    const { tokens, text } = caseTokens(Array.from({ length: count }, () => ({ text: "a", tags: ["A"] })));
    // A budget stops a parse that makes a captured part, or takes a step
    // through them, for each pair of captures.
    const work = countedWork(() => {
      const chart = recognize(new ParseContext(lowered, tokens, [...text], loaded.dialect.loader.unicode), "text", 0, tokens.length);
      assert.equal(chart.setAt(count).items.filter((item) => item.complete && item.production.lhs === "text").length, 1);
    }, { captures: 2 * count, captureSteps: 4 * count + 8 });
    return { captures: work.captures, items: work.items, steps: work.captureSteps };
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

test("a condition at each capture of a long production reads the part it names without a walk of every part before it (engine §4)", async () => {
  /**
   * The capture steps of one production of `count` captures, with a
   * condition at each capture that reads it and the capture `far`.
   * @param {number} count
   * @param {(index: number) => string} far
   */
  const steps = (count, far) => {
    const names = Array.from({ length: count }, (_, index) => `$c${index}(A)`).join(" ");
    const conditions = Array.from({ length: count }, (_, index) => `text($c${index}) = text(${far(index)})`).join(", ");
    const loaded = loadEngineCase({ grammar: `%rule text ${names}\n%conditions ${conditions}` });
    const lowered = loaded.dialect.stages[0].grammar.lower(new Set());
    const { tokens, text } = caseTokens(Array.from({ length: count }, () => ({ text: "a", tags: ["A"] })));
    // A budget stops a parse whose searches walk every part before the one
    // they find.
    const work = countedWork(() => {
      const chart = recognize(new ParseContext(lowered, tokens, [...text], loaded.dialect.loader.unicode), "text", 0, tokens.length);
      assert.equal(chart.setAt(count).items.filter((item) => item.complete && item.production.lhs === "text").length, 1);
    }, { captureSteps: count * (2 * Math.log2(count) + 8) });
    return work.captureSteps;
  };
  for (const count of [100, 200, 400]) {
    // The capture just read is the last part, and the first capture is a
    // search by the jumps, whose steps grow with the logarithm of the parts.
    const near = steps(count, (index) => `$c${index}`);
    const first = steps(count, () => "$c0");
    assert.ok(near <= 2 * count + 4, `${near} steps for ${count} captures read where they are made`);
    assert.ok(first <= count * (2 * Math.log2(count) + 4), `${first} steps for ${count} captures that each read the first`);
  }
});
