// The quoted Lojban texts of the grammar documents that tools/quoted-texts.js
// finds, and how it reads its allow-list (tests/README.md, "Quoted texts").
import { test } from "node:test";
import assert from "node:assert/strict";
import { codeSpans } from "../../../tools/links.js";
import { pinningDialect, quotedText, quotedTexts, readAllowList } from "../../../tools/quoted-texts.js";

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
  assert.deepEqual(quotedTexts(markdown), [
    { text: "mi klama le zarci", line: 1 },
    { text: "lo nu broda", line: 8 },
    { text: "ko'a broda ko'e", line: 8 },
  ]);
});

test("the allow-list holds a text and a reason on each line", () => {
  const { entries, problems } = readAllowList([
    "# a comment",
    "",
    "le mi zdani # a sumti",
    "le mi zdani # again",
    "ba za ki",
    "ba za # too short",
  ].join("\n"));
  assert.deepEqual([...entries], [["le mi zdani", 3]]);
  assert.deepEqual(problems, [
    "tests/quoted-allow.txt:4: `le mi zdani` is listed twice",
    'tests/quoted-allow.txt:5: not a quoted text followed by " # " and a reason',
    'tests/quoted-allow.txt:6: not a quoted text followed by " # " and a reason',
  ]);
});

test("a dialect document needs a case of its own dialect", () => {
  assert.equal(pinningDialect("grammars/dialects/bpfk.md"), "bpfk");
  assert.equal(pinningDialect("grammars/syntax/cll.md"), null);
});
