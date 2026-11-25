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
