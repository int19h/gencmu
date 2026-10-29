// The one thing read from Markdown by code rather than by grammar: the
// `jbogenbau` blocks of a grammar document (engine §8).

import { GencmuError } from "./errors.js";

// The grammar text of a document: its `jbogenbau` blocks joined with a newline,
// with the line and column of every code point in the document, and the
// number of blocks. A document with no block holds no grammar.
/**
 * @param {string} markdown
 * @param {string} path
 * @returns {{text: string, positions: import("./types.js").Position[], blocks: number}}
 */
export function extractGrammarText(markdown, path) {
  const lines = splitLines(markdown);
  /** @type {string[]} */
  const chars = [];
  /** @type {import("./types.js").Position[]} */
  const positions = [];
  /** @type {string | {skip: string} | null} */
  let inside = null;
  let openedAt = 0;
  let blocks = 0;
  for (let number = 0; number < lines.length; number++) {
    const line = lines[number];
    if (inside === null) {
      // A fence and its info string; a backtick fence's info string has no
      // backtick, or the line is not a fence (CommonMark). Only an info
      // string that is exactly `jbogenbau` makes a grammar block.
      const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/s.exec(line);
      const open = fence && !(fence[1][0] === "`" && fence[2].includes("`")) ? [fence[0], fence[1], trimWhiteSpace(fence[2])] : null;
      if (open && open[2] === "jbogenbau") {
        inside = open[1];
        openedAt = number + 1;
        if (blocks > 0) {
          chars.push("\n");
          positions.push([number + 1, 1]);
        }
        blocks++;
      } else if (open) {
        inside = { skip: open[1] };
      }
      continue;
    }
    const fence = typeof inside === "string" ? inside : inside.skip;
    const close = /^ {0,3}(`{3,}|~{3,})\p{White_Space}*$/u.exec(line);
    if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
      inside = null;
      continue;
    }
    if (typeof inside !== "string") continue;
    let column = 1;
    for (const character of line) {
      chars.push(character);
      positions.push([number + 1, column++]);
    }
    chars.push("\n");
    positions.push([number + 1, column]);
  }
  if (inside !== null && typeof inside === "string") {
    const column = lines[openedAt - 1].indexOf(inside[0]) + 1;
    throw new GencmuError("grammar", `${path}:${openedAt}:${column}: a jbogenbau block that is never closed`, { document: path, line: openedAt, column });
  }
  return { text: chars.join(""), positions, blocks };
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
  return text.split(/\r\n|\r|\n/);
}

// Scan only the edges, so a long inner whitespace run costs no backtracking.
/** @param {string} text @returns {string} */
function trimWhiteSpace(text) {
  let start = 0, end = text.length;
  while (start < end && /\p{White_Space}/u.test(text[start])) start++;
  while (end > start && /\p{White_Space}/u.test(text[end - 1])) end--;
  return text.slice(start, end);
}

// A path relative to a document, resolved and normalized.
/**
 * @param {string} from
 * @param {string} relative
 * @returns {string}
 */
export function resolvePath(from, relative) {
  if (relative.startsWith("/")) throw new GencmuError("grammar", "a path target must be relative", {document:from});
  const absolute = from.startsWith("/");
  const parts = [];
  for (const part of [...from.split("/").slice(0, -1), ...relative.split("/")]) {
    if (part === "" || part === ".") continue;
    if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop();
    else if (part !== ".." || !absolute) parts.push(part);
  }
  return (absolute ? "/" : "") + parts.join("/") || ".";
}
