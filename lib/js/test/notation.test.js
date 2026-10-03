import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repository, grammars, loaderWith, matches, readGrammarFile } from "./shared.js";
import { GencmuError, Loader } from "../src/node.js";
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
    assert.ok(matches(testCase.expect, outcome), JSON.stringify(outcome, null, 1));
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
    "%rule text A ...", "%rule text 'a'...'z'", "%rule text (A \\ B)", "%rule text A {... B}", "%rule text [{... A}]", "%rule text {$a(A)}", "%rule text $a({A})", "%rule text {A}=\"a\""]) {
    assert.throws(() => readDocument("```jbogenbau\n" + refused + "\n```\n", "t.md"), undefined, refused);
    assert.throws(() => loader.readDocument("```jbogenbau\n" + refused + "\n```\n", "t.md"), GencmuError, refused);
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

test("a plain %elidable with the operand ~maximal has no maximal member (engine §9)", () => {
  const dom = loader.readDocument("```jbogenbau\n%elidable ~maximal T\n```\n", "plain.md");
  assert.deepEqual(dom.directives, [{ name: "elidable", args: ["maximal", "T"], at: [2, 1] }]);
});

test("the hand-written bootstrap reader reads %elidable maximal as the notation does (engine §9)", async () => {
  const { readDocument } = await import("../../../tools/bootstrap-reader.js");
  for (const directive of ["%elidable maximal TOI ~SEhU", "%elidable maximal", "%elidable maximal ~maximal", "%elidable ~maximal T"]) {
    const document = "```jbogenbau\n" + directive + "\n```\n";
    assert.deepEqual(readDocument(document, "t.md"), loader.readDocument(document, "t.md"), directive);
  }
  assert.throws(() => readDocument("```jbogenbau\n%elidable T maximal\n```\n", "t.md"));
});
