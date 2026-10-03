// Whether each prose block of a Markdown document stands on one line, as
// every document of the repository keeps it: some renderers show a line
// break inside a paragraph as a break (docs/design.md, "Documents"). The
// blocks are those of a CommonMark and GFM parser (tools/markdown.js), so a
// lazy continuation line, a setext heading or a paragraph that a table takes
// in as a row is seen where GitHub sees it. tools/sync.js --check runs it on
// every Markdown document that git tracks.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseMarkdown, walk } from "./markdown.js";

/** The blocks that hold prose: each stands on one line. */
export const PROSE = new Set(["paragraph", "heading", "tableRow"]);

const NAMES = { paragraph: "paragraph", heading: "heading", tableRow: "table row" };

/**
 * The places where a prose block of `markdown` runs over more than one
 * line, as "FILE:LINE: ..." (lines counted from 1):
 *
 * - a line that continues a paragraph or a heading, wherever it stands: at
 *   the top level, in a list item or in a quote;
 * - a table row that does not begin with `|`, which is a line of prose that
 *   the table above takes in as a row;
 * - a code span that does not close on the line where it opens, and a
 *   backtick that opens no code span and has no backslash;
 * - a fenced block with no closing fence, which takes in the rest of its
 *   container.
 *
 * The content of code blocks and HTML blocks is not prose.
 * @param {string} markdown
 * @param {string} file
 * @returns {string[]}
 */
export function proseLineProblems(markdown, file) {
  /** @type {[number, string][]} */
  const problems = [];
  const report = (/** @type {number} */ line, /** @type {string} */ message) => problems.push([line, `${file}:${line}: ${message}`]);
  for (const { node, ancestors } of walk(parseMarkdown(markdown))) {
    const { start, end } = node.position;
    if (PROSE.has(node.type)) {
      for (let line = start.line + 1; line <= end.line; line++) {
        report(line, `this line continues the ${NAMES[node.type]} that begins on line ${start.line}; put the block on one line`);
      }
      if (node.type === "tableRow" && markdown[start.offset] !== "|") {
        report(start.line, "this line is a row of the table above it; put a blank line before a paragraph, and begin a row with |");
      }
    } else if (node.type === "inlineCode" && end.line > start.line) {
      report(start.line, `a code span opens here and closes on line ${end.line}; close it on this line`);
    } else if (node.type === "text" && ancestors.some((block) => PROSE.has(block.type))) {
      const source = markdown.slice(start.offset, end.offset);
      for (let k = 0; k < source.length; k++) {
        if (source[k] === "\\") { k++; continue; }
        if (source[k] === "`") {
          report(start.line + (source.slice(0, k).match(/\n/g) || []).length, "a backtick opens no code span here; close the span on this line, or escape the backtick");
          break;
        }
      }
    } else if (node.type === "code") {
      const lines = markdown.slice(start.offset, end.offset).split(/\r\n|\r|\n/);
      const opening = /^(`{3,}|~{3,})/.exec(lines[0]);
      const closing = /^[\s>]*(`{3,}|~{3,})\s*$/.exec(lines[lines.length - 1]);
      const closed = lines.length > 1 && closing && closing[1][0] === opening?.[1][0] && closing[1].length >= opening[1].length;
      if (opening && !closed) report(start.line, "this fenced block has no closing fence, so it takes in the rest of its container; close it");
    }
  }
  return problems.sort((a, b) => a[0] - b[0]).map(([, problem]) => problem);
}

/**
 * The Markdown documents of the repository at `root`, relative to it,
 * sorted: those that git tracks, or in a copy outside git, every one under
 * it. Hidden directories and those of tools and builds (node_modules,
 * target) hold none of the repository's documents.
 * @param {string} root
 * @returns {string[]}
 */
export function markdownFiles(root) {
  try {
    const listed = execFileSync("git", ["-C", root, "ls-files", "--cached", "-z", "--", "*.md"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return listed.split("\0").filter(Boolean).sort();
  } catch {
    return walkMarkdownFiles(root);
  }
}

/**
 * @param {string} root
 * @param {string} [prefix]
 * @returns {string[]}
 */
function walkMarkdownFiles(root, prefix = "") {
  const files = [];
  const entries = fs.readdirSync(path.join(root, prefix), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "target") continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walkMarkdownFiles(root, relative));
    else if (entry.name.endsWith(".md")) files.push(relative);
  }
  return files;
}
