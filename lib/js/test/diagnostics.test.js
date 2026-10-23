// The diagnostics' logic, on small dialects held in memory.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadDialectSources, loadDialect, formatTerm, formatCondition, audit, formatAudit, trace, formatTrace, explainError, GencmuError } from "../src/node.js";
import { countedWork } from "./linear.js";

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
  assert.throws(() => dialect("%rule text $y:A %conditions $x.matches(helper)\n%rule helper B"), /\$x is captured by no alternative/);
  assert.throws(() => dialect("%rule text $y:A | B %conditions $y ⟹ $x.matches(helper)\n%rule helper B"), /\$x is captured by no alternative/);
  // The free-modifier rule is reached through a reachable 🆓, and only so.
  const [unused] = audit(dialect("%rule text A %rule other B 🆓 %rule 🆓 [{free}] %rule free C"));
  assert.deepEqual(unused.unreachable, ["free", "other", "🆓"]);
  const [used] = audit(dialect("%rule text A 🆓 %rule 🆓 [{free}] %rule free C"));
  assert.deepEqual(used.unreachable, []);
  // A condition that applies reaches the rule it names.
  const [applies] = audit(dialect("%rule text $x:A %conditions $x.matches(helper) %rule helper A"));
  assert.deepEqual(applies.unreachable, []);
  // A condition reaches the rule it names only through the alternatives it
  // applies to.
  const [partly] = audit(dialect("%rule text $a:A | B %conditions $a.matches(ghost) %rule ghost A"));
  assert.deepEqual(partly.unreachable, []);
});

test("the audit follows every ranked option and emissions beneath it", () => {
  const rules = "%rule text (first ≻ second) B %rule first A %rule second C %rule idle D";
  assert.deepEqual(audit(dialect(rules))[0].unreachable, ["idle"]);
  const emitting = "%rule text quiet B %rule quiet (first ≻ second) %erased %rule first A B %rule second C D %emits $";
  assert.deepEqual(audit(dialect(emitting))[0].idleErasures, []);
});

test("the audit includes query targets of private ranked captures even when the query fails", () => {
  for (const body of ['"a"', '"z"']) {
    const d = dialect(`%rule text ($x:"a" ≻ "b") "c"
%conditions $x.matches(helper)
%rule helper ${body}`);
    assert.equal(d.parse("ac").ok, body === '"a"');
    assert.deepEqual(audit(d)[0].unreachable, []);
  }
});

test("the audit keeps capture scopes through nested ranked options and ordinary helpers", () => {
  let expression = '$x:"a"';
  for (let depth = 0; depth < 6; depth++) {
    expression = `("z" ≻ ${expression})`;
    const d = dialect(`%rule text [${expression}] "c"
%conditions $x.matches(helper)
%rule helper "a"`);
    assert.ok(d.parse("ac").ok);
    assert.ok(d.parse("c").ok);
    assert.deepEqual(audit(d)[0].unreachable, []);
  }
});

test("the audit does not combine captures from different ranked options", () => {
  const d = dialect(`%rule text ($x:"a" ≻ $y:"b") :: ∅
%conditions ($x ⟹ $y.matches(ghost)) ∧ ($y ⟹ $.starts-input)
%rule ghost "z"`);
  assert.ok(d.parse("a").ok);
  assert.ok(d.parse("b").ok);
  assert.deepEqual(audit(d)[0].unreachable, ["ghost"]);
});

test("the audit keeps query targets under absent and mixed optional guards", () => {
  const absent = dialect(`%rule text [$x:"a"]
%conditions ¬$x ⟹ $.matches(helper)
%rule helper ε`);
  assert.ok(absent.parse("").ok);
  assert.ok(absent.parse("a").ok);
  assert.deepEqual(audit(absent)[0].unreachable, []);
  for (const body of ['"a"', '"z"']) {
    const mixed = dialect(`%rule text [$x:"a"] [$y:"b"]
%conditions ($x ∧ ¬$y) ⟹ $.matches(helper)
%rule helper ${body}`);
    assert.equal(mixed.parse("a").ok, body === '"a"');
    assert.ok(mixed.parse("ab").ok);
    assert.deepEqual(audit(mixed)[0].unreachable, []);
  }
});

test("the audit does not expand independent optional captures", () => {
  let previous;
  for (const count of [6, 24, 96]) {
    const d = dialect("%rule text " + Array.from({ length: count }, (_, index) => `[$c${index}:"a"]`).join(" "));
    const work = countedWork(() => assert.deepEqual(audit(d)[0].unreachable, []), { lowering: 0, walkSteps: 32 * count + 32, clauses: 32 * count + 32 });
    assert.equal(work.lowering, 0);
    if (previous) assert.ok(work.clauses <= 5 * previous.clauses + 16);
    previous = work;
  }
});

// Clause applicability and presence reduction follow engine §3.6.
test("the audit reduces missing sibling", () => {
  const d = dialect(`%rule text ($x:"a" | $y:"b") "c"
%conditions ($x ⟹ $x.matches(ghost)) ∧ $y.starts-input
%rule ghost "z"`);
  assert.equal(d.parse("ac").ok, true);
  assert.equal(d.parse("bc").ok, true);
  assert.deepEqual(audit(d)[0].unreachable, ["ghost"]);
});

test("the audit reduces missing sibling ranked", () => {
  const d = dialect(`%rule text ($x:"a" ≻ $y:"b") "c"
%conditions ($x ⟹ $x.matches(ghost)) ∧ $y.starts-input
%rule ghost "z"`);
  assert.equal(d.parse("ac").ok, true);
  assert.equal(d.parse("bc").ok, true);
  assert.deepEqual(audit(d)[0].unreachable, ["ghost"]);
});

test("the audit reduces guarded sibling", () => {
  const d = dialect(`%rule text ($x:"a" | $y:"b") "c"
%conditions ($x ⟹ $x.matches(ghost)) ∧ ($y ⟹ $y.starts-input)
%rule ghost "a"`);
  assert.equal(d.parse("ac").ok, true);
  assert.equal(d.parse("bc").ok, true);
  assert.deepEqual(audit(d)[0].unreachable, []);
});

test("the audit reduces missing sibling value comparison", () => {
  const d = dialect(`%rule text ($x:"a" | $y:"b") "c"
%conditions ($x ⟹ $x.matches(ghost)) ∧ $y.source-text = "b"
%rule ghost "z"`);
  assert.equal(d.parse("ac").ok, true);
  assert.equal(d.parse("bc").ok, true);
  assert.deepEqual(audit(d)[0].unreachable, ["ghost"]);
});

test("the audit reduces impossible disjunctive guard", () => {
  const d = dialect(`%rule text ($x:"a" | $y:"b") "c" :: (((¬$x ∧ ¬$y) ∨ ($x ∧ $y)) ⟹ $.tags(ghost))
%rule ghost "a"`);
  assert.equal(d.parse("ac").ok, true);
  assert.equal(d.parse("bc").ok, true);
  assert.deepEqual(audit(d)[0].unreachable, ["ghost"]);
});

test("the audit reduces empty intersection", () => {
  const d = dialect(`%rule text $x:"a" "c" :: ∅ ∩ $x.tags(ghost)
%rule ghost "a"`);
  assert.equal(d.parse("ac").ok, true);
  assert.equal(d.parse("bc").ok, false);
  assert.deepEqual(audit(d)[0].unreachable, ["ghost"]);
});

test("the audit reduces empty difference", () => {
  const d = dialect(`%rule text $x:"a" "c" :: ∅ ∖ $x.tags(ghost)
%rule ghost "a"`);
  assert.equal(d.parse("ac").ok, true);
  assert.equal(d.parse("bc").ok, false);
  assert.deepEqual(audit(d)[0].unreachable, ["ghost"]);
});

test("the audit reduces empty intersection definition", () => {
  const d = dialect(`%rule text :: ∅ ∩ $x.tags(ghost) | $x:"a" "c"
%rule ghost "a"`);
  assert.equal(d.parse("ac").ok, true);
  assert.equal(d.parse("bc").ok, false);
  assert.deepEqual(audit(d)[0].unreachable, ["ghost"]);
});

test("the audit reduces empty intersection emission", () => {
  const d = dialect(`%rule text $x:"a" "c" %emits $x :: ∅ ∩ $x.tags(ghost)
%rule ghost "a"`);
  assert.equal(d.parse("ac").ok, true);
  assert.equal(d.parse("bc").ok, false);
  assert.deepEqual(audit(d)[0].unreachable, ["ghost"]);
});

test("the audit reduces disjunction pruned by absent guard", () => {
  const d = dialect(`%rule text ($x:"a" | $y:"b") "c"
%conditions (($x ⟹ $x.matches(ghost)) ∨ ($y ⟹ $y.starts-input)) ∧ ($y ⟹ $y.starts-input)
%rule ghost "z"`);
  assert.equal(d.parse("ac").ok, true);
  assert.equal(d.parse("bc").ok, true);
  assert.deepEqual(audit(d)[0].unreachable, ["ghost"]);
});

test("the audit keeps queries when projected guards and set terms survive", () => {
  for (const body of ['($x:"a" | $y:"b")', '($x:"a" ≻ $y:"b")']) {
    for (const guard of ['($x ∨ $y)', '(($x ∧ ¬$y) ∨ (¬$x ∧ $y))']) {
      // Private ranked captures can guard conditions, but cannot export
      // through tags. Both legal clause positions retain the query.
      const ranked = body.includes("≻");
      const expression = ranked ? '($x:"a" "c" ≻ $y:"b" "c")' : `${body} "c"`;
      const clause = ranked ? `%conditions ${guard} ⟹ $.matches(ghost)` : `:: (${guard} ⟹ $.tags(ghost))`;
      const d = dialect(`%rule text ${expression} ${clause}
%rule ghost "a" "c" | "b" "c"`);
      assert.ok(d.parse("ac").ok);
      assert.ok(d.parse("bc").ok);
      assert.deepEqual(audit(d)[0].unreachable, []);
    }
  }
  for (const term of ['∅ ∪ $x.tags(ghost)', '$x.tags(ghost) ∖ ∅', 'X ∩ $x.tags(ghost)']) {
    const d = dialect(`%rule text $x:"a" "c" :: ${term}
%rule ghost "a"`);
    assert.ok(d.parse("ac").ok);
    assert.deepEqual(audit(d)[0].unreachable, []);
  }
});

test("the experimental audit reaches text-token through the initial connective condition", () => {
  const d = loadDialect("experimental");
  assert.ok(d.parse("e mi klama").ok);
  assert.ok(d.parse("su'i mi klama").ok);
  const stage = audit(d).find((stage) => stage.name === "syntax");
  assert.ok(stage);
  assert.ok(!stage.unreachable.includes("text-token"));
  assert.ok(stage.unreachable.includes("joik-jek"));
});

test("the audit follows captures in ordinary groups for tags and emissions", () => {
  for (const rule of [
    '%rule text ($x:"a" | "b") "c" :: ($x ⟹ $x.tags(helper))',
    '%rule text :: ($x ⟹ $x.tags(helper)) | ($x:"a" | "b") "c"',
    '%rule text ($x:"a" | "b") "c" %emits $x :: $x.tags(helper), ε',
  ]) {
    const d = dialect(`${rule}
%rule helper "a"`);
    assert.ok(d.parse("ac").ok);
    assert.ok(d.parse("bc").ok);
    assert.deepEqual(audit(d)[0].unreachable, []);
  }
  const emitting = dialect(`%rule text holder "c"
%rule holder quiet %erased
%rule quiet ($x:word | $x:other) %emits $x
%rule word "a"
%rule other "b"`);
  assert.ok(emitting.parse("ac").ok);
  assert.deepEqual(audit(emitting)[0].idleErasures, []);
  const covering = dialect(`%rule text ($x:quiet | $x:loud) "c" %emits $x
%rule quiet "a" %erased
%rule loud "b"`);
  assert.ok(covering.parse("ac").ok);
  assert.deepEqual(audit(covering)[0].idleErasures, []);
  const inserted = dialect(`%rule text word %emits ε, $
%rule word quiet
%rule quiet "a" %erased`);
  assert.ok(inserted.parse("a").ok);
  assert.deepEqual(audit(inserted)[0].idleErasures, []);
});

test("the audit and the check of references go into a tested symbol", () => {
  // A rule that only a tested reference names is reachable, even inside a
  // capture, and a tested reference to a rule that does not exist is an
  // error of the grammar.
  const [tested] = audit(dialect("%rule text $s:sumti=\"lonu\" [other<X>] %rule sumti A B %rule other C %rule idle D"));
  assert.deepEqual(tested.unreachable, ["idle"]);
  assert.throws(() => dialect('%rule text ghost="a"'), /refers to ghost, which is not defined/);
  // A part under a test is walked for what could emit, as any part is.
  const idle = (rules) => audit(dialect(rules))[0].idleErasures.map((e) => e.rule);
  assert.deepEqual(idle("%rule text quiet B %rule quiet word=\"a\" %erased %rule word A %emits $"), []);
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

test("the audit finds an erasure that can change nothing", () => {
  const idle = (rules) => audit(dialect(rules))[0].idleErasures.map((e) => e.rule);
  // Nothing under x emits, and x is inside no emitted token.
  assert.deepEqual(idle("%rule text x %rule x A %erased"), ["x"]);
  // Something under x emits.
  assert.deepEqual(idle("%rule text x %rule x w %erased %rule w A %emits $"), []);
  // x is inside a token text emits, whose phonemes would include it.
  assert.deepEqual(idle("%rule text y %emits $ %rule y x B %rule x A %erased"), []);
  // A token whose tags name its phoneme does not sound like what is under it.
  assert.deepEqual(idle("%rule text x %emits $ ::Sound-0061-s %rule x A %erased"), []);
  // Not inside a token an ancestor emits, whose phonemes come from what lies
  // under it.
  assert.deepEqual(idle("%rule text y %emits $ %rule y x %emits $ ::Sound-0061-s %rule x B %erased"), []);
  // %tags counts for the alternatives it serves, guarded or not.
  assert.deepEqual(idle("%rule text :: Sound-0061-s ∪ ($x ⟹ $x.tags) | $x:A | y %emits $ %rule y B %erased"), []);
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
    "s.md": block("%rule text [{sound}]\n%rule sound \"l\" ::Sound-006C-s | \"a\" ::Sound-0061-s | \"i\" ::Sound-0069-s | \"d\" ::Sound-0064-s | \" \" ::Sound-002E-s %emits $"),
    "w.md": block("%rule text [{word}]\n%rule word le | d | Sound-002E-s\n%rule le Sound-006C-s Sound-0061-s [Sound-0069-s] %emits $ ::LE\n%rule d Sound-0064-s %emits $ ::D"),
    "g.md": block("%rule text LE=\"la\" D D | LE=\"lai\" C | LE<D> D"),
  }, "p.md");
  const result = tested.parse("lai d", { });
  assert.deepEqual(result.error.expected, [{ terminal: "C", rules: ["text"] }]);
  const text = formatTrace(trace(tested, "lai d", { stage: "main", position: 1 }));
  assert.match(text, /text ≔ LE="lai" • C {2}\[0\.\.1\]/);
  assert.match(text, /text ≔ LE="la" • D D\n {6}refused: the test of LE="la" does not hold of what it spans/);
  assert.match(text, /text ≔ LE<D> • D\n {6}refused: the test of LE<D> does not hold of what it spans/);
  assert.match(explainError(tested.parse("d", { })), /text: LE<D>, LE="la", LE="lai"/);
});

test("the trace writes a range and a property by their canonical written form (engine §4)", () => {
  // '\u{61}' is 'a' in its canonical spelling, so the range is 'a'..'z'.
  const classes = dialect("%rule text \"a\"..\"z\" _General_Category_Letter \"x\"");
  const first = trace(classes, "ab", { stage: "main", position: 0, });
  assert.deepEqual(first.expected, [{ terminal: "\"a\"..\"z\"", rules: ["text"] }]);
  assert.match(formatTrace(first), /text ≔ • "a"\.\."z" _General_Category_Letter "x" {2}\[0\.\.0\]/);
  const second = trace(classes, "ab", { stage: "main", position: 1, });
  assert.deepEqual(second.expected, [{ terminal: "_General_Category_Letter", rules: ["text"] }]);
  const text = formatTrace(second);
  assert.match(text, /text ≔ "a"\.\."z" • _General_Category_Letter "x" {2}\[0\.\.1\]/);
  assert.match(text, /could read next:\n {2}_General_Category_Letter \(text\)/);
});

test("the token table and the side-by-side view take more lines than a call takes arguments", async () => {
  const { tokenTable, sideBySide } = await import("../src/diagnostics.js");
  // A stage that hands on 150,000 tokens is one table, with no limit from
  // the number of arguments a call takes.
  const count = 150000;
  const output = Array.from({ length: count }, (_, index) => ({
    text: "a", value: "a", image: "A", span: [index, index + 1], source: [index, index + 1], tags: new Set(), before: [], after: [],
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

test("the audit retains stage patch locations and reports only surviving rule changes", () => {
  const d = loadDialectSources({ "p.md": "```jbogenbau\n%stage a\n%ambiguity-resolution greedy\n%rule text A\n" +
    "%extend-stage a\n%extend-rule text B\n%redefine-stage a\n%ambiguity-resolution greedy\n%rule text C\n" +
    "%extend-stage a\n%extend-rule text D\n```" }, "p.md");
  const [stage] = audit(d);
  assert.deepEqual(stage.stageChanges, [
    { kind: "extended", document: "p.md", line: 5, column: 1 },
    { kind: "replaced", document: "p.md", line: 7, column: 1 },
    { kind: "extended", document: "p.md", line: 10, column: 1 },
  ]);
  assert.equal(stage.changes.length, 1);
  assert.match(formatAudit([stage]), /stage replaced at p.md:7:1/);
});

test("trace refuses failures before recognition and retains the original diagnostic", () => {
  for (const rules of [
    '%features f\n%conditions $.value.split($.tokens-after-first.value) = ∅\n%rule text "a"',
    '%rule text {[A]}',
  ]) {
    const broken = loadDialectSources({
      "p.md": '```jbogenbau\n%stage first\n%ambiguity-resolution greedy\n%rule text "a"\n%emits\n%stage main\n%include "g.md"\n%stage later\n%ambiguity-resolution greedy\n%rule text "a"\n```\n',
      "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n" + rules + "\n```\n",
    }, "p.md");
    const result = broken.parse("a");
    assert.equal(result.error.kind, "grammar");
    const original = explainError(result);
    for (const stage of ["main", "later"]) {
      assert.throws(() => trace(broken, "a", {stage, position:0}), error => {
        assert.ok(error instanceof GencmuError);
        assert.ok(error.message.includes(original), error.message);
        return true;
      });
    }
    assert.ok(trace(broken, "a", {stage:"first", position:0}).events.length);
  }
});

test("pattern diagnostics use the pattern sigil and brace separator", () => {
  assert.equal(formatTerm({pattern: {terminal: "A", at: [1, 1]}}), "#A");
  const pattern = {any:true, children:[{repeat:[{child:{name:"a",at:[1,1]}}],
    separator:[{child:{any:true,children:[{child:{terminal:"B",at:[1,1]}}]}}]}]};
  assert.equal(formatTerm({pattern}), "#« {a / « B »} »");
});

for (const item of JSON.parse(fs.readFileSync(new URL("../../../tests/diagnostic-notation.json", import.meta.url), "utf8"))) {
  test(item.description, () => {
    const sources = {"p.md": "```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n" + item.grammar + "\n```"};
    if (item.abbreviation) sources["unicode.txt"] = fs.readFileSync(new URL("../../../grammars/unicode.txt", import.meta.url), "utf8") + item.abbreviation;
    const dialect = loadDialectSources(sources, "p.md");
    const text = formatTerm(item.term, dialect.loader.unicode);
    assert.equal(text, item.text);
    dialect.loader.readDocument("```jbogenbau\n%const $Pattern " + text + "\n```", "diagnostic.md");
  });
}
