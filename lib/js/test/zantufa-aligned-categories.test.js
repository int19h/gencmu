import assert from "node:assert/strict";
import test from "node:test";
import { loadDialect } from "../src/node.js";
import { nodeJson } from "../src/output.js";

const dialect = loadDialect("zantufa");

function nodes(text) {
  const result = dialect.parse(text);
  assert.equal(result.ok, true, text);
  const found = [];
  const pending = [nodeJson(result.tree)];
  while (pending.length) {
    const node = pending.pop();
    found.push(node);
    for (const child of node.children ?? []) pending.push(child);
  }
  return found;
}

test("letter fragments retain their terms category through recursive constructions", () => {
  for (const text of [
    "my", "my jo'u gy", "la'e my jo'u gy", "na'e gy", "my bo gy",
    "ke my ke'e", "la'e la'e my", "na'e bo la'e my", "my se jo'u gy",
  ]) {
    const fragment = nodes(text).find((node) => node.rule === "fragment");
    assert.ok(fragment, text);
    assert.equal(fragment.children[0].rule, "terms-vau", text);
  }
});

test("connected and wrapped letter arguments do not become quantifiers", () => {
  for (const text of [
    "my .e do cu klama", "mi dunda my .e gy do", "mi dunda la'e my do",
    "my bo gy mi prami", "na'e bo my mi prami", "by se jo'u cy cu klama",
    "lo my jo'u gy prenu",
  ]) {
    assert.equal(nodes(text).some((node) => node.rule === "quantifier"), false, text);
  }
});

test("ME retains the sumti category for connected and wrapped letters", () => {
  for (const text of [
    "mi me my jo'u gy", "mi me la'e my", "mi me na'e gy",
    "mi me my bo gy", "mi me na'e bo my", "mi me my .e gy moi",
  ]) {
    const unit = nodes(text).find((node) => node.rule === "tanru-unit-1"
      && node.children[0]?.terminal === "ME");
    assert.ok(unit, text);
    assert.ok(unit.children.some((node) => node.rule === "sumti"), text);
    assert.equal(unit.children.some((node) => node.rule === "mex"), false, text);
  }
});

test("description prefixes retain their local quantifier reservation", () => {
  const prefix = nodes("le ke my ke'e broda").find((node) => node.rule === "sumti-tail");
  assert.ok(prefix);
  assert.equal(prefix.children.some((node) => node.rule === "sumti"), false);
  assert.ok(prefix.children.some((node) => node.rule === "sumti-tail-1"));
  assert.ok(nodes("le ke my ke'e broda").some((node) => node.rule === "quantifier"));
});

test("ROI reserves tags at term starts while inner letters remain sumti", () => {
  for (const text of ["cy roi", "ke my ke'e roi klama"]) {
    assert.ok(nodes(text).some((node) => node.rule === "tag"), text);
  }
  for (const text of ["ro my roi klama", "mi .e my roi klama", "mi klama ro my roi"]) {
    assert.ok(nodes(text).some((node) => node.rule === "sumti"), text);
  }
});

test("an aligned category prefix still reserves an incomplete outer construction", () => {
  assert.equal(dialect.parse("broda na'e my na'e me my").ok, false);
});
