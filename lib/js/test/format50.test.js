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
  assert.throws(() => pipelineOf(["%stage s", "%ambiguity-resolution greedy", "%const $B {x: 1}", "%rule text $a:A", "%conditions $a'value = $B"]),
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
