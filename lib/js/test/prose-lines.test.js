// Every prose block of a Markdown document on one line, which
// tools/sync.js --check requires of the repository's documents
// (tools/prose-lines.js), and the reading of lines that it rests on
// (tools/markdown-lines.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLines, fenceOf } from "../../../tools/markdown-lines.js";
import { proseLineProblems } from "../../../tools/prose-lines.js";
import { quotedTexts } from "../../../tools/quoted-texts.js";

const lines = (markdown) => proseLineProblems(markdown, "d.md").map((problem) => Number(problem.split(":")[1]));
const kinds = (markdown) => classifyLines(markdown).map(({ kind, indent }) => `${kind}@${indent}`);

test("the modelled layout passes", () => {
  const markdown = [
    "# A heading",
    "",
    "A paragraph with `mi klama le zarci`.",
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
    "",
    "```",
    "a fenced",
    "> block",
    "```",
    "Escaped \\` backtick, and ``a ` b``.",
  ].join("\n");
  assert.deepEqual(proseLineProblems(markdown, "d.md"), []);
  assert.deepEqual(kinds(markdown), [
    "heading@0", "blank@0", "paragraph@0", "blank@0", "item@0", "item@2", "blank@4",
    "fence-open@4", "fence@4", "fence-close@4", "item@0", "blank@3", "table@0", "table@0", "blank@0",
    "fence-open@0", "fence@0", "fence@0", "fence-close@0", "paragraph@0",
  ]);
});

test("a code span that closes on a later line is reported", () => {
  assert.deepEqual(lines("Text `mi klama\nle zarci`."), [1, 2, 2]);
});

test("a heading, a paragraph or a list item that a line continues is reported", () => {
  assert.deepEqual(lines("# Heading\nprose after it."), [2]);
  assert.deepEqual(lines("A paragraph\non two lines."), [2]);
  assert.deepEqual(lines("- An item\n  on two lines."), [2]);
});

test("a layout that is not modelled is an error, and the lines after it are read", () => {
  // A quote, with a fenced block in it, and a quoted paragraph on two lines.
  assert.deepEqual(lines("> ```\n> example\n> ```\n\nA paragraph\non two lines."), [1, 2, 3, 6]);
  assert.deepEqual(lines("> A quoted\n> paragraph."), [1, 2]);
  // An indented code block, a lazy line, a tab, a link reference
  // definition, a thematic break and an HTML block.
  assert.deepEqual(lines("Text.\n\n    code"), [3]);
  assert.deepEqual(lines("\tText."), [1]);
  assert.deepEqual(lines("[a]: b.md\n\n---\n\n<div>"), [1, 3, 5]);
});

test("a fenced block ends with its container", () => {
  assert.deepEqual(lines("- An item\n\n  ```\n  code\nText.\n```"), [5, 7]);
  assert.deepEqual(lines("```\nno closing fence"), [3]);
});

test("a quote inside a quoted fence is not a quoted text", () => {
  const markdown = "> ```\n> `mi klama le zarci`\n> ```\n\nAnd `do klama le zarci`.";
  assert.deepEqual(quotedTexts(markdown).map(({ text }) => text), ["do klama le zarci"]);
});

test("a line opens a fence only as Markdown says", () => {
  assert.equal(fenceOf("```jbogenbau"), "```");
  assert.equal(fenceOf("~~~~"), "~~~~");
  assert.equal(fenceOf("```mi klama le zarci``` is prose."), null);
  assert.equal(fenceOf("``not a fence``"), null);
  assert.deepEqual(kinds("```mi klama le zarci``` is prose.\nmore"), ["paragraph@0", "paragraph@0"]);
});
