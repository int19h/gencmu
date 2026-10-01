// A DOM that does not come from reading a document is checked before use.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { domProblem as domProblemBy, DOM_FORMAT } from "../src/dom.js";
import { loadDialectSources, GencmuError, Token, fnv1a64 } from "../src/node.js";
import { UnicodeTable } from "../src/unicode.js";

const grammars = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "grammars");
const read = (file) => fs.readFileSync(path.join(grammars, file), "utf8");
// The check always has a table: the bundled one, unless a test gives its own.
const bundledUnicode = new UnicodeTable(read("unicode.txt"));
const domProblem = (dom, unicode = bundledUnicode) => domProblemBy(dom, unicode);

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
  const token = new Token(new Set(["A"]), [0, 1], [0, 1], "a", null, undefined);
  for (const dom of [{ format: DOM_FORMAT, rules: [{}], directives: [], constants: [], classifiers: [], implications: [] },
    { format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr: { seq: [] } }], conditions: [], at: [1, 1] }], directives: [], constants: [], classifiers: [], implications: [] }]) {
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
  const dom = { format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr }], conditions: [], at: [1, 1] }], directives: [], constants: [], classifiers: [], implications: [] };
  assert.equal(domProblem(dom), "nested too deeply");
  // An emission's tag terms are counted from the top as any term is.
  let term = { tag: "x" };
  for (let depth = 0; depth < 256; depth++) term = { union: [term, { tag: "y" }] };
  const emitted = { format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr: { ref: "A" } }], emit: { items: [{ capture: "", tags: term }] }, conditions: [], at: [1, 1] }], directives: [], constants: [], classifiers: [], implications: [] };
  assert.equal(domProblem(emitted), null);
});

test("a tag term naming a capture no alternative has is an error of the grammar", () => {
  assert.throws(() => loadDialectSources({ ...sources, "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A %emits $ <tags($x)>\n```\n" }, "p.md"),
    (error) => error instanceof GencmuError && /\$x is captured by no alternative/.test(error.message));
});

test("the reader holds documents to the same nesting bound as precompiled DOMs", () => {
  const deep = (n) => "```jbogenbau\n%ambiguity-resolution greedy\n%rule text " + "[".repeat(n) + "A" + "]".repeat(n) + "\n```\n";
  assert.throws(() => loadDialectSources({ ...sources, "g.md": deep(300) }, "p.md"),
    (error) => error instanceof GencmuError && error.where.line === 3 && error.where.column === 1);
  assert.doesNotThrow(() => loadDialectSources({ ...sources, "g.md": deep(100) }, "p.md"));
});

test("the check holds a precompiled emission and format to the reader's rules", () => {
  const rule = (emit) => ({ format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr: { capture: "x", expr: { ref: "A" } } }], emit, conditions: [], at: [1, 1] }], directives: [], constants: [], classifiers: [], implications: [] });
  assert.equal(domProblem(rule({ items: [{ capture: "" }, { capture: "x" }] })), "a malformed emission");
  assert.equal(domProblem(rule({ items: [{ capture: "x", what: true }] })), "a malformed emission");
  assert.equal(domProblem(rule({ items: [{ capture: "x", tags: { emptySet: true } }] })), "a malformed emission");
  assert.equal(domProblem(rule({ items: [] })), null);
  assert.equal(domProblem(rule({ items: [{ capture: "x" }, { capture: "x" }] })), "a malformed emission");
  assert.equal(domProblem(rule({ items: [{ insert: "y", tags: { tag: "z" } }] })), "a malformed emission");
  // An inserted item is one tag in its canonical spelling (engine §1, §9).
  assert.equal(domProblem(rule({ items: [{ insert: "'a'" }, { capture: "x" }] })), null);
  assert.equal(domProblem(rule({ items: [{ insert: "a b" }, { capture: "x" }] })), "a malformed emission");
  assert.equal(domProblem(rule({ items: [{ insert: "'\\u{61}'" }, { capture: "x" }] })), "a malformed emission");
  assert.equal(domProblem(rule({ items: [{ capture: "" }, { capture: "" }] })), null);
  // Attachments are named captures of the rule, on a named capture, each
  // once in the emission, and present only when not empty (engine §9, §11).
  const attached = (emit) => ({ format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr: { seq: [
    { capture: "b", expr: { ref: "B" } }, { capture: "x", expr: { ref: "A" } }, { capture: "a", expr: { ref: "C" } }] } }], emit, conditions: [], at: [1, 1] }],
  directives: [], constants: [], classifiers: [], implications: [] });
  assert.equal(domProblem(attached({ items: [{ capture: "x", before: ["b"], after: ["a"] }] })), null);
  assert.equal(domProblem(attached({ items: [{ capture: "x", before: [] }] })), "a malformed emission");
  assert.equal(domProblem(attached({ items: [{ capture: "x", after: ["a", ""] }] })), "a malformed emission");
  assert.equal(domProblem(attached({ items: [{ capture: "x", after: ["A"] }] })), "a malformed emission");
  assert.equal(domProblem(attached({ items: [{ capture: "x", after: "a" }] })), "a malformed emission");
  assert.equal(domProblem(attached({ items: [{ capture: "", after: ["a"] }] })), "a malformed emission");
  assert.equal(domProblem(attached({ items: [{ insert: "Y", before: ["b"] }, { capture: "x" }] })), "a malformed emission");
  assert.equal(domProblem(attached({ items: [{ capture: "x", after: ["a"] }, { capture: "a" }] })), "a malformed emission");
  assert.equal(domProblem(attached({ items: [{ capture: "x", before: ["b", "b"] }] })), "a malformed emission");
  assert.equal(domProblem(attached({ items: [{ capture: "x", before: ["a"] }] })), "%emits of text lists captures out of the order they stand in");
  assert.equal(domProblem(attached({ items: [{ capture: "x", after: ["z"] }] })), "$z is captured by no alternative of text");
  assert.equal(domProblem({ format: 3, rules: [], directives: [], constants: [], classifiers: [], implications: [] }), `not a DOM of format ${DOM_FORMAT}`);
  const tagged = (tags) => ({ format: DOM_FORMAT, rules: [{ name: "text", op: "define", tags, alternatives: [{ guards: [], expr: { capture: "x", expr: { ref: "A" } } }], conditions: [], at: [1, 1] }], directives: [], constants: [], classifiers: [], implications: [] });
  assert.equal(domProblem(tagged({ call: "matches", args: [{ tag: "x" }] })), "a malformed term");
  assert.equal(domProblem(tagged({ call: "head", args: [{ capture: "x" }] })), "a malformed term");
  assert.equal(domProblem(tagged({ call: "lowercase", args: [{ string: "x" }] })), "a malformed term");
  assert.equal(domProblem(tagged({ call: "tag", args: [{ capture: "x" }] })), "a malformed term");
  assert.equal(domProblem(tagged({ call: "tag", args: [{ string: "x" }] })), null);
  // A string literal that the reader sees must be a name for tag, and a
  // delimiter that is not empty for split (engine §9, §10).
  assert.match(String(domProblem(tagged({ call: "tag", args: [{ string: "x y" }] }))), /not a name/);
  assert.equal(domProblem(tagged({ weak: "x" })), "a malformed term");
  assert.equal(domProblem(tagged({ literal: "x" })), "a malformed term");
  assert.equal(domProblem(tagged({ difference: [{ tag: "x" }, { tag: "y" }, { tag: "z" }] })), "a malformed term");
  assert.equal(domProblem(tagged({ difference: [{ tag: "x" }, { tag: "y" }] })), null);
  assert.equal(domProblem(tagged({ tag: "'\\u{5C}'" })), null);
  assert.equal(domProblem(tagged({ tag: "'\\'" })), "a malformed term");
  const conditioned = (condition) => ({ format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr: { capture: "x", expr: { ref: "A" } } }], conditions: [condition], at: [1, 1] }], directives: [], constants: [], classifiers: [], implications: [] });
  // The types of a condition's sides agree (engine §10).
  const runs = { call: "split", args: [{ call: "phonemes", args: [{ capture: "x" }] }, { string: "." }] };
  assert.match(String(domProblem(conditioned({ op: "∈", left: { string: "a" }, right: { call: "split", args: [{ string: "a" }, { string: "" }] } }))), /empty delimiter/);
  assert.equal(domProblem(conditioned({ op: "∈", left: { string: "a" }, right: { call: "split", args: [{ capture: "x" }, { string: "." }] } })), "a malformed term");
  const tags = { call: "tags", args: [{ capture: "x" }] };
  const text = { call: "text", args: [{ capture: "x" }] };
  assert.match(String(domProblem(conditioned({ op: "∈", left: { capture: "x" }, right: runs }))), /a span is not a value/);
  assert.match(String(domProblem(conditioned({ op: "∉", left: tags, right: { string: "b" } }))), /tests a string/);
  assert.match(String(domProblem(conditioned({ op: "∈", left: { string: "b" }, right: tags }))), /in a set of strings/);
  assert.equal(domProblem(conditioned({ op: "∈", left: text, right: runs })), null);
  assert.equal(domProblem(conditioned({ op: "⊈", left: { tag: "a" }, right: tags })), null);
  assert.match(String(domProblem(conditioned({ op: "⊆", left: { tag: "a" }, right: runs }))), /one kind/);
  assert.match(String(domProblem(conditioned({ op: "=", left: text, right: { tag: "a" } }))), /one type/);
  assert.match(String(domProblem(conditioned({ op: "=", left: { emptySet: true }, right: { emptySet: true } }))), /not given/);
  assert.equal(domProblem(conditioned({ op: "=", left: { emptySet: true }, right: runs })), null);
  assert.match(String(domProblem(tagged({ string: "x" }))), /a tag set is needed/);
  assert.match(String(domProblem(tagged({ union: [tags, runs] }))), /one kind/);
  assert.equal(domProblem(tagged({ call: "tags", args: [{ capture: "" }] })), "a constituent's tags made of its own");
  assert.equal(domProblem(tagged({ union: [{ tag: "x" }, { capture: "" }] })), "a constituent's tags made of its own");
  assert.equal(domProblem(tagged({ call: "tags", args: [{ capture: "" }, { rule: "a" }] })), null);
  assert.equal(domProblem(tagged({ call: "tags", args: null })), "a malformed term");
  const alternative = (expr) => ({ format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr }], conditions: [], at: [1, 1] }], directives: [], constants: [], classifiers: [], implications: [] });
  assert.equal(domProblem(alternative({ seq: [{ optional: { capture: "x", expr: { ref: "A" } } }, { ref: "B" }] })), "a capture below the top level of an alternative");
  assert.equal(domProblem(alternative({ seq: [{ capture: "x", expr: { ref: "A" } }, { capture: "x", expr: { ref: "B" } }] })), "a capture name used twice in an alternative");
  assert.equal(domProblem(alternative({ seq: [{ capture: "x", expr: { ref: "A" } }, { ref: "B" }] })), null);
  assert.equal(domProblem(alternative({ seq: [{ capture: "X", expr: { ref: "A" } }, { ref: "B" }] })), "a capture name is not all lower case");
  // A terminal is a tag in its canonical spelling (engine §1).
  assert.equal(domProblem(alternative({ terminal: "'é'" })), null);
  assert.equal(domProblem(alternative({ terminal: "é" })), "a malformed expression");
  assert.equal(domProblem(alternative({ terminal: "'ab'" })), "a malformed expression");
  const elidable = (args) => ({ format: DOM_FORMAT, rules: [], directives: [{ name: "elidable", args, at: [1, 1] }], constants: [], classifiers: [], implications: [] });
  assert.equal(domProblem(elidable(["KU", "ku"])), null);
  assert.equal(domProblem(elidable(["/a/"])), "a malformed directive");
  const five = { seq: ["a", "b", "c", "d", "e"].map((name) => ({ capture: name, expr: { ref: "A" } })) };
  assert.equal(domProblem(alternative(five)), "more than four captures in an alternative");
  assert.equal(domProblem(tagged({ call: "tags", args: [{ call: "head", args: [{ capture: "x" }] }, { rule: "a" }] })), null);
});

test("a guard in a precompiled DOM has a kind, and a warning is never negated", () => {
  const guarded = (guard) => ({ format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [guard], expr: { ref: "A" } }], conditions: [], at: [1, 1] }], directives: [], constants: [], classifiers: [], implications: [] });
  assert.equal(domProblem(guarded({ feature: "f", kind: "gate", negated: true })), null);
  assert.equal(domProblem(guarded({ feature: "f", kind: "warning", negated: false })), null);
  assert.equal(domProblem(guarded({ feature: "f", kind: "warning", negated: true })), "a malformed alternative");
  assert.equal(domProblem(guarded({ feature: "f", negated: false })), "a malformed alternative");
  assert.equal(domProblem(guarded({ feature: "f", kind: "hint", negated: false })), "a malformed alternative");
  // A guard has no member but its feature, its kind and whether it is
  // negated, as an entry's guard has.
  assert.equal(domProblem(guarded({ feature: "f", kind: "gate", negated: false, extra: true })), "a malformed alternative");
});

test("a test in a precompiled DOM is checked as the reader checks it", () => {
  const { loader } = loadDialectSources(sources, "p.md");
  const alternative = (expr) => ({ format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr }], conditions: [], at: [1, 1] }], directives: [], constants: [], classifiers: [], implications: [] });
  const tested = (sound, expr = { ref: "LE" }, test = "=") => ({ test, value: typeof sound === "string" ? { string: sound } : sound, expr });
  const refusal = "a test follows only a reference other than # or a terminal";
  assert.equal(domProblem(alternative(tested("la")), loader.unicode), null);
  assert.equal(domProblem(alternative(tested("")), loader.unicode), null);
  assert.equal(domProblem(alternative(tested("a", { terminal: "/a/" }, "≠")), loader.unicode), null);
  assert.equal(domProblem(alternative(tested({ tag: "UI" }, { ref: "cmavo" }, "∩=∅")), loader.unicode), null);
  assert.equal(domProblem(alternative(tested({ union: [{ tag: "UI" }, { range: ["'a'", "'c'"] }] }, { range: ["'a'", "'z'"] }, "⊇")), loader.unicode), null);
  assert.equal(domProblem(alternative(tested({ emptySet: true }, { property: "L" }, "⊉")), loader.unicode), null);
  assert.equal(domProblem(alternative(tested({ const: "A", at: [1, 1] }, { ref: "LE" }, "∩≠∅")), loader.unicode), null);
  assert.equal(domProblem(alternative({ capture: "l", expr: tested("la") }), loader.unicode), null);
  assert.equal(domProblem(alternative({ seq: [{ capture: "l", expr: tested("la") }, { repeat: tested("ui", { ref: "UI" }), min: 1 }] }), loader.unicode), null);
  assert.equal(domProblem(alternative(tested("la", { ref: "LE" }, "==")), loader.unicode), "a malformed test");
  assert.equal(domProblem(alternative(tested("la", { ref: "LE" }, 7)), loader.unicode), "a malformed test");
  assert.equal(domProblem(alternative(tested("La")), loader.unicode), 'the string "La" is not in lower case, which every canonical sound is');
  assert.equal(domProblem(alternative({ capture: "l", expr: tested("Ла") }), loader.unicode), 'the string "Ла" is not in lower case, which every canonical sound is');
  assert.equal(domProblem(alternative(tested("l,a")), loader.unicode), 'the string "l,a" holds a comma, which no canonical sound holds');
  // A string constant is checked by the loader, which knows its value.
  assert.equal(domProblem(alternative(tested({ const: "A", at: [1, 1] })), loader.unicode), null);
  // A value of the wrong type, or one that is not closed.
  assert.notEqual(domProblem(alternative(tested({ tag: "UI" })), loader.unicode), null);
  assert.notEqual(domProblem(alternative(tested("la", { ref: "LE" }, "⊇")), loader.unicode), null);
  assert.notEqual(domProblem(alternative(tested({ call: "tags", args: [{ capture: "" }] }, { ref: "LE" }, "⊇")), loader.unicode), null);
  assert.notEqual(domProblem(alternative(tested({ call: "phonemes", args: [{ capture: "" }] })), loader.unicode), null);
  assert.notEqual(domProblem(alternative(tested({ capture: "x" })), loader.unicode), null);
  assert.equal(domProblem(alternative(tested("la", { ref: "#" })), loader.unicode), refusal);
  assert.equal(domProblem(alternative(tested("la", { optional: { ref: "LE" } })), loader.unicode), refusal);
  assert.equal(domProblem(alternative(tested("la", tested("la"))), loader.unicode), refusal);
  assert.equal(domProblem(alternative(tested("la", { capture: "x", expr: { ref: "LE" } })), loader.unicode), refusal);
  assert.equal(domProblem(alternative(tested("la", { empty: true })), loader.unicode), refusal);
  // A node read one way here and another way when lowered is refused.
  assert.equal(domProblem(alternative(tested("la", { empty: true, ref: "LE" })), loader.unicode), refusal);
  assert.equal(domProblem(alternative(tested("la", { ref: "LE", terminal: "LE" })), loader.unicode), refusal);
  assert.equal(domProblem(alternative({ ...tested("la"), empty: true }), loader.unicode), "a malformed expression");
  assert.equal(domProblem(alternative({ ...tested("la"), ref: "LE" }), loader.unicode), "a malformed expression");
  assert.equal(domProblem(alternative({ test: "=", expr: { ref: "LE" } }), loader.unicode), "a malformed expression");
  assert.equal(domProblem(alternative({ capture: "l", expr: { ...tested("la"), terminal: "LE" } }), loader.unicode), "a malformed expression");
  assert.equal(domProblem(alternative({ capture: "l", ...tested("La") }), loader.unicode), "a malformed expression");
  assert.equal(domProblem(alternative({ optional: { ref: "LE" }, ...tested("La") }), loader.unicode), "a malformed expression");
  // A top-level sequence is checked whole before it is split.
  assert.equal(domProblem(alternative({ seq: [{ ref: "LE" }, { ref: "LE" }], ...tested("la") }), loader.unicode), "a malformed expression");
  // A tested symbol is a compound node, and its value counts on from its
  // depth (engine §9).
  let expr = tested("la");
  for (let depth = 0; depth < 256; depth++) expr = { optional: expr };
  assert.equal(domProblem(alternative(expr)), "nested too deeply");
  assert.equal(domProblem(alternative(expr.optional)), null);
  let deep = tested({ union: [{ tag: "A" }, { tag: "B" }] }, { ref: "LE" }, "⊇");
  for (let depth = 0; depth < 255; depth++) deep = { optional: deep };
  assert.equal(domProblem(alternative(deep)), "nested too deeply");
  assert.equal(domProblem(alternative(deep.optional)), null);
});

test("a precompiled DOM with a test's string in upper case is a miss, and the document is read instead", () => {
  const bootstrapHash = loadDialectSources(sources, "p.md").loader.bootstrapHash;
  const text = "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A=\"a\"\n```\n";
  const hash = fnv1a64(text);
  const dom = { format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr: { test: "=", value: { string: "A" }, expr: { ref: "A" } } }], conditions: [], at: [3, 1] }], directives: [{ name: "ambiguity-resolution", args: ["greedy"], at: [2, 1] }], constants: [], classifiers: [], implications: [] };
  const compiled = JSON.stringify({ format: DOM_FORMAT, bootstrap: bootstrapHash, documents: { "g.md": { hash, dom } } });
  const dialect = loadDialectSources({ ...sources, "g.md": text, "compiled.json": compiled }, "p.md");
  assert.equal(dialect.loader.compiled.size, 0, "the entry was refused");
  const token = new Token(new Set(["A"]), [0, 1], [0, 1], "a", "a", undefined);
  assert.equal(dialect.parse("a", { tokens: [token], autoFeatures: false }).ok, true, "the document was read instead");
});

test("a precompiled test the reader would refuse is a miss, and the document is read instead", () => {
  const bootstrapHash = loadDialectSources(sources, "p.md").loader.bootstrapHash;
  const text = "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A=\"a\"\n```\n";
  const hash = fnv1a64(text);
  const token = new Token(new Set(["A"]), [0, 1], [0, 1], "a", "a", undefined);
  const fresh = loadDialectSources({ ...sources, "g.md": text }, "p.md").parse("a", { tokens: [token], autoFeatures: false });
  const value = { string: "a" };
  for (const expr of [
    { test: "=", value: { string: "a,b" }, expr: { ref: "A" } },
    { test: "=", value: { tag: "A" }, expr: { ref: "A" } },
    { test: "⊇", value, expr: { ref: "A" } },
    { test: "=", value, expr: { empty: true, ref: "A" } },
    { test: "=", value, expr: { ref: "A", terminal: "A" } },
    { test: "=", value, expr: { ref: "A" }, empty: true },
    { capture: "x", test: "=", value, expr: { ref: "A" } },
    { seq: [{ ref: "A" }, { ref: "A" }], test: "=", value, expr: { ref: "A" } },
  ]) {
    const dom = { format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr }], conditions: [], at: [3, 1] }], directives: [{ name: "ambiguity-resolution", args: ["greedy"], at: [2, 1] }], constants: [], classifiers: [], implications: [] };
    const compiled = JSON.stringify({ format: DOM_FORMAT, bootstrap: bootstrapHash, documents: { "g.md": { hash, dom } } });
    const dialect = loadDialectSources({ ...sources, "g.md": text, "compiled.json": compiled }, "p.md");
    assert.equal(dialect.loader.compiled.size, 0, `the entry was refused: ${JSON.stringify(expr)}`);
    assert.deepEqual(dialect.parse("a", { tokens: [token], autoFeatures: false }), fresh, "the document was read instead");
  }
});

test("a bootstrap test the reader would refuse is a grammar error", () => {
  // Test the first plain reference of the bootstrap.
  const wrap = (tested) => {
    const bootstrap = JSON.parse(read("notation/bootstrap.json"));
    const pending = [bootstrap];
    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
      if (node === null || typeof node !== "object") continue;
      for (const [key, value] of Object.entries(node)) {
        if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 && typeof value.ref === "string" && value.ref !== "#") {
          node[key] = tested(value);
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
  const value = { string: "a" };
  assert.equal(refused(wrap((ref) => ({ test: "=", value, expr: ref }))), false);
  for (const tested of [(ref) => ({ test: "=", value: { string: "a,b" }, expr: ref }), (ref) => ({ test: "=", value, expr: { ...ref, empty: true } }),
    (ref) => ({ seq: [ref, ref], test: "=", value, expr: ref })]) {
    assert.equal(refused(wrap(tested)), true);
  }
});

// Terms that join the members of two forms. Each must be refused whatever
// the order of its members, so that no library reads one form where
// another reads the other.
const mixedTerms = [
  { tag: "Bad", string: "wrong" },
  { string: "wrong", tag: "Bad" },
  { tag: "!", string: "a" },
  { string: "a", tag: "!" },
];
const mixedDifferences = [
  { difference: [{ tag: "B" }, { tag: "C" }], union: [{ tag: "B" }, { tag: "C" }] },
  { union: [{ tag: "B" }, { tag: "C" }], difference: [{ tag: "B" }, { tag: "C" }] },
  { difference: [{ tag: "B" }, { tag: "C" }], intersection: [{ tag: "B" }, { tag: "C" }] },
  { difference: [{ tag: "B" }, { tag: "C" }], tag: "B" },
  { tag: "B", difference: [{ tag: "B" }, { tag: "C" }] },
  { difference: [{ tag: "B" }] },
  { difference: [{ tag: "B" }, { tag: "C" }, { tag: "D" }] },
];

test("a precompiled term that joins two forms is a miss, and the document is read instead", () => {
  const bootstrapHash = loadDialectSources(sources, "p.md").loader.bootstrapHash;
  const text = "```jbogenbau\n%ambiguity-resolution greedy\n%rule text $x(A) <B ∖ C>\n%conditions text($x) = \"ok\"\n```\n";
  const hash = fnv1a64(text);
  const token = new Token(new Set(["A"]), [0, 1], [0, 2], "ok", null, undefined);
  const fresh = loadDialectSources({ ...sources, "g.md": text }, "p.md").parse("ok", { tokens: [token], autoFeatures: false });
  assert.equal(fresh.ok, true);
  const read = loadDialectSources({ ...sources, "g.md": text }, "p.md").loader.readDocument(text, "g.md");
  /** @type {[string, (dom: any, term: unknown) => void, unknown[]][]} */
  const places = [
    ["the operand of a condition", (dom, term) => { dom.rules[0].conditions[0].right = term; }, mixedTerms],
    ["an alternative's tags", (dom, term) => { dom.rules[0].alternatives[0].tags = term; }, [...mixedTerms.filter((term) => term.tag !== "Bad"), ...mixedDifferences]],
  ];
  for (const [place, change, terms] of places) {
    for (const term of terms) {
      const dom = structuredClone(read);
      change(dom, term);
      assert.equal(domProblem(dom), "a malformed term", `${place}: ${JSON.stringify(term)}`);
      const compiled = JSON.stringify({ format: DOM_FORMAT, bootstrap: bootstrapHash, documents: { "g.md": { hash, dom } } });
      const dialect = loadDialectSources({ ...sources, "g.md": text, "compiled.json": compiled }, "p.md");
      assert.equal(dialect.loader.compiled.size, 0, `the entry was refused: ${JSON.stringify(term)}`);
      assert.deepEqual(dialect.parse("ok", { tokens: [token], autoFeatures: false }), fresh, "the document was read instead");
    }
  }
});

test("a bootstrap term that joins two forms is a grammar error", () => {
  // Give the first alternative of the bootstrap a tag term.
  const tagged = (term) => {
    const bootstrap = JSON.parse(read("notation/bootstrap.json"));
    bootstrap.stages[0].documents[0].dom.rules[0].alternatives[0].tags = term;
    return JSON.stringify(bootstrap);
  };
  const refused = (bootstrap) => {
    try {
      loadDialectSources({ ...sources, "notation/bootstrap.json": bootstrap }, "p.md");
    } catch (error) {
      assert.ok(error instanceof GencmuError, String(error));
      return error.where.document === "notation/bootstrap.json";
    }
    return false;
  };
  assert.equal(refused(tagged({ tag: "B" })), false);
  assert.equal(refused(tagged({ difference: [{ tag: "B" }, { tag: "C" }] })), false);
  for (const term of [...mixedTerms.slice(2), ...mixedDifferences]) assert.equal(refused(tagged(term)), true, JSON.stringify(term));
});

test("a precompiled range or property is checked as the reader checks it (engine §9)", () => {
  const rule = (expr, tags) => ({ format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr, ...(tags ? { tags } : {}) }], conditions: [], at: [1, 1] }], directives: [], constants: [], classifiers: [], implications: [] });
  // Well formed: a range, a property, each captured, and a range in a term.
  assert.equal(domProblem(rule({ range: ["'a'", "'z'"] })), null);
  assert.equal(domProblem(rule({ property: "White_Space" })), null);
  // A range or a property is a terminal, and takes a test (engine §2).
  assert.equal(domProblem(rule({ test: "=", value: { string: "a" }, expr: { range: ["'a'", "'z'"] } })), null);
  assert.equal(domProblem(rule({ test: "∩≠∅", value: { tag: "'a'" }, expr: { property: "L" } })), null);
  assert.equal(domProblem(rule({ seq: [{ capture: "c", expr: { range: ["'\\u{300}'", "'\\u{36F}'"] } }, { capture: "d", expr: { property: "Cs" } }] })), null);
  assert.equal(domProblem(rule({ ref: "A" }, { union: [{ range: ["'a'", "'c'"] }, { tag: "'x'" }] })), null);
  for (const [expr, tags] of [
    [{ range: ["'z'", "'a'"] }],
    [{ range: ["'a'"] }],
    [{ range: ["'\\u{61}'", "'z'"] }],
    [{ range: ["A", "'z'"] }],
    [{ range: ["'a'", "'z'"], terminal: "A" }],
    [{ property: "Letter" }],
    [{ property: "lu" }],
    [{ property: "L", range: ["'a'", "'z'"] }],
    [{ test: "⊇", value: { tag: "'a'" }, expr: { range: ["'z'", "'a'"] } }],
    [{ test: "=", value: { string: "a" }, expr: { property: "Letter" } }],
    [{ ref: "A" }, { property: "L" }],
    [{ ref: "A" }, { range: ["'z'", "'a'"] }],
  ]) {
    assert.notEqual(domProblem(rule(expr, tags)), null, JSON.stringify([expr, tags]));
  }
  // An inserted range or property is not one tag.
  const inserted = rule({ ref: "A" });
  inserted.rules[0].emit = { items: [{ insert: "'a'..'z'" }] };
  assert.notEqual(domProblem(inserted), null);
});

// Malformed range and property nodes, as changes to a DOM whose first
// alternative is a sequence of a range and a property. Each is one that the
// reader would refuse (engine §9).
const malformedCharacterClasses = [
  ["a reversed range", (dom) => { dom.rules[0].alternatives[0].expr.seq[0].range = ["'z'", "'a'"]; }],
  ["a range with an end not in its canonical spelling", (dom) => { dom.rules[0].alternatives[0].expr.seq[0].range = ["'\\u{61}'", "'z'"]; }],
  ["an unknown property", (dom) => { dom.rules[0].alternatives[0].expr.seq[1].property = "Bogus"; }],
  ["a property in a term", (dom) => { dom.rules[0].alternatives[0].tags = { property: "L" }; }],
  ["a reversed range beside a sequence", (dom) => { dom.rules[0].alternatives[0].expr.range = ["'z'", "'a'"]; }],
  ["a range beside a sequence", (dom) => { dom.rules[0].alternatives[0].expr.range = ["'a'", "'z'"]; }],
  ["an unknown property beside a sequence", (dom) => { dom.rules[0].alternatives[0].expr.property = "Bogus"; }],
  ["a property beside a sequence", (dom) => { dom.rules[0].alternatives[0].expr.property = "L"; }],
];

test("a precompiled malformed range or property is a miss, and the document is read instead", () => {
  const text = "```jbogenbau\n%ambiguity-resolution greedy\n%rule text 'a'..'z' '\\p{L}'\n```\n";
  const hash = fnv1a64(text);
  const loaded = loadDialectSources({ ...sources, "g.md": text }, "p.md");
  const bootstrapHash = loaded.loader.bootstrapHash;
  const fresh = loaded.parse("ab", { autoFeatures: false });
  assert.equal(fresh.ok, true);
  const read = loaded.loader.readDocument(text, "g.md");
  for (const [name, change] of malformedCharacterClasses) {
    const dom = structuredClone(read);
    change(dom);
    assert.notEqual(domProblem(dom, loaded.loader.unicode), null, name);
    const compiled = JSON.stringify({ format: DOM_FORMAT, bootstrap: bootstrapHash, documents: { "g.md": { hash, dom } } });
    const dialect = loadDialectSources({ ...sources, "g.md": text, "compiled.json": compiled }, "p.md");
    assert.equal(dialect.loader.compiled.size, 0, `the entry was refused: ${name}`);
    assert.deepEqual(dialect.parse("ab", { autoFeatures: false }), fresh, `the document was read instead: ${name}`);
  }
  // The entry unchanged is used.
  const compiled = JSON.stringify({ format: DOM_FORMAT, bootstrap: bootstrapHash, documents: { "g.md": { hash, dom: read } } });
  assert.equal(loadDialectSources({ ...sources, "g.md": text, "compiled.json": compiled }, "p.md").loader.compiled.size, 1);
});

test("a bootstrap with a malformed range or property is a grammar error", () => {
  // Put a rule of the shape above first in the bootstrap's first document.
  const withRule = (change) => {
    const bootstrap = JSON.parse(read("notation/bootstrap.json"));
    const dom = bootstrap.stages[0].documents[0].dom;
    const rule = { name: "unused-rule", op: "define", alternatives: [{ guards: [], expr: { seq: [{ range: ["'a'", "'z'"] }, { property: "L" }] } }], conditions: [], at: [100000, 1] };
    const probe = { rules: [rule] };
    if (change) change(probe);
    dom.rules.unshift(rule);
    return JSON.stringify(bootstrap);
  };
  const refused = (bootstrap) => {
    try {
      loadDialectSources({ ...sources, "notation/bootstrap.json": bootstrap }, "p.md");
    } catch (error) {
      assert.ok(error instanceof GencmuError, String(error));
      return error.where.document === "notation/bootstrap.json";
    }
    return false;
  };
  assert.equal(refused(withRule(null)), false);
  for (const [name, change] of malformedCharacterClasses) assert.equal(refused(withRule(change)), true, name);
});

// Expressions and conditions that join the members of two forms, or that
// hold a value of the wrong kind, as changes to a DOM of `$x(A) B` with
// the condition `text($x) = "ok"`. Each must be refused whatever the order
// of its members, so that no library reads one form where another reads
// the other (docs/output.md).
const mixedForms = [
  ["empty with a terminal", (rule) => { rule.alternatives[0].expr.seq[1] = { empty: true, terminal: "B" }; }],
  ["a terminal with empty", (rule) => { rule.alternatives[0].expr.seq[1] = { terminal: "B", empty: true }; }],
  ["a choice with a sequence", (rule) => { rule.alternatives[0].expr.seq[1] = { choice: [{ ref: "B" }, { ref: "C" }], seq: [{ ref: "C" }, { ref: "C" }] }; }],
  ["a sequence with a choice", (rule) => { rule.alternatives[0].expr.seq[1] = { seq: [{ ref: "C" }, { ref: "C" }], choice: [{ ref: "B" }, { ref: "C" }] }; }],
  ["a choice with a sequence of a bad reference", (rule) => { rule.alternatives[0].expr.seq[1] = { choice: [{ ref: "B" }, { ref: "C" }], seq: [{ ref: 5 }, { ref: "C" }] }; }],
  ["a repetition with an optional", (rule) => { rule.alternatives[0].expr.seq[1] = { repeat: { ref: "B" }, min: 1, optional: { ref: "C" } }; }],
  ["an optional with a repetition", (rule) => { rule.alternatives[0].expr.seq[1] = { optional: { ref: "C" }, repeat: { ref: "B" }, min: 1 }; }],
  ["a repetition with an optional of a bad reference", (rule) => { rule.alternatives[0].expr.seq[1] = { repeat: { ref: "B" }, min: 1, optional: { ref: ["x"] } }; }],
  ["a reference that is not a name", (rule) => { rule.alternatives[0].expr.seq[1] = { ref: "x y" }; }],
  ["a top-level sequence with a choice", (rule) => { rule.alternatives[0].expr.choice = [{ ref: "B" }, { ref: "C" }]; }],
  ["a captured terminal not in its canonical spelling", (rule) => { rule.alternatives[0].expr.seq[0].expr = { terminal: "'ab'" }; }],
  ["a captured reference with a terminal", (rule) => { rule.alternatives[0].expr.seq[0].expr = { ref: "A", terminal: "A" }; }],
  ["a captured terminal with a reference", (rule) => { rule.alternatives[0].expr.seq[0].expr = { terminal: "A", ref: "A" }; }],
  ["a captured reference that is not a name", (rule) => { rule.alternatives[0].expr.seq[0].expr = { ref: "x y" }; }],
  ["a capture with a reference", (rule) => { rule.alternatives[0].expr.seq[0].ref = "B"; }],
  ["a comparison with a negation", (rule) => { rule.conditions[0].not = { captured: "x" }; }],
  ["a negation with a comparison", (rule) => { rule.conditions[0] = { not: { captured: "x" }, ...rule.conditions[0] }; }],
  ["a presence test with a comparison", (rule) => { rule.conditions[0] = { captured: "x", ...rule.conditions[0] }; }],
  ["a comparison with a match", (rule) => { rule.conditions[0].matches = { capture: "x" }; }],
  ["a match with a rule and another member", (rule) => { rule.conditions[0] = { matches: { capture: "x" }, rule: "text", initial: { capture: "x" } }; }],
  ["an emission with another member", (rule) => { rule.emit = { items: [{ capture: "x" }], extra: true }; }],
  ["another member with an emission", (rule) => { rule.emit = { extra: true, items: [{ capture: "x" }] }; }],
];

test("a precompiled node that joins two forms is a miss, and the document is read instead", () => {
  const text = "```jbogenbau\n%ambiguity-resolution greedy\n%rule text $x(A) B\n%conditions text($x) = \"ok\"\n```\n";
  const hash = fnv1a64(text);
  const loaded = loadDialectSources({ ...sources, "g.md": text }, "p.md");
  const bootstrapHash = loaded.loader.bootstrapHash;
  const tokens = [new Token(new Set(["A"]), [0, 1], [0, 2], "ok", null, undefined), new Token(new Set(["B"]), [1, 2], [3, 4], "b", null, undefined)];
  const fresh = loaded.parse("ok b", { tokens, autoFeatures: false });
  assert.equal(fresh.ok, true);
  const read = loaded.loader.readDocument(text, "g.md");
  for (const [name, change] of mixedForms) {
    const dom = structuredClone(read);
    change(dom.rules[0]);
    assert.notEqual(domProblem(dom, loaded.loader.unicode), null, name);
    const compiled = JSON.stringify({ format: DOM_FORMAT, bootstrap: bootstrapHash, documents: { "g.md": { hash, dom } } });
    const dialect = loadDialectSources({ ...sources, "g.md": text, "compiled.json": compiled }, "p.md");
    assert.equal(dialect.loader.compiled.size, 0, `the entry was refused: ${name}`);
    assert.deepEqual(dialect.parse("ok b", { tokens, autoFeatures: false }), fresh, `the document was read instead: ${name}`);
  }
  // The entry unchanged is used.
  const compiled = JSON.stringify({ format: DOM_FORMAT, bootstrap: bootstrapHash, documents: { "g.md": { hash, dom: read } } });
  assert.equal(loadDialectSources({ ...sources, "g.md": text, "compiled.json": compiled }, "p.md").loader.compiled.size, 1);
});

test("a bootstrap node that joins two forms is a grammar error", () => {
  // Put a rule of the shape above first in the bootstrap's first document.
  const withRule = (change) => {
    const bootstrap = JSON.parse(read("notation/bootstrap.json"));
    const rule = { name: "unused-rule", op: "define", alternatives: [{ guards: [], expr: { seq: [{ capture: "x", expr: { ref: "A" } }, { ref: "B" }] } }],
      conditions: [{ op: "=", left: { call: "text", args: [{ capture: "x" }] }, right: { string: "ok" } }], at: [100000, 1] };
    if (change) change(rule);
    bootstrap.stages[0].documents[0].dom.rules.unshift(rule);
    return JSON.stringify(bootstrap);
  };
  const refused = (bootstrap) => {
    try {
      loadDialectSources({ ...sources, "notation/bootstrap.json": bootstrap }, "p.md");
    } catch (error) {
      assert.ok(error instanceof GencmuError, String(error));
      return error.where.document === "notation/bootstrap.json";
    }
    return false;
  };
  assert.equal(refused(withRule(null)), false);
  for (const [name, change] of mixedForms) assert.equal(refused(withRule(change)), true, name);
});

test("a precompiled constant is checked as the reader checks it (engine §2, §9)", () => {
  const text = (constants, conditions = []) => ({ format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr: { ref: "A" } }], conditions, at: [9, 1] }], directives: [], constants, classifiers: [], implications: [] });
  const constant = (value, extra = {}) => ({ name: "K", op: "define", value, at: [1, 1], ...extra });
  assert.equal(domProblem(text([constant({ tag: "a" })])), null);
  assert.equal(domProblem(text([constant({ string: "." }), constant({ call: "split", args: [{ string: "a.b" }, { const: "K", at: [2, 20] }] }, { name: "S", at: [2, 1] })])), null);
  assert.equal(domProblem(text([constant({ emptySet: true }, { op: "redefine" })])), null);
  assert.equal(domProblem({ format: DOM_FORMAT, rules: [], directives: [] }), `not a DOM of format ${DOM_FORMAT}`);
  assert.equal(domProblem(text([constant({ tag: "a" }, { name: "k" })])), "a malformed constant");
  assert.equal(domProblem(text([constant({ tag: "a" }, { op: "extend" })])), "a malformed constant");
  assert.equal(domProblem(text([constant({ tag: "a" }, { at: null })])), "a malformed constant");
  assert.equal(domProblem(text([constant({ tag: "a" }, { extra: true })])), "a malformed constant");
  assert.equal(domProblem(text([constant({ capture: "x" })])), "a constant's value is not a closed term");
  assert.equal(domProblem(text([constant({ call: "phonemes", args: [{ capture: "x" }] })])), "a constant's value is not a closed term");
  assert.equal(domProblem(text([constant({ if: { captured: "x" }, then: { tag: "a" } })])), "a constant's value is not a closed term");
  assert.match(String(domProblem(text([constant({ emptySet: true })]))), /not given/);
  assert.match(String(domProblem(text([constant({ union: [{ string: "a" }, { tag: "b" }] })]))), /joins sets/);
  assert.equal(domProblem(text([constant({ call: "split", args: [{ string: "a" }, { string: "" }] })])), "split has an empty delimiter");
  // A reference to a constant has a name with a capital and a position.
  const condition = (right) => text([], [{ op: "⊆", left: { tag: "a" }, right }]);
  assert.equal(domProblem(condition({ const: "K", at: [9, 20] })), null);
  assert.equal(domProblem(condition({ const: "k", at: [9, 20] })), "a malformed term");
  assert.equal(domProblem(condition({ const: "K" })), "a malformed term");
  assert.equal(domProblem(condition({ const: "K", at: [9, 20], value: { set: [] } })), "a malformed term");
  // The reader cannot know a constant's type, so it fits any value.
  assert.equal(domProblem(text([], [{ op: "∈", left: { const: "S", at: [9, 20] }, right: { const: "T", at: [9, 30] } }])), null);
  assert.match(String(domProblem(text([], [{ op: "∈", left: { tag: "a" }, right: { const: "T", at: [9, 30] } }]))), /tests a string/);
  // Two items at one position, a constant among them.
  assert.equal(domProblem(text([constant({ tag: "a" }, { at: [9, 1] })])), "two items at one position");
});

const constantSources = {
  "p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n",
  "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%const $K ~a ∪ B\n%rule text A <$K>\n```\n",
};

test("a precompiled DOM with a constant serves the parse as the document does (engine §2, §8)", () => {
  const fresh = loadDialectSources(constantSources, "p.md");
  const bootstrapHash = fresh.loader.bootstrapHash;
  const dom = fresh.loader.documentDom("g.md");
  assert.deepEqual(dom.constants, [{ name: "K", op: "define", value: { union: [{ tag: "a" }, { tag: "B" }] }, at: [3, 1] }]);
  const token = new Token(new Set(["A"]), [0, 1], [0, 1], "a", null, undefined);
  const expected = fresh.parse("a", { tokens: [token], autoFeatures: false });
  assert.deepEqual([...expected.tree.tags].sort(), ["B", "a"]);
  const compiled = (entry) => JSON.stringify({ format: DOM_FORMAT, bootstrap: bootstrapHash, documents: { "g.md": { hash: fnv1a64(constantSources["g.md"]), dom: entry } } });
  // A hit: the cached DOM holds the constant, and the loader resolves it.
  const cached = loadDialectSources({ ...constantSources, "compiled.json": compiled(dom) }, "p.md");
  assert.equal(cached.loader.compiled.size, 1);
  assert.deepEqual(cached.parse("a", { tokens: [token], autoFeatures: false }), expected);
  // A miss: a cached DOM that holds a value where a reference stands, or a
  // malformed definition, is refused, and the document is read instead.
  for (const bad of [
    { ...dom, rules: [{ ...dom.rules[0], alternatives: [{ ...dom.rules[0].alternatives[0], tags: { const: "K", at: [4, 15], value: { set: ["a"] } } }] }] },
    { ...dom, constants: [{ ...dom.constants[0], value: { capture: "x" } }] },
    { ...dom, constants: undefined },
  ]) {
    const missed = loadDialectSources({ ...constantSources, "compiled.json": compiled(bad) }, "p.md");
    assert.equal(missed.loader.compiled.size, 0);
    assert.deepEqual(missed.parse("a", { tokens: [token], autoFeatures: false }), expected);
  }
});

test("a bootstrap with a malformed constant is a grammar error", () => {
  const bootstrap = JSON.parse(read("notation/bootstrap.json"));
  bootstrap.stages[0].documents[0].dom.constants.push({ name: "k", op: "define", value: { tag: "a" }, at: [1, 1] });
  assert.throws(() => loadDialectSources({ ...constantSources, "notation/bootstrap.json": JSON.stringify(bootstrap) }, "p.md"),
    (error) => error instanceof GencmuError && error.kind === "grammar" && /malformed constant/.test(error.message));
});

/**
 * A constant's value nested far deeper than any stack, as JSON text: a
 * walk that recursed before the bound on nesting would overflow.
 * @param {number} depth
 * @returns {string}
 */
const deepValueJson = (depth) => '{"union":['.repeat(depth) + '{"tag":"a"}' + ',{"tag":"B"}]}'.repeat(depth);

test("a precompiled constant nested too deeply is a miss before any walk recurses (engine §9)", () => {
  const fresh = loadDialectSources(constantSources, "p.md");
  const dom = fresh.loader.documentDom("g.md");
  const deep = JSON.stringify({ ...dom, constants: [{ ...dom.constants[0], value: "@VALUE@" }] }).replace('"@VALUE@"', deepValueJson(200000));
  const compiled = `{"format":${DOM_FORMAT},"bootstrap":"${fresh.loader.bootstrapHash}","documents":{"g.md":{"hash":"${fnv1a64(constantSources["g.md"])}","dom":${deep}}}}`;
  const missed = loadDialectSources({ ...constantSources, "compiled.json": compiled }, "p.md");
  assert.equal(missed.loader.compiled.size, 0);
  const token = new Token(new Set(["A"]), [0, 1], [0, 1], "a", null, undefined);
  assert.deepEqual(missed.parse("a", { tokens: [token], autoFeatures: false }), fresh.parse("a", { tokens: [token], autoFeatures: false }));
});

test("a bootstrap constant nested too deeply is a grammar error before any walk recurses (engine §9)", () => {
  const bootstrap = JSON.parse(read("notation/bootstrap.json"));
  bootstrap.stages[0].documents[0].dom.constants.push({ name: "K", op: "define", value: "@VALUE@", at: [99999, 1] });
  const text = JSON.stringify(bootstrap).replace('"@VALUE@"', deepValueJson(200000));
  assert.throws(() => loadDialectSources({ ...constantSources, "notation/bootstrap.json": text }, "p.md"),
    (error) => error instanceof GencmuError && error.kind === "grammar" && /nested too deeply/.test(error.message));
});

test("a cached DOM whose capture checks wait for a constant's value is used, and the loader makes them (engine §3.6, §9)", () => {
  const grammar = (first, last) => "```jbogenbau\n%ambiguity-resolution greedy\n%const $E " + first + "\n%rule text A | $x(A)\n%tags Y ∪ ($E ∩ tags($x))\n%redefine-const $E " + last + "\n```\n";
  const token = new Token(new Set(["A"]), [0, 1], [0, 1], "a", null, undefined);
  for (const [first, last, empty] of [["B", "$E ∖ B", true], ["B ∖ B", "B", false]]) {
    const document = grammar(first, last);
    const documentSources = { ...constantSources, "g.md": document };
    const reader = loadDialectSources(constantSources, "p.md").loader;
    const dom = reader.readDocument(document, "g.md");
    assert.equal(domProblem(dom), null);
    const compiled = JSON.stringify({ format: DOM_FORMAT, bootstrap: reader.bootstrapHash, documents: { "g.md": { hash: fnv1a64(document), dom } } });
    for (const sources of [documentSources, { ...documentSources, "compiled.json": compiled }]) {
      if (empty) {
        const dialect = loadDialectSources(sources, "p.md");
        assert.equal(dialect.loader.compiled.has("g.md"), "compiled.json" in sources);
        assert.deepEqual([...dialect.parse("a", { tokens: [token], autoFeatures: false }).tree.tags], ["Y"]);
      } else {
        assert.throws(() => loadDialectSources(sources, "p.md"),
          (error) => error instanceof GencmuError && error.where.line === 4 && error.where.column === 1 && /uses \$x, which an alternative lacks/.test(error.message));
      }
    }
  }
});

test("a precompiled classifier and implication are checked as the reader checks them (engine §9)", () => {
  const dom = (classifiers, implications = []) => ({ format: DOM_FORMAT, rules: [], directives: [], constants: [], classifiers, implications });
  const entry = (extra = {}) => ({ guards: [], keys: ["mi"], op: "∈", class: "KOhA", at: [3, 3], ...extra });
  const classifier = (entries, extra = {}) => ({ name: "lex", entries, at: [2, 1], ...extra });
  assert.equal(domProblem(dom([classifier([entry(), entry({ guards: [{ feature: "f", kind: "gate", negated: true }], op: "∉", at: [4, 3] })])])), null);
  assert.equal(domProblem(dom([classifier([])])), null);
  assert.equal(domProblem({ format: DOM_FORMAT, rules: [], directives: [], constants: [] }), `not a DOM of format ${DOM_FORMAT}`);
  for (const bad of [
    classifier([], { name: "Lex" }), classifier([], { at: null }), classifier([], { extra: true }),
    classifier([entry({ guards: [{ feature: "f", kind: "warning", negated: false }] })]),
    classifier([entry({ keys: [] })]), classifier([entry({ keys: ["Mi"] })]), classifier([entry({ keys: ["m,i"] })]), classifier([entry({ keys: [1] })]),
    classifier([entry({ op: "=" })]), classifier([entry({ class: "koha" })]), classifier([entry({ class: "/a/" })]), classifier([entry({ extra: true })]),
  ]) {
    assert.equal(domProblem(dom([bad])), bad.name === "lex" && bad.at && !bad.extra ? "a malformed entry of a classifier" : "a malformed classifier", JSON.stringify(bad));
  }
  const implication = (extra = {}) => ({ if: { tag: "UI" }, then: { tag: "indicator" }, at: [5, 1], ...extra });
  assert.equal(domProblem(dom([], [implication({ if: { union: [{ tag: "UI" }, { const: "K", at: [5, 15] }] } })])), null);
  assert.equal(domProblem(dom([], [implication({ at: null })])), "a malformed implication");
  assert.equal(domProblem(dom([], [implication({ extra: true })])), "a malformed implication");
  assert.equal(domProblem(dom([], [implication({ then: { capture: "x" } })])), "a side of an implication is not a closed term");
  assert.equal(domProblem(dom([], [implication({ if: { call: "classify", args: [{ string: "mi" }, { classifier: "lex" }] } })])), "a side of an implication is not a closed term");
  assert.match(String(domProblem(dom([], [implication({ then: { string: "a" } })]))), /a side of an implication is a tag set/);
  // A call of classify names a classifier as its second argument.
  const call = (args) => ({ format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr: { capture: "w", expr: { ref: "W" } }, tags: { call: "classify", args } }], conditions: [], at: [1, 1] }], directives: [], constants: [], classifiers: [], implications: [] });
  assert.equal(domProblem(call([{ call: "phonemes", args: [{ capture: "w" }] }, { classifier: "lex" }])), null);
  assert.equal(domProblem(call([{ call: "phonemes", args: [{ capture: "w" }] }, { rule: "lex" }])), "a malformed term");
  assert.equal(domProblem(call([{ call: "phonemes", args: [{ capture: "w" }] }, { classifier: "Lex" }])), "a malformed term");
  assert.equal(domProblem(call([{ capture: "w" }, { classifier: "lex" }])), "a malformed term");
  // Two items at one position, a classifier and an implication among them.
  assert.equal(domProblem(dom([classifier([])], [implication({ at: [2, 1] })])), "two items at one position");
});

test("a bootstrap with a malformed classifier is a grammar error", () => {
  const bootstrap = JSON.parse(read("notation/bootstrap.json"));
  bootstrap.stages[0].documents[0].dom.classifiers.push({ name: "lex", entries: [{ guards: [], keys: ["Mi"], op: "∈", class: "KOhA", at: [9999, 3] }], at: [9999, 1] });
  assert.throws(() => loadDialectSources({ ...constantSources, "notation/bootstrap.json": JSON.stringify(bootstrap) }, "p.md"),
    (error) => error instanceof GencmuError && error.kind === "grammar" && /malformed entry of a classifier/.test(error.message));
});

// A term of each function that takes a value, with a classifier's name in
// one of its argument slots, as a condition of the rule `text`.
const misplacedClassifiers = [
  { op: "⊆", left: { call: "tag", args: [{ classifier: "lex" }] }, right: { tag: "a" } },
  { op: "∈", left: { string: "a" }, right: { call: "split", args: [{ classifier: "lex" }, { string: "." }] } },
  { op: "∈", left: { string: "a" }, right: { call: "split", args: [{ string: "a.b" }, { classifier: "lex" }] } },
];

test("a classifier's name stands only as the second argument of classify (engine §9)", () => {
  const bootstrapHash = loadDialectSources(sources, "p.md").loader.bootstrapHash;
  const hash = fnv1a64(sources["g.md"]);
  const token = new Token(new Set(["A"]), [0, 1], [0, 1], "a", null, undefined);
  const rule = (conditions, name = "text", at = [3, 1]) => ({ name, op: "define", alternatives: [{ guards: [], expr: { capture: "x", expr: { ref: "A" } } }], conditions, at });
  const dom = (conditions) => ({ format: DOM_FORMAT, rules: [rule(conditions)], directives: [{ name: "ambiguity-resolution", args: ["greedy"], at: [2, 1] }], constants: [],
    classifiers: [{ name: "lex", entries: [], at: [4, 1] }], implications: [] });
  // The same condition with plain strings is well formed.
  assert.equal(domProblem(dom([{ op: "∈", left: { string: "a" }, right: { call: "split", args: [{ string: "a.b" }, { string: "." }] } }])), null);
  for (const condition of misplacedClassifiers) {
    const label = JSON.stringify(condition);
    assert.equal(domProblem(dom([condition])), "a malformed term", label);
    // A cached entry is a miss, and the document is read instead.
    const compiled = JSON.stringify({ format: DOM_FORMAT, bootstrap: bootstrapHash, documents: { "g.md": { hash, dom: dom([condition]) } } });
    const dialect = loadDialectSources({ ...sources, "compiled.json": compiled }, "p.md");
    assert.equal(dialect.loader.compiled.size, 0, `the entry was refused: ${label}`);
    assert.equal(dialect.parse("a", { tokens: [token], autoFeatures: false }).ok, true, `the document was read instead: ${label}`);
    // The bootstrap is an error of the grammar.
    const bootstrap = JSON.parse(read("notation/bootstrap.json"));
    bootstrap.stages[0].documents[0].dom.rules.push(rule([condition], "misplaced-classifier", [9999, 1]));
    assert.throws(() => loadDialectSources({ ...sources, "notation/bootstrap.json": JSON.stringify(bootstrap) }, "p.md"),
      (error) => error instanceof GencmuError && error.kind === "grammar" && /a malformed term/.test(error.message), label);
  }
});

test("a gate of a classifier's entry names a feature (engine §9)", () => {
  const bootstrapHash = loadDialectSources(sources, "p.md").loader.bootstrapHash;
  const hash = fnv1a64(sources["g.md"]);
  const classifier = (feature, at = [4, 1]) => ({ name: "lex", entries: [{ guards: [{ feature, kind: "gate", negated: false }], keys: ["mi"], op: "∈", class: "KOhA", at: [at[0], 3] }], at });
  const dom = (feature) => ({ format: DOM_FORMAT, rules: [{ name: "text", op: "define", alternatives: [{ guards: [], expr: { ref: "A" } }], conditions: [], at: [3, 1] }],
    directives: [{ name: "ambiguity-resolution", args: ["greedy"], at: [2, 1] }], constants: [], classifiers: [classifier(feature)], implications: [] });
  const cached = (feature) => loadDialectSources({ ...sources, "compiled.json": JSON.stringify({ format: DOM_FORMAT, bootstrap: bootstrapHash, documents: { "g.md": { hash, dom: dom(feature) } } }) }, "p.md");
  // The control: a well-formed entry is used, and its gate is a feature.
  assert.equal(domProblem(dom("f")), null);
  assert.deepEqual(cached("f").features.map((feature) => feature.name), ["f"]);
  for (const feature of ["", "!", "bad name"]) {
    assert.equal(domProblem(dom(feature)), "a malformed entry of a classifier", JSON.stringify(feature));
    // A cached entry is a miss: the document is read, and has no feature.
    const dialect = cached(feature);
    assert.equal(dialect.loader.compiled.size, 0, `the entry was refused: ${JSON.stringify(feature)}`);
    assert.deepEqual(dialect.features, [], JSON.stringify(feature));
    // The bootstrap is an error of the grammar.
    const bootstrap = JSON.parse(read("notation/bootstrap.json"));
    bootstrap.stages[0].documents[0].dom.classifiers.push(classifier(feature, [9999, 1]));
    assert.throws(() => loadDialectSources({ ...sources, "notation/bootstrap.json": JSON.stringify(bootstrap) }, "p.md"),
      (error) => error instanceof GencmuError && error.kind === "grammar" && /malformed entry of a classifier/.test(error.message), JSON.stringify(feature));
  }
});

test("a guard of a rule's alternative names a feature (engine §9)", () => {
  const bootstrapHash = loadDialectSources(sources, "p.md").loader.bootstrapHash;
  const hash = fnv1a64(sources["g.md"]);
  const rule = (guard, name = "text", at = [3, 1]) => ({ name, op: "define", alternatives: [{ guards: [guard], expr: { ref: "A" } }], conditions: [], at });
  const dom = (guard) => ({ format: DOM_FORMAT, rules: [rule(guard)], directives: [{ name: "ambiguity-resolution", args: ["greedy"], at: [2, 1] }], constants: [], classifiers: [], implications: [] });
  const cached = (guard) => loadDialectSources({ ...sources, "compiled.json": JSON.stringify({ format: DOM_FORMAT, bootstrap: bootstrapHash, documents: { "g.md": { hash, dom: dom(guard) } } }) }, "p.md");
  for (const kind of ["gate", "warning"]) {
    const guard = (feature) => ({ feature, kind, negated: false });
    // The control: a well-formed guard is used, and its feature is the dialect's.
    assert.equal(domProblem(dom(guard("f"))), null);
    assert.deepEqual(cached(guard("f")).features.map((feature) => [feature.name, feature.kind]), [["f", kind]]);
    for (const feature of ["", "!", "bad name"]) {
      const label = `${kind} ${JSON.stringify(feature)}`;
      assert.equal(domProblem(dom(guard(feature))), "a malformed alternative", label);
      // A cached entry is a miss: the document is read, and has no feature.
      const dialect = cached(guard(feature));
      assert.equal(dialect.loader.compiled.size, 0, `the entry was refused: ${label}`);
      assert.deepEqual(dialect.features, [], label);
      // The bootstrap is an error of the grammar.
      const bootstrap = JSON.parse(read("notation/bootstrap.json"));
      bootstrap.stages[0].documents[0].dom.rules.push(rule(guard(feature), "misnamed-feature", [9999, 1]));
      assert.throws(() => loadDialectSources({ ...sources, "notation/bootstrap.json": JSON.stringify(bootstrap) }, "p.md"),
        (error) => error instanceof GencmuError && error.kind === "grammar" && /malformed alternative/.test(error.message), label);
    }
  }
});
