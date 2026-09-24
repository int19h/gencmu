// The diagnostics' logic, on small dialects held in memory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDialectSources, audit } from "../src/node.js";

const dialect = (rules) => loadDialectSources({
  "p.md": "## Main <?stage main?>\n\n- [g](g.md) <?grammar?>\n",
  "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n" + rules + "\n```\n",
}, "p.md");

test("the audit reaches rules only through what a reachable alternative can use", () => {
  // A condition that applies to no alternative is an error of the grammar.
  assert.throws(() => dialect("%rule text $y(A) %conditions matches($x, helper)\n%rule helper B"), /\$x is captured by no alternative/);
  assert.throws(() => dialect("%rule text $y(A) | B %conditions $y ⟹ matches($x, helper)\n%rule helper B"), /\$x is captured by no alternative/);
  // The free-modifier rule is reached through a reachable #, and only so.
  const [unused] = audit(dialect("%rule text A %rule other B # %rule # [free ...] %rule free C"));
  assert.deepEqual(unused.unreachable, ["#", "free", "other"]);
  const [used] = audit(dialect("%rule text A # %rule # [free ...] %rule free C"));
  assert.deepEqual(used.unreachable, []);
  // A condition that applies reaches the rule it names.
  const [applies] = audit(dialect("%rule text $x(A) %conditions matches($x, helper) %rule helper A"));
  assert.deepEqual(applies.unreachable, []);
  // A condition reaches the rule it names only through the alternatives it
  // applies to.
  const [partly] = audit(dialect("%rule text $a(A) | B %conditions matches($a, ghost) %rule ghost A"));
  assert.deepEqual(partly.unreachable, []);
});

test("the audit finds a silent item that could change nothing", () => {
  const idle = (rules) => audit(dialect(rules))[0].idleErasures.map((e) => [e.rule, e.erased]);
  // Nothing under x emits, and x is inside no emitted token.
  assert.deepEqual(idle("%rule text x %rule x A %emits $ <>"), [["x", "$"]]);
  // Something under x emits.
  assert.deepEqual(idle("%rule text x %rule x w %emits $ <> %rule w A %emits $"), []);
  // x is inside a token text emits, whose phonemes would include it.
  assert.deepEqual(idle("%rule text y %emits $ %rule y x B %rule x A %emits $ <>"), []);
  // A token whose tags name its phoneme does not sound like what is under it.
  assert.deepEqual(idle("%rule text x %emits $ </a/> %rule x A %emits $ <>"), [["x", "$"]]);
  // Not inside a token an ancestor emits, whose phonemes come from what lies
  // under it.
  assert.deepEqual(idle("%rule text y %emits $ %rule y x %emits $ </a/> %rule x B %emits $ <>"), []);
  // %tags counts for the alternatives it serves, guarded or not.
  assert.deepEqual(idle("%rule text $x(A) | y %tags \"/a/\" ∪ ($x ⟹ tags($x)) %emits $ %rule y B %emits $ <>"), [["y", "$"]]);
  // A capture made silent by name is judged the same way.
  assert.deepEqual(idle("%rule text $a(A) $b(w) %emits $a <>, $b %rule w B"), [["text", "$a"]]);
});

test("a defect in a condition is reported although the lookahead skips its production", async () => {
  const d = dialect("%rule text good | bad %rule good A %rule bad B %conditions ∅ ∈ ∅");
  const { Token } = await import("../src/node.js");
  const result = d.parse("", { tokens: [new Token(new Map([["A", true]]), [0, 1], [0, 1], "a", null, undefined)] });
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, "grammar");
});
