// The diagnostics' logic, on small dialects held in memory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDialectSources, formatTerm, formatCondition, audit, formatAudit, trace, formatTrace, explainError, GencmuError } from "../src/node.js";

const dialect = (rules) => loadDialectSources({
  "p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n",
  "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n" + rules + "\n```\n",
}, "p.md");

test("the audit names flag changes in replacements", () => {
  const [stage] = audit(dialect("%rule(leftmost-longest) text A\n%extend-rule text B\n%redefine-rule text C\n%redefine-rule(leftmost-longest) text D\n%redefine-rule(leftmost-longest) text E\n%redefine-rule text F\n%redefine-rule text G"));
  assert.deepEqual(stage.changes.map((change) => change.flagChange), [
    undefined, { from: ["leftmost-longest"], to: [] }, { from: [], to: ["leftmost-longest"] }, undefined,
    { from: ["leftmost-longest"], to: [] }, undefined,
  ]);
  const text = formatAudit([stage]);
  assert.match(text, /flags changed from leftmost-longest to none/);
  assert.match(text, /flags changed from none to leftmost-longest/);
  assert.equal(text.split("flags changed").length - 1, 3);
});

test("the audit reaches rules only through what a reachable alternative can use", () => {
  // A condition that applies to no alternative is an error of the grammar.
  assert.throws(() => dialect("%rule text $y(A) %conditions matches($x, helper)\n%rule helper B"), /\$x is captured by no alternative/);
  assert.throws(() => dialect("%rule text $y(A) | B %conditions $y ⟹ matches($x, helper)\n%rule helper B"), /\$x is captured by no alternative/);
  // The free-modifier rule is reached through a reachable #, and only so.
  const [unused] = audit(dialect("%rule text A %rule other B # %rule # [{free}] %rule free C"));
  assert.deepEqual(unused.unreachable, ["#", "free", "other"]);
  const [used] = audit(dialect("%rule text A # %rule # [{free}] %rule free C"));
  assert.deepEqual(used.unreachable, []);
  // A condition that applies reaches the rule it names.
  const [applies] = audit(dialect("%rule text $x(A) %conditions matches($x, helper) %rule helper A"));
  assert.deepEqual(applies.unreachable, []);
  // A condition reaches the rule it names only through the alternatives it
  // applies to.
  const [partly] = audit(dialect("%rule text $a(A) | B %conditions matches($a, ghost) %rule ghost A"));
  assert.deepEqual(partly.unreachable, []);
});

test("the audit and the check of references go into a tested symbol", () => {
  // A rule that only a tested reference names is reachable, even inside a
  // capture, and a tested reference to a rule that does not exist is an
  // error of the grammar.
  const [tested] = audit(dialect('%rule text $s(sumti="lonu") [other⊇~x] %rule sumti A B %rule other C %rule idle D'));
  assert.deepEqual(tested.unreachable, ["idle"]);
  assert.throws(() => dialect('%rule text ghost="a"'), /refers to ghost, which is not defined/);
  // A part under a test is walked for what could emit, as any part is.
  const idle = (rules) => audit(dialect(rules))[0].idleErasures.map((e) => e.rule);
  assert.deepEqual(idle('%rule text quiet B %rule quiet word="a" %emits ε %rule word A %emits $'), []);
});

test("the audit reports where each membership of a classifier is added and removed", () => {
  const [stage] = audit(loadDialectSources({
    "p.md": "```jbogenbau\n%stage main\n%include \"a.md\"\n%include \"b.md\"\n```\n",
    "a.md": "```jbogenbau\n%ambiguity-resolution greedy\n%classifier lex\n  \"mi\" \"do\" ∈ KOhA\n%rule text W\n```\n",
    "b.md": "```jbogenbau\n%classifier lex\n  f? ¬g? \"mi\" ∉ KOhA\n  f? \"mi\" ∈ UI\n```\n",
  }, "p.md"));
  assert.deepEqual(stage.memberships, [
    { classifier: "lex", key: "mi", class: "KOhA", changes: [
      { op: "∈", gates: "", document: "a.md", line: 4, column: 3 },
      { op: "∉", gates: "f? ¬g?", document: "b.md", line: 3, column: 3 },
    ] },
    { classifier: "lex", key: "do", class: "KOhA", changes: [{ op: "∈", gates: "", document: "a.md", line: 4, column: 3 }] },
    { classifier: "lex", key: "mi", class: "UI", changes: [{ op: "∈", gates: "f?", document: "b.md", line: 4, column: 3 }] },
  ]);
  // The text lists the memberships that a gate guards or that more than
  // one entry touches, with every place that adds or removes them.
  const text = formatAudit([stage]);
  assert.match(text, /classifier lex: 3 memberships of 2 keys/);
  assert.match(text, /"mi" KOhA: added at a\.md:4:3, removed under f\? ¬g\? at b\.md:3:3/);
  assert.match(text, /"mi" UI: added under f\? at b\.md:4:3/);
  assert.doesNotMatch(text, /"do"/);
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
  assert.deepEqual(idle("%rule text $x(A) | y %tags /a/ ∪ ($x ⟹ tags($x)) %emits $ %rule y B %emits ε"), ["y"]);
});

test("a set on the left of ∈ is refused when the grammar is read, so no lookahead can skip it", () => {
  // It was once found only while parsing (engine §9, §10).
  assert.throws(() => dialect("%rule text good | bad %rule good A %rule bad B %conditions ∅ ∈ ∅"),
    (error) => error instanceof GencmuError && error.kind === "grammar" && /∈ tests a string/.test(error.message));
});

test("the trace and the explanation of an error write a tested terminal with its test", () => {
  // Characters to sounds, sounds to words, so that the words have phonemes.
  const block = (text) => "```jbogenbau\n%ambiguity-resolution greedy\n" + text + "\n```\n";
  const tested = loadDialectSources({
    "p.md": "```jbogenbau\n%stage sounds\n%include \"s.md\"\n%stage words\n%include \"w.md\"\n%stage main\n%include \"g.md\"\n```\n",
    "s.md": block("%rule text [{sound}]\n%rule sound 'l' </l/> | 'a' </a/> | 'i' </i/> | 'd' </d/> | ' ' </./> %emits $"),
    "w.md": block("%rule text [{word}]\n%rule word le | d | /./\n%rule le /l/ /a/ [/i/] %emits $ <LE>\n%rule d /d/ %emits $ <D>"),
    "g.md": block('%rule text LE="la" D D | LE="lai" C | LE∩~D≠∅ D'),
  }, "p.md");
  const result = tested.parse("lai d", { autoFeatures: false });
  assert.deepEqual(result.error.expected, [{ terminal: "C", rules: ["text"] }]);
  const text = formatTrace(trace(tested, "lai d", { stage: "main", position: 1 }));
  assert.match(text, /text ≔ LE="lai" • C {2}\[0\.\.1\]/);
  assert.match(text, /text ≔ LE="la" • D D\n {6}refused: the test of LE="la" does not hold of what it spans/);
  assert.match(text, /text ≔ LE∩D≠∅ • D\n {6}refused: the test of LE∩D≠∅ does not hold of what it spans/);
  assert.match(explainError(tested.parse("d", { autoFeatures: false })), /text: LE="la", LE="lai", LE∩D≠∅/);
});

test("the trace writes a range and a property by their canonical written form (engine §4)", () => {
  // '\u{61}' is 'a' in its canonical spelling, so the range is 'a'..'z'.
  const classes = dialect("%rule text '\\u{61}'..'z' '\\p{L}' 'x'");
  const first = trace(classes, "ab", { stage: "main", position: 0, autoFeatures: false });
  assert.deepEqual(first.expected, [{ terminal: "'a'..'z'", rules: ["text"] }]);
  assert.match(formatTrace(first), /text ≔ • 'a'\.\.'z' '\\p\{L\}' 'x' {2}\[0\.\.0\]/);
  const second = trace(classes, "ab", { stage: "main", position: 1, autoFeatures: false });
  assert.deepEqual(second.expected, [{ terminal: "'\\p{L}'", rules: ["text"] }]);
  const text = formatTrace(second);
  assert.match(text, /text ≔ 'a'\.\.'z' • '\\p\{L\}' 'x' {2}\[0\.\.1\]/);
  assert.match(text, /could read next:\n {2}'\\p\{L\}' \(text\)/);
});

test("the token table and the side-by-side view take more lines than a call takes arguments", async () => {
  const { tokenTable, sideBySide } = await import("../src/diagnostics.js");
  // A stage that hands on 150,000 tokens is one table, with no limit from
  // the number of arguments a call takes.
  const count = 150000;
  const output = Array.from({ length: count }, (_, index) => ({
    text: "a", phonemes: "a", label: "A", span: [index, index + 1], source: [index, index + 1], tags: new Set(), before: [], after: [],
  }));
  const table = tokenTable({ stages: [{ name: "main", output, verdict: "accepted" }] });
  assert.equal(table.split("\n").length, count + 2);
  // A long tree beside another is one view.
  const tree = Array.from({ length: count }, (_, index) => `line ${index}`).join("\n");
  const view = sideBySide(tree, "x", "left", "right");
  assert.equal(view.split("\n").length, count + 1);
});

test("a term and a condition nested 20,000 deep print on an ordinary stack", () => {
  // A caller can hand formatTerm and formatCondition values that no
  // document's depth limit bounds, so they keep a stack of their own.
  const depth = 20000;
  /** @type {any} */
  let term = { tag: "A" };
  for (let index = 0; index < depth; index++) term = { difference: [{ tag: "B" }, term] };
  assert.equal(formatTerm(term), "B ∖ (".repeat(depth - 1) + "B ∖ A" + ")".repeat(depth - 1));
  /** @type {any} */
  let condition = { captured: "c" };
  for (let index = 0; index < depth; index++) condition = { not: condition };
  assert.equal(formatCondition(condition), "¬(".repeat(depth) + "$c" + ")".repeat(depth));
});
