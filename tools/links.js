// Whether an %include of a pipeline has its link in the prose, in the layout
// docs/design.md ("Pipelines") prescribes: the %include's block is the first
// thing under a list item, indented to the item's text, and the item's own
// line has an inline link [text](PATH) to the same path. tools/sync.js uses
// it, so that the prose and the blocks name the same documents.

/**
 * The targets of the inline links on one line of Markdown: `[text](target)`,
 * `[text](<target>)` and either with a title after spaces or tabs. An
 * escaped `[`, a code span and a whole image, its description included, hold
 * no link. A target can hold balanced parentheses.
 * @param {string} line
 * @returns {string[]}
 */
export function inlineLinkTargets(line) {
  const chars = [...line];
  // Code spans are not prose: each becomes spaces. A span closes at the next
  // backtick run of exactly the length that opened it.
  /** @param {number} at */
  const runAt = (at) => {
    let end = at;
    while (chars[end] === "`") end++;
    return end - at;
  };
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === "\\") { i++; continue; }
    if (chars[i] !== "`") continue;
    const run = runAt(i);
    let close = i + run;
    while (close < chars.length) {
      if (chars[close] !== "`") { close++; continue; }
      const length = runAt(close);
      if (length === run) break;
      close += length;
    }
    if (close >= chars.length) { i += run - 1; continue; }
    for (let k = i; k < close + run; k++) chars[k] = " ";
    i = close + run - 1;
  }
  const targets = [];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === "\\") { i++; continue; }
    const image = chars[i] === "!" && chars[i + 1] === "[";
    if (!image && chars[i] !== "[") continue;
    const link = linkAt(chars, image ? i + 1 : i);
    if (!link) continue;
    if (!image) targets.push(link.target);
    i = link.end;
  }
  return targets;
}

/**
 * The link whose `[` is at `start`: its target and the index of its `)`.
 * @param {string[]} chars
 * @param {number} start
 * @returns {{target: string, end: number} | null}
 */
function linkAt(chars, start) {
  // The link text, with brackets balanced and escapes skipped.
  let depth = 1;
  let j = start + 1;
  for (; j < chars.length && depth > 0; j++) {
    if (chars[j] === "\\") j++;
    else if (chars[j] === "[") depth++;
    else if (chars[j] === "]") depth--;
  }
  if (depth > 0 || chars[j] !== "(") return null;
  const blank = (/** @type {string | undefined} */ c) => c === " " || c === "\t";
  let k = j + 1;
  while (blank(chars[k])) k++;
  let target = "";
  if (chars[k] === "<") {
    for (k++; k < chars.length && chars[k] !== ">"; k++) {
      if (chars[k] === "\\") k++;
      target += chars[k];
    }
    if (chars[k] !== ">") return null;
    k++;
  } else {
    let parens = 0;
    for (; k < chars.length && !blank(chars[k]); k++) {
      if (chars[k] === "\\") { target += chars[++k] || ""; continue; }
      if (chars[k] === "(") parens++;
      else if (chars[k] === ")" && parens-- === 0) break;
      target += chars[k];
    }
    if (target === "") return null;
  }
  // An optional title, after at least one space or tab.
  const beforeTitle = k;
  while (blank(chars[k])) k++;
  const close = { '"': '"', "'": "'", "(": ")" }[chars[k]];
  if (close) {
    if (k === beforeTitle) return null;
    for (k++; k < chars.length && chars[k] !== close; k++) if (chars[k] === "\\") k++;
    if (chars[k] !== close) return null;
    k++;
    while (blank(chars[k])) k++;
  }
  return chars[k] === ")" ? { target, end: k } : null;
}

/**
 * Whether the %include of `path` on line `line` (counted from 1) of
 * `markdown` has its link as the layout requires.
 * @param {string} markdown
 * @param {number} line
 * @param {string} path
 * @returns {boolean}
 */
export function includeIsLinked(markdown, line, path) {
  const lines = markdown.split(/\r\n|\r|\n/);
  let fence = line - 2;
  while (fence >= 0 && !/^ {0,3}(`{3,}|~{3,})\s*jbogenbau\s*$/.test(lines[fence])) fence--;
  if (fence < 1) return false;
  const item = /^( {0,3}(?:[-*+]|\d{1,9}[.)]) +)(.*)$/.exec(lines[fence - 1]);
  if (!item) return false;
  const indent = /^ */.exec(lines[fence])[0].length;
  return indent === item[1].length && inlineLinkTargets(item[2]).includes(path);
}
