// The layout of the top-level alternatives of a rule, which
// tools/sync.js requires of the bundled grammars (docs/notation.md,
// "Layout of the bundled grammars").
//
// A plain alternative is a juxtaposition of plain items, with no guard
// and no clause. A plain item is a rule reference without arguments, a
// string, a tag terminal, an engine tag, ε or a parameter. `_<T>` with
// one tag `T` is also a plain item. Any other alternative is a marked
// alternative. Each marked alternative stands on lines of its own. Plain
// alternatives can share lines, but a run of two or more plain
// alternatives does not put exactly one of them on each line, unless no
// two adjacent alternatives of the run fit together on one line. No line
// of a rule body holds more than LINE_LIMIT code points. A comment
// stands on its own lines, before the rule or the alternative that it
// describes. No comment shares a line with a rule header, an alternative
// or any other grammar code. Part 3 of the section, shared tag clauses,
// needs judgment, so this check does not test it.
//
// The rules and their lines come from the Markdown extraction of the engine
// and the DOM's positions. From a rule's position, a small scanner finds
// where each alternative begins, and stops at the next keyword.
import fs from "node:fs";
import { UnicodeTable } from "../lib/js/src/unicode.js";
import { extractGrammarText, splitLines } from "../lib/js/src/markdown.js";
import { countWork, hooks } from "../lib/js/src/testing.js";

const unicode = new UnicodeTable(fs.readFileSync(new URL("../data/unicode/unicode.txt", import.meta.url), "utf8"));

export const LINE_LIMIT = 100;

// Temporary exemption: another branch rewrites these documents, so the
// layout check does not apply to them for now.
export const TEMPORARY_LAYOUT_EXEMPTIONS = ["grammars/eberban/"];

/**
 * Whether an expression of the DOM is a single symbol.
 * @param {Record<string, unknown>} expr
 * @returns {boolean}
 */
export function isSingleSymbol(expr) {
  return !!expr.splice || !!expr.call || !!expr.param || typeof expr.ref === "string" || "literal" in expr || "wildcard" in expr || "terminal" in expr || "range" in expr || "property" in expr || "test" in expr || expr.empty === true;
}

/**
 * Whether an expression of the DOM is one plain item.
 * @param {Record<string, unknown>} expr
 * @returns {boolean}
 */
export function isPlainItem(expr) {
  if (!expr || typeof expr !== "object") return false;
  if (typeof expr.ref === "string") return true;
  if (typeof expr.param === "string") return true;
  if (expr.empty === true) return true;
  const literal = /** @type {any} */ (expr).literal;
  if (literal && typeof literal.string === "string") return true;
  // `_<T>` with one tag `T` is a plain item.
  const test = /** @type {any} */ (expr);
  if (test.test !== undefined && test.expr && test.expr.wildcard === true && Array.isArray(test.requirements) && test.requirements.length === 1 && !test.requirements[0].negated && test.requirements[0].value && typeof test.requirements[0].value.tag === "string") return true;
  return false;
}

// The written text of an alternative with strings removed, so that a
// bracket, `&` or `≻` inside a string does not mark the alternative.
/** @param {string} text */
function sourceWithoutStrings(text) {
  let out = "";
  let string = false;
  for (const c of text) {
    if (string) { if (c === '"') string = false; continue; }
    if (c === '"') { string = true; continue; }
    out += c;
  }
  return out;
}

/**
 * Whether a DOM alternative, as written, is a plain alternative.
 * `hasInternalComment` says a comment stands between its first and last
 * written code points.
 * @param {any} alternative
 * @param {string} text the alternative as written
 * @param {boolean} [hasInternalComment]
 * @returns {boolean}
 */
export function isPlainAlternative(alternative, text, hasInternalComment = false) {
  if (!alternative || (alternative.guards && alternative.guards.length !== 0)) return false;
  if (alternative.tags !== undefined || alternative.value !== undefined || alternative.image !== undefined) return false;
  if (hasInternalComment) return false;
  if (/[\[\]{}()&≻]/.test(sourceWithoutStrings(text))) return false;
  const expr = alternative.expr;
  const items = expr && Array.isArray(expr.seq) ? expr.seq : [expr];
  return items.every((item) => isPlainItem(item));
}

/**
 * A symbol as written, with the lines it occupies, from its first to its
 * last. Its text keeps its own line breaks.
 * @typedef {{text: string, lines: number[]}} WrittenSymbol
 * @typedef {{rule: any, keyword: string, line: number, indent: string, symbols: WrittenSymbol[]}} EligibleRule
 */

/**
 * The eligible rules of a document, each with its symbols as written and the
 * lines of each. `dom` is the document's DOM.
 * @param {string} markdown
 * @param {{rules: any[]}} dom
 * @param {string} path
 * @returns {EligibleRule[]}
 */
/**
 * Every comment of the extracted grammar text, as a range of indexes.
 * @param {string[]} chars
 * @returns {{from: number, to: number}[]}
 */
export function scanComments(chars) {
  /** @type {{from: number, to: number}[]} */
  const comments = [];
  let string = false;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (string) { if (c === '"') string = false; continue; }
    if (c === '"') { string = true; continue; }
    if (c === "(" && chars[i + 1] === "*") {
      const from = i;
      let depth = 1;
      i += 2;
      while (i < chars.length && depth) {
        if (chars[i] === "(" && chars[i + 1] === "*") { depth++; i += 2; continue; }
        if (chars[i] === "*" && chars[i + 1] === ")") { depth--; i += 2; continue; }
        i++;
      }
      comments.push({ from, to: i });
      i--;
    }
  }
  return comments;
}

/**
 * The layout of every rule of a document: each top-level alternative as
 * written, the lines its code occupies, and whether it is plain.
 * @typedef {{text: string, lines: number[], plain: boolean, from: number, to: number}} WrittenAlternative
 * @typedef {{rule: any, keyword: string, line: number, indent: string, alternatives: WrittenAlternative[], comments: {from: number, to: number, lines: number[]}[]}} RuleLayout
 * @param {string} markdown
 * @param {{rules: any[]}} dom
 * @param {string} path
 * @returns {RuleLayout[]}
 */
export function alternativeLayouts(markdown, dom, path) {
  const { text, positions } = extractGrammarText(markdown, path, unicode);
  const chars = [...text];
  const lines = splitLines(markdown);
  const comments = scanComments(chars).map(({ from, to }) => ({ from, to, lines: [...new Set(positions.slice(from, to).map(([line]) => line))] }));
  /** @type {Map<string, number>} */
  const indexOf = new Map();
  positions.forEach(([line, column], index) => {
    if (!indexOf.has(`${line}:${column}`)) indexOf.set(`${line}:${column}`, index);
  });
  /** @type {RuleLayout[]} */
  const result = [];
  for (const rule of dom.rules) {
    const alternatives = rule.alternatives ?? [];
    if (alternatives.length < 1) continue;
    const start = indexOf.get(`${rule.at[0]}:${rule.at[1]}`);
    if (start === undefined || chars[start] !== "%") throw new Error(`${path}:${rule.at[0]}:${rule.at[1]}: no keyword at the position of rule ${rule.name}`);
    const starts = scanBody(chars, start);
    if (starts.length !== alternatives.length) throw new Error(`${path}:${rule.at[0]}: found ${starts.length} alternatives of rule ${rule.name} in its text, but its DOM has ${alternatives.length}`);
    const written = starts.map(({ from, to }, index) => {
      const writtenText = chars.slice(from, to).join("");
      const hasInternalComment = comments.some((comment) => comment.from > from && comment.to < to);
      return {
        text: writtenText,
        lines: [...new Set(positions.slice(from, to).map(([line]) => line))],
        plain: isPlainAlternative(alternatives[index], writtenText, hasInternalComment),
        from, to,
      };
    });
    const headLine = lines[rule.at[0] - 1];
    const headIndent = /^\s*/.exec(headLine)?.[0] ?? "";
    const firstLine = written[0].lines[0];
    const indent = firstLine === rule.at[0] ? `${headIndent}  ` : (/^\s*/.exec(lines[firstLine - 1])?.[0] ?? "");
    const keyword = { define: "%rule", redefine: "%redefine-rule", extend: "%extend-rule" }[/** @type {"define" | "redefine" | "extend"} */ (rule.op)];
    result.push({ rule, keyword, line: rule.at[0], indent, alternatives: written, comments });
  }
  return result;
}

/**
 * The rules of a document whose alternatives are all plain, each with
 * its alternatives as written and the lines of each.
 * @param {string} markdown
 * @param {{rules: any[]}} dom
 * @param {string} path
 * @returns {EligibleRule[]}
 */
export function eligibleRules(markdown, dom, path) {
  /** @type {EligibleRule[]} */
  const result = [];
  for (const layout of alternativeLayouts(markdown, dom, path)) {
    if (layout.alternatives.length < 2) continue;
    if (!layout.alternatives.every((alternative) => alternative.plain)) continue;
    result.push({ rule: layout.rule, keyword: layout.keyword, line: layout.line, indent: layout.indent, symbols: layout.alternatives.map(({ text, lines }) => ({ text, lines })) });
  }
  return result;
}

/**
 * Where each alternative of the rule whose keyword is at `start` begins and
 * ends in `chars`: the index of its first code point, and the index after
 * its last. The body ends at the next keyword, a clause or the next item, or
 * at the end of the text.
 * @param {string[]} chars
 * @param {number} start
 * @returns {{from: number, to: number}[]}
 */
function scanBody(chars, start) {
  const isSpace = (/** @type {string | undefined} */ c) => c !== undefined && /\p{White_Space}/u.test(c);
  const isNameChar = (/** @type {string | undefined} */ c) => c !== undefined && /[A-Za-z0-9_-]/.test(c);
  let i = start + 1;
  while (isNameChar(chars[i])) i++;
  /** @type {(at: number) => number} */
  const skipLayout = (at) => {
    for (;;) {
      while (isSpace(chars[at])) at++;
      if (chars[at] !== "-" || chars[at + 1] !== "-") return at;
      at += 2;
      while (at < chars.length && chars[at]!=="\n" && chars[at]!=="\r") at++;
    }
  };
  // The rule's name is an identifier or one eligible emoji.
  i = skipLayout(i);
  if (chars[i] !== undefined && unicode.isEmojiName(chars[i])) i++;
  else while (isNameChar(chars[i])) i++;
  if (chars[i] === "(") {
    let depth=1;
    for (i++;i<chars.length && depth;i++) {
      i=skipLayout(i);
      if(i>=chars.length) break;
      if(chars[i] === '"') {for(i++;i<chars.length && chars[i] !== '"';i++);}
      else if(chars[i] === "(") depth++;
      else if(chars[i] === ")") depth--;
    }
  }
  i = skipLayout(i);
  // A header clause precedes the bar that starts the ordinary body.
  if (chars[i] === ":" && [":", "=", "-"].includes(chars[i + 1])) {
    let headerDepth = 0;
    while (i < chars.length) {
      i = skipLayout(i);
      if (chars[i] === "\"") {
        i++;
        while (i < chars.length && chars[i] !== "\"") i++;
      } else if (chars[i] === "(") headerDepth++;
      else if (chars[i] === ")") headerDepth--;
      else if (chars[i] === "|" && headerDepth === 0) break;
      i++;
    }
  }
  /** @type {{from: number, to: number}[]} */
  const alternatives = [];
  /** @type {{from: number, to: number} | null} */
  let current = null;
  let depth = 0;
  for (;;) {
    i = skipLayout(i);
    if (i >= chars.length || depth === 0 && chars[i] === "%") break;
    if (depth === 0 && chars[i] === "|") {
      if (current) alternatives.push(current);
      current = null;
      i++;
      continue;
    }
    const from = i;
    const c = chars[i];
    if (c === "\"") {
      // A character tag, a property or a string, with its escapes.
      i++;
      while (i < chars.length && chars[i] !== c) i++;
      i++;
    } else {
      if (c === "(" || c === "[" || c === "{" || c === "<") depth++;
      else if (c === ")" || c === "]" || c === "}" || c === ">") depth--;
      i++;
    }
    if (current) current.to = i;
    else current = { from, to: i };
  }
  if (current) alternatives.push(current);
  return alternatives;
}

/**
 * The lines of a layout of `symbols`, each indented by `indent`. The layout
 * has the fewest lines that hold at most `limit` code points. For that number
 * of lines, it takes the split whose longest line is shortest. One line has
 * no leading `|` unless a header clause precedes it. Every line of several
 * begins with `| `.
 *
 * A symbol keeps its own line breaks, and the lines after its first stay as
 * written. The next symbol continues its last line. A symbol that does not fit
 * by itself stands alone, and its lines that are too long do not count toward
 * the longest.
 * @param {string[]} symbols
 * @param {string} indent
 * @param {number} [limit]
 * @param {boolean} [leadingBar] whether a header clause precedes the body
 * @returns {string[]}
 */
export function suggestLayout(symbols, indent, limit = LINE_LIMIT, leadingBar = false) {
  const width = (/** @type {string} */ s) => [...s].length;
  const parts = symbols.map((symbol) => symbol.split("\n"));
  const n = symbols.length;
  // The lines of symbols i to j - 1 as one line of the layout, which begins
  // with `start`.
  /** @type {(i: number, j: number, start: string) => string[]} */
  const linesOf = (i, j, start) => {
    const lines = [start];
    for (let k = i; k < j; k++) {
      const [first, ...rest] = parts[k];
      lines[lines.length - 1] += (k === i ? "" : " | ") + first;
      for (const line of rest) lines.push(line);
    }
    return lines;
  };
  const one = linesOf(0, n, indent + (leadingBar ? "| " : ""));
  if (one.length === 1 && width(one[0]) <= limit) return one;
  // cost[i][j - i - 1]: what a line of the layout of symbols i to j - 1
  // counts toward the longest line, for each j up to the last such line
  // that can be a line of the layout.
  // Each row is built by adding one symbol at a time to the line, and stops
  // once a line of two or more symbols is too long: adding symbols never
  // shortens a line, so no longer one fits either. Rebuilding every line
  // from its first symbol, for every pair, would cost the cube of n.
  /** @type {number[][]} */
  const cost = [];
  const partWidths = parts.map((lines) => lines.map(width));
  const startWidth = width(`${indent}| `);
  for (let i = 0; i < n; i++) {
    /** @type {number[]} */
    const row = [];
    cost.push(row);
    let last = startWidth;
    let most = 0;
    let fits = true;
    for (let j = i + 1; j <= n; j++) {
      if (hooks.work) countWork(hooks.work, "text");
      const widths = partWidths[j - 1];
      last += (j - 1 === i ? 0 : 3) + widths[0];
      // Each of the symbol's other lines counts before it is read, so that
      // a row that read them again for each start fails its budget.
      for (let line = 1; line < widths.length; line++) {
        if (hooks.work) countWork(hooks.work, "text");
        if (last <= limit) most = Math.max(most, last);
        else fits = false;
        last = widths[line];
      }
      const lastFits = last <= limit;
      // Kept from i + 1 on: an array with holes before i would cost i to walk.
      if ((fits && lastFits) || j - i === 1) row.push(Math.max(most, lastFits ? last : 0));
      else break;
    }
  }
  // The starts of the lines that can end before j, last first, as the
  // search below takes them: each row is short, so this is the size of the
  // table rather than of every pair.
  /** @type {number[][]} */
  const starts = Array.from({ length: n + 1 }, () => []);
  for (let i = n - 1; i >= 0; i--) {
    cost[i].forEach((_, index) => {
      if (hooks.work) countWork(hooks.work, "text");
      starts[i + 1 + index].push(i);
    });
  }
  // The fewest lines of the layout for the symbols before each j, and for
  // those from each i to the end. Every symbol can stand alone, so both are
  // finite. The fewest for all of them is `lines`.
  const before = [0];
  for (let j = 1; j <= n; j++) {
    let fewest = Infinity;
    for (const i of starts[j]) {
      if (hooks.work) countWork(hooks.work, "text");
      fewest = Math.min(fewest, 1 + before[i]);
    }
    before.push(fewest);
  }
  const after = Array(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let fewest = Infinity;
    cost[i].forEach((_, index) => {
      if (hooks.work) countWork(hooks.work, "text");
      fewest = Math.min(fewest, 1 + after[i + 1 + index]);
    });
    after[i] = fewest;
  }
  const lines = before[n];
  // best[k]: for each j, the shortest longest line of symbols 0 to j - 1 on
  // k lines of the layout; from[k]: where the last of those lines begins.
  // The lines after the first of each symbol are the same in every layout,
  // so the fewest lines of the layout make the fewest lines. Only the j that
  // k lines can reach, and from which the rest fits in the lines left, can
  // be on the way to the answer, so only they are filled in: a full table
  // for each number of lines would cost that number times the square of n.
  /** @type {number[][]} */
  const active = Array.from({ length: lines + 1 }, () => []);
  for (let j = 1; j <= n; j++) {
    for (let k = before[j]; k <= lines - after[j]; k++) {
      if (hooks.work) countWork(hooks.work, "text");
      active[k].push(j);
    }
  }
  /** @type {Map<number, number>[]} */
  const best = [new Map([[0, 0]])];
  /** @type {Map<number, number>[]} */
  const from = [new Map()];
  for (let k = 1; k <= lines; k++) {
    /** @type {Map<number, number>} */
    const level = new Map();
    /** @type {Map<number, number>} */
    const levelFrom = new Map();
    best.push(level);
    from.push(levelFrom);
    for (const j of active[k]) {
      let shortest = Infinity;
      for (const i of starts[j]) {
        if (hooks.work) countWork(hooks.work, "text");
        const previous = best[k - 1].get(i);
        if (previous === undefined) continue;
        const value = Math.max(previous, cost[i][j - i - 1]);
        if (value < shortest) {
          shortest = value;
          levelFrom.set(j, i);
        }
      }
      if (shortest < Infinity) level.set(j, shortest);
    }
  }
  /** @type {string[][]} */
  const groups = [];
  for (let j = n, line = lines; line > 0; line--) {
    const i = /** @type {number} */ (from[line].get(j));
    groups.push(linesOf(i, j, `${indent}| `));
    j = i;
  }
  return groups.reverse().flat();
}

/**
 * The layout problems of a document's eligible rules, each a message that
 * names the file, the line and the rule.
 * @param {string} markdown
 * @param {{rules: any[]}} dom
 * @param {string} path
 * @param {number} [limit]
 * @returns {string[]}
 */
export function layoutProblems(markdown, dom, path, limit = LINE_LIMIT) {
  if (TEMPORARY_LAYOUT_EXEMPTIONS.some((prefix) => path.startsWith(prefix))) return [];
  const lines = splitLines(markdown);
  /** @type {string[]} */
  const problems = clauseLayoutProblems(markdown, dom, path);
  problems.push(...commentLayoutProblems(markdown, path));
  for (const { rule, keyword, line, indent, alternatives, comments } of alternativeLayouts(markdown, dom, path)) {
    // How many alternatives occupy each line of the body.
    /** @type {Map<number, number>} */
    const occupants = new Map();
    for (const alternative of alternatives) for (const number of alternative.lines) occupants.set(number, (occupants.get(number) ?? 0) + 1);
    const bodyLines = [...occupants.keys()].sort((a, b) => a - b);
    for (const number of bodyLines) {
      const width = [...lines[number - 1]].length;
      if (width > limit) problems.push(`${path}:${number}: a line of ${keyword} ${rule.name} holds ${width} characters, more than ${limit}`);
    }
    // Each marked alternative stands on lines of its own.
    const markedShared = new Set();
    for (const alternative of alternatives) {
      if (alternative.plain) continue;
      for (const number of alternative.lines) if ((occupants.get(number) ?? 0) > 1) markedShared.add(number);
    }
    for (const number of [...markedShared].sort((a, b) => a - b)) problems.push(`${path}:${number}: a marked alternative of ${keyword} ${rule.name} shares its line with another alternative; put it on lines of its own`);
    // A run of plain alternatives does not put one of them on each line.
    let runStart = 0;
    while (runStart < alternatives.length) {
      if (!alternatives[runStart].plain) { runStart++; continue; }
      let runEnd = runStart;
      // A comment on its own lines between two plain alternatives breaks
      // the run, because it stands before the alternative after it.
      while (runEnd + 1 < alternatives.length && alternatives[runEnd + 1].plain && !comments.some((comment) => comment.from > alternatives[runEnd].to && comment.to < alternatives[runEnd + 1].from)) runEnd++;
      const run = alternatives.slice(runStart, runStart = runEnd + 1);
      if (run.length < 2) continue;
      const runLines = [...new Set(run.flatMap((alternative) => alternative.lines))].sort((a, b) => a - b);
      if (runLines.length < 2) continue;
      if (runLines.some((number) => (occupants.get(number) ?? 0) !== 1)) continue;
      const coversAll = run.length === alternatives.length;
      const header = rule.tags !== undefined || rule.value !== undefined || rule.image !== undefined;
      const suggestion = suggestLayout(run.map((alternative) => alternative.text.trim()), indent, limit, header || !coversAll);
      // When no two adjacent alternatives fit on one line, one per line
      // is the only layout. A suggestion with fewer lines puts two
      // alternatives on one line.
      if (suggestion.length < runLines.length) {
        const at = coversAll ? line : run[0].lines[0];
        problems.push(`${path}:${at}: ${keyword} ${rule.name} puts one plain alternative on each of its ${runLines.length} lines; write:\n${suggestion.join("\n")}`);
      }
    }
  }
  return problems;
}

/**
 * A comment stands on its own lines. No comment shares a line with
 * grammar code, such as a rule header or an alternative.
 * @param {string} markdown
 * @param {string} path
 * @returns {string[]}
 */
function commentLayoutProblems(markdown, path) {
  const { text, positions } = extractGrammarText(markdown, path, unicode);
  const chars = [...text];
  const comments = scanComments(chars);
  if (!comments.length) return [];
  const commentIndexes = new Set();
  for (const { from, to } of comments) for (let i = from; i < to; i++) commentIndexes.add(i);
  /** @type {Set<number>} */
  const codeLines = new Set();
  chars.forEach((c, index) => {
    if (commentIndexes.has(index)) return;
    if (c === "\n" || c === "\r" || /\p{White_Space}/u.test(c)) return;
    codeLines.add(positions[index][0]);
  });
  /** @type {string[]} */
  const problems = [];
  for (const { from, to } of comments) {
    const commentLines = [...new Set(positions.slice(from, to).map(([line]) => line))];
    for (const number of commentLines) {
      if (codeLines.has(number)) problems.push(`${path}:${number}: put a comment on its own lines, before the rule or alternative that it describes`);
    }
  }
  return problems;
}

/**
 * Header clauses and blank layout in grammar blocks, outside opaque tokens.
 * @param {string} markdown
 * @param {{rules: any[]}} dom
 * @param {string} path
 * @returns {string[]}
 */
function clauseLayoutProblems(markdown, dom, path) {
  const { text, positions } = extractGrammarText(markdown, path, unicode);
  const chars = [...text];
  const lines = splitLines(markdown);
  const codeLines = new Set(positions.map(([line]) => line));
  const opaqueLines = new Set();
  const visible = new Map();
  let comment = 0;
  let string = false;
  for (let i = 0; i < chars.length; i++) {
    const line = positions[i][0];
    const c = chars[i];
    if (comment) {
      opaqueLines.add(line);
      if (c === "\n" || c === "\r") comment=0;
    } else if (string) {
      opaqueLines.add(line);
      if (c === '"') string = false;
    } else if (c === "-" && chars[i + 1] === "-") {
      opaqueLines.add(line);
      comment++; i++;
    } else if (c === '"') {
      opaqueLines.add(line);
      string = true;
    } else if (c !== "\n" && c !== "\r") {
      visible.set(line, (visible.get(line) ?? "") + c);
    }
  }
  const problems = [];
  for (const rule of dom.rules) {
    if (rule.tags === undefined) continue;
    const line = rule.at[0];
    const header = visible.get(line) ?? "";
    if (!header.includes("::") || /::\s*$/.test(header)) {
      problems.push(`${path}:${line}: put the common tag clause on the definition header`);
    }
  }
  for (const line of codeLines) {
    if (opaqueLines.has(line)) continue;
    if (lines[line - 1].trim() === "" && codeLines.has(line - 1) && !opaqueLines.has(line - 1) && lines[line - 2].trim() === "") {
      problems.push(`${path}:${line}: leave at most one blank line between grammar items`);
    }
    if (/^\s*%(?:conditions|emits|erased)\b/.test(visible.get(line) ?? "") && codeLines.has(line - 1) && !opaqueLines.has(line - 1) && lines[line - 2].trim() === "") {
      problems.push(`${path}:${line}: remove the blank line before the definition clause`);
    }
  }
  return problems;
}
