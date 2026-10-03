// Every prose block of a Markdown document on one line, which
// tools/sync.js --check requires of the repository's documents
// (tools/prose-lines.js). The blocks are those of a CommonMark and GFM
// parser (tools/markdown.js), a development dependency: `npm ci` installs
// it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { proseLineProblems } from "../../../tools/prose-lines.js";
import { quotedTexts } from "../../../tools/quoted-texts.js";

const lines = (markdown) => proseLineProblems(markdown, "d.md").map((problem) => Number(problem.split(":")[1]));

test("the documents' layout passes", () => {
  const markdown = [
    "# A heading",
    "A paragraph right after the heading, with `mi klama le zarci`.",
    "",
    "- An item",
    "  - a nested item",
    "",
    "    ```",
    "    a block in the nested item",
    "    ```",
    "1. A numbered item",
    "",
    "| a | b |",
    "| --- | --- |",
    "| c | d |",
    "",
    "```",
    "a fenced",
    "> block",
    "```",
    "Escaped \\` backtick, and ``a ` b``.",
    "",
    "> A quote on one line.",
    "",
    "- - -",
    "",
    "    an indented code block",
    "    on two lines",
  ].join("\n");
  assert.deepEqual(proseLineProblems(markdown, "d.md"), []);
});

test("a code span that closes on a later line is reported", () => {
  assert.deepEqual(lines("Text `mi klama\nle zarci`."), [1, 2]);
  assert.deepEqual(lines("Text `mi klama.\n\nle zarci`."), [1, 3]);
});

test("a paragraph, a list item or a heading that a line continues is reported", () => {
  assert.deepEqual(lines("A paragraph\non two lines."), [2]);
  assert.deepEqual(lines("- An item\n  on two lines."), [2]);
  assert.deepEqual(lines("> A quoted\n> paragraph."), [2]);
  // A setext heading is a heading on two lines.
  assert.deepEqual(lines("A heading\n========="), [2]);
});

test("a lazy continuation line is reported, whatever it begins with", () => {
  assert.deepEqual(lines("A paragraph that goes\n| on, as one paragraph."), [2]);
  assert.deepEqual(lines("A paragraph ending in the year\n2. And goes on."), [2]);
  assert.deepEqual(lines("- An item\n| on two lines."), [2]);
  assert.deepEqual(lines("- An item\non two lines."), [2]);
  assert.deepEqual(lines("> A quote\nthat goes on."), [2]);
  // A list item numbered 1 or a bullet can interrupt a paragraph, so these
  // are new blocks.
  assert.deepEqual(lines("A paragraph\n1. item"), []);
  assert.deepEqual(lines("A paragraph\n- item"), []);
});

test("a paragraph after a table is a row of the table", () => {
  assert.deepEqual(lines("| a | b |\n| --- | --- |\n| c | d |\nA paragraph."), [4]);
  assert.deepEqual(lines("| a | b |\n| --- | --- |\n| c | d |\n\nA paragraph."), []);
  // A line of pipes with no delimiter row is a paragraph.
  assert.deepEqual(lines("| a | b |\n| c | d |"), [2]);
});

test("a thematic break is no list item", () => {
  assert.deepEqual(lines("- - -\n* * *\n---"), []);
  assert.deepEqual(lines("Text.\n\n- - -\nMore text."), []);
});

test("a fenced block with no closing fence is reported", () => {
  // The block in the list item ends with the item; the second has no end.
  assert.deepEqual(lines("- An item\n\n  ```\n  code\nText.\n```"), [3, 6]);
  assert.deepEqual(lines("```\nno closing fence"), [1]);
  assert.deepEqual(lines("> ```\n> code\n\nText."), [1]);
});

test("a closing fence can be indented, as CommonMark allows", () => {
  // The fence closes on line 3, so the paragraph after it is prose.
  assert.deepEqual(lines("```\ncode\n ```\nA paragraph that quotes `mi klama le zarci`\nand goes on."), [5]);
  assert.deepEqual(quotedTexts("```\ncode\n   ```\nIt quotes `mi klama le zarci`.").map(({ line }) => line), [4]);
  assert.deepEqual(lines("- An item\n\n  ```\n  code\n     ```\n\n  Text."), []);
  // A line indented four spaces, or with a quote marker, is code content,
  // not a closer: the fence stays open, as the parser reads it.
  assert.deepEqual(lines("```\ncode\n    ```"), [1]);
  assert.deepEqual(lines("```\ncode\n> ```"), [1]);
  assert.deepEqual(lines("- An item\n\n  ```\n  code\n      ```"), [3]);
});

test("a table row begins with a cell divider as the parser reads it", () => {
  // In a list item and in a quote, the container's prefix is not the row's.
  assert.deepEqual(lines("- An item\n\n  | a | b |\n  | - | - |\n  | c | d |"), []);
  assert.deepEqual(lines("> | a | b |\n> | - | - |\n> | c | d |\n> A paragraph."), [4]);
});

test("a backtick that the parser reads as text is reported, and an escaped one is not", () => {
  assert.deepEqual(lines("Escaped \\` and ``a ` b``, and `code`."), []);
  assert.deepEqual(lines("One ` alone.\n\n# A ` heading\n\n| a ` |\n| - |"), [1, 3, 5]);
  // A backtick in a code block or an HTML block is not prose.
  assert.deepEqual(lines("```\na ` b\n```\n\n<div>\n`\n</div>"), []);
});

test("a line that begins with a code span of three backticks opens no fence", () => {
  assert.deepEqual(lines("```mi klama le zarci``` is prose."), []);
  assert.deepEqual(lines("```mi klama le zarci``` is prose\nthat goes on."), [2]);
});

test("a quote inside a quoted fence is not a quoted text", () => {
  const markdown = "> ```\n> `mi klama le zarci`\n> ```\n\nAnd `do klama le zarci`.";
  assert.deepEqual(quotedTexts(markdown).map(({ text }) => text), ["do klama le zarci"]);
});
