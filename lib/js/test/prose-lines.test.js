// Every prose block of a Markdown document on one line, which
// tools/sync.js --check requires of the repository's documents
// (tools/prose-lines.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fenceOf, proseLineProblems } from "../../../tools/prose-lines.js";

const lines = (markdown) => proseLineProblems(markdown, "d.md").map((problem) => Number(problem.split(":")[1]));

test("blocks of one line each pass", () => {
  const markdown = [
    "# A heading",
    "",
    "A paragraph with `mi klama le zarci`.",
    "",
    "- An item",
    "  - a nested item",
    "1. A numbered item",
    "",
    "> A quote.",
    ">",
    "> - an item in it",
    "",
    "| a | b |",
    "| --- | --- |",
    "",
    "```",
    "a fenced",
    "block",
    "```",
    "  ```jbogenbau",
    "  rule = A",
    "  ```",
    "Escaped \\` backtick, and ``a ` b``.",
  ].join("\n");
  assert.deepEqual(proseLineProblems(markdown, "d.md"), []);
});

test("a code span that closes on a later line is reported", () => {
  assert.deepEqual(lines("Text `mi klama\nle zarci`."), [1, 2, 2]);
});

test("a quoted paragraph on two lines is reported", () => {
  assert.deepEqual(lines("> A quoted\n> paragraph."), [2]);
  // A line without the marker continues it too.
  assert.deepEqual(lines("> A quoted\nparagraph."), [2]);
});

test("a heading, a paragraph or a list item that a line continues is reported", () => {
  assert.deepEqual(lines("# Heading\nprose after it."), [2]);
  assert.deepEqual(lines("A paragraph\non two lines."), [2]);
  assert.deepEqual(lines("- An item\n  on two lines."), [2]);
});

test("a line opens a fence only as Markdown says", () => {
  assert.equal(fenceOf("```jbogenbau"), "```");
  assert.equal(fenceOf("  ~~~~"), "~~~~");
  assert.equal(fenceOf("```mi klama le zarci``` is prose."), null);
  assert.equal(fenceOf("``not a fence``"), null);
});
