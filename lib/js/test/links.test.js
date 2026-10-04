// The layout tools/sync.js requires of a pipeline's %include: a block under a
// list item whose line links to the same path (tools/links.js). The list
// items, blocks and links are the Markdown parser's (tools/markdown.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertLinearWork } from "./linear.js";
import { includeIsLinked, includeLinks, inlineLinkTargets } from "../../../tools/links.js";
import { walk } from "../../../tools/markdown.js";

// A list item with `text` on its line and a block with `%include "path"`
// under it; the %include is on line 3.
const item = (text, path, indent = "  ") => `${text}\n${indent}\`\`\`jbogenbau\n${indent}%include "${path}"\n${indent}\`\`\`\n`;

test("an inline link on the list item's line links the include", () => {
  assert.ok(includeIsLinked(item("- [Grammar](g.md): what it adds", "g.md"), 3, "g.md"));
  assert.ok(includeIsLinked(item("- [Grammar](g(1).md)", "g(1).md"), 3, "g(1).md"));
  assert.ok(includeIsLinked(item('- [Grammar](<a b.md> "the title")', "a b.md"), 3, "a b.md"));
  assert.ok(includeIsLinked(item("1. [Grammar](g.md)", "g.md", "   "), 3, "g.md"));
});

test("anything else does not", () => {
  // An escaped bracket, an image, a reference link, a link to another
  // document, text that is not a list item, and a block not indented to the
  // item's text.
  assert.ok(!includeIsLinked(item("- \\[Grammar](g.md)", "g.md"), 3, "g.md"));
  assert.ok(!includeIsLinked(item("- ![Grammar](g.md)", "g.md"), 3, "g.md"));
  assert.ok(!includeIsLinked(item("- ![alt [Grammar](g.md)](image.png)", "g.md"), 3, "g.md"));
  assert.ok(!includeIsLinked(item("- [Grammar][g]\n\n[g]: g.md", "g.md"), 3, "g.md"));
  assert.ok(!includeIsLinked(item("- [Grammar](h.md)", "g.md"), 3, "g.md"));
  assert.ok(!includeIsLinked(item("[Grammar](g.md)", "g.md", ""), 3, "g.md"));
  assert.ok(!includeIsLinked(item("- [Grammar](g.md)", "g.md", ""), 3, "g.md"));
  // A link in an indented code block before the list item's block does not
  // count either, since only the item's own line does.
  assert.ok(!includeIsLinked("    [Grammar](g.md)\n\n```jbogenbau\n%include \"g.md\"\n```\n", 4, "g.md"));
});

test("code spans, images and whitespace before a title are read as CommonMark reads them", () => {
  assert.deepEqual(inlineLinkTargets("`[Grammar](g.md)`"), []);
  assert.deepEqual(inlineLinkTargets("![alt [Grammar](g.md)](image.png)"), []);
  assert.deepEqual(inlineLinkTargets("\\![Grammar](g.md)"), ["g.md"]);
  assert.deepEqual(inlineLinkTargets('[Grammar](<g.md>"title")'), []);
  assert.deepEqual(inlineLinkTargets('[Grammar](g.md\t"title")'), ["g.md"]);
  assert.deepEqual(inlineLinkTargets("`` a ` b `` [Grammar](g.md)"), ["g.md"]);
  assert.deepEqual(inlineLinkTargets("[`😀`](g.md)"), ["g.md"]);
  assert.deepEqual(inlineLinkTargets("` x ````` [Grammar](g.md) `"), []);
  assert.ok(!includeIsLinked(item("- ` x ````` [Grammar](g.md) `", "g.md"), 3, "g.md"));
  assert.ok(!includeIsLinked(item("- `[Grammar](g.md)`", "g.md"), 3, "g.md"));
  assert.ok(includeIsLinked(item("- \\![Grammar](g.md)", "g.md"), 3, "g.md"));
});

test("inline link targets", () => {
  assert.deepEqual(inlineLinkTargets("[a](x.md) and [b [c]](y(z).md 'title') and ![i](img.png) and [d](<w v.md>)"), ["x.md", "y(z).md", "w v.md"]);
  // An escaped bracket, an empty target and an unclosed link give none.
  assert.deepEqual(inlineLinkTargets("\\[a](x.md) [b]( ) [c](unclosed"), []);
});

test("the list item, its block and its link are the ones the parser reads", () => {
  const block = (indent) => `${indent}\`\`\`jbogenbau\n${indent}%include "g.md"\n${indent}\`\`\`\n`;
  // An item numbered 2 cannot interrupt a paragraph, so this line continues
  // the paragraph, and the block is not in a list item.
  assert.ok(!includeIsLinked(`Text.\n2. [Grammar](g.md)\n${block("   ")}`, 4, "g.md"));
  assert.ok(includeIsLinked(`Text.\n1. [Grammar](g.md)\n${block("   ")}`, 4, "g.md"));
  // Five spaces after the marker make the item's text an indented code
  // block, which holds no link.
  assert.ok(!includeIsLinked(`-     [Grammar](g.md)\n${block("      ")}`, 3, "g.md"));
  // A jbogenbau fence shown inside a tilde block opens no block.
  assert.ok(!includeIsLinked(`~~~\n- [Grammar](g.md)\n${block("  ")}~~~\n`, 4, "g.md"));
  // The item's text column decides the indentation, whatever the marker.
  assert.ok(includeIsLinked(`-   [Grammar](g.md)\n${block("    ")}`, 3, "g.md"));
  assert.ok(includeIsLinked(`10. [Grammar](g.md)\n${block("    ")}`, 3, "g.md"));
  // The link stands on the item's own line, and the block follows it.
  assert.ok(!includeIsLinked(`- [Grammar](h.md)\n  and [more](g.md)\n${block("  ")}`, 4, "g.md"));
  assert.ok(!includeIsLinked(`- [Grammar](g.md)\n\n${block("  ")}`, 4, "g.md"));
  // A tilde fence is a fence too.
  assert.ok(includeIsLinked('- [Grammar](g.md)\n  ~~~jbogenbau\n  %include "g.md"\n  ~~~\n', 3, "g.md"));
});

test("checking every include of a document costs linear work in the document, not one parse for each include", () => {
  // Each include's block is found by a binary search, whose steps grow
  // with the logarithm of the blocks, so 4n may cost a little over 4 times n.
  assertLinearWork("includeLinks", 100, (n) => {
    const markdown = Array.from({ length: n }, (_, index) => item(`- [Grammar](g${index}.md)`, `g${index}.md`)).join("\n");
    return () => {
      const isLinked = includeLinks(markdown);
      for (let index = 0; index < n; index++) assert.ok(isLinked(5 * index + 3, `g${index}.md`));
    };
  }, ["walkSteps", "text"], { factor: 6 });
});

test("walking a deep tree costs linear work in its nodes, not their depth for each", () => {
  assertLinearWork("walk", 2000, (n) => {
    /** @type {any} */
    let tree = { type: "text" };
    for (let depth = 0; depth < n; depth++) tree = { type: "blockquote", children: [tree] };
    return () => {
      let deepest = 0;
      for (const { ancestors } of walk(tree)) deepest = Math.max(deepest, ancestors.length);
      assert.equal(deepest, n);
    };
  }, ["walkSteps"]);
});
