// Format 49: an item condition of braces in a stage that holds a ranked
// choice. The frames of the ranked choice lower the conditions of each
// production again, and in format 49 they take the item conditions too, so
// a condition that is false without its item capture rejects the text.
// That is int19h/gencmu#347. Format 49 keeps this verdict until that fix,
// and the format 50 lowering of compound bindings does not change it.
import test from "node:test";
import assert from "node:assert/strict";
import { runEngineCase } from "./shared.js";

const tokens = [{ text: "a", tags: ["A"] }, { text: "b", tags: ["B"] }];
const ranked = "%rule text :: ∅ | bad ≻ good\n%rule bad A\n%error \"bad\"\n%rule good {$i:A} B\n%conditions ";
const plain = "%rule text good\n%rule good {$i:A} B\n%conditions ";

/** @param {string} grammar */
function verdict(grammar) {
  const outcome = runEngineCase({ description: grammar, grammar, tokens });
  if (outcome.loadError || outcome.usageError) return `error: ${(outcome.loadError ?? outcome.usageError).message}`;
  return outcome.result.ok ? `ok ${outcome.brackets}` : `${outcome.result.error.kind}: ${outcome.result.error.message}`;
}

test("an item condition beside a ranked choice keeps the format 49 verdict of int19h/gencmu#347", () => {
  for (const condition of ['¬($i ⟹ $i.value = "x")', '¬(¬$i ∨ $i.value = "x")']) {
    assert.equal(verdict(ranked + condition), "rejected: the main stage could not continue at token 1", condition);
    assert.equal(verdict(plain + condition), "ok (a b)", condition);
  }
  assert.equal(verdict(ranked + '$i.value ≠ "x"'), "ok (a b)");
});
