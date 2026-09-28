// A DOM that does not come from reading a document is checked before use.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { domProblem, DOM_FORMAT } from "../src/dom.js";
import { loadDialectSources, GencmuError, Token, fnv1a64 } from "../src/node.js";

const grammars = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "grammars");
const read = (file) => fs.readFileSync(path.join(grammars, file), "utf8");

test("every bundled DOM passes the check", () => {
  for (const stage of JSON.parse(read("notation/bootstrap.json")).stages) {
    for (const document of stage.documents) assert.equal(domProblem(document.dom), null, document.path);
  }
  for (const [file, entry] of Object.entries(JSON.parse(read("compiled.json")).documents)) assert.equal(domProblem(entry.dom), null, file);
});

const sources = {
  "p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n",
  "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A\n```\n",
};

test("a malformed precompiled DOM is a miss, and the document is read instead", () => {
  const bootstrapHash = loadDialectSources(sources, "p.md").loader.bootstrapHash;
  const hash = fnv1a64(sources["g.md"]);
  const token = new Token(new Map([["A", true]]), [0, 1], [0, 1], "a", null, undefined);
  for (const dom of [{ format: DOM_FORMAT, rules: [{}], directives: [] },
    { format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr: { seq: [] } }], conditions: [], at: [1, 1] }], directives: [] }]) {
    const compiled = JSON.stringify({ format: DOM_FORMAT, bootstrap: bootstrapHash, documents: { "g.md": { hash, dom } } });
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
  for (let depth = 0; depth < 257; depth++) expr = { optional: expr };
  const dom = { format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr }], conditions: [], at: [1, 1] }], directives: [] };
  assert.equal(domProblem(dom), "nested too deeply");
  // An emission's tag terms are counted from the top as any term is.
  let term = { literal: "x" };
  for (let depth = 0; depth < 256; depth++) term = { union: [term, { literal: "y" }] };
  const emitted = { format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr: { ref: "A" } }], emit: { items: [{ capture: "", tags: term }] }, conditions: [], at: [1, 1] }], directives: [] };
  assert.equal(domProblem(emitted), null);
});

test("a tag term naming a capture no alternative has is an error of the grammar", () => {
  assert.throws(() => loadDialectSources({ ...sources, "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A %emits $ <$x>\n```\n" }, "p.md"),
    (error) => error instanceof GencmuError && /\$x is captured by no alternative/.test(error.message));
});

test("the reader holds documents to the same nesting bound as precompiled DOMs", () => {
  const deep = (n) => "```jbogenbau\n%ambiguity-resolution greedy\n%rule text " + "[".repeat(n) + "A" + "]".repeat(n) + "\n```\n";
  assert.throws(() => loadDialectSources({ ...sources, "g.md": deep(300) }, "p.md"),
    (error) => error instanceof GencmuError && error.where.line === 3 && error.where.column === 1);
  assert.doesNotThrow(() => loadDialectSources({ ...sources, "g.md": deep(100) }, "p.md"));
});

test("the check holds a precompiled emission and format to the reader's rules", () => {
  const rule = (emit) => ({ format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr: { capture: "x", expr: { ref: "A" } } }], emit, conditions: [], at: [1, 1] }], directives: [] });
  assert.equal(domProblem(rule({ items: [{ capture: "" }, { capture: "x" }] })), "a malformed emission");
  assert.equal(domProblem(rule({ items: [{ capture: "x", what: true }] })), "a malformed emission");
  assert.equal(domProblem(rule({ items: [{ capture: "x", tags: { emptySet: true } }] })), "a malformed emission");
  assert.equal(domProblem(rule({ items: [] })), null);
  assert.equal(domProblem(rule({ items: [{ capture: "x" }, { capture: "x" }] })), "a malformed emission");
  assert.equal(domProblem(rule({ items: [{ insert: "y", tags: { literal: "z" } }] })), "a malformed emission");
  assert.equal(domProblem(rule({ items: [{ capture: "" }, { capture: "" }] })), null);
  assert.equal(domProblem({ format: 3, rules: [], directives: [] }), `not a DOM of format ${DOM_FORMAT}`);
  const tagged = (tags) => ({ format: DOM_FORMAT, rules: [{ name: "text", op: "define", tags, alternatives: [{ guards: [], expr: { capture: "x", expr: { ref: "A" } } }], conditions: [], at: [1, 1] }], directives: [] });
  assert.equal(domProblem(tagged({ call: "matches", args: [{ literal: "x" }] })), "a malformed term");
  assert.equal(domProblem(tagged({ call: "head", args: [{ capture: "x" }] })), "a malformed term");
  assert.equal(domProblem(tagged({ call: "lowercase", args: [{ weak: "x" }] })), "a malformed term");
  const conditioned = (condition) => ({ format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr: { capture: "x", expr: { ref: "A" } } }], conditions: [condition], at: [1, 1] }], directives: [] });
  assert.equal(domProblem(conditioned({ op: "∈", left: { capture: "x" }, right: { capture: "x" } })), "a malformed condition");
  assert.equal(domProblem(conditioned({ op: "∉", left: { call: "tags", args: [{ capture: "x" }] }, right: { literal: "b" } })), "a malformed condition");
  assert.equal(domProblem(conditioned({ op: "∈", left: { call: "text", args: [{ capture: "x" }] }, right: { capture: "x" } })), null);
  assert.equal(domProblem(tagged({ call: "tags", args: [{ capture: "" }] })), "a constituent's tags made of its own");
  assert.equal(domProblem(tagged({ union: [{ literal: "x" }, { capture: "" }] })), "a constituent's tags made of its own");
  assert.equal(domProblem(tagged({ call: "tags", args: [{ capture: "" }, { rule: "a" }] })), null);
  assert.equal(domProblem(tagged({ call: "tags", args: null })), "a malformed term");
  const alternative = (expr) => ({ format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr }], conditions: [], at: [1, 1] }], directives: [] });
  assert.equal(domProblem(alternative({ seq: [{ optional: { capture: "x", expr: { ref: "A" } } }, { ref: "B" }] })), "a capture below the top level of an alternative");
  assert.equal(domProblem(alternative({ seq: [{ capture: "x", expr: { ref: "A" } }, { capture: "x", expr: { ref: "B" } }] })), "a capture name used twice in an alternative");
  assert.equal(domProblem(alternative({ seq: [{ capture: "x", expr: { ref: "A" } }, { ref: "B" }] })), null);
  const five = { seq: ["a", "b", "c", "d", "e"].map((name) => ({ capture: name, expr: { ref: "A" } })) };
  assert.equal(domProblem(alternative(five)), "more than four captures in an alternative");
  assert.equal(domProblem(tagged({ call: "tags", args: [{ call: "head", args: [{ capture: "x" }] }, { rule: "a" }] })), null);
});

test("a guard in a precompiled DOM has a kind, and a warning is never negated", () => {
  const guarded = (guard) => ({ format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [guard], expr: { ref: "A" } }], conditions: [], at: [1, 1] }], directives: [] });
  assert.equal(domProblem(guarded({ feature: "f", kind: "gate", negated: true })), null);
  assert.equal(domProblem(guarded({ feature: "f", kind: "warning", negated: false })), null);
  assert.equal(domProblem(guarded({ feature: "f", kind: "warning", negated: true })), "a malformed alternative");
  assert.equal(domProblem(guarded({ feature: "f", negated: false })), "a malformed alternative");
  assert.equal(domProblem(guarded({ feature: "f", kind: "hint", negated: false })), "a malformed alternative");
});

test("a spelling in a precompiled DOM is checked as the reader checks it", () => {
  const { loader } = loadDialectSources(sources, "p.md");
  const alternative = (expr) => ({ format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr }], conditions: [], at: [1, 1] }], directives: [] });
  const spelled = (spelling, expr = { ref: "LE" }) => ({ spelling, expr });
  assert.equal(domProblem(alternative(spelled("la")), loader.unicode), null);
  assert.equal(domProblem(alternative(spelled("a", { terminal: "/a/" })), loader.unicode), null);
  assert.equal(domProblem(alternative({ capture: "l", expr: spelled("la") }), loader.unicode), null);
  assert.equal(domProblem(alternative({ seq: [{ capture: "l", expr: spelled("la") }, { repeat: spelled("ui", { ref: "UI" }), min: 1 }] }), loader.unicode), null);
  assert.equal(domProblem(alternative(spelled("")), loader.unicode), "a spelling is empty");
  assert.equal(domProblem(alternative(spelled(7)), loader.unicode), "a malformed spelling");
  assert.equal(domProblem(alternative(spelled("La")), loader.unicode), "the spelling La is not in lower case");
  assert.equal(domProblem(alternative({ capture: "l", expr: spelled("Ла") }), loader.unicode), "the spelling Ла is not in lower case");
  assert.equal(domProblem(alternative(spelled("la", { ref: "#" })), loader.unicode), "a spelling follows only a reference other than #, a string or a phoneme tag");
  assert.equal(domProblem(alternative(spelled("la", { optional: { ref: "LE" } })), loader.unicode), "a spelling follows only a reference other than #, a string or a phoneme tag");
  assert.equal(domProblem(alternative(spelled("la", spelled("la"))), loader.unicode), "a spelling follows only a reference other than #, a string or a phoneme tag");
  assert.equal(domProblem(alternative(spelled("la", { capture: "x", expr: { ref: "LE" } })), loader.unicode), "a spelling follows only a reference other than #, a string or a phoneme tag");
  // The notation cannot write a backtick in a spelling.
  assert.equal(domProblem(alternative(spelled("l`a")), loader.unicode), "a spelling holds a backtick");
  assert.equal(domProblem(alternative(spelled("`")), loader.unicode), "a spelling holds a backtick");
  // A node read one way here and another way when lowered is refused.
  assert.equal(domProblem(alternative(spelled("la", { empty: true, ref: "LE" })), loader.unicode), "a spelling follows only a reference other than #, a string or a phoneme tag");
  assert.equal(domProblem(alternative(spelled("la", { ref: "LE", terminal: "LE" })), loader.unicode), "a spelling follows only a reference other than #, a string or a phoneme tag");
  assert.equal(domProblem(alternative({ ...spelled("la"), empty: true }), loader.unicode), "a malformed expression");
  assert.equal(domProblem(alternative({ ...spelled("la"), ref: "LE" }), loader.unicode), "a malformed expression");
  assert.equal(domProblem(alternative({ capture: "l", expr: { ...spelled("la"), terminal: "LE" } }), loader.unicode), "a malformed expression");
  assert.equal(domProblem(alternative({ capture: "l", ...spelled("La") }), loader.unicode), "a malformed expression");
  assert.equal(domProblem(alternative({ optional: { ref: "LE" }, ...spelled("La") }), loader.unicode), "a malformed expression");
  // A top-level sequence is checked whole before it is split.
  assert.equal(domProblem(alternative({ seq: [{ ref: "LE" }, { ref: "LE" }], ...spelled("la") }), loader.unicode), "a malformed expression");
  // A spelled symbol is a compound node (engine §9).
  let expr = spelled("la");
  for (let depth = 0; depth < 256; depth++) expr = { optional: expr };
  assert.equal(domProblem(alternative(expr)), "nested too deeply");
  assert.equal(domProblem(alternative(expr.optional)), null);
});

test("a precompiled DOM with a spelling in upper case is a miss, and the document is read instead", () => {
  const bootstrapHash = loadDialectSources(sources, "p.md").loader.bootstrapHash;
  const text = "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A`a`\n```\n";
  const hash = fnv1a64(text);
  const dom = { format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr: { spelling: "A", expr: { ref: "A" } } }], conditions: [], at: [3, 1] }], directives: [{ name: "ambiguity-resolution", args: ["greedy"], at: [2, 1] }] };
  const compiled = JSON.stringify({ format: DOM_FORMAT, bootstrap: bootstrapHash, documents: { "g.md": { hash, dom } } });
  const dialect = loadDialectSources({ ...sources, "g.md": text, "compiled.json": compiled }, "p.md");
  assert.equal(dialect.loader.compiled.size, 0, "the entry was refused");
  const token = new Token(new Map([["A", true]]), [0, 1], [0, 1], "a", "a", undefined);
  assert.equal(dialect.parse("a", { tokens: [token], autoFeatures: false }).ok, true, "the document was read instead");
});

test("a precompiled spelling the reader would refuse is a miss, and the document is read instead", () => {
  const bootstrapHash = loadDialectSources(sources, "p.md").loader.bootstrapHash;
  const text = "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A`a`\n```\n";
  const hash = fnv1a64(text);
  const token = new Token(new Map([["A", true]]), [0, 1], [0, 1], "a", "a", undefined);
  const fresh = loadDialectSources({ ...sources, "g.md": text }, "p.md").parse("a", { tokens: [token], autoFeatures: false });
  for (const expr of [
    { spelling: "a`b", expr: { ref: "A" } },
    { spelling: "a", expr: { empty: true, ref: "A" } },
    { spelling: "a", expr: { ref: "A", terminal: "A" } },
    { spelling: "a", expr: { ref: "A" }, empty: true },
    { capture: "x", spelling: "a`b", expr: { ref: "A" } },
    { seq: [{ ref: "A" }, { ref: "A" }], spelling: "a", expr: { ref: "A" } },
  ]) {
    const dom = { format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr }], conditions: [], at: [3, 1] }], directives: [{ name: "ambiguity-resolution", args: ["greedy"], at: [2, 1] }] };
    const compiled = JSON.stringify({ format: DOM_FORMAT, bootstrap: bootstrapHash, documents: { "g.md": { hash, dom } } });
    const dialect = loadDialectSources({ ...sources, "g.md": text, "compiled.json": compiled }, "p.md");
    assert.equal(dialect.loader.compiled.size, 0, `the entry was refused: ${JSON.stringify(expr)}`);
    assert.deepEqual(dialect.parse("a", { tokens: [token], autoFeatures: false }), fresh, "the document was read instead");
  }
});

test("a bootstrap spelling the reader would refuse is a grammar error", () => {
  // Spell the first plain reference of the bootstrap.
  const spell = (spelled) => {
    const bootstrap = JSON.parse(read("notation/bootstrap.json"));
    const pending = [bootstrap];
    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
      if (node === null || typeof node !== "object") continue;
      for (const [key, value] of Object.entries(node)) {
        if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 && typeof value.ref === "string" && value.ref !== "#") {
          node[key] = spelled(value);
          return JSON.stringify(bootstrap);
        }
        pending.push(value);
      }
    }
    throw new Error("the bootstrap has no plain reference");
  };
  // Whether the bootstrap itself is refused. The notation it gives may
  // still fail to read the document.
  const refused = (bootstrap) => {
    try {
      loadDialectSources({ ...sources, "notation/bootstrap.json": bootstrap }, "p.md");
    } catch (error) {
      assert.ok(error instanceof GencmuError, String(error));
      return error.where.document === "notation/bootstrap.json";
    }
    return false;
  };
  assert.equal(refused(spell((ref) => ({ spelling: "a", expr: ref }))), false);
  for (const spelled of [(ref) => ({ spelling: "a`b", expr: ref }), (ref) => ({ spelling: "a", expr: { ...ref, empty: true } }),
    (ref) => ({ seq: [ref, ref], spelling: "a", expr: ref })]) {
    assert.equal(refused(spell(spelled)), true);
  }
});
