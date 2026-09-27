// The diagnostics' logic, on small dialects held in memory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDialectSources, audit, trace, formatTrace, explainError } from "../src/node.js";

const dialect = (rules) => loadDialectSources({
  "p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n",
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

test("the audit and the check of references go into a spelled symbol", () => {
  // A rule that only a spelled reference names is reachable, even inside a
  // capture, and a spelled reference to a rule that does not exist is an
  // error of the grammar.
  const [spelled] = audit(dialect("%rule text $s(sumti`lonu`) [other`x`] %rule sumti A B %rule other C %rule idle D"));
  assert.deepEqual(spelled.unreachable, ["idle"]);
  assert.throws(() => dialect("%rule text ghost`a`"), /refers to ghost, which is not defined/);
  // A part under a spelling is walked for what could emit, as any part is.
  const idle = (rules) => audit(dialect(rules))[0].idleErasures.map((e) => e.rule);
  assert.deepEqual(idle("%rule text quiet B %rule quiet word`a` %emits ε %rule word A %emits $"), []);
});

test("the audit finds an ε emission that could change nothing", () => {
  const idle = (rules) => audit(dialect(rules))[0].idleErasures.map((e) => e.rule);
  // Nothing under x emits, and x is inside no emitted token.
  assert.deepEqual(idle("%rule text x %rule x A %emits ε"), ["x"]);
  // Something under x emits.
  assert.deepEqual(idle("%rule text x %rule x w %emits ε %rule w A %emits $"), []);
  // x is inside a token text emits, whose phonemes would include it.
  assert.deepEqual(idle("%rule text y %emits $ %rule y x B %rule x A %emits ε"), []);
  // A token whose tags name its phoneme does not sound like what is under it.
  assert.deepEqual(idle("%rule text x %emits $ </a/> %rule x A %emits ε"), ["x"]);
  // Not inside a token an ancestor emits, whose phonemes come from what lies
  // under it.
  assert.deepEqual(idle("%rule text y %emits $ %rule y x %emits $ </a/> %rule x B %emits ε"), []);
  // %tags counts for the alternatives it serves, guarded or not.
  assert.deepEqual(idle("%rule text $x(A) | y %tags \"/a/\" ∪ ($x ⟹ tags($x)) %emits $ %rule y B %emits ε"), ["y"]);
});

test("a defect in a condition is reported although the lookahead skips its production", async () => {
  const d = dialect("%rule text good | bad %rule good A %rule bad B %conditions ∅ ∈ ∅");
  const { Token } = await import("../src/node.js");
  const result = d.parse("", { tokens: [new Token(new Map([["A", true]]), [0, 1], [0, 1], "a", null, undefined)] });
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, "grammar");
});

test("the trace and the explanation of an error write a spelled terminal with its spelling", () => {
  // Characters to sounds, sounds to words, so that the words have phonemes.
  const block = (text) => "```jbogenbau\n%ambiguity-resolution greedy\n" + text + "\n```\n";
  const spelled = loadDialectSources({
    "p.md": "```jbogenbau\n%stage sounds\n%include \"s.md\"\n%stage words\n%include \"w.md\"\n%stage main\n%include \"g.md\"\n```\n",
    "s.md": block("%rule text [sound] ...\n%rule sound \"l\" </l/> | \"a\" </a/> | \"i\" </i/> | \"d\" </d/> | \" \" </./> %emits $"),
    "w.md": block("%rule text [word] ...\n%rule word le | d | \"/./\"\n%rule le \"/l/\" \"/a/\" [\"/i/\"] %emits $ <\"LE\">\n%rule d \"/d/\" %emits $ <\"D\">"),
    "g.md": block("%rule text LE`la` D D | LE`lai` C"),
  }, "p.md");
  const result = spelled.parse("lai d", { autoFeatures: false });
  assert.deepEqual(result.error.expected, [{ terminal: "C", rules: ["text"] }]);
  const text = formatTrace(trace(spelled, "lai d", { stage: "main", position: 1 }));
  assert.match(text, /text ≔ LE`lai` • C {2}\[0\.\.1\]/);
  assert.match(text, /text ≔ LE`la` • D D\n {6}refused: what it spans does not sound like `la`/);
  assert.match(explainError(spelled.parse("d", { autoFeatures: false })), /text: LE`la`, LE`lai`/);
});
