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
