import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repository, grammars, loaderWith, matches, readGrammarFile, sameJson } from "./shared.js";
import { GencmuError, Loader, loadDialectSources, fnv1a64 } from "../src/node.js";
import { DOM_FORMAT, domProblem } from "../src/dom.js";
import { compactJson } from "../src/output.js";
import { splicePipeline } from "../src/pipeline.js";

const loader = loaderWith({});

const directory = path.join(repository, "tests", "notation");
for (const file of fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort()) {
  const testCase = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
  test(`notation: ${file}`, () => {
    let outcome;
    try {
      outcome = { dom: loader.readDocument(testCase.document, file) };
    } catch (error) {
      if (!(error instanceof GencmuError)) throw error;
      outcome = { error: { line: error.where.line, column: error.where.column, message: error.message } };
    }
    // A DOM can nest deeper than JSON.stringify can write.
    if (!matches(testCase.expect, outcome)) assert.fail(compactJson(outcome));
  });
}

test("the notation reads its own pipeline to the bootstrap (the fixpoint)", () => {
  const bootstrap = JSON.parse(readGrammarFile("notation/bootstrap.json"));
  // Every document is read afresh with the bootstrap, never from compiled.json.
  const { stages } = splicePipeline("dialects/notation.md", (documentPath) => {
    let text;
    try {
      text = readGrammarFile(documentPath);
    } catch {
      return undefined;
    }
    return loader.readDocument(text, documentPath);
  });
  assert.deepEqual(stages.map((stage) => ({ name: stage.name, documents: stage.documents })), bootstrap.stages);
  void grammars;
});

test("the notation's lexical stage tags keywords, tag literals, character tags, properties and symbols (grammars/notation/lexical.md)", () => {
  const run = loader.notation.parse("%rule a ¬f? ~b 'c' /d/ {E ... \\ '\\\\'} | g! %tags X %rulex $e ¬h 'x'..'y' '\\p{L}' 'a'...", { features: new Set(), until: "lexical" });
  const tokens = /** @type {import("../src/tokens.js").Token[]} */ (run.stages[0].output).map((token) => [token.text, [...token.tags].sort()]);
  assert.deepEqual(tokens, [
    ["%rule", ["keyword-rule"]], ["a", ["identifier"]], ["¬f?", ["guard"]], ["~b", ["tag"]], ["'c'", ["character"]],
    ["/d/", ["phoneme"]], ["{", ["'{'"]], ["E", ["identifier"]], ["...", ["ellipsis"]], ["\\", ["'\\u{5C}'"]], ["'\\\\'", ["character"]], ["}", ["'}'"]],
    ["|", ["'|'"]], ["g!", ["guard"]],
    ["%tags", ["keyword-tags"]], ["X", ["identifier"]], ["%rulex", ["keyword"]], ["$e", ["capture"]], ["¬", ["'¬'"]], ["h", ["identifier"]],
    ["'x'", ["character"]], ["..", ["double-dot"]], ["'y'", ["character"]], ["'\\p{L}'", ["property"]], ["'a'", ["character"]], ["...", ["ellipsis"]],
  ]);
});

test("the notation's lexical stage tags constants and the keywords that define them (grammars/notation/lexical.md)", () => {
  const run = loader.notation.parse("%const $SU-STOPS %redefine-const $x $ $K1", { features: new Set(), until: "lexical" });
  const tokens = /** @type {import("../src/tokens.js").Token[]} */ (run.stages[0].output).map((token) => [token.text, [...token.tags].sort()]);
  assert.deepEqual(tokens, [
    ["%const", ["keyword-const"]], ["$SU-STOPS", ["constant"]], ["%redefine-const", ["keyword-redefine-const"]],
    ["$x", ["capture"]], ["$", ["capture"]], ["$K1", ["constant"]],
  ]);
});

test("the hand-written bootstrap reader reads constants as the notation does", async () => {
  const { readDocument } = await import("../../../tools/bootstrap-reader.js");
  const document = "```jbogenbau\n%const $A ~a ∪ B\n%const $S \".\"\n%const $T split(\"x.y\", $S)\n%redefine-const $A $A ∖ B ∪ tag(\"C\")\n" +
    "%rule text $x(C) <$A>\n%conditions phonemes($x) ∈ $T, tag($S) ⊆ $A\n```\n";
  assert.deepEqual(readDocument(document, "t.md"), loader.readDocument(document, "t.md"));
});

test("the hand-written bootstrap reader reads tests in a body as the notation does", async () => {
  const { readDocument } = await import("../../../tools/bootstrap-reader.js");
  const document = "```jbogenbau\n%const $C ~c\n%rule text $l(LE=\"la\") {UI=\"ui\" \\ A=\"a\"} [KU = \"ku\"] w≠\"\" A⊇B w⊉$C A∩(B ∪ ~c)=∅ A ∩ 'a'..'z' ≠ ∅ '\\p{L}'⊇∅ B (C)\n```\n";
  assert.deepEqual(readDocument(document, "t.md"), loader.readDocument(document, "t.md"));
  for (const refused of ["%rule text (A)=\"a\"", "%rule text A=\"a\"=\"b\"", "%rule text #=\"a\"", "%rule text A=\"A\"", "%rule text A⊇\"a\"", "%rule text A=B"]) {
    assert.throws(() => readDocument("```jbogenbau\n" + refused + "\n```\n", "t.md"), undefined, refused);
    assert.throws(() => loader.readDocument("```jbogenbau\n" + refused + "\n```\n", "t.md"), GencmuError, refused);
  }
});

test("the hand-written bootstrap reader reads braces as the notation does (engine §9)", async () => {
  const { readDocument } = await import("../../../tools/bootstrap-reader.js");
  const document = "```jbogenbau\n%rule text $a(A) {B} [{C \\ D | E}] {{F} \\ [G] {H}} {| I | J \\ | K}\n%rule l {... L \\ M}\n%rule r {N | O ...}\n" +
    "%rule s {... P} <~Q>\n```\n";
  assert.deepEqual(readDocument(document, "t.md"), loader.readDocument(document, "t.md"));
  for (const refused of ["%rule text {}", "%rule text {A \\}", "%rule text {\\ A}", "%rule text {A \\ B \\ C}", "%rule text {... A ...}", "%rule text {A \\ ... B}",
    "%rule text A ...", "%rule text 'a'...'z'", "%rule text (A \\ B)", "%rule text A {... B}", "%rule text [{... A}]", "%rule text {$a(A)}", "%rule text $a({A})", "%rule text {A}=\"a\"",
    "%rule text ({... A})", "%rule text (({A ...}))", "%rule text ({... A \\ S}) <~T>", "%rule text ((({A ... \\ S})))"]) {
    assert.throws(() => readDocument("```jbogenbau\n" + refused + "\n```\n", "t.md"), undefined, refused);
    assert.throws(() => loader.readDocument("```jbogenbau\n" + refused + "\n```\n", "t.md"), GencmuError, refused);
  }
});

test("the hand-written bootstrap reader agrees with the notation on every notation case, to the place of an error (engine §9)", async () => {
  const { readDocument } = await import("../../../tools/bootstrap-reader.js");
  /** @param {() => unknown} read */
  const outcome = (read) => {
    try {
      return { dom: read() };
    } catch (error) {
      if (!(error instanceof GencmuError)) throw error;
      return { error: { line: error.where.line, column: error.where.column } };
    }
  };
  const names = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort();
  assert.ok(names.length > 300);
  for (const name of names) {
    const testCase = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
    // A DOM can nest deeper than deepStrictEqual can compare.
    const bootstrapped = outcome(() => readDocument(testCase.document, name));
    const read = outcome(() => loader.readDocument(testCase.document, name));
    if (!sameJson(bootstrapped, read)) assert.fail(`${name}: ${compactJson(bootstrapped)} from the bootstrap reader, ${compactJson(read)} from the library`);
  }
});

test("the hand-written bootstrap reader reads every bundled document to its DOM in compiled.json", async () => {
  const { readDocument } = await import("../../../tools/bootstrap-reader.js");
  const compiled = JSON.parse(readGrammarFile("compiled.json"));
  for (const [file, entry] of Object.entries(compiled.documents)) assert.deepEqual(readDocument(readGrammarFile(file), file), entry.dom, file);
});

test("both readers read a document nested far deeper than the call stack, with the error that engine §9 orders first", async () => {
  const { readDocument } = await import("../../../tools/bootstrap-reader.js");
  /** @param {string} body @param {number} n */
  const deep = (body, n) => body.replaceAll("<", "(".repeat(n)).replaceAll(">", ")".repeat(n)).replaceAll("{", "[".repeat(n)).replaceAll("}", "]".repeat(n));
  /** @param {(document: string, file: string) => import("../src/types.js").GrammarDom} read @param {number} n */
  const check = (read, n) => {
    // Groups add no depth to the DOM, in a body, a tag term and a condition.
    for (const body of ["%rule text <A>", "%rule text A <<~a>>", '%rule text $x(A) %conditions <text($x) = "a">']) {
      assert.doesNotThrow(() => read("```jbogenbau\n" + deep(body, n) + "\n```\n", "t.md"), body);
    }
    // A later error of reading comes before the bound on nesting, and a
    // syntax error before both.
    for (const [body, line, column] of [["%rule text {A}\n%rule b $X", 3, 9], ["%rule text {A}\n%rule b )", 3, 9], ["%rule text {A}", 2, 1]]) {
      assert.throws(() => read("```jbogenbau\n" + deep(body, n) + "\n```\n", "t.md"),
        (error) => error instanceof GencmuError && error.where.line === line && error.where.column === column, body);
    }
  };
  check(readDocument, 100000);
  check((text, file) => loader.readDocument(text, file), 10000);
});

test("the hand-written bootstrap reader reports each error where the notation does, the first in the order of engine §9", async () => {
  const { readDocument } = await import("../../../tools/bootstrap-reader.js");
  // A test after a tested symbol, at the outer test; a capture of a group
  // of a group, at the capture; a capture in braces before a later syntax
  // error of a constant in a body, which is no syntax error; and syntax
  // errors that the lexical and syntax stages report at the furthest
  // character or token that they reached.
  for (const [body, line, column] of [['%rule text A="A"="b"', 2, 17], ["%rule text $x($y((A)))", 2, 12], ["%rule text {$x(A)} $A", 2, 13],
    ["%rule a ", 2, 8], ['%rule text LE="l ~t A" | ', 2, 25], ["%rule text $w(W) <ta = g(lex)>", 2, 30], ['%const $A clas = sify ∨ ("mi", lexicon)', 2, 30],
    ["%rule a [+'a'.'z']", 2, 15], ["%rule a $1", 2, 10], ["%rul a A", 2, 1], ["%rule a A %emit $", 2, 11], ['%rule a A "x', 2, 13]]) {
    const document = "```jbogenbau\n" + body + "\n```\n";
    for (const read of [readDocument, (/** @type {string} */ text, /** @type {string} */ file) => loader.readDocument(text, file)]) {
      assert.throws(() => read(document, "t.md"), (error) => error instanceof GencmuError && error.where.line === line && error.where.column === column, body);
    }
  }
});

test("the hand-written bootstrap reader reads classifiers, implications and classify as the notation does", async () => {
  const { readDocument } = await import("../../../tools/bootstrap-reader.js");
  const document = "```jbogenbau\n%classifier lex\n  \"mi\" \"do\" ∈ KOhA\n  f? ¬g? \"u'i\"\n  ∉ ~UI\n%classifier none\n" +
    "%implies UI ∪ $K ⟹ ~indicator\n%implies 'a'..'c' ⟹ ~a ∪ /a/\n%const $K CAI\n%rule text $w(W) <classify(phonemes($w), lex)>\n```\n";
  assert.deepEqual(readDocument(document, "t.md"), loader.readDocument(document, "t.md"));
  for (const refused of ['%classifier Lex "a" ∈ A', '%classifier l f! "a" ∈ A', '%classifier l "A" ∈ A', '%classifier l "a,b" ∈ A', '%classifier l "a" ∈ ~a',
    '%implies A ⟹ "a"', '%implies tags($x) ⟹ A']) {
    assert.throws(() => readDocument("```jbogenbau\n" + refused + "\n```\n", "t.md"), undefined, refused);
    assert.throws(() => loader.readDocument("```jbogenbau\n" + refused + "\n```\n", "t.md"), GencmuError, refused);
  }
});

test("the hand-written bootstrap reader reads a parenthesized rule or classifier name as the notation does (engine §9)", async () => {
  const { readDocument } = await import("../../../tools/bootstrap-reader.js");
  const document = "```jbogenbau\n%classifier lex\n%rule text $w(W) <classify(\"mi\", (lex)) ∪ classify(phonemes($w), ((lex))) ∪ tags($w, (text))>\n" +
    "%conditions matches($w, (text)), begins($w, ((text)))\n```\n";
  const read = readDocument(document, "t.md");
  assert.deepEqual(read, loader.readDocument(document, "t.md"));
  assert.deepEqual(read.rules[0].alternatives[0].tags.union[0], { call: "classify", args: [{ string: "mi" }, { classifier: "lex" }] });
  for (const refused of ['%rule text $w(W) <classify((lex), "mi")>', "%rule text $w(W) <tag((lex))>", '%rule text $w(W) <classify(lex, "mi")>',
    "%rule text $w(W) <tags($w, (text) ∪ A)>", "%rule text $w(W) <split((lex), \".\")>"]) {
    assert.throws(() => readDocument("```jbogenbau\n" + refused + "\n```\n", "t.md"), undefined, refused);
    assert.throws(() => loader.readDocument("```jbogenbau\n" + refused + "\n```\n", "t.md"), GencmuError, refused);
  }
});

test("the notation's lexical stage tags the keywords of classifiers and implications (grammars/notation/lexical.md)", () => {
  const run = loader.notation.parse("%classifier %implies %classifiers", { features: new Set(), until: "lexical" });
  const tokens = /** @type {import("../src/tokens.js").Token[]} */ (run.stages[0].output).map((token) => [token.text, [...token.tags].sort()]);
  assert.deepEqual(tokens, [["%classifier", ["keyword-classifier"]], ["%implies", ["keyword-implies"]], ["%classifiers", ["keyword"]]]);
});

test("a tie in a stage of the notation is a grammar error that names the document, with no line or column (engine §8)", () => {
  // A notation whose one stage reads the character a in two ways.
  const notation = loader.readDocument("```jbogenbau\n%ambiguity-resolution greedy\n%rule text p | q\n%rule p 'a' '\\u{a}'\n%rule q 'a' '\\u{a}'\n```\n", "n.md");
  const bootstrap = JSON.stringify({ format: notation.format, stages: [{ name: "syntax", documents: [{ path: "n.md", dom: notation }] }] });
  const tying = new Loader((relative) => (relative === "notation/bootstrap.json" ? bootstrap : readGrammarFile(relative)));
  assert.throws(() => tying.readDocument("```jbogenbau\na\n```\n", "t.md"), (error) => error instanceof GencmuError && error.kind === "grammar" &&
    error.where.document === "t.md" && error.where.line === undefined && error.where.column === undefined &&
    /t\.md: the grammar text is ambiguous: the syntax stage of the notation reads it in two ways/.test(error.message));
});

test("the hand-written bootstrap reader reads marked optionals and captures as the notation does (engine §3.5, §3.8, §9)", async () => {
  const { readDocument } = await import("../../../tools/bootstrap-reader.js");
  const document = "```jbogenbau\n%rule text A [+KU #] [++TOI #] [+~KU] [+KU=\"ku\" (B | C)] [ + VAU ] {[+KU] D} [+KU [+VAU]]\n" +
    "%rule b [$c(A)] ($a(A) | B) ($x(C) | $x(D) [E]) $d(D) & F [A [$e(B)]]\n%rule c $a(A) $b(B) $c(C) $d(D) $e(E) $f(F)\n```\n";
  assert.deepEqual(readDocument(document, "t.md"), loader.readDocument(document, "t.md"));
  for (const refused of ["%rule text [+KU | VAU]", "%rule text [+KU & A]", "%rule text [+(KU)]", "%rule text [+(KU) #]", "%rule text [+((KU)) #]", "%rule text [+(KU #)]",
    "%rule text [+(KU #) A]", "%rule text [++(TOI) #]", "%rule text [+(KU=\"ku\") #]", "%rule text [+ku]", "%rule text [+#]", "%rule text [+/a/]", "%rule text [+'a']",
    "%rule text [+ε]", "%rule text [+[KU] A]", "%rule text [+]", "%rule text [+KU $c(A)]", "%rule text [++TOI ($c(A))]",
    "%rule text [+ +KU]", "%rule text [+++KU]", "%elidable KU", "%rule text $x([A])", "%rule text [$x(A)] $x(B)", "%rule text $x(A) & $x(B)",
    "%rule text f? [$x(A)] $x(B) | C", "%rule text ($x(A) | B) ($x(C) | D)", "%rule text {[$c(A)]}"]) {
    assert.throws(() => readDocument("```jbogenbau\n" + refused + "\n```\n", "t.md"), undefined, refused);
    assert.throws(() => loader.readDocument("```jbogenbau\n" + refused + "\n```\n", "t.md"), GencmuError, refused);
  }
});

test("the hand-written reader of tools/bootstrap-reader.js reads the notation's pipeline to the bootstrap", async () => {
  const { readDocument } = await import("../../../tools/bootstrap-reader.js");
  const bootstrap = JSON.parse(readGrammarFile("notation/bootstrap.json"));
  const { stages } = splicePipeline("dialects/notation.md", (documentPath) => {
    let text;
    try {
      text = readGrammarFile(documentPath);
    } catch {
      return undefined;
    }
    return readDocument(text, documentPath);
  });
  assert.deepEqual(stages.map((stage) => ({ name: stage.name, documents: stage.documents })), bootstrap.stages);
});

test("every bundled document reads, without the precompiled DOMs, to its DOM in compiled.json", () => {
  const compiled = JSON.parse(readGrammarFile("compiled.json"));
  assert.equal(compiled.format, DOM_FORMAT);
  for (const [file, entry] of Object.entries(compiled.documents)) assert.deepEqual(loader.readDocument(readGrammarFile(file), file), entry.dom, file);
});

test("a precompiled DOM whose classifier entry has 150,000 gates loads, with no call that takes them all as arguments", () => {
  const sources = { "p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n",
    "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%features f\n%classifier c\n  f? \"a\" ∈ A\n%rule text $w(W) <classify(phonemes($w), c)>\n```\n" };
  const fresh = loadDialectSources(sources, "p.md");
  const dom = structuredClone(fresh.loader.readDocument(sources["g.md"], "g.md"));
  const entry = dom.classifiers[0].entries[0];
  entry.guards = Array.from({ length: 150000 }, () => entry.guards[0]);
  const compiled = JSON.stringify({ format: DOM_FORMAT, bootstrap: fresh.loader.bootstrapHash, documents: { "g.md": { hash: fnv1a64(sources["g.md"]), dom } } });
  const loaded = loadDialectSources({ ...sources, "compiled.json": compiled }, "p.md");
  assert.equal(loaded.loader.compiled.size, 1);
  assert.equal(loaded.stages[0].grammar.classifierItems[0].classifier.entries[0].guards.length, 150000);
});

test("a precompiled DOM of format 17 is never used", () => {
  const sources = { "p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n", "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text {A}\n```\n" };
  const fresh = loadDialectSources(sources, "p.md");
  const dom = fresh.loader.readDocument(sources["g.md"], "g.md");
  const entry = (format, body) => JSON.stringify({ format, bootstrap: fresh.loader.bootstrapHash, documents: { "g.md": { hash: fnv1a64(sources["g.md"]), dom: { ...body, format } } } });
  assert.equal(loadDialectSources({ ...sources, "compiled.json": entry(DOM_FORMAT, dom) }, "p.md").loader.compiled.size, 1);
  // The same document in the shape of format 17, a repeat with min.
  const old = structuredClone(dom);
  old.rules[0].alternatives[0].expr = { repeat: { ref: "A" }, min: 1 };
  assert.equal(loadDialectSources({ ...sources, "compiled.json": entry(17, old) }, "p.md").loader.compiled.size, 0);
  assert.equal(loadDialectSources({ ...sources, "compiled.json": entry(17, dom) }, "p.md").loader.compiled.size, 0);
});
