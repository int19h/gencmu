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

test("a defect in a condition is reported although the lookahead skips its production", async () => {
  const d = dialect("text ≔ good | bad ; good ≔ A ; bad ≔ B : ∅ ∈ ∅ ;");
  const { Token } = await import("../src/node.js");
  const result = d.parse("", { tokens: [new Token(new Map([["A", true]]), [0, 1], [0, 1], "a", null, undefined)] });
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, "grammar");
});
