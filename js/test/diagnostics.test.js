// The diagnostics' logic, on small dialects held in memory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDialectSources, audit } from "../src/node.js";

const dialect = (rules) => loadDialectSources({
  "p.md": "## Main <?stage main?>\n\n- [g](g.md) <?grammar?>\n",
  "g.md": "```ebnf\n%ambiguity-resolution greedy ;\n" + rules + "\n```\n",
}, "p.md");

test("the audit reaches rules only through what a reachable alternative can use", () => {
  // A condition naming a capture no alternative has never runs, so the rule
  // it names is not reached through it.
  const [idle] = audit(dialect("text ≔ A : matches($x, helper) ; helper ≔ B ;"));
  assert.deepEqual(idle.unreachable, ["helper"]);
  assert.equal(idle.idleConditions.length, 1);
  // The free-modifier rule is reached through a reachable #, and only so.
  const [unused] = audit(dialect("text ≔ A ; other ≔ B # ; # ≔ [free ...] ; free ≔ C ;"));
  assert.deepEqual(unused.unreachable, ["#", "free", "other"]);
  const [used] = audit(dialect("text ≔ A # ; # ≔ [free ...] ; free ≔ C ;"));
  assert.deepEqual(used.unreachable, []);
  // A condition that applies reaches the rule it names.
  const [applies] = audit(dialect("text ≔ $x(A) : matches($x, helper) ; helper ≔ A ;"));
  assert.deepEqual(applies.unreachable, []);
  // An alternative's own tags replace the rule's, so a rule the rule-level
  // tags name is not reached through an alternative that has its own.
  const [overridden] = audit(dialect("text <tags($x, ghost)> ≔ $x(A) <\"T\"> ; ghost ≔ A ;"));
  assert.deepEqual(overridden.unreachable, ["ghost"]);
});

test("the audit finds an erasure that could change nothing", () => {
  // Nothing under x emits, and x is inside no emitted token: erasing it says nothing.
  const [idle] = audit(dialect("text ≔ x ; x ≔ A ⇒ $ <> ;"));
  assert.deepEqual(idle.idleErasures.map((e) => [e.rule, e.erased]), [["x", "$"]]);
  // Something under x emits.
  const [emits] = audit(dialect("text ≔ x ; x ≔ w ⇒ $ <> ; w ≔ A ⇒ $ ;"));
  assert.deepEqual(emits.idleErasures, []);
  // x is inside a token text emits, whose phonemes would include it.
  const [sounds] = audit(dialect("text ≔ y ⇒ $ ; y ≔ x B ; x ≔ A ⇒ $ <> ;"));
  assert.deepEqual(sounds.idleErasures, []);
  // A token whose tags name its phoneme does not sound like what is under it.
  const [fixed] = audit(dialect("text ≔ x ⇒ $ </a/> ; x ≔ A ⇒ $ <> ;"));
  assert.deepEqual(fixed.idleErasures.map((e) => [e.rule, e.erased]), [["x", "$"]]);
  // Not when that tag term is dropped for the alternative, for naming a
  // capture it lacks.
  const [dropped] = audit(dialect("text <\"/a/\" ∪ tags($x)> ≔ $x(A) | y ⇒ $ ; y ≔ B ⇒ $ <> ;"));
  assert.deepEqual(dropped.idleErasures, []);
  // A capture erased by name is judged the same way.
  const [named] = audit(dialect("text ≔ $a(A) $b(w) ⇒ $a <>, $b ; w ≔ B ;"));
  assert.deepEqual(named.idleErasures.map((e) => [e.rule, e.erased]), [["text", "$a"]]);
});

test("a defect in a condition is reported although the lookahead skips its production", async () => {
  const d = dialect("text ≔ good | bad ; good ≔ A ; bad ≔ B : ∅ ∈ ∅ ;");
  const { Token } = await import("../src/node.js");
  const result = d.parse("", { tokens: [new Token(new Map([["A", true]]), [0, 1], [0, 1], "a", null, undefined)] });
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, "grammar");
});
