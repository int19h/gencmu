// The quoted Lojban texts of the grammar documents that tools/quoted-texts.js
// finds, how it reads its allow-list, and what it reports on a small
// repository (tests/README.md, "Quoted texts").
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repository as repositoryRoot } from "./shared.js";
import { sourceLoader } from "../../../tools/grammar-sources.js";
import { CHECKED_DIALECTS, checkedDocuments, dialectNames, documentDialects, namedDialects, quotedText, quotedTextProblems, quotedTexts, quotingPlaces, readAllowList, roleProblem, showsRole, wordLabels } from "../../../tools/quoted-texts.js";

test("a quoted text has two words or more, each with a Lojban letter", () => {
  assert.equal(quotedText("mi  klama\tle zarci"), "mi klama le zarci");
  assert.equal(quotedText("li zy du li ma'o fy. xy."), "li zy du li ma'o fy. xy.");
  assert.equal(quotedText(".i ja nai"), ".i ja nai");
  assert.equal(quotedText("le zarci"), "le zarci");
  // One word, a gap, words with no letter, rule names, tokens and notation.
  assert.equal(quotedText("zarci"), null);
  assert.equal(quotedText("mi klama ..."), null);
  assert.equal(quotedText("mi … klama"), null);
  assert.equal(quotedText(". . ."), null);
  assert.equal(quotedText(", , ,"), null);
  assert.equal(quotedText("mi . klama"), null);
  assert.equal(quotedText("bridi-tail-1 gihek bridi-tail-2"), null);
  assert.equal(quotedText("VAU ke'e brode"), null);
  assert.equal(quotedText("[VAU #] le zarci"), null);
});

test("code blocks hold no quoted text", () => {
  const markdown = [
    "Prose with `mi klama le zarci` and `zarci`.",
    "```jbogenbau",
    "text = `mi klama le zarci`",
    "```",
    "  ~~~",
    "  `do klama le zarci`",
    "  ~~~",
    "More, ``lo nu broda`` and `ko'a broda ko'e`.",
  ].join("\n");
  assert.deepEqual(quotedTexts(markdown).map(({ text, line }) => ({ text, line })), [
    { text: "mi klama le zarci", line: 1 },
    { text: "lo nu broda", line: 8 },
    { text: "ko'a broda ko'e", line: 8 },
  ]);
});

test("a line that begins with a code span of three backticks opens no fence", () => {
  // After backticks, a fence's info string holds no backtick, so this line
  // is prose, and so is the text after it.
  const markdown = "```mi klama le zarci``` is a text.\n\nSo is `do klama le zarci`.";
  assert.deepEqual(quotedTexts(markdown).map(({ text, line }) => ({ text, line })), [
    { text: "mi klama le zarci", line: 1 },
    { text: "do klama le zarci", line: 3 },
  ]);
});

test("a block names the dialects whose names stand as words in its prose", () => {
  assert.deepEqual(namedDialects("The bpfk dialect rejects it."), ["bpfk"]);
  assert.deepEqual(namedDialects("The cll-ebnf and bpfk dialects, and the experimental dialect"), ["cll-ebnf", "bpfk", "experimental"]);
  assert.deepEqual(namedDialects("In cll-ebnf and bpfk, it parses."), ["cll-ebnf", "bpfk"]);
  assert.deepEqual(namedDialects("the experimental layer"), ["experimental"]);
  assert.deepEqual(namedDialects("a bpfk-like reading, zantufas and xbpfk"), []);
  // A code span and a link target name nothing; the text of a link does.
  const markdown = [
    "Here `li zy du li ma'o fy. xy.` parses. The bpfk dialect rejects it.",
    "",
    "And `mi klama le zarci`, which `the bpfk dialect` quotes, as [this](bpfk.md) does.",
    "",
    "The [cll-ebnf](cll-ebnf.md) dialect reads `do klama le zarci`.",
  ].join("\n");
  // The span `the bpfk dialect` is itself a quoted text.
  assert.deepEqual(quotedTexts(markdown).map(({ dialects }) => dialects), [["bpfk"], [], [], ["cll-ebnf"]]);
});

test("a list item is the scope of a dialect name, whatever its blank lines", () => {
  const markdown = "- The bpfk dialect rejects this one.\n\n  Here `mi klama le zarci` parses.\n- And `do klama le zarci` too.\n";
  assert.deepEqual(quotedTexts(markdown).map(({ dialects }) => dialects), [["bpfk"], []]);
  // A name counts in any case, as a word of its own.
  assert.deepEqual(namedDialects("The Zantufa dialect, and Experimental"), ["zantufa", "experimental"]);
});

test("the checked documents are those that the CLL pipelines include, at any depth", () => {
  assert.deepEqual(CHECKED_DIALECTS, ["cll-ebnf", "bpfk"]);
  assert.deepEqual(dialectNames(), ["bpfk", "cll-ebnf", "experimental", "zantufa"]);
  const documents = checkedDocuments();
  assert.deepEqual(documents.get("grammars/syntax/cll.md"), ["bpfk", "cll-ebnf"]);
  assert.deepEqual(documents.get("grammars/words/shapes.md"), ["cll-ebnf"]);
  assert.deepEqual(documents.get("grammars/dialects/bpfk.md"), ["bpfk"]);
  assert.equal(documents.has("grammars/syntax/experimental.md"), false);
  assert.deepEqual(documentDialects().get("grammars/syntax/cll.md").sort(), ["bpfk", "cll-ebnf", "experimental"]);
});

test("an allow-list entry names its document, and a reason or the cases that show it in their roles", () => {
  const { entries, problems } = readAllowList([
    "# a comment",
    "",
    "mi .e do # grammars/syntax/cll.md # the shape of a sumti connection",
    "na'e ka'e # grammars/syntax/cll.md = simple-tense-modal adhoc.a reject adhoc.a.bpfk",
    "mi .e do # grammars/syntax/cll.md # twice",
    "mi .e do # the shape, with no document",
    "le zarci",
    "le zarci # grammars/syntax/cll.md = adhoc.b",
  ].join("\n"));
  assert.deepEqual(entries.slice(0, 2), [
    { text: "mi .e do", document: "grammars/syntax/cll.md", line: 3, reason: "the shape of a sumti connection" },
    { text: "na'e ka'e", document: "grammars/syntax/cll.md", line: 4, cases: [{ role: "simple-tense-modal", id: "adhoc.a" }, { role: "reject", id: "adhoc.a.bpfk" }] },
  ]);
  assert.deepEqual(problems.map((problem) => problem.split(":")[1]), ["5", "6", "7", "8", "8"]);
});

/**
 * A repository whose cll-ebnf and bpfk dialects include
 * grammars/syntax/s.md, which includes grammars/syntax/t.md, with the given
 * documents, cases and allow-list. The DOMs say what each document
 * includes, as tools/sync.js reads them.
 */
function repository({ document, nested = "# T\n", cases, allow = "", dialects = {}, core = null }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "quoted-texts-"));
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(base, file)), { recursive: true });
    fs.writeFileSync(path.join(base, file), text);
  };
  write("grammars/dialects/cll-ebnf.md", "# A dialect\n");
  write("grammars/dialects/bpfk.md", "# A dialect\n");
  for (const [name, text] of Object.entries(dialects)) write(`grammars/dialects/${name}`, text);
  write("grammars/syntax/s.md", document);
  write("grammars/syntax/t.md", nested);
  write("tests/corpus/adhoc.jsonl", cases.map((c) => JSON.stringify(c)).join("\n") + "\n");
  write("tests/quoted-allow.txt", allow);
  if (core) write("tests/core.txt", core.join("\n") + "\n");
  const include = (target) => ({ directives: [{ name: "stage", args: ["syntax"] }, { name: "include", args: [target] }] });
  const doms = new Map([
    ["dialects/cll-ebnf.md", include("../syntax/s.md")],
    ["dialects/bpfk.md", include("../syntax/s.md")],
    ["syntax/s.md", include("t.md")],
    ["syntax/t.md", { directives: [] }],
  ]);
  return { base, doms };
}

const loader = sourceLoader(repositoryRoot);

const both = (id, text, brackets, bpfk = brackets) => [
  { id, text, dialect: "cll-ebnf", expect: "accept", brackets },
  { id: `${id}.bpfk`, text, dialect: "bpfk", ...(bpfk ? { expect: "accept", brackets: bpfk } : { expect: "reject" }) },
];
const cases = [
  ...both("a.klama", "mi klama le zarci", "(mi [klama {le zarci}])"),
  ...both("a.kahe", "mi na'e ka'e klama", "(mi [{na'e ka'e} klama])"),
  ...both("a.lerfu", "pa xy. cu barda", "([pa xy] cu barda)", null),
];

test("quotedTextProblems reports unpinned texts, needless entries and missing dialects", () => {
  const { base: clean, doms } = repository({
    document: "# S\n\nHere `mi klama le zarci` parses, and `na'e ka'e` is one unit.\n\nA shape: `mi .e do`.\n",
    nested: "# T\n\nAnd `mi klama le zarci` once more.\n",
    cases,
    allow: "na'e ka'e # grammars/syntax/s.md = simple-tense-modal a.kahe a.kahe.bpfk\nmi .e do # grammars/syntax/s.md # a shape\n",
    dialects: { "notation.md": "# Notation\n" },
  });
  // The fixture has no grammars of its own, so the cases of `=` entries
  // parse with the repository's source grammars.
  const scope = { loader, doms, unchecked: { "grammars/dialects/notation.md": "a test" } };
  assert.deepEqual(quotedTextProblems(clean, scope), []);
  // A failing case names the lines that quote its text, and those of a
  // fragment that an entry pins with it.
  const places = quotingPlaces(clean, doms);
  assert.deepEqual(places.get("a.klama.bpfk"), ["grammars/syntax/s.md:3", "grammars/syntax/t.md:3"]);
  assert.deepEqual(places.get("a.kahe"), ["grammars/syntax/s.md:3"]);

  const { base: broken } = repository({
    document: "# S\n\nHere `do klama le zarci` parses.\n\nAnd `na'e ka'e` is one unit.\n\nIn zantufa, `mi klama le zarci` parses.\n\nNumbers hold lerfu, as `pa xy.` does.\n\nHere `pa xy. cu barda` parses.\n",
    cases: [...cases, { id: "a.do", text: "do klama le zarci", dialect: "cll-ebnf", expect: "accept" }],
    allow: "na'e ka'e # grammars/syntax/s.md = simple-tense-modal a.kahe a.klama\nmi .e do # grammars/syntax/s.md # a shape\npa xy. # grammars/syntax/s.md = number a.lerfu reject a.lerfu.bpfk\n",
    dialects: { "zantufa.md": "# Zantufa\n" },
  });
  assert.deepEqual(quotedTextProblems(broken, { loader, doms, unchecked: { "grammars/dialects/zantufa.md": "a test" } }).map((problem) => problem.replace(/;.*/, "")), [
    "grammars/syntax/s.md:3: `do klama le zarci` is pinned by no case of bpfk",
    "tests/quoted-allow.txt:1: neither the text nor the words of a.klama hold `na'e ka'e`",
    "grammars/syntax/s.md:5: `na'e ka'e` is held by no listed case of bpfk (tests/quoted-allow.txt:1)",
    "grammars/syntax/s.md:7: `mi klama le zarci` is pinned by no case of zantufa",
    // The case reads `pa` as a quantifier, not as part of a number.
    "tests/quoted-allow.txt:3: a.lerfu does not show `pa xy.` as one number: no tree has a node of number whose words are exactly the text's",
    "grammars/syntax/s.md:9: `pa xy.` is held by no listed case of cll-ebnf (tests/quoted-allow.txt:3)",
    // The dialects read the text apart, and the line names neither.
    "grammars/syntax/s.md:11: `pa xy. cu barda` reads differently in cll-ebnf and bpfk, and its line names none of them",
    "tests/quoted-allow.txt:2: `mi .e do` is not needed: grammars/syntax/s.md does not quote it unpinned",
  ]);

  // Every case that pins a quoted text is in the core sample.
  const { base: outside } = repository({
    document: "# S\n\nHere `mi klama le zarci` parses, and `na'e ka'e` is one unit.\n",
    cases,
    allow: "na'e ka'e # grammars/syntax/s.md = simple-tense-modal a.kahe a.kahe.bpfk\n",
    core: ["a.klama", "a.kahe"],
  });
  assert.deepEqual(quotedTextProblems(outside, { loader, doms, unchecked: {} }), [
    "grammars/syntax/s.md:3: a.klama.bpfk pins a quoted text and is not in tests/core.txt",
    "tests/quoted-allow.txt:1: a.kahe.bpfk pins a quoted text and is not in tests/core.txt",
  ]);

  // A grammar document that no checked dialect includes, with no reason in
  // UNCHECKED, and a reason for a document that is not there.
  const { base: unlisted } = repository({ document: "# S\n", cases, dialects: { "new.md": "# New\n" } });
  assert.deepEqual(quotedTextProblems(unlisted, { loader, doms, unchecked: { "grammars/gone.md": "a test" } }).map((problem) => problem.split(":")[0]), ["grammars/dialects/new.md", "grammars/gone.md"]);
});

test("a words role compares the labels of tokens, which stand together in the case's text", () => {
  assert.deepEqual(wordLabels(".i la djim.bu, mi"), ["i", "la", "djim bu", "mi"]);
  const shows = (dialect, text, fragment) => showsRole({ text, dialect }, "words", fragment, new Map(), loader);
  // `sa` passes the tag on: the words are `la` and the letter word `djim bu`.
  assert.equal(shows("cll-ebnf", "ladjan. sa .djim. bu", "la djim.bu"), true);
  // Inside `lo'u ... le'u`, `bu` does nothing: three words, not two.
  assert.equal(shows("cll-ebnf", "lo'u la .djim. bu le'u", "la djim.bu"), false);
  // A stage before the word stage, and an attachment between the tokens.
  assert.equal(shows("bpfk", "kyyykerlo", "ky yy kerlo"), true);
  assert.equal(shows("bpfk", "mi ui klama", "mi klama"), true);
  // Erased words between the tokens are not theirs.
  assert.match(roleProblem({ text: "mi do si klama", dialect: "cll-ebnf" }, "words", "mi klama", new Map(), loader), /other words of its text between them/);
});

test("the check reads the repository's source grammars, not the bundled copies", () => {
  // A copy of the repository's grammars in which the sources differ from
  // the bundled grammars and grammars/compiled.json: a rule has another
  // name, and the bpfk pipeline includes one more document.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "quoted-sources-"));
  fs.cpSync(path.join(repositoryRoot, "grammars"), path.join(base, "grammars"), { recursive: true });
  const syntax = path.join(base, "grammars", "syntax", "cll.md");
  fs.writeFileSync(syntax, fs.readFileSync(syntax, "utf8").replace(/\bsimple-tense-modal\b(?!-)/g, "simple-tense-modal-renamed"));
  const bpfk = path.join(base, "grammars", "dialects", "bpfk.md");
  fs.writeFileSync(bpfk, fs.readFileSync(bpfk, "utf8").replace('%include "../syntax/cll.md"', '%include "../syntax/cll.md"\n  %include "../words/lohai.md"'));
  const c = { text: "mi pu ki klama", dialect: "cll-ebnf" };
  const changed = sourceLoader(base);
  assert.equal(showsRole(c, "simple-tense-modal", "pu ki", new Map(), changed), false);
  assert.equal(showsRole(c, "simple-tense-modal-renamed", "pu ki", new Map(), changed), true);
  assert.equal(showsRole(c, "simple-tense-modal", "pu ki", new Map(), loader), true);
  // The include graph comes from the sources too.
  assert.ok(documentDialects(base).get("grammars/words/lohai.md").includes("bpfk"));
  assert.ok(!documentDialects().get("grammars/words/lohai.md").includes("bpfk"));
});
