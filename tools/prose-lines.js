// Whether each prose block of a Markdown document stands on one line, as
// every document of the repository keeps it: some renderers show a line
// break inside a paragraph as a break (docs/design.md, "Documents").
// tools/sync.js --check runs it on every Markdown document.
import fs from "node:fs";
import path from "node:path";
import { codeSpans } from "./links.js";

/**
 * Whether a line, with its quote markers removed, begins a block of its
 * own: a list item, a heading, a table row, a quote, a fence, a thematic
 * break, an HTML block or a link reference definition.
 * @param {string} content
 * @returns {boolean}
 */
function beginsBlock(content) {
  return /^\s*([-*+]\s|\d{1,9}[.)]\s|#{1,6}(\s|$)|\||>|`{3,}|~{3,}|<|\[[^\]]+\]:\s|([-*_])(\s*\3){2,}\s*$)/.test(content);
}

/**
 * Whether a line opens or closes a fenced block, as Markdown says: three
 * backticks or tildes or more after any indentation, and after backticks
 * no other backtick on the line.
 * @param {string} line
 * @returns {string | null} the fence, or null
 */
export function fenceOf(line) {
  const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
  if (!fence || (fence[1][0] === "`" && fence[2].includes("`"))) return null;
  return fence[1];
}

/**
 * The places where a prose block of `markdown` runs over more than one
 * line, as "FILE:LINE: ..." (lines counted from 1): a paragraph, a list
 * item's text, a quoted paragraph or a heading that a line continues, and
 * a code span that does not close on the line where it opens. Fenced
 * blocks are exempt.
 * @param {string} markdown
 * @param {string} file
 * @returns {string[]}
 */
export function proseLineProblems(markdown, file) {
  const problems = [];
  /** @type {string | null} */
  let fence = null;
  // The previous line's quote depth, and whether it held prose that a line
  // after it would continue.
  let depth = 0;
  let open = false;
  markdown.split(/\r\n|\r|\n/).forEach((line, index) => {
    const at = `${file}:${index + 1}`;
    if (fence) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      open = false;
      return;
    }
    const quote = /^(\s*>)*\s?/.exec(line)[0];
    const lineDepth = (quote.match(/>/g) || []).length;
    const content = line.slice(quote.length);
    const opened = fenceOf(content);
    if (opened) { fence = opened; open = false; depth = lineDepth; return; }
    if (!content.trim()) { open = false; depth = lineDepth; return; }
    if (open && lineDepth <= depth && !beginsBlock(content)) {
      problems.push(`${at}: this line continues the block on the line before it; put the block on one line`);
    }
    // A code span closes on the line where it opens. An unclosed backtick
    // run is a span that closes on a later line, or a backtick that needs
    // a backslash.
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
    depth = lineDepth;
    open = true;
  });
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
