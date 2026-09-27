// The layout tools/sync.js requires of a pipeline's %include: a block under a
// list item whose line links to the same path (tools/links.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { includeIsLinked, inlineLinkTargets } from "../../../tools/links.js";

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
  assert.deepEqual(inlineLinkTargets("\\[a](x.md) [b]( ) [c](unclosed"), []);
});
