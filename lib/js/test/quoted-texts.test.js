// The quoted Lojban texts of the grammar documents that tools/quoted-texts.js
// finds, and how it reads its allow-list (tests/README.md, "Quoted texts").
import { test } from "node:test";
import assert from "node:assert/strict";
import { codeSpans } from "../../../tools/links.js";
import { DOCUMENTS, namedDialects, quotedText, quotedTexts, readAllowList } from "../../../tools/quoted-texts.js";

test("a code span is its content between backtick runs of one length", () => {
  assert.deepEqual(codeSpans("a `mi klama` b").map((span) => span.content), ["mi klama"]);
  assert.deepEqual(codeSpans("``a ` b`` and `c`").map((span) => span.content), ["a ` b", "c"]);
  // An escaped backtick opens nothing, and a run that nothing closes is text.
  assert.deepEqual(codeSpans("\\`mi klama` do").map((span) => span.content), []);
  assert.deepEqual(codeSpans("``mi `klama`").map((span) => span.content), ["klama"]);
});

test("a quoted text has three words or more of Lojban letters", () => {
  assert.equal(quotedText("mi  klama\tle zarci"), "mi klama le zarci");
  assert.equal(quotedText("li zy du li ma'o fy. xy."), "li zy du li ma'o fy. xy.");
  assert.equal(quotedText(".i ja nai"), ".i ja nai");
  // Too few words, a gap, rule names, tokens and notation.
  assert.equal(quotedText("le zarci"), null);
  assert.equal(quotedText("mi klama ..."), null);
  assert.equal(quotedText("mi … klama"), null);
  assert.equal(quotedText("bridi-tail-1 gihek bridi-tail-2"), null);
  assert.equal(quotedText("VAU ke'e brode"), null);
  assert.equal(quotedText("[VAU #] le zarci"), null);
});

test("fenced blocks hold no quoted text", () => {
  const markdown = [
    "Prose with `mi klama le zarci` and `le zarci`.",
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
  const markdown = "```mi klama le zarci``` is a text.\nSo is `do klama le zarci`.";
  assert.deepEqual(quotedTexts(markdown).map(({ text, line }) => ({ text, line })), [
    { text: "mi klama le zarci", line: 1 },
    { text: "do klama le zarci", line: 2 },
  ]);
});

test("each document's texts need cases of its dialect and of the dialects their line names", () => {
  assert.equal(DOCUMENTS["grammars/dialects/bpfk.md"], "bpfk");
  assert.equal(DOCUMENTS["grammars/syntax/cll.md"], "cll-ebnf");
  assert.deepEqual(namedDialects("The bpfk dialect rejects it."), ["bpfk"]);
  assert.deepEqual(namedDialects("The cll-ebnf and bpfk dialects, and the experimental dialect"), ["cll-ebnf", "bpfk", "experimental"]);
  assert.deepEqual(namedDialects("An experimental construct, and bpfk alone"), []);
  const markdown = "Here `li zy du li ma'o fy. xy.` parses. The bpfk dialect rejects it.\n\nAnd `mi klama le zarci`.";
  assert.deepEqual(quotedTexts(markdown).map(({ dialects }) => dialects), [["bpfk"], []]);
});
