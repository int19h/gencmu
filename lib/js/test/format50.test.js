// Unit tests of the format 50 engine that the shared cases do not cover.
import test from "node:test";
import assert from "node:assert/strict";
import { loaderForNotation } from "../src/node.js";
import { nodeBrackets50 } from "../src/format50/render.js";

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
    // A label binds a symbol or a compound operand, but not a chain.
    "capture of a chain": doc([rule({ alternatives: [{ gates: [], expr: { capture: "x", expr: { repeat: { ref: "A" }, chain: "right" } } }] })]),
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
  const term = "%rule q $b:B → {($b'value.split(\"x\").join(\"-\") = \"b\")? K}";
  // A flag read on a capture, a flag read on a forest, and a read through
  // a primary. Each read the keys of q, whose guard has no translation.
  for (const lines of [
    ["%rule text $x:A $y:q", "%conditions $y.flags'K", term],
    ["%rule text $x:A $y:B", "%conditions $y.span.parse(q).flags'K", term],
    ["%rule text $x:A $y:s", "%conditions $y.flags'K", "%rule s ^q", term],
  ]) {
    assert.throws(() => pipelineOf([...head, ...lines]), /cannot yet compute this string/, lines.join(" / "));
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
  // A native method of the bridge is no method of a written document.
  assert.equal(domProblem(dom, undefined), "unknown method native50:payload");
});

test("a comparison that reads a constant of the wrong type fails at load in the stage", () => {
  const head = ["%stage s", "%ambiguity-resolution greedy", "%const $T {A}", "%const $L [\"a\"]"];
  assert.throws(() => pipelineOf([...head, "%rule text $a:A", "%conditions $a'value = $T"]), /= requires comparable operands of one type/);
  assert.throws(() => pipelineOf([...head, "%rule text $a:A", "%conditions $L ∈ $L"]), /∈ requires compatible operands/);
  assert.throws(() => pipelineOf([...head, "%rule text $a:A", "%conditions $L ⊆ $T"]), /⊆ requires key sets/);
  // The same constants in comparisons of their own types load.
  assert.doesNotThrow(() => pipelineOf([...head, "%rule text $a:A", "%conditions $a'value ∈ $L, $T ⊆ $a.flags"]));
});

test("a forest predicate reads its roots through their keys and written strings in recognition", () => {
  const head = ["%stage main", "%ambiguity-resolution greedy",
    "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}", "%const $OUTPUTS {}"];
  const body = "%rule body $b:B → {run: $b'value}";
  // The term of body writes neither the value nor the image, so a read of
  // either fails at load. So does a read of the span or of the keys of the
  // binder as a capture. Before, the binder read as an unbound capture.
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

test("a constant built from another constant reads the final version of that constant in the stage", () => {
  const head = ["%ambiguity-resolution greedy",
    "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}", "%const $OUTPUTS {}"];
  const fence = (/** @type {string[]} */ lines) => ["```jbogenbau", ...lines, "```", ""].join("\n");
  const load = (/** @type {string[]} */ base, /** @type {string[]} */ extra) => loaders.loadPipelineSources({
    "p.md": fence(["%stage main", '%include "base.md"', '%include "extra.md"']), "base.md": fence([...head, ...base]), "extra.md": fence(extra),
  }, "p.md");
  const passes = (/** @type {any} */ pipeline, /** @type {object} */ props, text = "w") => pipeline.parse(text, { tokens: supplied([{ text, props }]) }).ok;
  // $M names $Z, which the later document redefines. A filter on $M reads
  // the final $Z, as format 49 does.
  const filter = load(["%const $Z {A}", "%const $M $Z ∪ {B}", "%rule text W<¬$M>"], ["%redefine-const $Z {*$Z, C}"]);
  assert.deepEqual(["A", "B", "C"].map(key => passes(filter, { W: true, [key]: true })), [false, false, false]);
  // A list item that names a redefined constant reads its final string.
  const member = load(["%const $S \"a\"", "%rule text $a:W", "%conditions $a'value ∈ [$S, \"b\"]"], ["%redefine-const $S \"c\""]);
  assert.deepEqual(["a", "b", "c"].map(text => passes(member, { W: true }, text)), [false, true, true]);
  // A fold that recognition still needs, the domain of a payload from a
  // guard, fails at load where another document redefines the constant.
  assert.throws(() => load(["%const $L [\"a\"]", "%rule text $x:r", "%conditions $x'run = \"c\"", "%rule r $y:W → {($y'value ∈ $L)? run: $y'value}"],
    ["%redefine-const $L [\"a\", \"c\"]"]), /cannot yet fold the constant \$L/);
  // The keys of $INPUTS reach the stage as they are.
  assert.equal(passes(load(["%rule text W"], ["%redefine-const $OUTPUTS $INPUTS"]), { W: true }), true);
});

test("the certificate reads the terms of each rule whose keys a recognizer test reads", () => {
  const head = ["%stage main", "%ambiguity-resolution greedy",
    "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}", "%const $OUTPUTS {}"];
  const outcome = (/** @type {string[]} */ lines) => {
    const result = pipelineOf([...head, ...lines]).parse("a", { tokens: supplied([A]) });
    return result.ok ? "ok" : `${result.error.kind}: ${result.error.message}`;
  };
  // lv writes its value, so it has no certificate. The guard of v reads it,
  // and recognition computes the keys of v for the filter.
  const term = "%rule v $x:lv → {($x'value ≠ \"y\")? K}";
  const uncertified = "%rule lv A → {value: \"y\"}";
  for (const lines of [
    ["%rule text v<K>", term, uncertified],
    ["%rule text f(v)", "%rule f(@V) @V<K>", term, uncertified],
    ["%rule text w<K>", "%rule w g(lv)", "%rule g(@C) $x:@C → {($x'value ≠ \"y\")? K}", uncertified],
  ]) {
    assert.match(outcome(lines), /grammar: .*the read of the value of \$x in recognition has no proof that the value equals the join of its input: (the actual of @C in a call of g: )?lv: /, lines.join(" / "));
  }
  // A certified child, and a rule whose keys no test reads, are fine.
  assert.equal(outcome(["%rule text v<K>", term, "%rule lv A"]), "ok");
  assert.equal(outcome(["%rule text v", term, uncertified]), "ok");
});

test("a key read through a template parameter reads the keys of the actuals of its calls", () => {
  const head = ["%stage main", "%ambiguity-resolution greedy",
    "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}", "%const $OUTPUTS {}"];
  const untranslated = "%rule v $a:A → {($a'value.split(\"x\").join(\"-\") = \"a\")? K}";
  for (const lines of [
    ["%rule text f(v)", "%rule f(@V) @V<K>", untranslated],
    ["%rule text g(v)", "%rule g(@W) f(@W)", "%rule f(@V) @V<K>", untranslated],
    ["%rule text f(v)", "%rule f(@V) $x:@V", "%conditions $x.flags'K", untranslated],
  ]) {
    assert.throws(() => pipelineOf([...head, ...lines]), /cannot yet compute this string/, lines.join(" / "));
  }
});

test("a group, ε or a call stands as the actual of a template", () => {
  const head = ["%stage main", "%ambiguity-resolution greedy",
    "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}", "%const $OUTPUTS {}"];
  const B = { text: "b", props: { B: true } };
  for (const [lines, tokens] of [
    // The certificate of the instance reads a group or ε as its body.
    [["%rule text v=\"a\"", "%rule v = t(([A]))", "%rule t(@X) @X [B]"], [A]],
    [["%rule text v=\"a\"", "%rule v = t(A, ε)", "%rule t(@X, @Y) @X @Y"], [A]],
    // A call keeps its position where it stands in the body.
    [["%rule text t(g(A), g(B))", "%rule t(@X, @Y) @X @Y", "%rule g(@Z) @Z"], [A, B]],
    [["%rule text v=\"ab\"", "%rule v = t(g(A), g(B))", "%rule t(@X, @Y) @X @Y", "%rule g(@Z) @Z"], [A, B]],
  ]) {
    const result = pipelineOf([...head, ...lines]).parse(tokens.map(token => token.text).join(" "), { tokens: supplied(tokens) });
    assert.equal(result.ok, true, `${lines.join(" / ")}: ${result.error?.message}`);
  }
});

test("a recognizer test reads a hidden key that another document of the stage writes", () => {
  const head = ["%stage main", "%ambiguity-resolution greedy", "%const $OUTPUTS {}", "%include \"q.md\"", "%rule text $w:w"];
  const writer = ["```jbogenbau", "%rule w", "  | A → {k: \"a\"}", "  | B → {k: \"b\"}", "```", ""].join("\n");
  /** @param {string} condition */
  const pipeline = condition => loaders.loadPipelineSources({
    "p.md": ["```jbogenbau", ...head, `%conditions ${condition}`, "```", ""].join("\n"), "q.md": writer }, "p.md");
  const B = { text: "b", props: { B: true } };
  /** @param {any} result */
  const verdict = result => result.ok ? "ok" : result.error.kind;
  // The value of k comes from q.md, so the domain of k in p.md is its domain
  // in the stage. Alone, p.md would know no value of k.
  assert.equal(verdict(pipeline('$w\'k = "a"').parse("a", { tokens: supplied([A]) })), "ok");
  assert.equal(verdict(pipeline('$w\'k = "a"').parse("b", { tokens: supplied([B]) })), "rejected");
  assert.equal(verdict(pipeline("$w.has(k)").parse("b", { tokens: supplied([B]) })), "ok");
  assert.equal(verdict(pipeline('$w\'k ≠ "a"').parse("b", { tokens: supplied([B]) })), "ok");
  assert.equal(verdict(pipeline('$w\'k ≠ "a"').parse("a", { tokens: supplied([A]) })), "rejected");
});

test("a closed constant with no item keeps the kind of its set", () => {
  // A key set and a list of strings that fold to no item still reach the
  // recognizer as an empty set of their kind, not as a placeholder.
  for (const [constant, condition] of [["({A} ∖ {A})", "_<¬$S>"], ['(["a"] ∖ ["a"])', '_ %conditions ¬("a" ∈ $S)']]) {
    const pipeline = pipelineOf(["%stage main", "%ambiguity-resolution greedy", "%const $OUTPUTS {}", `%const $S ${constant}`, `%rule text ${condition}`]);
    assert.equal(pipeline.parse("a", { tokens: supplied([A]) }).ok, true, constant);
  }
});

test("a forest predicate reads the value of a root that each alternative writes in its term, with its certificate", () => {
  const head = ["%stage main", "%ambiguity-resolution greedy", "%const $OUTPUTS {}",
    "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}"];
  const reader = ["%rule text $o:A $c:span", "%conditions $c.parse(body).any($x ↦ $x'value = $o'value)", "%rule span B B"];
  /** @param {Record<string, string[]>} documents */
  const load = documents => loaders.loadPipelineSources(Object.fromEntries(Object.entries(documents)
    .map(([name, lines]) => [name, ["```jbogenbau", ...lines, "```", ""].join("\n")])), "p.md");
  /** @param {any} pipeline @param {string} values */
  const verdict = (pipeline, values) => {
    const tokens = [...values].map((value, index) => ({ text: value, props: { [index ? "B" : "A"]: true, value } }));
    const result = pipeline.parse("a b c", { tokens: supplied(tokens) });
    return result.ok ? "ok" : result.error.kind;
  };
  // A recognition read of the value of a root needs the certificate of its
  // rule, as any recognition read of a rule value does (docs/engine.md,
  // "Proof for a rule value"). A value of one of two children has none.
  const both = load({ "p.md": [...head, ...reader, "%rule body → {value: $p'value}", "  | $p:B B", "  | B $p:B"] });
  assert.deepEqual(["xxy", "zxy", "yxy"].map(values => verdict(both, values)), ["grammar", "grammar", "grammar"]);
  // The join of the input values has the certificate, also from another
  // document of the stage.
  /** @param {any} pipeline @param {string[]} values */
  const joined = (pipeline, values) => {
    const tokens = values.map((value, index) => ({ text: value, props: { [index ? "B" : "A"]: true, value } }));
    const result = pipeline.parse(values.join(" "), { tokens: supplied(tokens) });
    return result.ok ? "ok" : result.error.kind;
  };
  const included = load({ "p.md": [...head, '%include "q.md"', ...reader], "q.md": ["%rule body B B → {value: $.span.tokens!'value.join()}"] });
  assert.deepEqual([["xy", "x", "y"], ["zz", "x", "y"]].map(values => joined(included, values)), ["ok", "rejected"]);
  // The stage defaults give the recognizer no tag of the value.
  assert.throws(() => load({ "p.md": [...head, ...reader, "%rule body $p:B B"] }),
    /read the value of a root of a forest, which an alternative of body does not write in its term/);
});

test("a read of a payload of a captured node has the types of the key in the bags of its rules", () => {
  const head = ["%stage main", "%ambiguity-resolution greedy", "%const $OUTPUTS {}",
    "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}"];
  /** @param {string[]} lines */
  const load = lines => pipelineOf([...head, ...lines]);
  // The rule of $x writes n as a number, through its own term, a primary, a
  // sole symbol or a copy.
  for (const rules of [["%rule x A → {n: 1}"], ["%rule x ^$y:y B", "%rule y A → {n: 1}"], ["%rule x y", "%rule y A → {n: 1}"],
    ["%rule x $y:y → {$y'n}", "%rule y A → {n: 1}"]]) {
    assert.throws(() => load(["%rule text $x:x", '%conditions ($x\'n ++ "a") = "1a"', ...rules]), /an operand of concatenation is a number/, rules.join(" "));
  }
  assert.throws(() => load(["%rule text $x:x", '%conditions $x\'n = "1"', "%rule x A → {n: 1}"]), /= requires comparable operands of one type/);
  assert.throws(() => load(["%rule text $x:x", "%conditions $x'k", '%rule x A → {k: "a"}']), /a string does not convert to truth/);
  // A string payload compares with a string, a flag reads as truth, and a
  // payload of a token has no type in this stage.
  load(["%rule text $x:x", '%conditions $x\'k = "a"', '%rule x A → {k: "a"}']);
  load(["%rule text $x:x", "%conditions $x'K", "%rule x A → {K}"]);
  load(["%rule text $x:A", '%conditions $x\'k = "a"']);
});

test("a label on an optional, a flat repetition or a group binds the compound operand", () => {
  const head = ["%stage main", "%ambiguity-resolution greedy", "%const $OUTPUTS {}",
    "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}"];
  /** @param {string} text @returns {any[]} */
  const tokensOf = text => supplied(text ? text.split(" ").map(tag => ({ text: tag.toLowerCase(), props: { [tag]: true, value: tag.toLowerCase() } })) : []);
  /** @param {string[]} lines @param {string} text */
  const verdict = (lines, text) => {
    const result = pipelineOf([...head, ...lines]).parse(text.toLowerCase(), { tokens: tokensOf(text) });
    return result.ok ? "ok" : result.error.kind;
  };
  // The label is transparent to recognition (docs/notation.md, "Ambiguity"): each body parses
  // as it does without the label.
  for (const [target, text] of [["(A B)", "A B"], ["(A | B)", "A"], ["(A & B)", "A B"], ["(A ≻ B)", "A"], ["[A]", "A"], ["{A}", "A A"], ["[+JI]", "JI"]]) {
    for (const input of [text, ""]) {
      assert.equal(verdict([`%rule text $x:${target}`], input), verdict([`%rule text ${target}`], input), `${target} on ${input || "ε"}`);
    }
    for (const marked of [`^$x:${target}`, `$x:${target}<K>`, `$x:${target}="a"`]) assert.throws(() => pipelineOf([...head, `%rule text ${marked}`]), /cannot yet|primary|test/, marked);
  }
  // A label on a chain, an empty expression, a capture or a primary fails.
  for (const [body, fault] of [["$x:{A ...}", /label a chain/], ["$x:ε", /label an empty expression/],
    ["$x:($y:A)", /label another capture/], ["$x:(^A)", /label another capture or a primary/]]) {
    assert.throws(() => pipelineOf([...head, `%rule text ${body}`]), fault, body);
  }
  // An inner label belongs to the enclosing alternative, and $x:(A) binds A.
  assert.equal(verdict(["%rule text $x:($y:A B)", '%conditions $y\'value = "a"'], "A B"), "ok");
  assert.equal(verdict(["%rule text $x:(A)", '%conditions $x\'value = "a"'], "A"), "ok");
  // A condition reads the binding: its span, its presence and its value.
  // In $x:[A], x is one node on omission too, and its span tests false.
  for (const [lines, text, expected] of [
    [["%rule text $x:(A B)", "%conditions $x.following-tokens.ends-input"], "A B", "ok"],
    [["%rule text $x:(A B)", "%conditions ¬$x.starts-input"], "A B", "rejected"],
    [["%rule text $x:[A] B", "%conditions $x.present"], "B", "ok"],
    [["%rule text $x:[A] B", "%conditions $x.span"], "B", "rejected"],
    [["%rule text $x:[A] B", "%conditions $x.span"], "A B", "ok"],
    [["%rule text $x:(A B)", '%conditions $x\'value = "ab"'], "A B", "ok"],
    [["%rule text $x:(A B)", '%conditions $x\'value = "ba"'], "A B", "rejected"],
    // The window of a binding before a later capture is its own, also in a
    // condition that is ready only after that capture.
    [["%rule text $x:(A B) $y:C", "%conditions $x.ends-input ∧ $y.ends-input"], "A B C", "rejected"],
    [["%rule text $x:(A B) $y:C", "%conditions ¬$x.ends-input ∧ $y.ends-input"], "A B C", "ok"],
    // A pattern reads a group as an anonymous node over its children, with
    // one seal at a ranked choice.
    [["%rule text $x:(a | b) $y:a", "%conditions $x ≅ #·a", "%rule a A", "%rule b B"], "A A", "rejected"],
    [["%rule text ($x:a | $x:b) $y:a", "%conditions $x ≅ #·a", "%rule a A", "%rule b B"], "A A", "ok"],
    [["%rule text $g:(hi | lo)", "%conditions $g ≅ #(⋮ ·hi)", "%rule hi A", "%rule lo B"], "A", "ok"],
    [["%rule text $g:(hi ≻ lo)", "%conditions $g ≅ #(⋮ ·hi)", "%rule hi A", "%rule lo B"], "A", "rejected"],
    // Conditions on a binding around a ranked choice hold or fail as written.
    [["%rule text $g:(hi ≻ lo)", "%conditions ¬$g.span", "%rule hi A", "%rule lo A"], "A", "rejected"],
    [["%rule text $g:(P (hi ≻ lo))", '%conditions $g\'value = "pa"', "%rule hi A", "%rule lo A"], "P A", "ok"],
    [["%rule text $g:(P (hi ≻ lo))", '%conditions $g\'value = "zz"', "%rule hi A", "%rule lo A"], "P A", "rejected"],
  ]) assert.equal(verdict(/** @type {string[]} */ (lines), /** @type {string} */ (text)), expected, `${lines.join(" / ")} on ${text}`);
});

// The frames of a ranked choice keep the item conditions out of the rule
// only for an alternative with a compound binding, so that format 49 keeps
// its answer. With no compound binding this waits for int19h/gencmu#347.
test("an item condition of braces holds beside a ranked choice", { todo: "int19h/gencmu#347" }, () => {
  const head = ["%stage main", "%ambiguity-resolution greedy", "%const $OUTPUTS {}"];
  /** @param {string} text @returns {any[]} */
  const tokensOf = text => supplied(text.split(" ").map(tag => ({ text: tag.toLowerCase(), props: { [tag]: true } })));
  /** @param {string} condition @param {string} text */
  const verdict = (condition, text) => {
    const result = pipelineOf([...head, "%rule text {$x:P} (hi ≻ lo)", `%conditions ${condition}`, "%rule hi A → {K}", "%rule lo A"])
      .parse(text.toLowerCase(), { tokens: tokensOf(text) });
    return result.ok ? "ok" : result.error.kind;
  };
  // The condition belongs to the helper of the braces. The rule and the
  // options of the ranked choice do not test it again without the items.
  assert.equal(verdict("$x.present", "P A"), "ok");
  assert.equal(verdict("$x.all(.present)", "P P A"), "ok");
  assert.equal(verdict("¬$x.present", "P A"), "rejected");
});

/** @param {any} result */
const codes = result => ({
  errors: (result.error?.errors ?? []).map((/** @type {any} */ item) => `${item.stage}/${item.code}`),
  warnings: (result.warnings ?? []).map((/** @type {any} */ item) => `${item.stage}/${item.code}`),
});
const JOINS = "%const $DEFAULTS $n ↦ {value: $n.children!'value.join(), image: $n.children!'image.join()}";

test("an argument for a parameter in an expression is a marked expression, a string or a constant", () => {
  const head = ["%stage main", "%ambiguity-resolution greedy", JOINS, "%const $OUTPUTS {*$INPUTS, T}", "%rule family(@X, @Tag) @X → {*@Tag}"];
  // A tag has no form as an expression (docs/engine.md, "Arguments and substitution").
  assert.throws(() => pipelineOf([...head, "%rule text family(\"a\", T)"]), /the argument for @Tag of family stands in an expression/);
  // A call in a pattern of a resolution step makes an instance too.
  assert.throws(() => pipelineOf(["%stage main", "%ambiguity-resolution fewest #·family(\"a\", T)<T>", JOINS, "%const $OUTPUTS {*$INPUTS, T}",
    "%rule family(@X, @Tag) @X → {*@Tag}", "%rule text \"a\""]), /the argument for @Tag of family stands in an expression/);
  // A template that passes its parameter on passes the position on.
  assert.throws(() => pipelineOf([...head, "%rule outer(@Y) family(\"a\", @Y)", "%rule text outer(T)"]), /the argument for @Y of outer stands in an expression/);
  const marked = pipelineOf([...head, "%rule text family(\"a\", ={T})", "%emit"]);
  const result = marked.parse("a");
  assert.equal(result.ok, true);
  assert.equal(result.stages[0].output[0].props.has("T"), true);
});

test("a value test on a template family needs the certificate of each instance", () => {
  const head = ["%stage main", "%ambiguity-resolution greedy", JOINS, "%const $OUTPUTS {*$INPUTS, T, U}"];
  const joined = pipelineOf([...head, "%rule family(@X, @Tag) @X → {*@Tag}", "%rule text", "  | $x:family(\"a\", ={T})", "  | $x:family(\"a\", ={U})",
    "%conditions ($x ≅ #·family<T>=\"a\")"]);
  assert.equal(joined.parse("a").ok, true);
  // An instance that writes its value has no certificate (docs/engine.md, "Proof for a rule value").
  const written = pipelineOf([...head, "%rule family(@X, @V) @X → {value: @V}", "%rule text $x:family(\"a\", \"a\")", "%conditions ($x ≅ #·family=\"a\")"]);
  const result = written.parse("a");
  assert.equal(result.error?.kind, "grammar");
  assert.match(result.error.message, /the pattern atom family has no proof/);
});

test("the chosen derivation gives its reports in preorder, own and carried", () => {
  // The carried report of B and the own report of fresh, in the preorder of
  // the last stage (docs/engine.md §12.1). The token keeps them by raising
  // stage (§11.4).
  const pipeline = pipelineOf(["%stage before", "%ambiguity-resolution greedy", JOINS, "%const $OUTPUTS {*$INPUTS, A, B, C}",
    "%rule text $a:A $b:old $c:C", "%emit $a{*$a}, $b{*$b}, $c{*$c}", "%rule old B", "%error \"old\"",
    "%stage last", "%ambiguity-resolution greedy", JOINS, "%const $OUTPUTS {*$INPUTS, A, B, C}",
    "%rule text $p:pair ^$w:word", "%emit", "%rule pair $x:fresh $y:B", "%emit $x{*$x}, $y{*$y}", "%rule fresh A", "%error \"new\"", "%rule word C"]);
  const result = pipeline.parse("a b c", { tokens: supplied([{ text: "a", props: { A: true } }, { text: "b", props: { B: true } }, { text: "c", props: { C: true } }]) });
  assert.equal(result.error?.kind, "reported");
  assert.deepEqual(codes(result).errors, ["last/fresh", "before/old"]);
  assert.deepEqual(result.stages[1].output[0].errors.map((/** @type {any} */ item) => `${item.stage}/${item.code}`), ["before/old", "last/fresh"]);
});

test("a grammar failure after the choice of a parse keeps the reports that its stage evaluated", () => {
  const pipeline = pipelineOf(["%features w", "%stage main", "%ambiguity-resolution greedy", JOINS, "%const $OUTPUTS {}",
    "%rule text A", "%warning \"w\"", "%emit ${image: \"x\".split($.following-tokens.source-text).join()}"]);
  const result = pipeline.parse("a", { tokens: supplied([A]), features: ["text"] });
  assert.equal(result.error?.kind, "grammar");
  assert.deepEqual(result.error.warnings?.map((/** @type {any} */ item) => item.code), ["text"]);
});

test("the check of elision-only reads the elided leaves under a splice and keeps the warnings", () => {
  const lines = ["%stage main", "%ambiguity-resolution late #·_<_Elided>", "%elision-only", "%const $OUTPUTS {*$INPUTS}", JOINS,
    "%rule text", "  | a", "  | b", "  | c", "%rule b A [+T] [+T]", "%rule c A T"];
  for (const call of ["*w", "w"]) {
    const pipeline = pipelineOf([...lines, `%rule a ${call}`, "%rule w A [+T]", "%warning \"warning w\""]);
    const result = pipeline.parse("a", { tokens: supplied([A]), features: ["w"] });
    assert.equal(result.error?.kind, "ambiguous", call);
    assert.equal(result.error.reason, "elision-only", call);
    assert.deepEqual(codes(result).warnings, ["main/w"], call);
  }
});

test("a projection shows the satellites of its part once", () => {
  const pipeline = pipelineOf(["%stage a", "%ambiguity-resolution greedy", "%const $OUTPUTS {X, W, B}", "%rule text {item}",
    "%rule item", "  | $b:bb ^$w:word", "  | ^$w:word", "%emit ε{image: value: \"\", X}, ${*$}",
    "%rule word ^\"w\" → {W}", "%rule bb ^\"b\" → {B}", "%emit"]);
  const result = pipeline.parse("bww");
  assert.equal(result.ok, true);
  assert.equal(result.stages[0].output.length, 4);
  // A count of the satellite twice would show ([b b w] w).
  assert.equal(nodeBrackets50(result.stages[0].root), "([b w] w)");
});

test("a splat of a constant with no definition fails as an undefined constant, in written order", () => {
  // The undefined constant in the condition stands first, so its error wins
  // over the splat of the undefined constant in the emission.
  assert.throws(() => pipelineOf(["%stage main", "%ambiguity-resolution greedy", "%rule t(@X) \"a\"", "%rule text \"b\"",
    "%conditions $.parse(t(= $COND))", "%emit ${*$EMIT}"]), /\$COND is not defined/);
  assert.throws(() => pipelineOf(["%stage main", "%ambiguity-resolution greedy", "%rule text \"b\"", "%emit ${*$EMIT}"]), /\$EMIT is not defined/);
});
