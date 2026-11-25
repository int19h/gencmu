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
