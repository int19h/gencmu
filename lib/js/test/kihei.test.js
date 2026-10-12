import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDialect, toBrackets } from "../src/node.js";

const dialect = loadDialect("kihei");
const cll = loadDialect("cll-ebnf");
function nodes(tree, rule) {
  return (tree.rule === rule ? [tree] : []).concat((tree.children || []).flatMap(child => nodes(child, rule)));
}
function reads(text) {
  const result = dialect.parse(text);
  assert.equal(result.ok, true, `${text}: ${JSON.stringify(result.error)}`);
  return result;
}
function source(text, node) {
  return text.slice(node.source[0], node.source[1]);
}

for (const text of [
  "ki'ei ko'a .i broda .i brode", "KI'EI ko'a .i broda",
  "ki'ei pu zu ku .i broda", "ki'ei pu zu .i broda",
  "ki'ei ko'a ko'e pu ku .i broda", "ki'ei .i broda",
  "ki'ei", "ki'ei ko'a", "ki'ei ko'a ni'o broda",
  "ki'ei ko'a ki'ei ko'e .i broda", "ki'ei .i ki'ei .i broda",
  "broda ki'ei ko'a .i brode", "broda .i ki'ei ko'a .i brode",
  "ni'o ki'ei ko'a .i broda", ".i ki'ei ko'a .i broda",
  "ki'ei lo nu broda kei ku .i brode", "ki'ei fi'o broda fe'u ku .i brode",
  "ki'ei ba'e ko'a .i broda", "ki'ei ui ko'a .i broda",
  "ki'ei ko'a .i broda .ije brode", "ki'ei ko'a .i broda .i bo brode",
  "zo ki'ei", "lo'u ki'ei le'u", "ki'ei ko'a si ko'e .i broda",
]) test(`kihei accepts ${text}`, () => reads(text));

for (const text of ["ki'ei ko'a broda", "ki'ei ce'u purci ce'u .i broda", "mi ki'ei ko'a klama"])
  test(`kihei rejects ${text}`, () => assert.equal(dialect.parse(text).ok, false));

test("frames contain their utterances and stop before the next frame", () => {
  const text = "broda ki'ei ko'a .i brode .i brodi ki'ei ko'e .i brodo";
  const tree = reads(text).tree;
  assert.deepEqual(nodes(tree, "frame-group").map(n => source(text, n)), [
    "ki'ei ko'a .i brode .i brodi", "ki'ei ko'e .i brodo",
  ]);
  assert.deepEqual(nodes(tree, "frame").map(n => source(text, n)), ["ki'ei ko'a", "ki'ei ko'e"]);
});

test("NIhO separates paragraphs outside the frame groups", () => {
  const text = "ki'ei ko'a .i broda ni'o ki'ei ko'e .i brode";
  const tree = reads(text).tree;
  assert.deepEqual(nodes(tree, "paragraph").map(n => source(text, n)), [
    "ki'ei ko'a .i broda", "ki'ei ko'e .i brode",
  ]);
  for (const n of nodes(tree, "frame-group")) assert.equal(source(text, n).includes("ni'o"), false);
});

for (const [text, inner] of [
  ["ki'ei ko'a .i mi cusku lu ki'ei ko'e .i broda li'u .i brode", "ki'ei ko'e .i broda"],
  ["ki'ei ko'a .i broda to ki'ei ko'e .i brode toi .i brodi", "ki'ei ko'e .i brode"],
  ["ki'ei ko'a .i tu'e ki'ei ko'e .i broda tu'u .i brode", "ki'ei ko'e .i broda"],
]) test(`frames stay inside their enclosing text: ${text}`, () => {
  const groups = nodes(reads(text).tree, "frame-group");
  assert.equal(groups.length, 2);
  assert.equal(source(text, groups[0]), text);
  assert.equal(source(text, groups[1]), inner);
});

test("CLL texts keep their brackets and CLL does not gain KIhEI", () => {
  for (const text of ["mi klama le zarci", "broda .i brode ni'o brodi", "mi broda .ije do brode", "lu broda li'u", "broda to brode toi", "tu'e broda .i brode tu'u"])
    assert.equal(toBrackets(reads(text)), toBrackets(cll.parse(text)), text);
  assert.equal(cll.parse("ki'ei ko'a .i broda").ok, false);
});

test("KIhEI is a word class and SA keeps the earlier utterance", () => {
  const text = "broda .i ki'ei ko'a sa ki'ei ko'e .i brode";
  const result = reads(text);
  assert.ok(result.features.includes("sa-su"));
  assert.deepEqual(nodes(result.tree, "frame").map(n => source(text, n)), ["ki'ei ko'e"]);
  assert.match(toBrackets(result), /broda i/);
  const forms = dialect.parse("KI'EI", { until: "forms" });
  assert.equal(forms.ok, true);
  assert.ok(forms.stages.at(-1).output[0].tags.has("KIhEI"));
  const plain = cll.parse(text, { until: "words" });
  assert.equal(plain.ok, true);
  assert.equal(plain.stages.at(-1).output.some(token => token.text === "broda"), false);
});
