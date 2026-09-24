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
  const [unused] = audit(dialect("%free-modifiers free ;\ntext ≔ A ; other ≔ B # ; free ≔ C ;"));
  assert.deepEqual(unused.unreachable, ["free", "other"]);
  const [used] = audit(dialect("%free-modifiers free ;\ntext ≔ A # ; free ≔ C ;"));
  assert.deepEqual(used.unreachable, []);
  // A condition that applies reaches the rule it names.
  const [applies] = audit(dialect("text ≔ $x(A) : matches($x, helper) ; helper ≔ A ;"));
  assert.deepEqual(applies.unreachable, []);
});
