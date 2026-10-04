// The quoted Lojban texts of the grammar documents that tools/quoted-texts.js
// finds, how it reads its allow-list, and what it reports on a small
// repository (tests/README.md, "Quoted texts").
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DOCUMENTS, documentDialects, namedDialects, quotedText, quotedTextProblems, quotedTexts, quotingPlaces, readAllowList } from "../../../tools/quoted-texts.js";

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

test("a document's dialects are those that include it, less the layered ones", () => {
  assert.deepEqual(DOCUMENTS["grammars/syntax/cll.md"], ["cll-ebnf", "bpfk"]);
  assert.deepEqual(DOCUMENTS["grammars/dialects/bpfk.md"], ["bpfk"]);
  assert.deepEqual(documentDialects().get("grammars/syntax/cll.md").sort(), ["bpfk", "cll-ebnf", "experimental"]);
});

test("an allow-list entry names its document, and a reason or the cases that hold it", () => {
  const { entries, problems } = readAllowList([
    "# a comment",
    "",
    "mi .e do # grammars/syntax/cll.md # the shape of a sumti connection",
    "na'e ka'e # grammars/syntax/cll.md = adhoc.a adhoc.a.bpfk",
    "mi .e do # grammars/syntax/cll.md # twice",
    "mi .e do # the shape, with no document",
    "le zarci",
  ].join("\n"));
  assert.deepEqual(entries.slice(0, 2), [
    { text: "mi .e do", document: "grammars/syntax/cll.md", line: 3, reason: "the shape of a sumti connection" },
    { text: "na'e ka'e", document: "grammars/syntax/cll.md", line: 4, cases: ["adhoc.a", "adhoc.a.bpfk"] },
  ]);
  assert.deepEqual(problems.map((problem) => problem.split(":")[1]), ["5", "6", "7"]);
});

/**
 * A repository with the dialects a and b, both of which include
 * grammars/syntax/s.md, and the given document, cases and allow-list.
 */
function repository({ document, cases, allow = "", dialects = {}, core = null }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "quoted-texts-"));
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(base, file)), { recursive: true });
    fs.writeFileSync(path.join(base, file), text);
  };
  const include = '# A dialect\n\n- [Syntax](../syntax/s.md)\n  ```jbogenbau\n  %include "../syntax/s.md"\n  ```\n';
  write("grammars/dialects/cll-ebnf.md", include);
  write("grammars/dialects/bpfk.md", include);
  for (const [name, text] of Object.entries(dialects)) write(`grammars/dialects/${name}`, text);
  write("grammars/syntax/s.md", document);
  write("tests/corpus/adhoc.jsonl", cases.map((c) => JSON.stringify(c)).join("\n") + "\n");
  write("tests/quoted-allow.txt", allow);
  if (core) write("tests/core.txt", core.join("\n") + "\n");
  return base;
}

test("quotedTextProblems reports unpinned texts, needless entries and missing dialects", () => {
  const scope = {
    documents: { "grammars/syntax/s.md": ["cll-ebnf", "bpfk"] },
    unchecked: { "grammars/dialects/cll-ebnf.md": "a test", "grammars/dialects/bpfk.md": "a test" },
    layered: {},
  };
  const both = (id, text) => [{ id, text, dialect: "cll-ebnf" }, { id: `${id}.bpfk`, text, dialect: "bpfk" }];
  const cases = [...both("a.klama", "mi klama le zarci"), ...both("a.kahe", "mi na'e ka'e klama")];
  const clean = repository({
    document: "# S\n\nHere `mi klama le zarci` parses, and `na'e ka'e` is one unit.\n\nA shape: `mi .e do`.\n",
    cases,
    allow: "na'e ka'e # grammars/syntax/s.md = a.kahe a.kahe.bpfk\nmi .e do # grammars/syntax/s.md # a shape\n",
  });
  assert.deepEqual(quotedTextProblems(clean, scope), []);
  assert.deepEqual(quotingPlaces(clean, scope.documents).get("mi klama le zarci"), ["grammars/syntax/s.md:3"]);

  const broken = repository({
    document: "# S\n\nHere `do klama le zarci` parses.\n\nAnd `na'e ka'e` is one unit.\n\nIn zantufa, `mi klama le zarci` parses.\n",
    cases: [...cases, { id: "a.do", text: "do klama le zarci", dialect: "cll-ebnf" }],
    allow: "na'e ka'e # grammars/syntax/s.md = a.kahe a.klama\nmi .e do # grammars/syntax/s.md # a shape\n",
  });
  assert.deepEqual(quotedTextProblems(broken, scope).map((problem) => problem.replace(/;.*/, "")), [
    "grammars/syntax/s.md:3: `do klama le zarci` is pinned by no case of bpfk",
    "tests/quoted-allow.txt:1: neither the text nor the words of a.klama hold `na'e ka'e`",
    "grammars/syntax/s.md:5: `na'e ka'e` is held by no listed case of bpfk (tests/quoted-allow.txt:1)",
    "grammars/syntax/s.md:7: `mi klama le zarci` is pinned by no case of zantufa",
    "tests/quoted-allow.txt:2: `mi .e do` is not needed: grammars/syntax/s.md does not quote it unpinned",
  ]);

  // Every case that pins a quoted text is in the core sample.
  const outside = repository({
    document: "# S\n\nHere `mi klama le zarci` parses, and `na'e ka'e` is one unit.\n",
    cases,
    allow: "na'e ka'e # grammars/syntax/s.md = a.kahe a.kahe.bpfk\n",
    core: ["a.klama", "a.kahe"],
  });
  assert.deepEqual(quotedTextProblems(outside, scope), [
    "grammars/syntax/s.md:3: a.klama.bpfk pins a quoted text and is not in tests/core.txt",
    "tests/quoted-allow.txt:1: a.kahe.bpfk pins a quoted text and is not in tests/core.txt",
  ]);

  // A new dialect document that neither list names, and a document whose
  // listed dialects are not those that include it.
  const unlisted = repository({ document: "# S\n", cases, dialects: { "new.md": "# New\n" } });
  assert.deepEqual(quotedTextProblems(unlisted, scope).map((problem) => problem.split(":")[0]), ["grammars/dialects/new.md"]);
  const drifted = { ...scope, documents: { "grammars/syntax/s.md": ["cll-ebnf"] } };
  assert.deepEqual(quotedTextProblems(clean, drifted).map((problem) => problem.split(":")[0]), ["grammars/syntax/s.md"]);
});
