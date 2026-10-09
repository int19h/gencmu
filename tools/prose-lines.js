// Whether each prose block of a Markdown document stands on one line, as
// every document of the repository keeps it: some renderers show a line
// break inside a paragraph as a break (docs/design.md, "Documents"). The
// blocks are those of a CommonMark and GFM parser (tools/markdown.js), so a
// lazy continuation line, a setext heading or a paragraph that a table takes
// in as a row is seen where GitHub sees it. tools/sync.js --check runs it on
// every Markdown document of the repository (tools/documents.js).
import { parseMarkdown, walk } from "./markdown.js";
import { isDiagramElement } from "./railroad.js";

/** The blocks that hold prose: each stands on one line. */
export const PROSE = new Set(["paragraph", "heading", "tableRow"]);

const NAMES = { paragraph: "paragraph", heading: "heading", tableRow: "table row" };

/**
 * The places where a prose block of `markdown` runs over more than one
 * line, as "FILE:LINE: ..." (lines counted from 1):
 *
 * - a line that continues a paragraph or a heading, wherever it stands: at
 *   the top level, in a list item or in a quote;
 * - a table row that does not begin with `|`, such as a line of prose that
 *   the table above takes in as a row;
 * - a code span that does not close on the line where it opens, and a
 *   backtick that opens no code span and has no backslash;
 * - a fenced block with no closing fence, which takes in the rest of its
 *   container;
 * - an indented code block and an HTML block, which can hide prose: a line
 *   indented too far in a list item becomes code. The one HTML block that
 *   a document can hold is the element of railroad diagrams that
 *   tools/sync.js writes after a block of rules (tools/railroad.js), at
 *   the top level. sync.js checks its text and its place.
 *
 * A list item can hold several paragraphs, each on its own line.
 * @param {string} markdown
 * @param {string} file
 * @returns {string[]}
 */
export function proseLineProblems(markdown, file) {
  /** @type {[number, string][]} */
  const problems = [];
  const report = (/** @type {number} */ line, /** @type {string} */ message) => problems.push([line, `${file}:${line}: ${message}`]);
  const tree = parseMarkdown(markdown);
  // Every structural fact comes from the parser (tools/markdown.js): none
  // is read again from the source text.
  /** @type {Map<object, boolean>} whether the last row of each table so far begins with `|` */
  const lastRow = new Map();
  for (const { node, ancestors } of walk(tree)) {
    const { start, end } = node.position;
    if (PROSE.has(node.type)) {
      for (let line = start.line + 1; line <= end.line; line++) {
        report(line, `this line continues the ${NAMES[node.type]} that begins on line ${start.line}; put the block on one line`);
      }
      if (node.type === "tableRow") {
        const table = ancestors[ancestors.length - 1];
        if (!node.data.leadingPipe) {
          report(start.line, lastRow.get(table)
            ? "this line is a row of the table above it; put a blank line before a paragraph"
            : "this table row does not begin with |; begin every row with |");
        }
        lastRow.set(table, node.data.leadingPipe);
      }
    } else if (node.type === "inlineCode" && end.line > start.line) {
      report(start.line, `a code span opens here and closes on line ${end.line}; close it on this line`);
    } else if (node.type === "code" && node.data && node.data.fenced && !node.data.closed) {
      report(start.line, "this fenced block has no closing fence, so it takes in the rest of its container; close it");
    } else if (node.type === "code" && !(node.data && node.data.fenced)) {
      report(start.line, "an indented code block; use a fenced block, or indent prose in a list item to the item's text");
    } else if (node.type === "html" && !ancestors.some((block) => PROSE.has(block.type)) && !(ancestors.length === 1 && isDiagramElement(node.value.split(/\r\n|\r|\n/)))) {
      report(start.line, "an HTML block; the documents use Markdown only");
    }
  }
  const backticks = new Set();
  for (const { line } of tree.data.strayBackticks) {
    if (backticks.has(line)) continue;
    backticks.add(line);
    report(line, "a backtick opens no code span here; close the span on this line, or escape the backtick");
  }
  return problems.sort((a, b) => a[0] - b[0]).map(([, problem]) => problem);
}
