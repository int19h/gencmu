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
