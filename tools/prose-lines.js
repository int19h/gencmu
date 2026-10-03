// Whether each prose block of a Markdown document stands on one line, as
// every document of the repository keeps it: some renderers show a line
// break inside a paragraph as a break (docs/design.md, "Documents"). The
// lines are read by tools/markdown-lines.js, and a layout that it does not
// model is an error. tools/sync.js --check runs it on every Markdown
// document.
import fs from "node:fs";
import path from "node:path";
import { codeSpans } from "./links.js";
import { classifyLines } from "./markdown-lines.js";

/** The kinds of line that hold prose. */
export const PROSE = new Set(["heading", "paragraph", "item", "table"]);

/**
 * The places where a prose block of `markdown` runs over more than one
 * line, as "FILE:LINE: ..." (lines counted from 1): a paragraph, a list
 * item's text or a heading that a line continues, a code span that does
 * not close on the line where it opens, and a line whose layout
 * tools/markdown-lines.js does not model. Fenced blocks are exempt.
 * @param {string} markdown
 * @param {string} file
 * @returns {string[]}
 */
export function proseLineProblems(markdown, file) {
  const problems = [];
  let previous = "blank";
  for (const { line, content, kind, error } of classifyLines(markdown)) {
    const at = `${file}:${line}`;
    if (kind === "unmodelled") problems.push(`${at}: ${error}; the documents do not use this layout`);
    else if (kind === "paragraph" && PROSE.has(previous)) problems.push(`${at}: this line continues the block on the line before it; put the block on one line`);
    if (PROSE.has(kind)) {
      // A code span closes on the line where it opens. An unclosed
      // backtick run is a span that closes on a later line, or a backtick
      // that needs a backslash.
      const chars = [...content];
      const covered = new Set();
      for (const span of codeSpans(content)) for (let k = span.start; k < span.end; k++) covered.add(k);
      for (let k = 0; k < chars.length; k++) {
        if (chars[k] === "\\") { k++; continue; }
        if (chars[k] === "`" && !covered.has(k)) {
          problems.push(`${at}: a code span opens here and does not close on this line`);
          break;
        }
      }
    }
    previous = kind;
  }
  return problems;
}

/**
 * The Markdown documents under a directory, relative to it, sorted. Hidden
 * directories and those of tools and builds (node_modules, target) are not
 * the repository's documents.
 * @param {string} root
 * @param {string} [prefix]
 * @returns {string[]}
 */
export function markdownFiles(root, prefix = "") {
  const files = [];
  const entries = fs.readdirSync(path.join(root, prefix), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "target") continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...markdownFiles(root, relative));
    else if (entry.name.endsWith(".md")) files.push(relative);
  }
  return files;
}
