import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repository, grammars, loaderWith, matches, readGrammarFile, sameJson } from "./shared.js";
import { GencmuError, Loader, loadPipelineSources, fnv1a64 } from "../src/node.js";
import { DOM_FORMAT, domProblem } from "../src/dom.js";
import { compactJson } from "../src/output.js";
import { splicePipeline } from "../src/splice.js";
import { notationCachePaths } from "./notation-cache.js";
import { readDocument as readBootstrapDocument } from "../../../tools/bootstrap-reader.js";

const loader = loaderWith({});

const directory = path.join(repository, "tests", "notation");
for (const file of fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort()) {
  const testCase = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
  assert.ok(!testCase.expect.error || !Object.hasOwn(testCase.expect.error, "message"), "shared expectations omit message wording");
  test(`notation: ${file}`, () => {
    let outcome;
    try {
      outcome = { dom: loader.readDocument(testCase.document, file) };
    } catch (error) {
      if (!(error instanceof GencmuError)) throw error;
      outcome = { error: { line: error.where.line, column: error.where.column } };
    }
    // A DOM can nest deeper than JSON.stringify can write.
    if (!matches(testCase.expect, outcome)) assert.fail(compactJson(outcome));
    if (testCase.cacheMisses) {
      assert.ok(outcome.dom, "cache cases require a readable document");
      const bootstrapDom = readBootstrapDocument(testCase.document, file);
      assert.ok(matches(testCase.expect, {dom: bootstrapDom}), "bootstrap DOM matches the case");
      assert.deepEqual(bootstrapDom, outcome.dom);
      for (const dom of [outcome.dom, bootstrapDom]) {
        notationCachePaths(loader, testCase.document, file, dom, (preparsed, documentPath) =>
          new Loader(relative => relative === documentPath ? testCase.document
            : relative === "data/preparsed/test.json" ? JSON.stringify(preparsed) : readGrammarFile(relative)));
      }
    }
  });
}

test("every recipe position instructs the author to join adjacent strings with ++", () => {
  const cases = JSON.parse(fs.readFileSync(path.join(repository, "tests", "recipe-diagnostics.json"), "utf8"));
  const readers = {
    engine: document => loader.readDocument(document, "recipe.md"),
    bootstrap: document => readBootstrapDocument(document, "recipe.md"),
  };
  for (const [name, read] of Object.entries(readers)) {
    for (const position of cases.positions) for (const channel of [":=", ":-"]) for (const recipe of cases.recipes) {
      const body = position.template.replace("@CHANNEL@", channel).replace("@RECIPE@", recipe.source);
      const marker = body.indexOf(recipe.source) + recipe.source.indexOf(recipe.at);
      const label = `${name}: ${position.name} ${channel} ${recipe.source}`;
      assert.throws(() => read("```jbogenbau\n" + body + "\n```"), error => {
        assert.ok(error instanceof GencmuError, label);
        assert.match(error.message.toLowerCase(), /use \+\+/, label);
        assert.deepEqual([error.where.line, error.where.column], [2, [...body.slice(0, marker)].length + 1], label);
        return true;
      }, label);
    }
    for (const body of cases.ordinary) {
      assert.throws(() => read("```jbogenbau\n" + body + "\n```"), error => {
        assert.ok(error instanceof GencmuError);
        assert.match(error.message, /\+\+/);
        assert.doesNotMatch(error.message.toLowerCase(), /use \+\+/);
        return true;
      }, body);
    }
  }
});

test("String constants and joins have the same DOM in both notation readers", () => {
  for (const file of fs.readdirSync(directory).filter(name => name.startsWith("concat-") && name.endsWith("-dom.json"))) {
    const { document, expect } = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
    assert.deepEqual(readBootstrapDocument(document, file), expect.dom, file);
  }
});

test("the notation reads its own pipeline to the bootstrap (the fixpoint)", () => {
  const bootstrap = JSON.parse(readGrammarFile("data/preparsed/gencmu.json"));
  // Every document is read afresh with the bootstrap, never from preparsed family files.
  const entries = {};
  splicePipeline("grammars/gencmu/jbogenbau/pipeline.md", (documentPath) => {
    let text;
    try {
      text = readGrammarFile(documentPath);
    } catch {
      return undefined;
    }
    const dom = loader.readDocument(text, documentPath);
    entries[documentPath] = {hash:fnv1a64(text),dom};
    return dom;
  });
  assert.deepEqual(entries, bootstrap.documents);
  void grammars;
});

test("the notation's lexical stage tags names, plain dollar strings, engine tags, guards and symbols (engine §9.1)", () => {
  const run = loader.notation.parse('%rule a ¬f? B "c" Sound-d {E ... / "$$"} g! %rulex $e ¬h "x".."y" _General_Category_Letter', {features: new Set(), until: "lexical"});
  const tokens = run.stages[0].output.map(token => [token.text, [...token.tags].sort()]);
  assert.deepEqual(tokens, [
    ["%rule", ["KW-RULE"]], ["a", ["Identifier", "Lowercase-Name"]], ["¬f?", ["Guard"]],
    ["B", ["Identifier", "Uppercase-Name"]], ['"c"', ["String"]], ["Sound-d", ["Identifier", "Uppercase-Name"]],
    ["{", ["_Age_V1_1", "_Bidi_Class_Other_Neutral", "_Bidi_Mirrored", "_Bidi_Paired_Bracket_Type_Open", "_Block_Basic_Latin", "_Canonical_Combining_Class_Not_Reordered", "_Decomposition_Type_None", "_East_Asian_Width_Narrow", "_General_Category_Open_Punctuation", "_General_Category_Punctuation", "_Grapheme_Base", "_Grapheme_Cluster_Break_Other", "_Hangul_Syllable_Type_Not_Applicable", "_Indic_Conjunct_Break_None", "_Indic_Positional_Category_NA", "_Indic_Syllabic_Category_Other", "_Joining_Group_No_Joining_Group", "_Joining_Type_Non_Joining", "_Line_Break_Open_Punctuation", "_NFC_Quick_Check_Yes", "_NFD_Quick_Check_Yes", "_NFKC_Quick_Check_Yes", "_NFKD_Quick_Check_Yes", "_Numeric_Type_None", "_Pattern_Syntax", "_Script_Common", "_Script_Extensions_Common", "_Sentence_Break_Close", "_Vertical_Orientation_Rotated", "_Word_Break_Other"]], ["E", ["Identifier", "Uppercase-Name"]], ["...", []], ["/", ["_Age_V1_1", "_Bidi_Class_Common_Separator", "_Bidi_Paired_Bracket_Type_None", "_Block_Basic_Latin", "_Canonical_Combining_Class_Not_Reordered", "_Decomposition_Type_None", "_East_Asian_Width_Narrow", "_General_Category_Other_Punctuation", "_General_Category_Punctuation", "_Grapheme_Base", "_Grapheme_Cluster_Break_Other", "_Hangul_Syllable_Type_Not_Applicable", "_Indic_Conjunct_Break_None", "_Indic_Positional_Category_NA", "_Indic_Syllabic_Category_Other", "_Joining_Group_No_Joining_Group", "_Joining_Type_Non_Joining", "_Line_Break_Break_Symbols", "_NFC_Quick_Check_Yes", "_NFD_Quick_Check_Yes", "_NFKC_Quick_Check_Yes", "_NFKD_Quick_Check_Yes", "_Numeric_Type_None", "_Pattern_Syntax", "_Script_Common", "_Script_Extensions_Common", "_Sentence_Break_Other", "_Vertical_Orientation_Rotated", "_Word_Break_Other"]],
    ['"$$"', ["String"]], ["}", ["_Age_V1_1", "_Bidi_Class_Other_Neutral", "_Bidi_Mirrored", "_Bidi_Paired_Bracket_Type_Close", "_Block_Basic_Latin", "_Canonical_Combining_Class_Not_Reordered", "_Decomposition_Type_None", "_East_Asian_Width_Narrow", "_General_Category_Close_Punctuation", "_General_Category_Punctuation", "_Grapheme_Base", "_Grapheme_Cluster_Break_Other", "_Hangul_Syllable_Type_Not_Applicable", "_Indic_Conjunct_Break_None", "_Indic_Positional_Category_NA", "_Indic_Syllabic_Category_Other", "_Joining_Group_No_Joining_Group", "_Joining_Type_Non_Joining", "_Line_Break_Close_Punctuation", "_NFC_Quick_Check_Yes", "_NFD_Quick_Check_Yes", "_NFKC_Quick_Check_Yes", "_NFKD_Quick_Check_Yes", "_Numeric_Type_None", "_Pattern_Syntax", "_Script_Common", "_Script_Extensions_Common", "_Sentence_Break_Close", "_Vertical_Orientation_Rotated", "_Word_Break_Other"]], ["g!", ["Guard"]], ["%rulex", ["Keyword"]],
    ["$e", ["Capture"]], ["¬", ["_Age_V1_1", "_Bidi_Class_Other_Neutral", "_Bidi_Paired_Bracket_Type_None", "_Block_Latin_1_Supplement", "_Canonical_Combining_Class_Not_Reordered", "_Decomposition_Type_None", "_East_Asian_Width_Narrow", "_General_Category_Math_Symbol", "_General_Category_Symbol", "_Grapheme_Base", "_Grapheme_Cluster_Break_Other", "_Hangul_Syllable_Type_Not_Applicable", "_Indic_Conjunct_Break_None", "_Indic_Positional_Category_NA", "_Indic_Syllabic_Category_Other", "_Joining_Group_No_Joining_Group", "_Joining_Type_Non_Joining", "_Line_Break_Alphabetic", "_Math", "_NFC_Quick_Check_Yes", "_NFD_Quick_Check_Yes", "_NFKC_Quick_Check_Yes", "_NFKD_Quick_Check_Yes", "_Numeric_Type_None", "_Pattern_Syntax", "_Script_Common", "_Script_Extensions_Common", "_Sentence_Break_Other", "_Vertical_Orientation_Rotated", "_Word_Break_Other"]], ["h", ["Identifier", "Lowercase-Name"]],
    ['"x"', ["String"]], ["..", []], ['"y"', ["String"]], ["_General_Category_Letter", ["Engine-Tag"]],
  ]);
});

test("the notation's lexical stage tags constants and the keywords that define them (grammars/gencmu/jbogenbau/lexical.md)", () => {
  const run = loader.notation.parse("%const $SU-STOPS %redefine-const $x $ $K1", { features: new Set(), until: "lexical" });
  const tokens = /** @type {import("../src/tokens.js").Token[]} */ (run.stages[0].output).map((token) => [token.text, [...token.tags].sort()]);
  assert.deepEqual(tokens, [
    ["%const", ["KW-CONST"]], ["$SU-STOPS", ["Constant"]], ["%redefine-const", ["KW-REDEFINE-CONST"]],
    ["$x", ["Capture"]], ["$", ["Capture"]], ["$K1", ["Constant"]],
  ]);
});

test("the hand-written bootstrap reader reads constants as the notation does", async () => {
  const {readDocument} = await import("../../../tools/bootstrap-reader.js");
  const document = '```jbogenbau\n%const $A A ∪ B\n%const $S "."\n%const $T "x.y".split($S)\n%redefine-const $A $A ∖ B ∪ C\n%rule text $x:C ::$A\n%conditions $x.value ∈ $T, C ⊆ $A\n```\n';
  assert.deepEqual(readDocument(document, "t.md"), loader.readDocument(document, "t.md"));
});

test("the hand-written bootstrap reader reads tests in a body as the notation does", async () => {
  const { readDocument } = await import("../../../tools/bootstrap-reader.js");
  const document = "```jbogenbau\n%const $C C\n%rule text $l:LE=\"la\" {UI=\"ui\" / A=\"a\"} [KU = \"ku\"] w≠\"\" A<B> w<¬$C> A<¬B ¬C> A<¬B> _General_Category_Letter<> B (C)\n```\n";
  assert.deepEqual(readDocument(document, "t.md"), loader.readDocument(document, "t.md"));
  for (const refused of ["%rule text (A)=\"a\"", "%rule text A=\"a\"=\"b\"", "%rule text A⊇\"a\"", "%rule text A=B"]) {
    assert.throws(() => readDocument("```jbogenbau\n" + refused + "\n```\n", "t.md"), undefined, refused);
    assert.throws(() => loader.readDocument("```jbogenbau\n" + refused + "\n```\n", "t.md"), GencmuError, refused);
  }
});

test("the hand-written bootstrap reader reads braces as the notation does (engine §9)", async () => {
  const { readDocument } = await import("../../../tools/bootstrap-reader.js");
  const document = "```jbogenbau\n%rule text $a:A {B} [{C / D | E}] {{F} / [G] {H}} {| I | J / | K}\n%rule l {... L / M}\n%rule r {N | O ...}\n" +
    "%rule s {... P} ::Q\n```\n";
  assert.deepEqual(readDocument(document, "t.md"), loader.readDocument(document, "t.md"));
  for (const refused of ["%rule text {}", "%rule text {A /}", "%rule text {/ A}", "%rule text {A / B / C}", "%rule text {... A ...}", "%rule text {A / ... B}",
    "%rule text A ...", "%rule text \"a\"...\"z\"", "%rule text (A / B)", "%rule text A {... B}", "%rule text [{... A}]", "%rule text {$a:A}", "%rule text $a:{A}", "%rule text {A}=\"a\"",
    "%rule text ({... A})", "%rule text (({A ...}))", "%rule text ({... A / S}) ::T", "%rule text ((({A ... / S})))"]) {
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

test("the hand-written bootstrap reader reads every bundled document to its DOM in data/preparsed/lojban.json", async () => {
  const { readDocument } = await import("../../../tools/bootstrap-reader.js");
  const preparsed = JSON.parse(readGrammarFile("data/preparsed/lojban.json"));
  for (const [file, entry] of Object.entries(preparsed.documents)) assert.deepEqual(readDocument(readGrammarFile(file), file), entry.dom, file);
});

test("both readers read a document nested far deeper than the call stack, with the error that engine §9 orders first", async () => {
  const { readDocument } = await import("../../../tools/bootstrap-reader.js");
  /** @param {string} body @param {number} n */
  const deep = (body, n) => body.replaceAll("<", "(".repeat(n)).replaceAll(">", ")".repeat(n)).replaceAll("{", "[".repeat(n)).replaceAll("}", "]".repeat(n));
  /** @param {(document: string, file: string) => import("../src/types.js").GrammarDom} read @param {number} n */
  const check = (read, n) => {
    // Groups add no depth to the DOM, in a body, a tag term and a condition.
    for (const body of ["%rule text ε %emits $ :: <A>", "%rule text A :: <A>", "%rule text $x:A %conditions <$x.source-text = \"a\">"]) {
      assert.doesNotThrow(() => read("```jbogenbau\n" + deep(body, n) + "\n```\n", "t.md"), body);
    }
    // A later error of reading comes before the bound on nesting, and a
    // syntax error before both.
    for (const [body, line, column] of [["%rule text {A}\n%rule Foo A", 3, 7], ["%rule text {A}\n%rule b )", 3, 9], ["%rule text {A}", 2, 1]]) {
      assert.throws(() => read("```jbogenbau\n" + deep(body, n) + "\n```\n", "t.md"),
        (error) => error instanceof GencmuError && error.where.line === line && error.where.column === column, body);
    }
  };
  check(readDocument, 100000);
  check((text, file) => loader.readDocument(text, file), 10000);
});

test("the hand-written bootstrap reader reports each error where the notation does, the first in the order of engine §9", async () => {
  const { readDocument } = await import("../../../tools/bootstrap-reader.js");
  for (const [body, line, column] of [
    ['%rule text $x:A<B><C>', 2, 19], ['%rule text $x:[A]', 2, 12],
    ['%rule text {$x:A} )', 2, 19], ['%rule Foo A', 2, 7], ['%stage $X', 2, 1],
    ['%rule text A="x"<B>', 2, 17], ['%const "‹U+0041›" "x"', 2, 8],
  ]) {
    const document = "```jbogenbau\n" + body + "\n```\n";
    for (const read of [readDocument, (/** @type {string} */ text, /** @type {string} */ file) => loader.readDocument(text, file)]) {
      assert.throws(() => read(document, "t.md"), (error) => error instanceof GencmuError && error.where.line === line && error.where.column === column, body);
    }
  }
});

test("the hand-written bootstrap reader reads classifiers, implications and classify as the notation does", async () => {
  const {readDocument} = await import("../../../tools/bootstrap-reader.js");
  const document = '```jbogenbau\n%classifier lex\n $MI "do" ∈ KOHA\n f? ¬g? "u\'i" ∉ UI\n%classifier none\n%implies UI ∪ $K ⟹ Indicator\n%const $K CAI\n%const $MI "mi"\n%rule text $w:W :: $w.value.classify(lex)\n```\n';
  assert.deepEqual(readDocument(document, "t.md"), loader.readDocument(document, "t.md"));
  for (const refused of ['%classifier Lex "a" ∈ A', '%classifier l f! "a" ∈ A', '%classifier l "a" ∈ Ab', '%implies A ⟹ "a"', '%implies $x.tags ⟹ A']) {
    const source = '```jbogenbau\n' + refused + '\n```\n';
    assert.throws(() => readDocument(source, "t.md"), GencmuError, refused);
    assert.throws(() => loader.readDocument(source, "t.md"), GencmuError, refused);
  }
});

test("the hand-written bootstrap reader reads a parenthesized rule or classifier name as the notation does (engine §9)", async () => {
  const {readDocument} = await import("../../../tools/bootstrap-reader.js");
  const document = '```jbogenbau\n%classifier lex\n%rule text $w:W :: "mi".classify((lex)) ∪ $w.value.classify(((lex))) ∪ $w.tags((text))\n%conditions $w.matches((text)), $w.begins((text))\n```\n';
  const read = readDocument(document, "t.md");
  assert.deepEqual(read, loader.readDocument(document, "t.md"));
  assert.deepEqual(read.rules[0].alternatives[0].tags.union[0], {method: "classify", receiver: {string: "mi"}, args: [{classifier: "lex"}]});
  for (const refused of ['%rule text $w:W :: (lex).classify("mi")', '%rule text $w:W :: "mi".classify(A)', '%rule text $w:W :: $w.tags("text")', '%rule text $w:W :: lex.split(".")']) {
    const source = '```jbogenbau\n' + refused + '\n```\n';
    assert.throws(() => readDocument(source, "t.md"), GencmuError, refused);
    assert.throws(() => loader.readDocument(source, "t.md"), GencmuError, refused);
  }
});

test("the notation's lexical stage tags the keywords of classifiers and implications (grammars/gencmu/jbogenbau/lexical.md)", () => {
  const run = loader.notation.parse("%classifier %implies %classifiers", { features: new Set(), until: "lexical" });
  const tokens = /** @type {import("../src/tokens.js").Token[]} */ (run.stages[0].output).map((token) => [token.text, [...token.tags].sort()]);
  assert.deepEqual(tokens, [["%classifier", ["KW-CLASSIFIER"]], ["%implies", ["KW-IMPLIES"]], ["%classifiers", ["Keyword"]]]);
});

test("a tie in a stage of the notation is a grammar error that names the document, with no line or column (engine §8)", () => {
  // A notation whose one stage reads the character a in two ways.
  const notation = loader.readDocument("```jbogenbau\n%ambiguity-resolution greedy\n%rule text p | q\n%rule p \"a\" \"‹U+000A›\"\n%rule q \"a\" \"‹U+000A›\"\n```\n", "n.md");
  const pipeline = loader.readDocument('```jbogenbau\n%stage syntax\n%include "../../../n.md"\n```\n', "grammars/gencmu/jbogenbau/pipeline.md");
  const bootstrap = JSON.stringify({format:notation.format,documents:{"grammars/gencmu/jbogenbau/pipeline.md":{hash:"0",dom:pipeline},"n.md":{hash:"0",dom:notation}}});
  const tying = new Loader((relative) => (relative === "data/preparsed/gencmu.json" ? bootstrap : readGrammarFile(relative)));
  assert.throws(() => tying.readDocument("```jbogenbau\na\n```\n", "t.md"), (error) => error instanceof GencmuError && error.kind === "grammar" &&
    error.where.document === "t.md" && error.where.line === undefined && error.where.column === undefined &&
    /t\.md: the grammar text is ambiguous: the syntax stage of the notation reads it in two ways/.test(error.message));
});

test("the hand-written bootstrap reader reads marked optionals and captures as the notation does (engine §3.5, §3.8, §9)", async () => {
  const { readDocument } = await import("../../../tools/bootstrap-reader.js");
  const document = "```jbogenbau\n%rule text A [+KU 🆓] [+TOI 🆓] [+KU] [+Sound-0061-s] [+KU=\"ku\" (B | C)] [ + VAU ] {[+KU] D} [+KU [+VAU]]\n" +
    "%rule b [$c:A] ($a:A | B) ($x:C | $x:D [E]) $d:D & F [A [$e:B]]\n%rule c $a:A $b:B $c:C $d:D $e:E $f:F\n```\n";
  assert.deepEqual(readDocument(document, "t.md"), loader.readDocument(document, "t.md"));
  for (const refused of ["%rule text [+KU | VAU]", "%rule text [+KU & A]", "%rule text [+(KU)]", "%rule text [+(KU) 🆓]", "%rule text [+((KU)) 🆓]", "%rule text [+(KU 🆓)]",
    "%rule text [+(KU 🆓) A]", "%rule text [++(TOI) 🆓]", "%rule text [+(KU=\"ku\") 🆓]", "%rule text [+ku]", "%rule text [+🆓]", "%rule text [+\"a\"]",
    "%rule text [+ε]", "%rule text [+[KU] A]", "%rule text [+]", "%rule text [+KU $c:A]", "%rule text [++TOI ($c:A)]",
    "%rule text [+ +KU]", "%rule text [+++KU]", "%unknown KU", "%rule text $x:[A]", "%rule text [$x:A] $x:B", "%rule text $x:A & $x:B",
    "%rule text f? [$x:A] $x:B | C", "%rule text ($x:A | B) ($x:C | D)", "%rule text {[$c:A]}"]) {
    assert.throws(() => readDocument("```jbogenbau\n" + refused + "\n```\n", "t.md"), undefined, refused);
    assert.throws(() => loader.readDocument("```jbogenbau\n" + refused + "\n```\n", "t.md"), GencmuError, refused);
  }
});

test("the hand-written reader of tools/bootstrap-reader.js reads the notation's pipeline to the bootstrap", async () => {
  const { readDocument } = await import("../../../tools/bootstrap-reader.js");
  const bootstrap = JSON.parse(readGrammarFile("data/preparsed/gencmu.json"));
  const entries = {};
  splicePipeline("grammars/gencmu/jbogenbau/pipeline.md", (documentPath) => {
    let text;
    try {
      text = readGrammarFile(documentPath);
    } catch {
      return undefined;
    }
    const dom = readDocument(text, documentPath);
    entries[documentPath] = {hash:fnv1a64(text),dom};
    return dom;
  });
  assert.deepEqual(entries, bootstrap.documents);
});

test("every bundled document reads, without the preparsed DOMs, to its DOM in data/preparsed/lojban.json", () => {
  const preparsed = JSON.parse(readGrammarFile("data/preparsed/lojban.json"));
  assert.equal(preparsed.format, DOM_FORMAT);
  for (const [file, entry] of Object.entries(preparsed.documents)) assert.deepEqual(loader.readDocument(readGrammarFile(file), file), entry.dom, file);
});

test("a preparsed DOM whose classifier entry has 150,000 gates loads, with no call that takes them all as arguments", () => {
  const sources = { "grammars/test/p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n",
    "grammars/test/g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%features f\n%classifier c\n  f? \"a\" ∈ A\n%rule text $w:W ::$w.value.classify(c)\n```\n" };
  const fresh = loadPipelineSources(sources, "grammars/test/p.md");
  const dom = structuredClone(fresh.loader.readDocument(sources["grammars/test/g.md"], "g.md"));
  const entry = dom.classifiers[0].entries[0];
  entry.guards = Array.from({ length: 150000 }, () => entry.guards[0]);
  const preparsed = JSON.stringify({ format: DOM_FORMAT, bootstrap: fresh.loader.bootstrapHash, unicode: fresh.loader.unicodeHash, properties: fresh.loader.propertiesHash, documents: { "grammars/test/g.md": { hash: fnv1a64(sources["grammars/test/g.md"]), dom } } });
  const loaded = loadPipelineSources({ ...sources, "data/preparsed/test.json": preparsed }, "grammars/test/p.md");
  assert.equal(loaded.loader.preparsed.size, 1);
  assert.equal(loaded.stages[0].grammar.classifierItems[0].classifier.entries[0].guards.length, 150000);
});

test("a preparsed DOM of format 17 is never used", () => {
  const sources = { "grammars/test/p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n", "grammars/test/g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text {A}\n```\n" };
  const fresh = loadPipelineSources(sources, "grammars/test/p.md");
  const dom = fresh.loader.readDocument(sources["grammars/test/g.md"], "g.md");
  const entry = (format, body) => JSON.stringify({ format, bootstrap: fresh.loader.bootstrapHash, unicode: fresh.loader.unicodeHash, properties: fresh.loader.propertiesHash, documents: { "grammars/test/g.md": { hash: fnv1a64(sources["grammars/test/g.md"]), dom: { ...body, format } } } });
  assert.equal(loadPipelineSources({ ...sources, "data/preparsed/test.json": entry(DOM_FORMAT, dom) }, "grammars/test/p.md").loader.preparsed.size, 1);
  // An unknown expression member invalidates a cache entry.
  const old = structuredClone(dom);
  old.rules[0].alternatives[0].expr = { repeat: { ref: "A" }, extra: true };
  assert.equal(loadPipelineSources({ ...sources, "data/preparsed/test.json": entry(17, old) }, "grammars/test/p.md").loader.preparsed.size, 0);
  assert.equal(loadPipelineSources({ ...sources, "data/preparsed/test.json": entry(DOM_FORMAT, old) }, "grammars/test/p.md").loader.preparsed.size, 0);
  assert.equal(loadPipelineSources({ ...sources, "data/preparsed/test.json": entry(17, dom) }, "grammars/test/p.md").loader.preparsed.size, 0);
});

test("a bare parameter sigil fails at its source position in both readers", () => {
  const document = "```jbogenbau\n%rule t @\n```";
  for (const read of [() => loader.readDocument(document, "at.md"), () => readBootstrapDocument(document, "at.md")]) {
    assert.throws(read, error => error instanceof GencmuError && error.where.line === 2 && error.where.column === 9);
  }
});
