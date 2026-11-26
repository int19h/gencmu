// The layout tools/sync.js requires of a pipeline's %include: a block under a
// list item whose line links to the same path (tools/links.js). The list
// items, blocks and links are the Markdown parser's (tools/markdown.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertLinearWork } from "./linear.js";
import { includeIsLinked, includeLinks, inlineLinkTargets, headingAnchors, localAnchorProblems, formatPathProblems } from "../../../tools/links.js";
import { walk } from "../../../tools/markdown.js";

// A list item with `text` on its line and a block with `%include "path"`
// under it; the %include is on line 3.
const item = (text, path, indent = "  ") => `${text}
${indent}\`\`\`jbogenbau
${indent}%include "${path}"
${indent}\`\`\`
`;

test("local heading links follow renamed headings and repeated anchors", () => {
  const target = "# Stage 6: syntax\n\n## `Images` and *values*\n\n## Images and values\n";
  const anchors = headingAnchors(target);
  assert.deepEqual([...anchors], ["stage-6-syntax", "images-and-values", "images-and-values-1"]);
  const read = (file) => file === "grammars/lojban/cll/pipeline.md" ? anchors : null;
  assert.deepEqual(localAnchorProblems("[Syntax](../cll/pipeline.md#stage-6-syntax)", "grammars/lojban/bpfk/pipeline.md", read), []);
  assert.deepEqual(localAnchorProblems("[Syntax](../cll/pipeline.md#stage-5-syntax)", "grammars/lojban/bpfk/pipeline.md", read), [
    "grammars/lojban/bpfk/pipeline.md:1: the local link ../cll/pipeline.md#stage-5-syntax names no heading",
  ]);
  assert.deepEqual(localAnchorProblems("[Missing](none.md#syntax)", "grammars/lojban/bpfk/pipeline.md", read), [
    "grammars/lojban/bpfk/pipeline.md:1: the local link none.md#syntax names no heading",
  ]);
  assert.deepEqual(localAnchorProblems("`[Old](x.md#old)` [Remote](https://example.test/x.md#old)", "grammars/lojban/bpfk/pipeline.md", read), []);
});

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
  const block = (indent) => `${indent}\`\`\`jbogenbau
${indent}%include "g.md"
${indent}\`\`\`
`;
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

test("a format 50 document links the format 50 copy of a grammar file", () => {
  const copies = new Set(["grammars50/lojban/common/latin.md", "grammars50/lojban/common/names.txt", "grammars50/lojban/examples/kihei"]);
  const exists = (file) => copies.has(file);
  const file = "grammars50/lojban/cll/latin.md";
  const problems = (text) => formatPathProblems(text, file, exists);
  const latin = (line, written = "grammars/lojban/common/latin.md") =>
    `${file}:${line}: ${written} names grammars/lojban/common/latin.md, which has a format 50 copy; link grammars50/lojban/common/latin.md instead`;
  // Carbon's matrix: four paths that the check must report, then four that it must not.
  const cases = [
    ["a relative link to the format 49 copy", "See [Latin conventions](../../../grammars/lojban/common/latin.md).",
      [latin(1, "../../../grammars/lojban/common/latin.md")]],
    ["a footnote that a later section cites, after the differences section",
      "## Differences from the format 49 grammar\n\nThe format 49 copy is `grammars/lojban/cll/latin.md`.\n\n## Notes\n\nSee the note.[^1]\n\n[^1]: See `grammars/lojban/common/latin.md`.",
      [latin(9)]],
    ["an inline code span that starts with three backticks",
      "```` ```jbogenbau``` ```` blocks in `grammars/lojban/common/latin.md`.\n\nSee `grammars/lojban/common/latin.md`.",
      [latin(1), latin(3)]],
    ["an extensionless path", "See `grammars/lojban/examples/kihei`.",
      [`${file}:1: grammars/lojban/examples/kihei names grammars/lojban/examples/kihei, which has a format 50 copy; link grammars50/lojban/examples/kihei instead`]],
    ["a subsection of the differences section", "## Differences from the format 49 grammar\n\n### Phonemes\n\nThe format 49 copy is `grammars/lojban/common/latin.md`.", []],
    ["a tilde fence under a list item", "- [Latin](latin.md)\n  ~~~jbogenbau\n  %include \"grammars/lojban/common/latin.md\"\n  ~~~", []],
    ["a longer file name", "See `grammars/lojban/common/latin.md2` and `grammars/lojban/common/latin.md-notes`.", []],
    ["an external URL", "See [link](https://example.test/?file=grammars/lojban/common/latin.md).", []],
    ["a backtick fence", "```jbogenbau\n%include \"grammars/lojban/common/latin.md\"\n```", []],
    ["links to the format 50 copy", "See [the conventions](../common/latin.md) and `grammars50/lojban/common/latin.md`.", []],
    ["a directory and a path with no format 50 copy", "The layers in `grammars/lojban/` and `grammars/lojban/experimental/syntax.md` stay.", []],
  ];
  for (const [name, text, expected] of cases) assert.deepEqual(problems(text), expected, name);
  // A footnote that only the differences section cites stays out of the check.
  assert.deepEqual(problems("## Differences from the format 49 grammar\n\nThe copy.[^1]\n\n[^1]: See `grammars/lojban/common/latin.md`."), []);
  // A plain path in a sentence is reported, and so is the name file.
  assert.deepEqual(problems("The names file is grammars/lojban/common/names.txt."), [
    `${file}:1: grammars/lojban/common/names.txt names grammars/lojban/common/names.txt, which has a format 50 copy; link grammars50/lojban/common/names.txt instead`,
  ]);
});

test("every local link names an existing file and a nonempty fragment", () => {
  const files = new Set(["grammars50/lojban/common/latin.md", "grammars50/lojban/common/names.txt"]);
  const exists = (relative) => files.has(relative);
  const read = (relative) => relative === "grammars50/lojban/common/latin.md" ? new Set(["pauses"]) : null;
  const file = "grammars50/lojban/common/forms.md";
  const check = (text) => localAnchorProblems(text, file, read, exists);
  assert.deepEqual(check("[Latin](latin.md), [pauses](latin.md#pauses) and [names](names.txt)."), []);
  assert.deepEqual(check("[Experimental](../experimental/latin.md)"), [
    `${file}:1: the local link ../experimental/latin.md names no file`,
  ]);
  assert.deepEqual(check("[Empty](latin.md#)"), [`${file}:1: the local link latin.md# has an empty fragment`]);
  assert.deepEqual(check("[Table](missing.txt)"), [`${file}:1: the local link missing.txt names no file`]);
  assert.deepEqual(check("[Gone](latin.md#gone)"), [`${file}:1: the local link latin.md#gone names no heading`]);
  // Without the file check, the older behavior stays: only heading fragments count.
  assert.deepEqual(localAnchorProblems("[Experimental](../experimental/latin.md)", file, read), []);
});

test("both link checks resolve links, references, images and paths as a Markdown reader does", () => {
  const file = "grammars50/lojban/common/forms.md";
  const files = new Set([file, "grammars50/lojban/common/latin.md", "grammars/lojban/common/latin.md", "grammars50/lojban/common/100%.txt",
    "grammars50/lojban/examples/kihei", "grammars/lojban/examples/kihei"]);
  const directories = new Set(["grammars50/lojban/common", "grammars/lojban/common"]);
  const isFile = (relative) => files.has(relative);
  // As fs.existsSync: a directory exists with or without a final slash, a file only without one.
  const exists = (relative) => files.has(relative) || directories.has(relative.replace(/\/$/, ""));
  const read = (relative) => relative.endsWith(".md") && files.has(relative) ? new Set(["punctuation"]) : null;
  const OLD = "../../../grammars/lojban/common/latin.md", LIT = "grammars/lojban/common/latin.md";
  const old = (line, written) =>
    `${file}:${line}: ${written} names grammars/lojban/common/latin.md, which has a format 50 copy; link grammars50/lojban/common/latin.md instead`;
  const link = (line, url, problem) => `${file}:${line}: the local link ${url} ${problem}`;
  // Each case: a name, the Markdown, the problems of formatPathProblems, and those of localAnchorProblems.
  const cases = [
    // Reference links count at the reference, with the destination of the definition.
    ["R1 a full reference to the old copy", `[Latin][lx]\n\n[lx]: ${OLD}#punctuation`, [old(1, `${OLD}#punctuation`)], []],
    ["R2 a collapsed reference to a missing file", "[missing][]\n\n[missing]: missing.txt", [], [link(1, "missing.txt", "names no file")]],
    ["R3 a shortcut reference to a missing heading", "[gone]\n\n[gone]: latin.md#gone", [], [link(1, "latin.md#gone", "names no heading")]],
    ["R4 a reference that only the differences section uses", `## Differences from the format 49 grammar\n\nOld [Latin][lx].\n\n## Now\n\n[lx]: ${OLD}`, [], []],
    ["R5 control: an inline link to the old copy", `[latin](${OLD}#punctuation)`, [old(1, `${OLD}#punctuation`)], []],
    ["an unused definition makes no link", `[lx]: ${OLD}\n\n[unused]: missing.txt`, [], []],
    ["an image reference to a missing file", "![map][m]\n\n[m]: absent.svg", [], [link(1, "absent.svg", "names no file")]],
    // A query and a fragment do not belong to the file name.
    ["Q1 a query before the fragment", "[Latin](latin.md?plain=1#punctuation)", [], []],
    ["Q2 a query on the old copy", `[Latin](${OLD}?plain=1#punctuation)`, [old(1, `${OLD}?plain=1#punctuation`)], []],
    ["Q3 a literal percent, then a missing file", "[percent](100%.txt) and [missing](missing.txt)", [], [link(1, "missing.txt", "names no file")]],
    ["Q4 a malformed escape in the fragment", "[missing](latin.md#%ZZ)", [], [link(1, "latin.md#%ZZ", "names no heading")]],
    ["Q5 a query and a fragment of the document itself", "[Latin](?plain=1#punctuation)", [], []],
    ["Q6 a path from the repository root", "[Latin](/grammars/lojban/common/latin.md)", [old(1, "/grammars/lojban/common/latin.md")], []],
    ["Q8 a query before an empty fragment", "[empty](latin.md?plain=1#)", [], [link(1, "latin.md?plain=1#", "has an empty fragment")]],
    ["Q9 control: a network path", `[outside](//example.test/${LIT})`, [], []],
    ["Q10 control: an encoded percent", "[literal](100%25.txt)", [], []],
    ["an encoded # stays in the file name", "[hash](latin%23md)", [], [link(1, "latin%23md", "names no file")]],
    // A directory is no format 50 file copy, but it is a target that exists.
    ["Q7 a link to an old directory", "[old](../../../grammars/lojban/common)", [], []],
    ["the same directory with a slash", "[old](../../../grammars/lojban/common/)", [], []],
    ["a file with a final slash", "[Latin](latin.md/)", [], [link(1, "latin.md/", "names no file")]],
    ["T4 a directory in a code span", "See the folder `grammars/lojban/common`.", [], []],
    ["control: an extensionless file", "See `grammars/lojban/examples/kihei`.",
      [`${file}:1: grammars/lojban/examples/kihei names grammars/lojban/examples/kihei, which has a format 50 copy; link grammars50/lojban/examples/kihei instead`], []],
    // Paths in prose and code spans are whole operands.
    ["T1 a plus sign after the name", `\`${LIT}+draft\``, [], []],
    ["T2 a Unicode letter after the name", `\`${LIT}é\``, [], []],
    ["T3 the displayed URL of an autolink", `See <https://example.test/?v=${LIT}>.`, [], []],
    ["T5 a path that starts with ./", "Read `./../../../grammars/lojban/common/latin.md`.", [old(1, "./../../../grammars/lojban/common/latin.md")], []],
    ["T6 the old path as the text of a link to the copy", `See [${LIT}](latin.md).`, [old(1, LIT)], []],
    ["sentence punctuation around a path", `See (${LIT}), "${LIT}"; and ${LIT}.`, [old(1, LIT), old(1, LIT), old(1, LIT)], []],
    ["a line suffix and a fragment", `See \`${LIT}:12\` and \`${LIT}#punctuation\`.`, [old(1, `${LIT}:12`), old(1, `${LIT}#punctuation`)], []],
    // The differences section reaches footnotes through other footnotes.
    ["F1 a note that an outside note cites", `Shown.[^a]\n\n## Differences from the format 49 grammar\n\nOld.[^b]\n\n[^a]: Also see [^b].\n\n[^b]: Read \`${LIT}\`.`, [old(9, LIT)], []],
    ["F2 a note that only an inside note cites", `## Differences from the format 49 grammar\n\nOld.[^a]\n\n[^a]: See [^b].\n\n[^b]: Read \`${LIT}\`.`, [], []],
    ["notes that cite each other", `## Differences from the format 49 grammar\n\nOld.[^a]\n\n[^a]: See [^b].\n\n[^b]: See [^a] and \`${LIT}\`.`, [], []],
    ["F3 a longer version number", `## Differences from the format 490 timetable\n\nRead \`${LIT}\`.`, [old(3, LIT)], []],
    ["F4 a heading in a block quote opens no section", `> ## Differences from the format 49 grammar\n>\n> Read \`${LIT}\`.`, [old(3, LIT)], []],
    // Images are local links too.
    ["I1 a missing image", "![map](absent.svg)", [], [link(1, "absent.svg", "names no file")]],
    ["I2 a missing image inside a link", "[![map](absent.svg)](latin.md)", [], [link(1, "absent.svg", "names no file")]],
  ];
  for (const [name, markdown, format, anchors] of cases) {
    assert.deepEqual(formatPathProblems(markdown, file, isFile), format, name);
    assert.deepEqual(localAnchorProblems(markdown, file, read, exists), anchors, name);
  }
});
