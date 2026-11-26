// Unit tests of the format 50 engine that the shared cases do not cover.
import test from "node:test";
import assert from "node:assert/strict";
import { loaderForNotation } from "../src/node.js";

const loaders = loaderForNotation(50);

/** @param {string[]} lines */
function pipelineOf(lines) {
  return loaders.loadPipelineSources({ "p.md": ["```jbogenbau", ...lines, "```", ""].join("\n") }, "p.md");
}

/** @param {{text: string, props: object}[]} tokens */
function supplied(tokens) {
  return tokens.map((token, index) => ({ ...token, span: [index, index + 1], source: [index * 2, index * 2 + 1] }));
}

const A = { text: "a", props: { A: true } };
const EMPTY_T = { text: "t", props: { T: true, value: "" } };

test("an omitted-only head does not take a written token with an empty value", () => {
  const omitted = pipelineOf(["%stage main", "%ambiguity-resolution greedy", "%rule text [+T<_Elided>] A"]);
  const written = pipelineOf(["%stage main", "%ambiguity-resolution greedy", "%rule text [+T=\"\"] A"]);
  // With no T token, both heads stand for an omitted T.
  for (const pipeline of [omitted, written]) {
    const result = pipeline.parse("a", { tokens: supplied([A]) });
    assert.equal(result.ok, true);
  }
  // A written T with an empty value is not an omission.
  const rejected = omitted.parse("t a", { tokens: supplied([EMPTY_T, A]) });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.kind, "rejected");
  const accepted = written.parse("t a", { tokens: supplied([EMPTY_T, A]) });
  assert.equal(accepted.ok, true);
});

test("a long left-recursive run keeps the host stack and the copying bounded", () => {
  const pipeline = pipelineOf(["%stage main", "%ambiguity-resolution greedy",
    "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}",
    "%const $OUTPUTS {}", "%rule text $r:run → {image: value: $r'value}", "%emit", "%rule run A | run A"]);
  const size = 20000;
  const tokens = Array.from({ length: size }, () => A);
  const result = pipeline.parse(tokens.map(token => token.text).join(" "), { tokens: supplied(tokens) });
  assert.equal(result.ok, true);
  const value = result.stages[0].output[0].props.value("value");
  assert.equal(value.length, size);
  assert.equal(/^a*$/.test(value), true);
});

test("a neighbor test after the choice of a parse reads the chosen reading", () => {
  const flags = (/** @type {string} */ guard) => {
    const pipeline = pipelineOf(["%stage main", "%ambiguity-resolution greedy", "%const $OUTPUTS {F}", "%rule text w w",
      `%rule w $t:A → {image: value: $t'value, ${guard}? F}`, "%emit"]);
    const result = pipeline.parse("a a", { tokens: supplied([A, A]) });
    assert.equal(result.ok, true);
    return result.stages[0].output.map((/** @type {any} */ token) => token.props.has("F"));
  };
  assert.deepEqual(flags("$.followed-by(w)"), [true, false]);
  assert.deepEqual(flags("$.preceded-by(w)"), [false, true]);
  assert.deepEqual(flags("$.followed-by(A)"), [true, false]);
});

test("$INPUTS of the first stage is the supported Unicode registry and the supplied user keys", () => {
  const holds = (/** @type {string} */ rule, /** @type {string} */ key, /** @type {any} */ options) => pipelineOf(["%stage main",
    "%ambiguity-resolution greedy", `%rule text ${rule}`, `%conditions $INPUTS'${key}`]).parse("a", options).ok;
  // Latin text still offers the Cyrillic membership.
  assert.equal(holds("_Script_Latin", "_Script_Cyrillic"), true);
  assert.equal(holds("_Script_Latin", "Foo"), false);
  const tokens = supplied([{ text: "a", props: { A: true, Foo: true } }]);
  assert.equal(holds("A", "Foo", { tokens }), true);
  assert.equal(holds("A", "_Script_Cyrillic", { tokens }), true);
});

test("a report that meets no token goes to the nearest emission that yields one", () => {
  const pipeline = pipelineOf(["%stage main", "%ambiguity-resolution greedy",
    "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}",
    "%const $OUTPUTS {}", "%rule text a b", "%rule a $y:A inner", "%emit $y{}", "%rule inner A %error \"boom\"", "%rule b A", "%emit"]);
  const result = pipeline.parse("a a a", { tokens: supplied([A, A, A]) });
  assert.equal(result.error.kind, "reported");
  const output = JSON.parse(loaders.resultJson(result)).stages[0].output;
  // The token of a, not the first token after the report, owns it.
  assert.deepEqual(output.map((/** @type {any} */ token) => [token.span, (token.errors ?? []).length]), [[[0, 1], 1], [[2, 3], 0]]);
});

test("a structural comparison of two captures runs after the choice of a parse", () => {
  const B = { text: "b", props: { B: true } };
  const flag = (/** @type {string} */ op, /** @type {any[]} */ input) => {
    const pipeline = pipelineOf(["%stage main", "%ambiguity-resolution greedy",
      "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}",
      "%const $OUTPUTS {Same}", "%rule text $x:a $y:a", "%emit ${(($x " + op + " $y))? Same}", "%rule a A | B"]);
    const result = pipeline.parse(input.map(token => token.text).join(" "), { tokens: supplied(input) });
    assert.equal(result.ok, true);
    return result.stages[0].output[0].props.has("Same");
  };
  // The comparison reads structure, so two nodes over A are alike.
  assert.equal(flag("≅", [A, A]), true);
  assert.equal(flag("≅", [A, B]), false);
  assert.equal(flag("≇", [A, B]), true);
});

test("a late structural comparison with a pattern uses the pattern that the recognizer compiled", () => {
  const flag = (/** @type {string} */ right, /** @type {string[]} */ extra = []) => {
    const pipeline = pipelineOf(["%stage main", "%ambiguity-resolution greedy", ...extra, "%const $OUTPUTS {X}", "%rule text A",
      "%emit ${(($ ≅ " + right + "))? X}"]);
    const result = pipeline.parse("a", { tokens: supplied([A]) });
    assert.equal(result.ok, true);
    return result.stages[0].output[0].props.has("X");
  };
  assert.equal(flag("#A"), true);
  assert.equal(flag("#B"), false);
  assert.equal(flag("(#A ∖ ∅)"), true);
  assert.equal(flag("(#A ∩ ∅)"), false);
  assert.equal(flag("∅"), false);
  assert.equal(flag("$P", ["%const $P #A ∪ #B"]), true);
});

test("a wrapper of a decorated word of an earlier stage shows the word's satellites", () => {
  const defaults = "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}";
  const pipeline = pipelineOf(["%stage a", "%ambiguity-resolution greedy", defaults, "%const $OUTPUTS {W}", "%rule text {item}",
    "%rule item ^word mark", "%emit", "%rule word W", "%emit", "%rule mark U", "%emit",
    "%stage b", "%ambiguity-resolution greedy", defaults, "%const $OUTPUTS {}", "%rule text {wrap}", "%rule wrap ^W", "%emit"]);
  const result = pipeline.parse("w u", { tokens: supplied([{ text: "w", props: { W: true } }, { text: "u", props: { U: true } }]) });
  assert.equal(result.ok, true);
  const stages = JSON.parse(loaders.resultJson(result)).stages;
  const item = stages[0].nodes.find((/** @type {any} */ node) => node.rule === "item");
  assert.equal(item.face.parts.length, 2);
  // The wrapper has no satellite of its own, so its one part is its primary,
  // which leads to the decorated face of stage a.
  const wrap = stages[1].nodes.find((/** @type {any} */ node) => node.rule === "wrap");
  assert.equal(wrap.face.parts.length, 1);
  assert.equal(wrap.face.primaryIndex, 0);
  assert.deepEqual(wrap.face.core, item.face.core);
});

test("a pattern constant can be a set of patterns and constants", () => {
  const flag = (/** @type {string[]} */ constants) => {
    const pipeline = pipelineOf(["%stage main", "%ambiguity-resolution greedy", ...constants, "%const $OUTPUTS {X}", "%rule text A",
      "%emit ${(($ ≅ $P))? X}"]);
    const result = pipeline.parse("a", { tokens: supplied([A]) });
    assert.equal(result.ok, true);
    return result.stages[0].output[0].props.has("X");
  };
  // Each form gives the same pattern as one pattern literal.
  assert.equal(flag(["%const $Q #B", "%const $P #A ∪ $Q"]), true);
  assert.equal(flag(["%const $Q #A", "%const $P #A ∖ $Q"]), false);
  assert.equal(flag(["%const $P #(A ∖ B)"]), true);
});

test("a winning bare value or image fails at load, and a deleted one does not", () => {
  const load = (/** @type {string} */ rule) => () => pipelineOf(["%stage main", "%ambiguity-resolution greedy", "%const $OUTPUTS {}", rule, "%emit"]);
  assert.throws(load("%rule text A → {value}"), /a value or image needs a string/);
  assert.throws(load("%rule text A → {image}"), /a value or image needs a string/);
  // A deletion leaves no effective key, so only publication can fail.
  assert.doesNotThrow(load("%rule text A → {value: \"x\", ¬value}"));
});

test("verbatim text extends each side through uncovered source, and two spans cannot claim the same text", () => {
  const image = (/** @type {string} */ text, /** @type {any[]} */ tokens, /** @type {string[]} */ rules) => {
    const pipeline = pipelineOf(["%stage main", "%ambiguity-resolution greedy", "%const $OUTPUTS {}", ...rules]);
    const result = pipeline.parse(text, { tokens });
    if (!result.ok) return result.error.message;
    return result.stages[0].output.map((/** @type {any} */ token) => token.props.value("image")).join("|");
  };
  const a = { text: "a", props: { A: true }, span: [0, 1] };
  const word = ["%rule text {word}", "%rule word $t:A → {image: value: $t.span.verbatim-text}", "%emit"];
  // Both edges of one span, then the left edge alone.
  assert.equal(image(",a,", [{ ...a, source: [1, 2] }], word), ",a,");
  assert.equal(image(",a", [{ ...a, source: [1, 2] }], word), ",a");
  // Two words beside one gap both claim it.
  const b = { text: "b", props: { A: true }, span: [1, 2], source: [3, 4] };
  assert.match(image("a,,b", [{ ...a, source: [0, 1] }, b], word), /claim the same uncovered source text/);
  // .source-text claims nothing.
  assert.equal(image(",a,", [{ ...a, source: [1, 2] }], ["%rule text {word}", "%rule word $t:A → {image: value: $t.span.source-text}", "%emit"]), "a");
});

test("the record check of a stored DOM reads template calls only in their operand places", async () => {
  const { validateStoredDom } = await import("../src/format50/loader.js");
  // The annotation of a stage extension is not a template call.
  const annotated = { format: 50, rules: [], constants: [], directives: [{ name: "extend-stage", args: ["main"], annotation: { call: "f", args: ["s"] }, at: [1, 1] }] };
  assert.doesNotThrow(() => validateStoredDom(annotated, "p.md", undefined));
  // A real DOM with a template call, whose argument then loses its position.
  const { Loader50 } = await import("../src/format50/loader.js");
  const fs = await import("node:fs");
  const files = /** @type {Record<string, string>} */ ({ "p.md": "```jbogenbau\n%stage main\n%rule text f(A)\n%rule f(@P) @P\n```\n" });
  const loader = new Loader50(path => files[path] ?? (fs.existsSync(new URL("../" + path, import.meta.url)) ? fs.readFileSync(new URL("../" + path, import.meta.url), "utf8") : undefined));
  const call = structuredClone(loader.documentDom("p.md", undefined));
  delete call.rules[0].alternatives[0].expr.args[0].at;
  assert.throws(() => validateStoredDom(call, "p.md", undefined), /tagArgument record needs "at"/);
});

test("a rejection at a token with satellites points at the start of its core", () => {
  const defaults = "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}";
  const pipeline = pipelineOf(["%stage a", "%ambiguity-resolution greedy", defaults, "%const $OUTPUTS {W}", "%rule text {item}",
    "%rule item mark ^word", "%emit", "%rule word W", "%emit", "%rule mark U", "%emit",
    "%stage b", "%ambiguity-resolution greedy", defaults, "%const $OUTPUTS {}", "%rule text Z", "%emit"]);
  const result = pipeline.parse("u w", { tokens: [{ text: "u", props: { U: true }, span: [0, 1], source: [0, 1] }, { text: "w", props: { W: true }, span: [1, 2], source: [2, 3] }] });
  assert.equal(result.error.kind, "rejected");
  // The source is the whole token. Line and column give the start of w.
  const error = JSON.parse(loaders.resultJson(result)).error;
  assert.deepEqual([error.source, error.line, error.column], [[0, 3], 1, 3]);
});

test("the binder of an empty list keeps one element type across its uses", () => {
  const load = (/** @type {string} */ condition) => () => pipelineOf(["%stage main", "%ambiguity-resolution greedy", "%rule text A", "%conditions " + condition]);
  assert.throws(load('[].all($x ↦ ($x = "a") ∧ ($x = 1))'), /needs one element type/);
  assert.throws(load('[].all($x ↦ ($x = "a") ∨ ($x = 1))'), /needs one element type/);
  assert.doesNotThrow(load('[].all($x ↦ ($x = "a") ∧ ($x = "b"))'));
  assert.doesNotThrow(load('[].all($x ↦ ($x = 1) ∧ ($x = 2))'));
});

test("forms that the Eberban grammar needs load and give their results", () => {
  const run = (/** @type {string[]} */ lines, /** @type {any[]} */ tokens, text = tokens.map(token => token.text).join(" ")) =>
    pipelineOf(["%stage main", "%ambiguity-resolution greedy", ...lines]).parse(text, { tokens: supplied(tokens) });
  const A = { text: "A", props: { A: true } };
  const B = { text: "B", props: { B: true } };
  // A filtered forest in a truth position.
  assert.equal(run(["%rule text $a:A", "%conditions ¬$a.onward.parse(A …).error-free"], [A]).ok, false);
  // A tag test inside a tree pattern, in a template.
  assert.equal(run(["%rule text t(A)", "%rule t(@X) @X [+B]", "%conditions $ ≅ #⁅ ⋯ B<¬_Elided> ⁆ ∨ $.ends-input"], [A]).ok, true);
  // A predicate on an optional capture as a guard in a shared term.
  const guard = ["%rule text r<K>", "%rule r → {$t.any('K)? K}", "  | A [$t:r]", "  | B [$t:r] → {K}"];
  assert.equal(run(guard, [A]).ok, false);
  assert.equal(run(guard, [A, B]).ok, true);
  // A string template parameter in a condition.
  const param = (/** @type {string} */ actual) => run(["%rule text m", `%rule m p(= "${actual}")`, "%rule p(@C) $c:A", "%conditions $c'value = @C"], [A]).ok;
  assert.equal(param("A"), true);
  assert.equal(param("B"), false);
  // A function applied to an expression that is not a bare capture.
  const raw = (/** @type {string} */ op) => run(["%const $RAW $x ↦ $x.tokens!'value.join()", "%rule text $a:A $b:B", `%conditions $RAW($a.last-token) ${op} $b'value`], [A, B]).ok;
  assert.equal(raw("≠"), true);
  assert.equal(raw("="), false);
  // A list constant with splats.
  const pairs = (/** @type {string} */ text) => run(['%const $M ["x", "y"]', '%const $I ["B"]', "%const $PAIRS [*$M, *$I]", "%rule text $a:A", "%conditions $a'value ∈ $PAIRS"],
    [{ text, props: { A: true } }]).ok;
  assert.deepEqual(["x", "B", "z"].map(pairs), [true, true, false]);
  // A value test on an instance whose template writes another value.
  const instance = run(["%rule text a=\"a\"", "%rule a = letter-of(A, = \"a\")", "%rule letter-of(@Chars, @Value)", "  {@Chars} → {image: value: @Value}"], [A, A]);
  assert.match(instance.error.message, /the value test on a has no proof/);
});

test("the choice of full stage trees is an option of the parse", () => {
  const defaults = "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}";
  const pipeline = pipelineOf(["%stage a", "%ambiguity-resolution greedy", defaults, "%const $OUTPUTS {}", "%rule text {w}", "%rule w A A", "%emit",
    "%stage b", "%ambiguity-resolution greedy", defaults, "%rule text {A}"]);
  const nodes = (/** @type {any} */ options) => JSON.parse(loaders.resultJson(pipeline.parse("a a a a", { tokens: supplied([A, A, A, A]), ...options }))).stages[0].nodes.length;
  assert.ok(nodes({ stageTrees: "all" }) > nodes({}));
  assert.throws(() => pipeline.parse("a", { stageTrees: "x" }), { kind: "usage" });
});

test("a guard on a capture that every alternative of the clause binds holds as the clause does", () => {
  const run = (/** @type {string} */ condition, /** @type {string[]} */ words) => pipelineOf(["%stage s", "%ambiguity-resolution greedy",
    "%rule text q", "%rule q $d:D {$c:A}", "  | [$e:E] B", "%conditions " + condition])
    .parse(words.join(" "), { tokens: supplied(words.map(word => ({ text: word, props: { [word === "y" || word === "z" ? "A" : word.toUpperCase()]: true } }))) }).ok;
  for (const condition of ['$d ⟹ $c.all($x ↦ $x\'value ≠ "z")', '$c.all($x ↦ $x\'value ≠ "z")']) {
    assert.equal(run(condition, ["d", "y"]), true);
    assert.equal(run(condition, ["d", "z"]), false);
  }
});

test("a recognizer read of a constant that the recognizer cannot hold fails at load", () => {
  assert.throws(() => pipelineOf(["%stage s", "%ambiguity-resolution greedy", "%const $B {X, *$INPUTS}", "%rule text A<$B>"]),
    /cannot yet read the constant \$B/);
});

test("a hidden payload with a finite domain compares with the value of another node", () => {
  const run = (/** @type {string} */ op, /** @type {any[]} */ words) => pipelineOf(["%stage s", "%ambiguity-resolution greedy",
    "%rule text $a:r $b:B", "%conditions $a'last " + op + " $b'value", "%rule r $v:A → {last: \"x\"}", "  | $v:C → {last: \"y\"}"])
    .parse(words.map(word => word.text).join(" "), { tokens: supplied(words) }).ok;
  const [a, c, x] = [{ text: "a", props: { A: true } }, { text: "c", props: { C: true } }, { text: "x", props: { B: true } }];
  assert.equal(run("=", [a, x]), true);
  assert.equal(run("=", [c, x]), false);
  assert.equal(run("≠", [c, x]), true);
  assert.equal(run("≠", [a, x]), false);
});

test("a supplied DOM that breaks the record constraints of its forms fails", async () => {
  const { validateStoredDom } = await import("../src/format50/loader.js");
  const at = [1, 1];
  const rule = (extra = {}) => ({ name: "r", op: "define", alternatives: [{ gates: [], expr: { ref: "A" } }], conditions: [], at, ...extra });
  const doc = (rules, constants = []) => ({ format: 50, rules, directives: [], constants });
  const COND = c => doc([rule({ conditions: [c] })]);
  const cases = {
    "format 49": { ...doc([rule()]), format: 49 },
    "no format": (({ format, ...rest }) => rest)(doc([rule()])),
    "constant without value": doc([], [{ name: "C", op: "define", at }]),
    "constant op null": doc([], [{ name: "C", op: null, value: { string: "x" }, at }]),
    "rule without at": doc([(({ at, ...rest }) => rest)(rule())]),
    "rule with no alternatives": doc([rule({ alternatives: [] })]),
    "string term": doc([rule({ term: { string: "a" } })]),
    "gate negated null": doc([rule({ alternatives: [{ gates: [{ feature: "f", kind: "gate", negated: null }], expr: { ref: "A" } }] })]),
    "insert without term": doc([rule({ emit: { items: [{ insert: true, gates: [], at }] } })]),
    "write without keys": doc([rule({ term: { bag: [{ kind: "write", keys: [], value: { string: "x" }, gates: [], at }] } })]),
    "one-item sequence": doc([rule({ alternatives: [{ gates: [], expr: { seq: [{ ref: "A" }] } }] })]),
    "value test ?": doc([rule({ alternatives: [{ gates: [], expr: { test: "?", expr: { ref: "A" }, value: { string: "a" }, at } }] })]),
    "chain sideways": doc([rule({ alternatives: [{ gates: [], expr: { repeat: { ref: "A" }, separator: { ref: "B" }, chain: "sideways" } }] })]),
    "string 12": doc([rule({ conditions: [{ op: "=", left: { capture: "" }, right: { string: 12 }, at }] })]),
    "comparison ?": doc([rule({ conditions: [{ op: "?", left: { string: "a" }, right: { string: "a" }, at }] })]),
    "path sideways": doc([rule({ conditions: [{ op: "≅", left: { capture: "" }, right: { pattern: { path: "sideways", pattern: { name: "r" } } }, at }] })]),
    "rule without conditions": doc([(({ conditions, ...rest }) => rest)(rule())]),
    "filter around a sequence": doc([rule({ alternatives: [{ gates: [], expr: { test: "tags", requirements: [], expr: { seq: [{ ref: "A" }, { ref: "B" }] }, at } }] })]),
    "nested tag filters": doc([rule({ alternatives: [{ gates: [], expr: { test: "tags", requirements: [], expr: { test: "tags", requirements: [], expr: { ref: "A" }, at }, at } }] })]),
    "capture of an optional": doc([rule({ alternatives: [{ gates: [], expr: { capture: "x", expr: { optional: { ref: "A" } } } }] })]),
    "tag argument without at": doc([rule({ alternatives: [{ gates: [], expr: { call: "f", args: [{ tag: "A" }], at } }] })]),
    "one target": doc([rule({ alternatives: [{ gates: [], expr: { call: "f", args: [{ targets: [{ rule: "r" }], at }], at } }] })]),
    "empty union": COND({ op: "=", left: { union: [], at }, right: { string: "a" }, at }),
    "concat without at": COND({ op: "=", left: { concat: [{ string: "a" }, { string: "b" }] }, right: { string: "ab" }, at }),
    "nested union": COND({ op: "=", left: { union: [{ union: [{ capture: "" }, { capture: "" }], at }, { capture: "" }], at }, right: { capture: "" }, at }),
    "has with a string": COND({ method: "has", receiver: { capture: "" }, args: [{ string: "A" }], at }),
    "followed-by with a key": COND({ method: "followed-by", receiver: { capture: "" }, args: [{ key: "A" }], at }),
    "family with a query": COND({ method: "without-elision-except", receiver: { capture: "" }, args: [{ body: { ref: "r" } }], at }),
    "method without args": COND({ method: "span", receiver: { capture: "" }, at }),
    "structural comparison with a string": COND({ op: "≅", left: { string: "a" }, right: { pattern: { name: "r", at } }, at }),
    "pattern literal of a constant": COND({ op: "≅", left: { capture: "" }, right: { pattern: { literal: { const: "K", at }, at } }, at }),
    "nested pattern tag tests": COND({ op: "≅", left: { capture: "" }, right: { pattern: { test: "tags", requirements: [], expr: { test: "tags", requirements: [], expr: { name: "r", at }, at }, at } }, at }),
    "pattern without at": COND({ op: "≅", left: { capture: "" }, right: { pattern: { name: "r" } }, at }),
    "empty child choice": COND({ op: "≅", left: { capture: "" }, right: { pattern: { name: "r", children: [{ choice: [] }], at } }, at }),
    "child choice with an empty arm": COND({ op: "≅", left: { capture: "" }, right: { pattern: { name: "r", children: [{ choice: [[], [{ siblings: true }]] }], at } }, at }),
    "empty child repeat": COND({ op: "≅", left: { capture: "" }, right: { pattern: { name: "r", children: [{ repeat: [] }], at } }, at }),
    "nested pattern intersection": COND({ op: "≅", left: { capture: "" }, right: { pattern: { intersection: [{ intersection: [{ name: "r", at }, { name: "s", at }], at }, { name: "t", at }], at } }, at }),
  };
  for (const [name, dom] of Object.entries(cases)) {
    assert.throws(() => validateStoredDom(dom, "p.md", undefined), { kind: "grammar" }, name);
  }
  // The same document with every constraint met loads.
  assert.doesNotThrow(() => validateStoredDom(doc([rule()]), "p.md", undefined));
});

test("a requirement list and a target choice with a call pass to a template as written", () => {
  const head = ["%stage main", "%ambiguity-resolution greedy",
    "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}", "%const $OUTPUTS {}"];
  const verdicts = (/** @type {string[]} */ lines, /** @type {{text: string, props: object}[][]} */ inputs) => {
    const pipeline = pipelineOf([...head, ...lines]);
    return inputs.map(tokens => pipeline.parse(tokens.map(token => token.text).join(" "), { tokens: supplied(tokens) }).ok);
  };
  const B = { text: "b", props: { B: true } };
  const C = { text: "c", props: { C: true } };
  // The origin test in a requirement list reads the hidden written key, as
  // in a filter that the grammar writes.
  assert.deepEqual(verdicts(["%rule text filtered(A, <¬_Elided>)", "%rule filtered(@Char, @Excluded) @Char<@Excluded>"], [[A], [A, B]]), [true, false]);
  // A call in a target choice, as a template argument, in a template's own
  // condition, and written in a rule.
  const inputs = [[A, B], [A, C]];
  const next = ["%rule next B | C | g(D)", "%rule g(@T) @T"];
  assert.deepEqual(verdicts(["%rule text letter(A, C | g(D))", "%rule letter(@Char, @Forbidden) $c:@Char next", "%conditions ¬$c.followed-by(@Forbidden)", ...next], inputs), [true, false]);
  assert.deepEqual(verdicts(["%rule text letter(A)", "%rule letter(@Char) $c:@Char next", "%conditions ¬$c.followed-by(C | g(D))", ...next], inputs), [true, false]);
  assert.deepEqual(verdicts(["%rule text $c:A next", "%conditions ¬$c.followed-by(C | g(D))", ...next], inputs), [true, false]);
});

test("every recognizer read of the keys of a rule makes an untranslated term of that rule fail at load", () => {
  const head = ["%stage main", "%ambiguity-resolution greedy",
    "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}", "%const $OUTPUTS {}"];
  const term = "%rule q $b:B → {($b.flags = {B})? K}";
  // A flag read on a capture, a flag read on a forest, and a read through
  // a primary. Each read the keys of q, whose guard has no translation.
  for (const lines of [
    ["%rule text $x:A $y:q", "%conditions $y.flags'K", term],
    ["%rule text $x:A $y:B", "%conditions $y.span.parse(q).flags'K", term],
    ["%rule text $x:A $y:s", "%conditions $y.flags'K", "%rule s ^q", term],
  ]) {
    assert.throws(() => pipelineOf([...head, ...lines]), /cannot yet compare the keys of a node/, lines.join(" / "));
  }
  // The same reads of a term that translates load and hold.
  const B = { text: "b", props: { B: true } };
  for (const lines of [
    ["%rule text $x:A $y:B", "%conditions $y.span.parse(q).flags'K", "%rule q $b:B → {K}"],
    ["%rule text $x:A $y:s", "%conditions $y.flags'K", "%rule s ^q", "%rule q $b:B → {K}"],
  ]) {
    assert.equal(pipelineOf([...head, ...lines]).parse("a b", { tokens: supplied([A, B]) }).ok, true, lines.join(" / "));
  }
});

test("a redefinition in another document keeps the type of the constant, and hides it from recognizer reads", () => {
  const head = ["%ambiguity-resolution greedy",
    "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}"];
  const load = (/** @type {string[]} */ base, /** @type {string[]} */ extra) => loaders.loadPipelineSources({
    "p.md": ["```jbogenbau", "%stage main", '%include "base.md"', '%include "extra.md"', "```", ""].join("\n"),
    "base.md": ["```jbogenbau", ...head, ...base, "```", ""].join("\n"),
    "extra.md": ["```jbogenbau", ...extra, "```", ""].join("\n"),
  }, "p.md");
  // {*$OUTPUTS, B} splats a constant of the other document.
  const pipeline = load(["%const $OUTPUTS {A}", "%rule text {tok}", "%rule tok A | B → {A, B}", "%emit"], ["%redefine-const $OUTPUTS {*$OUTPUTS, B}"]);
  const result = pipeline.parse("b", { tokens: supplied([{ text: "b", props: { B: true } }]) });
  assert.equal(result.ok, true, result.error?.message);
  assert.deepEqual([...result.stages[0].output[0].props.keys()].filter(key => key === "A" || key === "B").sort(), ["A", "B"]);
  // A recognizer read in the base document sees the final version, which
  // keeps the reference to the version before it.
  const read = load(["%const $OUTPUTS {}", "%const $K {A}", "%rule text W<$K>"], ["%redefine-const $K {*$K, B}"]);
  const verdict = (/** @type {object} */ props) => read.parse("w", { tokens: supplied([{ text: "w", props }]) }).ok;
  assert.deepEqual([verdict({ W: true, A: true, B: true }), verdict({ W: true, A: true })], [true, false]);
  // Where the final version has only a placeholder, the read fails at load.
  assert.throws(() => load(["%const $OUTPUTS {}", "%const $K {A}", "%rule text W<$K>"], ["%redefine-const $K {*$K, B, ¬A}"]),
    /cannot yet read the constant \$K/);
});

test("a set of strings that the bridge writes has at least two operands or none", async () => {
  const { Loader50 } = await import("../src/format50/loader.js");
  const { bridgeDocument } = await import("../src/format50/bridge.js");
  const fs = await import("node:fs");
  const text = ["```jbogenbau", "%stage main", "%const $OUTPUTS {}", "%rule text W",
    `%conditions $'value.ngrams(1).any(' ≠ "y"), $'value ∈ ["y"], $'value ∉ []`, "```", ""].join("\n");
  const loader = new Loader50(path => path === "p.md" ? text : fs.readFileSync(new URL("../" + path, import.meta.url), "utf8"));
  const bridged = bridgeDocument(loader.documentDom("p.md", undefined), "p.md", new Map());
  /** @type {any[]} */
  const pending = [bridged.rules];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node.union)) assert.ok(node.union.length >= 2, JSON.stringify(node));
    for (const value of Object.values(node)) pending.push(value);
  }
});

test("a key set built from other constants stands in a filter and in a term that a filter reads", () => {
  const head = ["%stage main", "%ambiguity-resolution greedy",
    "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}", "%const $OUTPUTS {}",
    "%const $BASE {A}", "%const $MORE $BASE ∪ {B}", "%const $LINK {*$BASE, C}"];
  const verdicts = (/** @type {string[]} */ lines, /** @type {object[]} */ inputs) => {
    const pipeline = pipelineOf([...head, ...lines]);
    return inputs.map(props => pipeline.parse("w", { tokens: supplied([{ text: "w", props }]) }).ok);
  };
  // W<¬$MORE> refuses a token with A or with B.
  assert.deepEqual(verdicts(["%rule text W<¬$MORE>"], [{ W: true }, { W: true, A: true }, { W: true, B: true }]), [true, false, false]);
  // The keys of $w in $LINK reach the filter of text.
  assert.deepEqual(verdicts(["%rule text r<C>", "%rule r $w:W → {*$w.flags ∩ $LINK}"], [{ W: true }, { W: true, C: true }]), [false, true]);
});

test("a set operation in a pattern of a template's condition loads and agrees with a written rule", () => {
  const head = ["%stage main", "%ambiguity-resolution greedy",
    "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}", "%const $OUTPUTS {}"];
  const verdicts = (/** @type {string[]} */ lines) => {
    const pipeline = pipelineOf([...head, ...lines, "%rule g A B | A C | A D"]);
    return ["B", "C", "D"].map(key => pipeline.parse("a x", { tokens: supplied([A, { text: "x", props: { [key]: true } }]) }).ok);
  };
  for (const [template, written] of [
    ["$w ≇ #⁅ A (@T ∖ ⁅ C ⁆) ⁆", "$w ≇ #⁅ A (B ∖ ⁅ C ⁆) ⁆"],
    ["$w ≇ #⁅ A (@T ∪ C) ⁆", "$w ≇ #⁅ A (B ∪ C) ⁆"],
  ]) {
    const expected = verdicts(["%rule text $w:g", `%conditions ${written}`]);
    // B always matches. C matches only the union. D never does.
    assert.deepEqual(expected, [false, !written.includes("∪"), true], written);
    assert.deepEqual(verdicts(["%rule text f(B)", "%rule f(@T) $w:g", `%conditions ${template}`]), expected, template);
  }
});

test("a condition reads a capture of a ranked option as one node of that option", () => {
  const head = ["%stage main", "%ambiguity-resolution greedy",
    "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}", "%const $OUTPUTS {}"];
  const pipeline = pipelineOf([...head, "%rule text (A ≻ $c:B $t:C)", "%conditions $c ≇ #B ∨ $t.first-token.parse(C)"]);
  const B = { text: "b", props: { B: true } };
  const C = { text: "c", props: { C: true } };
  assert.equal(pipeline.parse("a", { tokens: supplied([A]) }).ok, true);
  assert.equal(pipeline.parse("b c", { tokens: supplied([B, C]) }).ok, true);
});

test("a payload with no finite domain compares in recognition through the tag of its value", async () => {
  const head = ["%stage main", "%ambiguity-resolution greedy",
    "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}", "%const $OUTPUTS {}"];
  const verdicts = (/** @type {string[]} */ lines) => {
    const pipeline = pipelineOf([...head, ...lines]);
    return [["x", "x"], ["x", "y"]].map(([a, b]) => pipeline.parse(`${a} ${b}`, {
      tokens: supplied([{ text: a, props: { A: true } }, { text: b, props: { B: true } }]),
    }).ok);
  };
  const run = "%rule run $c:B → {run: $c'value}";
  assert.deepEqual(verdicts(["%rule text $o:A $r:run", "%conditions $r'run = $o'value", run]), [true, false]);
  assert.deepEqual(verdicts(["%rule text $o:A $r:run", "%conditions $r'run ≠ $o'value", run]), [false, true]);
  // A forest predicate reads the value of each root.
  assert.deepEqual(verdicts(["%rule text $o:A $r:run", "%conditions $r.span.parse(run).any($x ↦ $x'run = $o'value)", run]), [true, false]);
  // A write that cannot give the value tag makes the read fail at load.
  assert.throws(() => pipelineOf([...head, "%rule text $o:A $r:run", "%conditions $r'run = $o'value",
    "%rule run $c:B → {run: $c'value} | C → {run: 1}"]), /compare the payload run/);
  // The method of the value tag is not a method of format 49.
  const { domProblem } = await import("../src/dom.js");
  const dom = { format: 49, rules: [{ name: "text", op: "define", alternatives: [{ gates: [], expr: { ref: "A" },
    tags: { method: "native50:payload", receiver: { string: "x" }, args: [{ string: "Payload_00_" }] } }], conditions: [], at: [1, 1] }],
    directives: [], constants: [], classifiers: [], implications: [] };
  assert.equal(domProblem(dom, undefined), "a malformed method");
});

test("a comparison that reads a constant of the wrong type fails at load in the stage", () => {
  const head = ["%stage s", "%ambiguity-resolution greedy", "%const $T {A}", "%const $L [\"a\"]"];
  assert.throws(() => pipelineOf([...head, "%rule text $a:A", "%conditions $a'value = $T"]), /= requires comparable operands of one type/);
  assert.throws(() => pipelineOf([...head, "%rule text $a:A", "%conditions $L ∈ $L"]), /∈ requires compatible operands/);
  assert.throws(() => pipelineOf([...head, "%rule text $a:A", "%conditions $L ⊆ $T"]), /⊆ requires key sets/);
  // The same constants in comparisons of their own types load.
  assert.doesNotThrow(() => pipelineOf([...head, "%rule text $a:A", "%conditions $a'value ∈ $L, $T ⊆ $a.flags"]));
});

test("a forest predicate reads its roots only through their keys in recognition", () => {
  const head = ["%stage main", "%ambiguity-resolution greedy",
    "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}", "%const $OUTPUTS {}"];
  const body = "%rule body $b:B → {run: $b'value}";
  // A read of the value, the image, the span or the keys of the binder as a
  // capture fails at load. Before, the binder read as an unbound capture.
  for (const read of ["$x'value = $o'value", "$x'image = $o'value", "$x.span.source-text = \"b\"", "$x.flags ⊆ {B}"]) {
    assert.throws(() => pipelineOf([...head, "%rule text $o:A $c:B", `%conditions ¬$c.span.parse(body).any($x ↦ ${read})`, body]),
      /cannot yet/, read);
  }
  // A payload of the root compares through its tag.
  const pipeline = pipelineOf([...head, "%rule text $o:A $c:B", "%conditions ¬$c.span.parse(body).any($x ↦ $x'run = $o'value)", body]);
  const verdict = (/** @type {string} */ a, /** @type {string} */ b) => pipeline.parse(`${a} ${b}`,
    { tokens: supplied([{ text: a, props: { A: true } }, { text: b, props: { B: true } }]) }).ok;
  assert.deepEqual([verdict("x", "x"), verdict("x", "y")], [false, true]);
});

test("a term that reads a private ranked capture fails only where an early reader reads the keys of its rule", () => {
  const head = ["%stage main", "%ambiguity-resolution greedy",
    "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}", "%const $OUTPUTS {}"];
  const term = "%rule r ($x:A ≻ $x:B) → {($x'value = \"a\")? K}";
  assert.throws(() => pipelineOf([...head, "%rule text r<K>", term]), { code: "ranked-choice-export" });
  // A late read of the private capture needs no early proof.
  const pipeline = pipelineOf([...head, "%rule text r", term]);
  assert.equal(pipeline.parse("a", { tokens: supplied([A]) }).ok, true);
});

test("a stage with no final token keeps its surviving reports", () => {
  const head = ["%ambiguity-resolution greedy", "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}"];
  const stagesOf = (/** @type {string[]} */ lines) => {
    const result = pipelineOf(lines).parse("a", { tokens: supplied([A]), features: ["w"] });
    return JSON.parse(loaders.resultJson(result)).stages.map((/** @type {any} */ stage) => (stage.warnings ?? []).map((/** @type {any} */ item) => item.message));
  };
  // An own report of the reporting stage, and a report carried from an
  // earlier stage, as format 49 gives them (engine §11.4, rule 4).
  assert.deepEqual(stagesOf(["%stage main", ...head, "%rule text w", "%rule w A", "%warning \"w found\""]), [["w found"]]);
  assert.deepEqual(stagesOf(["%stage first", ...head, "%const $OUTPUTS {A}", "%rule text {w}", "%rule w A", "%warning \"w found\"", "%emit",
    "%stage second", ...head, "%rule text A"]), [[], ["w found"]]);
});

test("an emission that forwards the output of a child yields that output for diagnostic assignment", () => {
  const pipeline = pipelineOf(["%stage main", "%ambiguity-resolution greedy",
    "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}", "%const $OUTPUTS {A}",
    "%rule text {w}", "%rule w $a:a mark", "%emit $a", "%rule a A", "%emit", "%rule mark M", "%warning \"m\""]);
  const M = { text: "m", props: { M: true } };
  const result = pipeline.parse("a m a m", { tokens: supplied([A, M, A, M]), features: ["mark"] });
  assert.equal(result.ok, true, result.error?.message);
  // The report of the first M covers no final token. Its nearest emission,
  // w, forwards the first A, so that token owns it (engine §11.4, rule 2).
  const output = JSON.parse(loaders.resultJson(result)).stages[0].output;
  assert.deepEqual(output.map((/** @type {any} */ token) => (token.warnings ?? []).length), [1, 1]);
});
