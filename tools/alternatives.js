// The layout of the top-level alternatives of a rule, which
// tools/sync.js requires of the bundled grammars (docs/notation.md,
// "Layout of the bundled grammars").
//
// A plain alternative is a juxtaposition of plain items, with no guard
// and no clause. A plain item is a rule reference without arguments, a
// splice, a string, a tag terminal, an engine tag, ε or a parameter.
// `_<T>` with one tag `T` is also a plain item. Any other alternative is
// a marked alternative. Each marked alternative stands on lines of its
// own. Plain alternatives can share lines, and they can also stand one
// on each line. No line of a rule body holds more than LINE_LIMIT code
// points. A comment line does not count toward that limit. A comment
// stands on its own lines, before the rule or the alternative that it
// describes. No comment shares a line with a rule header, an alternative
// or any other grammar code. Part 3 of the section, shared clauses,
// needs judgment, so this check does not test it.
//
// The rules and their lines come from the Markdown extraction of the engine
// and the DOM's positions. From a rule's position, a small scanner finds
// where each alternative begins, and stops at the next keyword.
import fs from "node:fs";
import { UnicodeTable } from "../lib/js/src/unicode.js";
import { extractGrammarText, splitLines } from "../lib/js/src/markdown.js";

const unicode = new UnicodeTable(fs.readFileSync(new URL("../data/unicode/unicode.txt", import.meta.url), "utf8"));

export const LINE_LIMIT = 100;

/**
 * Whether an expression of the DOM is one plain item.
 * @param {Record<string, unknown>} expr
 * @returns {boolean}
 */
export function isPlainItem(expr) {
  if (!expr || typeof expr !== "object") return false;
  if (typeof expr.ref === "string") return true;
  if (expr.splice !== undefined) return true;
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

// The written text with comments removed, so that punctuation inside a
// comment does not mark the alternative. A comment is whitespace.
/** @param {string} text */
function sourceWithoutComments(text) {
  let out = "";
  let string = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (string) { out += c; if (c === '"') string = false; continue; }
    if (c === '"') { string = true; out += c; continue; }
    if (c === "-" && text[i + 1] === "-") { while (i < text.length && text[i] !== "\n" && text[i] !== "\r") i++; out += "\n"; continue; }
    out += c;
  }
  return out;
}

/**
 * Whether a DOM alternative, as written, is a plain alternative.
 * @param {any} alternative
 * @param {string} text the alternative as written
 * @param {boolean} [hasInternalComment]
 * @returns {boolean}
 */
export function isPlainAlternative(alternative, text) {
  if (!alternative || (alternative.guards && alternative.guards.length !== 0)) return false;
  if (alternative.tags !== undefined || alternative.value !== undefined || alternative.image !== undefined) return false;
  if (/[\[\]{}()&≻]/.test(sourceWithoutStrings(sourceWithoutComments(text)))) return false;
  const expr = alternative.expr;
  const items = expr && Array.isArray(expr.seq) ? expr.seq : [expr];
  return items.every((item) => isPlainItem(item));
}

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
    if (c === "-" && chars[i + 1] === "-") {
      const from = i;
      i += 2;
      while (i < chars.length && chars[i] !== "\n" && chars[i] !== "\r") i++;
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
 * @typedef {{rule: any, keyword: string, alternatives: WrittenAlternative[]}} RuleLayout
 * @param {string} markdown
 * @param {{rules: any[]}} dom
 * @param {string} path
 * @returns {RuleLayout[]}
 */
export function alternativeLayouts(markdown, dom, path) {
  const { text, positions } = extractGrammarText(markdown, path, unicode);
  const chars = [...text];
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
      return {
        text: writtenText,
        lines: [...new Set(positions.slice(from, to).map(([line]) => line))],
        plain: isPlainAlternative(alternatives[index], writtenText),
        from, to,
      };
    });
    const keyword = { define: "%rule", redefine: "%redefine-rule", extend: "%extend-rule" }[/** @type {"define" | "redefine" | "extend"} */ (rule.op)];
    result.push({ rule, keyword, alternatives: written });
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
      } else if (chars[i] === "(" || chars[i] === "«") headerDepth++;
      else if (chars[i] === ")" || chars[i] === "»") headerDepth--;
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
      if (c === "(" || c === "[" || c === "{" || c === "<" || c === "«") depth++;
      else if (c === ")" || c === "]" || c === "}" || c === ">" || c === "»") depth--;
      i++;
    }
    if (current) current.to = i;
    else current = { from, to: i };
  }
  if (current) alternatives.push(current);
  return alternatives;
}


// The clauses of one body (a rule header or one alternative), as written:
// each operator with the index at which it stands in `text`.
function writtenClauses(text) {
  const scrubbed = [...text]; let string = false;
  for (let i = 0; i < scrubbed.length; i++) {
    const c = scrubbed[i];
    if (string) { if (c === '"') string = false; else scrubbed[i] = " "; continue; }
    if (c === '"') { string = true; continue; }
    if (c === "-" && scrubbed[i + 1] === "-") { while (i < scrubbed.length && scrubbed[i] !== "\n") { scrubbed[i] = " "; i++; } i--; continue; }
  }
  const ops = []; let depth = 0;
  for (let i = 0; i < scrubbed.length; i++) {
    const c = scrubbed[i];
    if ("([{<«".includes(c)) depth++;
    else if (")]}>»".includes(c)) depth--;
    else if (depth === 0 && c === ":" && (scrubbed[i + 1] === ":" || scrubbed[i + 1] === "=" || scrubbed[i + 1] === "-")) { ops.push({ at: i, op: scrubbed.slice(i, i + 2).join("") }); i++; }
  }
  return ops.map((o, i) => ({ ...o, end: i + 1 < ops.length ? ops[i + 1].at : text.length }));
}

// The operands of a tag term at its top level, split at `∪`. Each keeps
// the index at which it starts in the term text.
function termOperands(term) {
  const chars = [...term];
  const parts = []; let depth = 0, string = false, start = 0;
  const flush = (end) => { const text = chars.slice(start, end).join(""); const lead = text.length - text.trimStart().length; parts.push({ text: text.trim().replace(/\s+/g, " "), at: start + [...text.slice(0, lead)].length }); };
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (string) { if (c === '"') string = false; continue; }
    if (c === '"') { string = true; continue; }
    if ("([{<«".includes(c)) depth++;
    else if (")]}>»".includes(c)) depth--;
    else if (depth === 0 && c === "∪") { flush(i); start = i + 1; }
  }
  flush(chars.length);
  return parts.filter((part) => part.text);
}

const BARE_TAG = /^[A-Z_][A-Za-z0-9_-]*$/u;
// Whether an operand of a tag term is a bare tag or a run of bare tags.
function isBareRun(text) { return text.split(" ").every((word) => BARE_TAG.test(word)); }

/**
 * The problems of clause and tag term layout in a document: a clause
 * that starts a new line stands in the column of the first clause; a
 * tag term that runs over several lines ends each line with its `∪` and
 * never starts a line with it, and each later operand stands in the
 * column of the first; and a term with two or more expressions puts
 * each expression on a line of its own.
 * @param {string} markdown
 * @param {{rules: any[]}} dom
 * @param {string} path
 * @returns {string[]}
 */
export function clauseTermProblems(markdown, dom, path) {
  const lines = splitLines(markdown);
  const { positions } = extractGrammarText(markdown, path, unicode);
  /** @type {string[]} */
  const problems = [];
  const at = (index) => positions[Math.min(index, positions.length - 1)] ?? [1, 1];
  for (const { rule, keyword, alternatives } of alternativeLayouts(markdown, dom, path)) {
    const where = `${keyword} ${rule.name}`;
    /** @type {{text: string, base: number}[]} */
    const bodies = alternatives.map((a) => ({ text: a.text, base: a.from }));
    if (alternatives.length && (rule.tags !== undefined || rule.value !== undefined || rule.image !== undefined)) {
      const start = positions.findIndex(([line, col]) => line === rule.at[0] && col === rule.at[1]);
      if (start >= 0) {
        let headerText = alternativeLayoutsHeaderText(markdown, dom, path, start, alternatives[0].from);
        const bar = writtenClausesBar(headerText);
        if (bar >= 0) headerText = headerText.slice(0, bar);
        bodies.unshift({ text: headerText, base: start });
      }
    }
    for (const body of bodies) {
      const clauses = writtenClauses(body.text);
      if (!clauses.length) continue;
      const placed = clauses.map((c) => ({ ...c, line: at(body.base + c.at)[0], col: at(body.base + c.at)[1] }));
      const reference = placed[0].col;
      // Rule 1: a clause that starts a new line stands in the column of `::`.
      for (const c of placed.slice(1)) {
        const before = [...(lines[c.line - 1] ?? "")].slice(0, c.col - 1).join("");
        if (/^\s*$/.test(before) && c.col !== reference) problems.push(`${path}:${c.line}: a clause of ${where} does not stand in the column of its first clause`);
      }
      for (const c of clauses) {
        if (c.op !== "::") continue;
        const termText = body.text.slice(c.at + 2, c.end);
        const termStart = body.base + c.at + 2 + (termText.length - termText.trimStart().length);
        const operands = termOperands(termText);
        const exprs = operands.filter((o) => !isBareRun(o.text));
        const startLine = at(termStart)[0];
        const firstCol = at(termStart)[1];
        // Rule 4: each expression on a line of its own.
        if (exprs.length >= 2) {
          const starts = operands.map((o) => at(body.base + c.at + 2 + o.at)[0]);
          if (new Set(starts).size !== starts.length) problems.push(`${path}:${startLine}: a tag term of ${where} has two or more expressions, and each expression stands on a line of its own`);
        }
        // Rule 2: a term over several lines ends each line with `∪`.
        const termLines = termText.trim().split("\n");
        if (termLines.length < 2) continue;
        let depth = 0;
        termLines.forEach((termLine, i) => {
          const startDepth = depth;
          const scrubbed = [...termLine]; let string = false;
          for (const ch of scrubbed) {
            if (string) { if (ch === '"') string = false; continue; }
            if (ch === '"') { string = true; continue; }
            if ("([{<«".includes(ch)) depth++;
            else if (")]}>»".includes(ch)) depth--;
          }
          const lineNumber = startLine + i;
          if (i + 1 < termLines.length && startDepth === 0 && depth === 0 && !termLine.trimEnd().endsWith("∪")) problems.push(`${path}:${lineNumber}: a tag term of ${where} runs over several lines, and each line ends with its ∪`);
          if (i > 0 && startDepth === 0) {
            const trimmed = termLine.trimStart();
            if (trimmed.startsWith("∪")) problems.push(`${path}:${lineNumber}: a tag term of ${where} starts a line with ∪`);
            else if ([...(lines[lineNumber - 1] ?? "")].findIndex((ch) => ch !== " ") + 1 !== firstCol && trimmed) problems.push(`${path}:${lineNumber}: an operand of a tag term of ${where} does not stand in the column of its first operand`);
          }
        });
      }
    }
  }
  return problems;
}

// The written text of a rule header, from its keyword to the first
// alternative. Only its clause layout is read.
// The index of the bar before the first alternative in a header text,
// or -1 where the body follows the header without a bar.
function writtenClausesBar(text) {
  const scrubbed = [...text]; let string = false, depth = 0, bar = -1;
  for (let i = 0; i < scrubbed.length; i++) {
    const c = scrubbed[i];
    if (string) { if (c === '"') string = false; continue; }
    if (c === '"') { string = true; continue; }
    if ("([{<«".includes(c)) depth++;
    else if (")]}>»".includes(c)) depth--;
    else if (depth === 0 && c === "|") bar = i;
  }
  return bar;
}

function alternativeLayoutsHeaderText(markdown, dom, path, start, end) {
  const { text } = extractGrammarText(markdown, path, unicode);
  return [...text].slice(start, end).join("");
}

/**
 * The layout problems of a document, for every rule with an alternative.
 * Each message names the file, the line and the rule. A line that holds
 * only a comment does not count toward the limit, wherever it stands.
 * @param {string} markdown
 * @param {{rules: any[]}} dom
 * @param {string} path
 * @param {number} [limit]
 * @returns {string[]}
 */
export function layoutProblems(markdown, dom, path, limit = LINE_LIMIT) {
  const lines = splitLines(markdown);
  /** @type {string[]} */
  const problems = clauseLayoutProblems(markdown, dom, path);
  for (const problem of clauseTermProblems(markdown, dom, path)) problems.push(problem);
  for (const problem of commentLayoutProblems(markdown, path)) problems.push(problem);
  for (const { rule, keyword, alternatives } of alternativeLayouts(markdown, dom, path)) {
    // How many alternatives occupy each line of the body.
    /** @type {Map<number, number>} */
    const occupants = new Map();
    for (const alternative of alternatives) for (const number of alternative.lines) occupants.set(number, (occupants.get(number) ?? 0) + 1);
    const bodyLines = [...occupants.keys()].sort((a, b) => a - b);
    for (const number of bodyLines) {
      if (/^\s*--/.test(lines[number - 1])) continue;
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
