// A DOM that does not come from reading a document is checked before use.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { domProblem } from "../src/dom.js";
import { loadDialectSources, GencmuError, Token, fnv1a64 } from "../src/node.js";

const grammars = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "grammars");
const read = (file) => fs.readFileSync(path.join(grammars, file), "utf8");

test("every bundled DOM passes the check", () => {
  for (const stage of JSON.parse(read("notation/bootstrap.json")).stages) {
    for (const document of stage.documents) assert.equal(domProblem(document.dom), null, document.path);
  }
  for (const [file, entry] of Object.entries(JSON.parse(read("compiled.json")).documents)) assert.equal(domProblem(entry.dom), null, file);
});

const sources = {
  "p.md": "## Main <?stage main?>\n\n- [g](g.md) <?grammar?>\n",
  "g.md": "```ebnf\n%ambiguity-resolution greedy ;\ntext ≔ A ;\n```\n",
};

test("a malformed precompiled DOM is a miss, and the document is read instead", () => {
  const bootstrapHash = loadDialectSources(sources, "p.md").loader.bootstrapHash;
  const hash = fnv1a64(sources["g.md"]);
  const token = new Token(new Map([["A", true]]), [0, 1], [0, 1], "a", null, undefined);
  for (const dom of [{ format: 1, rules: [{}], directives: [] },
    { format: 1, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr: { seq: [] } }], conditions: [], at: [1, 1] }], directives: [] }]) {
    const compiled = JSON.stringify({ format: 1, bootstrap: bootstrapHash, documents: { "g.md": { hash, dom } } });
    const dialect = loadDialectSources({ ...sources, "compiled.json": compiled }, "p.md");
    assert.equal(dialect.loader.compiled.size, 0, "the entry was refused");
    assert.equal(dialect.parse("a", { tokens: [token], autoFeatures: false }).ok, true, "the document was read instead");
  }
  const garbage = loadDialectSources({ ...sources, "compiled.json": "{not json" }, "p.md");
  assert.equal(garbage.loader.compiled.size, 0);
});

test("a malformed bootstrap is a grammar error", () => {
  for (const bad of ['{"format":1,"stages":[]}', "{", '{"stages":[{"name":"x","documents":[{"path":"a","dom":{"rules":[{}],"directives":[]}}]}]}']) {
    assert.throws(() => loadDialectSources({ ...sources, "notation/bootstrap.json": bad }, "p.md"), GencmuError);
  }
});

test("nesting deeper than any grammar is refused", () => {
  let expr = { ref: "a" };
  for (let depth = 0; depth < 300; depth++) expr = { optional: expr };
  const dom = { format: 1, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr }], conditions: [], at: [1, 1] }], directives: [] };
  assert.equal(domProblem(dom), "nested too deeply");
});

test("a tag term naming a capture the production lacks is dropped from the item", () => {
  const dialect = loadDialectSources({ ...sources, "g.md": "```ebnf\n%ambiguity-resolution greedy ;\ntext ≔ A ⇒ this <$x> ;\n```\n" }, "p.md");
  const token = new Token(new Map([["A", true]]), [0, 1], [0, 1], "a", null, undefined);
  const result = dialect.parse("a", { tokens: [token], autoFeatures: false });
  assert.equal(result.ok, true);
  assert.deepEqual([...result.stages[0].output[0].tags.keys()], ["A"], "the constituent's own tags");
});

test("the reader holds documents to the same nesting bound as precompiled DOMs", () => {
  const deep = (n) => "```ebnf\n%ambiguity-resolution greedy ;\ntext ≔ " + "[".repeat(n) + "A" + "]".repeat(n) + " ;\n```\n";
  assert.throws(() => loadDialectSources({ ...sources, "g.md": deep(300) }, "p.md"),
    (error) => error instanceof GencmuError && error.where.line === 3 && error.where.column === 1);
  assert.doesNotThrow(() => loadDialectSources({ ...sources, "g.md": deep(100) }, "p.md"));
});

test("the check holds a precompiled emission and format to the reader's rules", () => {
  const rule = (emit) => ({ format: 1, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr: { capture: "x", expr: { ref: "A" } } }], emit, conditions: [], at: [1, 1] }], directives: [] });
  assert.equal(domProblem(rule({ items: [{ this: true }, { capture: "x" }] })), "a malformed emission");
  assert.equal(domProblem(rule({ items: [{ capture: "x" }, { capture: "x" }] })), "a malformed emission");
  assert.equal(domProblem(rule({ items: [{ insert: "y", tags: { literal: "z" } }] })), "a malformed emission");
  assert.equal(domProblem(rule({ items: [{ this: true }, { this: true }] })), null);
  assert.equal(domProblem({ format: 2, rules: [], directives: [] }), "not a DOM of format 1");
  const tagged = (tags) => ({ format: 1, rules: [{ name: "text", op: "define", tags, alternatives: [{ guards: [], expr: { capture: "x", expr: { ref: "A" } } }], conditions: [], at: [1, 1] }], directives: [] });
  assert.equal(domProblem(tagged({ call: "matches", args: [{ literal: "x" }] })), "a malformed term");
  assert.equal(domProblem(tagged({ call: "head", args: [{ capture: "x" }] })), "a malformed term");
  assert.equal(domProblem(tagged({ call: "lowercase", args: [{ weak: "x" }] })), "a malformed term");
  const alternative = (expr) => ({ format: 1, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr }], conditions: [], at: [1, 1] }], directives: [] });
  assert.equal(domProblem(alternative({ seq: [{ optional: { capture: "x", expr: { ref: "A" } } }, { ref: "B" }] })), "a capture below the top level of an alternative");
  assert.equal(domProblem(alternative({ seq: [{ capture: "x", expr: { ref: "A" } }, { capture: "x", expr: { ref: "B" } }] })), "a capture name used twice in an alternative");
  assert.equal(domProblem(alternative({ seq: [{ capture: "x", expr: { ref: "A" } }, { ref: "B" }] })), null);
  assert.equal(domProblem(tagged({ call: "tags", args: [{ call: "head", args: [{ capture: "x" }] }, { rule: "a" }] })), null);
});
