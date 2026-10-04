// The layout of rules whose alternatives are single symbols, which
// tools/sync.js requires of the bundled grammars (docs/notation.md, "Rules").
//
// A rule is eligible when its DOM has two or more alternatives, and each is a
// single symbol with no guard and no tags of its own. A single symbol is a
// reference, a terminal, a range, a property, a tested symbol or ε. An
// eligible rule does not put exactly one symbol on each of its lines when it
// has more than one, unless no two adjacent symbols fit on one line. Each line
// that a symbol of its body occupies holds at most LINE_LIMIT code points. A
// symbol can run over several lines, and each of them counts. A rule chooses
// its own grouping otherwise.
//
// The rules and their lines come from the Markdown extraction of the engine
// and the DOM's positions. From a rule's position, a small scanner finds
// where each alternative begins, and stops at the next keyword.
import { extractGrammarText, splitLines } from "../lib/js/src/markdown.js";

export const LINE_LIMIT = 100;

/**
 * Whether an expression of the DOM is a single symbol.
 * @param {Record<string, unknown>} expr
 * @returns {boolean}
 */
export function isSingleSymbol(expr) {
  return typeof expr.ref === "string" || "terminal" in expr || "range" in expr || "property" in expr || "test" in expr || expr.empty === true;
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
export function eligibleRules(markdown, dom, path) {
  const { text, positions } = extractGrammarText(markdown, path);
  const chars = [...text];
  const lines = splitLines(markdown);
  /** @type {Map<string, number>} */
  const indexOf = new Map();
  positions.forEach(([line, column], index) => {
    if (!indexOf.has(`${line}:${column}`)) indexOf.set(`${line}:${column}`, index);
  });
  /** @type {EligibleRule[]} */
  const result = [];
  for (const rule of dom.rules) {
    const alternatives = rule.alternatives;
    if (alternatives.length < 2) continue;
    if (!alternatives.every((/** @type {any} */ alternative) => alternative.guards.length === 0 && alternative.tags === undefined && isSingleSymbol(alternative.expr))) continue;
    const start = indexOf.get(`${rule.at[0]}:${rule.at[1]}`);
    if (start === undefined || chars[start] !== "%") throw new Error(`${path}:${rule.at[0]}:${rule.at[1]}: no keyword at the position of rule ${rule.name}`);
    const starts = scanBody(chars, start);
    if (starts.length !== alternatives.length) throw new Error(`${path}:${rule.at[0]}: found ${starts.length} alternatives of rule ${rule.name} in its text, but its DOM has ${alternatives.length}`);
    const written = starts.map(({ from, to }) => ({
      text: chars.slice(from, to).join(""),
      lines: [...new Set(positions.slice(from, to).map(([line]) => line))],
    }));
    const headLine = lines[rule.at[0] - 1];
    const headIndent = /^\s*/.exec(headLine)?.[0] ?? "";
    const firstLine = written[0].lines[0];
    const indent = firstLine === rule.at[0] ? `${headIndent}  ` : (/^\s*/.exec(lines[firstLine - 1])?.[0] ?? "");
    const keyword = { define: "%rule", redefine: "%redefine-rule", extend: "%extend-rule" }[/** @type {"define" | "redefine" | "extend"} */ (rule.op)];
    result.push({ rule, keyword, line: rule.at[0], indent, symbols: written });
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
  const isNameChar = (/** @type {string | undefined} */ c) => c !== undefined && /[A-Za-z0-9-]/.test(c);
  let i = start + 1;
  while (isNameChar(chars[i])) i++;
  /** @type {(at: number) => number} */
  const skipLayout = (at) => {
    for (;;) {
      while (isSpace(chars[at])) at++;
      if (chars[at] !== "(" || chars[at + 1] !== "*") return at;
      at += 2;
      while (at < chars.length && !(chars[at] === "*" && chars[at + 1] === ")")) at++;
      at += 2;
    }
  };
  // The rule's name, a name or #.
  i = skipLayout(i);
  if (chars[i] === "#") i++;
  else while (isNameChar(chars[i])) i++;
  /** @type {{from: number, to: number}[]} */
  const alternatives = [];
  /** @type {{from: number, to: number} | null} */
  let current = null;
  let depth = 0;
  for (;;) {
    i = skipLayout(i);
    if (i >= chars.length || (depth === 0 && chars[i] === "%")) break;
    if (depth === 0 && chars[i] === "|") {
      if (current) alternatives.push(current);
      current = null;
      i++;
      continue;
    }
    const from = i;
    const c = chars[i];
    if (c === "'" || c === "\"") {
      // A character tag, a property or a string, with its escapes.
      i++;
      while (i < chars.length && chars[i] !== c) i += chars[i] === "\\" ? 2 : 1;
      i++;
    } else if (c === "/") {
      i += 3;
    } else {
      if (c === "(" || c === "[" || c === "<") depth++;
      else if (c === ")" || c === "]" || c === ">") depth--;
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
 * no leading `|`, and every line of several begins with `| `.
 *
 * A symbol keeps its own line breaks, and the lines after its first stay as
 * written. The next symbol continues its last line. A symbol that does not fit
 * by itself stands alone, and its lines that are too long do not count toward
 * the longest.
 * @param {string[]} symbols
 * @param {string} indent
 * @param {number} [limit]
 * @returns {string[]}
 */
export function suggestLayout(symbols, indent, limit = LINE_LIMIT) {
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
  const one = linesOf(0, n, indent);
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
      const [first, ...rest] = partWidths[j - 1];
      last += (j - 1 === i ? 0 : 3) + first;
      for (const w of rest) {
        if (last <= limit) most = Math.max(most, last);
        else fits = false;
        last = w;
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
    cost[i].forEach((_, index) => starts[i + 1 + index].push(i));
  }
  // The fewest lines of the layout for the symbols before each j, and for
  // those from each i to the end. Every symbol can stand alone, so both are
  // finite. The fewest for all of them is `lines`.
  const before = [0];
  for (let j = 1; j <= n; j++) {
    let fewest = Infinity;
    for (const i of starts[j]) fewest = Math.min(fewest, 1 + before[i]);
    before.push(fewest);
  }
  const after = Array(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let fewest = Infinity;
    cost[i].forEach((_, index) => {
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
  for (let j = 1; j <= n; j++) for (let k = before[j]; k <= lines - after[j]; k++) active[k].push(j);
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
  const lines = splitLines(markdown);
  /** @type {string[]} */
  const problems = [];
  for (const { rule, keyword, line, indent, symbols } of eligibleRules(markdown, dom, path)) {
    // How many symbols occupy each line of the body.
    /** @type {Map<number, number>} */
    const occupants = new Map();
    for (const symbol of symbols) for (const number of symbol.lines) occupants.set(number, (occupants.get(number) ?? 0) + 1);
    const bodyLines = [...occupants.keys()].sort((a, b) => a - b);
    for (const number of bodyLines) {
      const width = [...lines[number - 1]].length;
      if (width > limit) problems.push(`${path}:${number}: a line of ${keyword} ${rule.name} holds ${width} characters, more than ${limit}`);
    }
    if (bodyLines.length < 2 || [...occupants.values()].some((count) => count !== 1)) continue;
    const suggestion = suggestLayout(symbols.map((symbol) => symbol.text), indent, limit);
    // When no two adjacent symbols fit on one line, one per line is the only
    // layout. A suggestion with fewer lines puts two symbols on one line.
    if (suggestion.length < bodyLines.length) {
      problems.push(`${path}:${line}: ${keyword} ${rule.name} puts one symbol on each of its ${bodyLines.length} lines; write:\n${suggestion.join("\n")}`);
    }
  }
  return problems;
}
