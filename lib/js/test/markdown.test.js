// The blocks that the reader extracts from a document, which also decide
// whether tools/sync.js reads the document as grammar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractGrammarText } from "../src/markdown.js";

/** @param {string} markdown */
const blocks = (markdown) => extractGrammarText(markdown, "t.md").blocks;

test("every fence form that the reader accepts opens a block", () => {
  assert.equal(blocks("```jbogenbau\n%rule x a\n```\n"), 1);
  assert.equal(blocks("~~~jbogenbau\n%rule x a\n~~~\n"), 1);
  assert.equal(blocks("````jbogenbau\n%rule x a\n````\n"), 1);
  assert.equal(blocks("   ```jbogenbau\n%rule x a\n   ```\n"), 1);
  // A space before and after the info string.
  assert.equal(blocks("``` jbogenbau \n%rule x a\n```\n"), 1);
  assert.equal(blocks("~~~ jbogenbau\n%rule x a\n~~~\n"), 1);
  assert.deepEqual(extractGrammarText("Prose.\n\n``` jbogenbau\n%rule x a\n```\n", "t.md").text, "%rule x a\n");
  // An empty block is a block, and blocks are counted one by one.
  assert.equal(blocks("```jbogenbau\n```\n\n~~~jbogenbau\n%rule x a\n~~~\n"), 2);
});

test("nothing else opens a block", () => {
  // Another info string, a fence indented by four spaces, the info string in
  // prose, and a backtick fence whose info string holds a backtick.
  assert.equal(blocks("```js\n%rule x a\n```\n"), 0);
  assert.equal(blocks("```jbogenbau x\n%rule x a\n```\n"), 0);
  assert.equal(blocks("    ```jbogenbau\n%rule x a\n    ```\n"), 0);
  assert.equal(blocks("Write ```jbogenbau to open a block.\n"), 0);
  assert.equal(blocks("```jbogenbau`\n%rule x a\n```\n"), 0);
  // A jbogenbau fence inside another block is its text.
  assert.equal(blocks("````md\n```jbogenbau\n%rule x a\n```\n````\n"), 0);
});
