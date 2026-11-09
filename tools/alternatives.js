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
  return ops.map((o, i) => ({ ...o, end: i + 1 < ops.length ? ops[i + 1].at : scrubbed.length }));
}

// The code points of a text with each comment replaced by spaces, so
// that punctuation in a comment makes no operand, bracket or operator.
// New lines and string contents stay, and every index still counts code
// points of the original text.
/** @param {string[]} chars @returns {string[]} */
function scrubComments(chars) {
  const out = [...chars];
  let string = false;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (string) { if (c === '"') string = false; continue; }
    if (c === '"') { string = true; continue; }
    if (c === "-" && out[i + 1] === "-") { while (i < out.length && out[i] !== "\n") { out[i] = " "; i++; } i--; }
  }
  return out;
}

// The operands of a tag term at its top level, split at `∪`. Each keeps
// the index at which it starts in the term text.
function termOperands(term) {
  const chars = scrubComments([...term]);
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

// The kind of one operand of a tag term, for the fixed order of rule 3:
// a run of bare tags, an expression without a guard, or a guarded
// expression. String contents do not make a guard.
/** @param {string} text @returns {"bare" | "expr" | "guarded"} */
function operandKind(text) {
  if (isBareRun(text)) return "bare";
  const withoutStrings = text.replace(/"[^"]*"/g, '""');
  return withoutStrings.includes("⟹") ? "guarded" : "expr";
}

// Whether `op` stands at the top level of a term text, outside brackets,
// strings and comments.
/** @param {string} text @param {string} op */
function hasTopLevel(text, op) {
  const chars = scrubComments([...text]);
  let depth = 0, string = false;
  for (const c of chars) {
    if (string) { if (c === '"') string = false; continue; }
    if (c === '"') { string = true; continue; }
    if ("([{<«".includes(c)) depth++;
    else if (")]}>»".includes(c)) depth--;
    else if (depth === 0 && c === op) return true;
  }
  return false;
}

/**
 * The problems of clause and tag term layout in a document: a clause
 * that starts a new line stands in the column of the first clause; a
 * tag term that runs over several lines ends each line with its `∪` and
 * never starts a line with it, and each later operand stands in the
 * column of the first; a term lists bare tags first as one run, then
 * expressions without a guard, then guarded expressions; and a term
 * with two or more expressions puts each expression on a line of its
 * own. Emission items follow the same rules. Inside brackets, a long
 * condition or term ends each line with its operator, and the next
 * line stands one column after the opening bracket.
 * @param {string} markdown
 * @param {{rules: any[]}} dom
 * @param {string} path
 * @returns {string[]}
 */
export function clauseTermProblems(markdown, dom, path) {
  const lines = splitLines(markdown);
  const { text, positions } = extractGrammarText(markdown, path, unicode);
  /** @type {string[]} */
  const problems = [];
  const at = (index) => positions[Math.min(index, positions.length - 1)] ?? [1, 1];
  // The clause and tag-term rules of one written body: a rule header,
  // one alternative, or one emission item. `base` is the code-point
  // index of the body's first code point in the extracted text.
  /** @param {string} bodyText @param {number} base @param {string} where */
  const checkBody = (bodyText, base, where) => {
    const clauses = writtenClauses(bodyText);
    if (!clauses.length) return;
    const bodyChars = [...bodyText];
    const placed = clauses.map((c) => ({ ...c, line: at(base + c.at)[0], col: at(base + c.at)[1] }));
    const reference = placed[0].col;
    // Rule 1: a clause that starts a new line stands in the column of `::`.
    for (const c of placed.slice(1)) {
      const before = [...(lines[c.line - 1] ?? "")].slice(0, c.col - 1).join("");
      if (/^\s*$/.test(before) && c.col !== reference) problems.push(`${path}:${c.line}: a clause of ${where} does not stand in the column of its first clause`);
    }
    for (const c of clauses) {
      if (c.op !== "::") continue;
      const termText = bodyChars.slice(c.at + 2, c.end).join("");
      const termChars = [...termText];
      let lead = 0;
      while (lead < termChars.length && /\s/u.test(termChars[lead])) lead++;
      const termStart = base + c.at + 2 + lead;
      const operands = termOperands(termText);
      const kinds = operands.map((o) => operandKind(o.text));
      const exprs = operands.filter((_, i) => kinds[i] !== "bare");
      const startLine = at(termStart)[0];
      const firstCol = at(termStart)[1];
      // Rule 3: bare tags first as one run, then expressions without a
      // guard, then guarded expressions. A term with a top-level `∖`
      // keeps its order, because `∖` and `∪` stand at the same level.
      // Where each part stands on a line of its own, the expressions
      // can stand in the order of their meaning. The bare tags still
      // come first, as one run.
      if (!hasTopLevel(termText, "∖")) {
        const rank = { bare: 0, expr: 1, guarded: 2 };
        const operandLines = operands.map((o) => at(base + c.at + 2 + o.at)[0]);
        const ownLines = exprs.length >= 2 && new Set(operandLines).size === operandLines.length;
        const bareOutOfPlace = kinds.filter((k) => k === "bare").length > 1
          || kinds.some((k, i) => k === "bare" && i > 0);
        const outOfOrder = bareOutOfPlace
          || (!ownLines && kinds.some((k, i) => i > 0 && rank[k] < rank[kinds[i - 1]]));
        if (outOfOrder) problems.push(`${path}:${startLine}: a tag term of ${where} lists its parts out of order: bare tags first, then expressions without a guard, then guarded expressions`);
      }
      // Rule 4: each expression on a line of its own. Only the start
      // lines of the expressions count. A run of bare tags can share
      // the line of the first expression.
      if (exprs.length >= 2) {
        const starts = exprs.map((o) => at(base + c.at + 2 + o.at)[0]);
        if (new Set(starts).size !== starts.length) problems.push(`${path}:${startLine}: a tag term of ${where} has two or more expressions, and each expression stands on a line of its own`);
      }
      // Rule 2: a term over several lines ends each line with `∪`.
      // Lines before the first operand and blank lines after the last
      // operand are not lines of the term. A long condition in the
      // guard of a term breaks like any long condition instead: each
      // of its lines ends with its own operator, and its next line
      // stands in the column where the condition begins.
      const rawTermLines = scrubComments(termChars).join("").split("\n");
      let firstTermLine = 0;
      for (let k = 0; k < lead; k++) if (termChars[k] === "\n") firstTermLine++;
      let lastTermLine = rawTermLines.length - 1;
      while (lastTermLine > firstTermLine && !rawTermLines[lastTermLine].trim()) lastTermLine--;
      const termLines = rawTermLines.slice(firstTermLine, lastTermLine + 1);
      if (termLines.length < 2) continue;
      const operandStarts = operands.map((o) => {
        const [line, col] = at(base + c.at + 2 + o.at);
        return { line, col };
      });
      let depth = 0;
      /** @type {number | null} */
      let conditionColumn = null;
      termLines.forEach((termLine, i) => {
        const startDepth = depth;
        const scrubbed = [...termLine]; let string = false;
        for (const ch of scrubbed) {
          if (string) { if (ch === '"') string = false; continue; }
          if (ch === '"') { string = true; continue; }
          if ("([{<«".includes(ch)) depth++;
          else if (")]}>»".includes(ch)) depth--;
        }
        const trimmed = termLine.trimStart();
        if (!trimmed) return;
        const lineNumber = startLine + i;
        const trimmedEnd = termLine.trimEnd();
        const endsUnion = trimmedEnd.endsWith("∪");
        const endsCondition = "∧∨⟹⊆⊈=≠≅≇∩∖".includes(trimmedEnd[trimmedEnd.length - 1]);
        if (i + 1 < termLines.length && startDepth === 0 && depth === 0 && !endsUnion && !endsCondition) problems.push(`${path}:${lineNumber}: a tag term of ${where} runs over several lines, and each line ends with its ∪`);
        if (i > 0 && startDepth === 0) {
          const col = [...(lines[lineNumber - 1] ?? "")].findIndex((ch) => ch !== " ") + 1;
          if (trimmed.startsWith("∪")) problems.push(`${path}:${lineNumber}: a tag term of ${where} starts a line with ∪`);
          else if (conditionColumn !== null && col !== conditionColumn) problems.push(`${path}:${lineNumber}: a continued line of a condition in a tag term of ${where} does not stand in the column where the condition begins`);
          else if (conditionColumn === null && col !== firstCol) problems.push(`${path}:${lineNumber}: an operand of a tag term of ${where} does not stand in the column of its first operand`);
        }
        if (startDepth === 0 && depth === 0) {
          if (endsUnion) conditionColumn = null;
          else if (endsCondition) {
            const active = operandStarts.filter((s) => s.line <= lineNumber).pop();
            conditionColumn = active ? active.col : firstCol;
          }
        }
      });
    }
  };
  for (const { rule, keyword, alternatives } of alternativeLayouts(markdown, dom, path)) {
    const where = `${keyword} ${rule.name}`;
    /** @type {{text: string, base: number}[]} */
    const bodies = alternatives.map((a) => ({ text: a.text, base: a.from }));
    if (alternatives.length && (rule.tags !== undefined || rule.value !== undefined || rule.image !== undefined)) {
      const start = positions.findIndex(([line, col]) => line === rule.at[0] && col === rule.at[1]);
      if (start >= 0) {
        let headerText = alternativeLayoutsHeaderText(markdown, dom, path, start, alternatives[0].from);
        const bar = writtenClausesBar(headerText);
        if (bar >= 0) headerText = [...headerText].slice(0, bar).join("");
        bodies.unshift({ text: headerText, base: start });
      }
    }
    for (const body of bodies) checkBody(body.text, body.base, where);
  }
  // Emission items follow the same rules. The DOM gives no position
  // for an item, so the source text finds them: an item of the %emits
  // section after a definition, split at its top-level commas.
  const chars = scrubComments([...text]);
  /** @type {number[]} */
  const lineStarts = [0];
  chars.forEach((c, i) => { if (c === "\n") lineStarts.push(i + 1); });
  const textLines = chars.join("").split("\n");
  let where = "";
  for (let li = 0; li < textLines.length; li++) {
    const definition = /^%(rule|redefine-rule|extend-rule|template)\s+(\S+)/.exec(textLines[li]);
    if (definition) { where = `%${definition[1]} ${definition[2]}`; continue; }
    if (!/^%emits\b/.test(textLines[li])) continue;
    // An item can start on the %emits line itself, so the section
    // starts with what follows the keyword on that line.
    let section = textLines[li].slice("%emits".length) + "\n";
    let lj = li + 1;
    for (; lj < textLines.length && !/^%/.test(textLines[lj]); lj++) section += textLines[lj] + "\n";
    const base = (lineStarts[li] ?? 0) + "%emits".length;
    let depth = 0, string = false, itemStart = 0;
    const sectionChars = [...section];
    const flush = (end) => {
      const item = sectionChars.slice(itemStart, end).join("");
      const first = item.search(/\S/);
      if (first >= 0) checkBody(item, base + itemStart, where);
    };
    for (let i = 0; i < sectionChars.length; i++) {
      const c = sectionChars[i];
      if (string) { if (c === '"') string = false; continue; }
      if (c === '"') { string = true; continue; }
      if ("([{<«".includes(c)) depth++;
      else if (")]}>»".includes(c)) depth--;
      else if (depth === 0 && c === ",") { flush(i); itemStart = i + 1; }
    }
    flush(sectionChars.length);
    li = lj - 1;
  }
  for (const problem of bracketProblems(markdown, path)) problems.push(problem);
  for (const problem of conditionProblems(markdown, path)) problems.push(problem);
  return problems;
}

// The layout of a long condition outside brackets: each continued
// line of a condition ends with its operator. The %conditions section
// of a definition holds its conditions as items split at top-level
// commas. Lines inside brackets follow the bracket rules instead, so
// this check only reads a boundary at the top level of an item.
/** @param {string} markdown @param {string} path @returns {string[]} */
function conditionProblems(markdown, path) {
  const { text, positions } = extractGrammarText(markdown, path, unicode);
  /** @type {string[]} */
  const problems = [];
  const chars = scrubComments([...text]);
  let string = false;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (string) { if (c === '"') string = false; else if (c !== "\n") chars[i] = " "; continue; }
    if (c === '"') string = true;
  }
  /** @type {number[]} */
  const lineStarts = [0];
  chars.forEach((c, i) => { if (c === "\n") lineStarts.push(i + 1); });
  const textLines = chars.join("").split("\n");
  let where = "";
  for (let li = 0; li < textLines.length; li++) {
    const definition = /^%(rule|redefine-rule|extend-rule|template|const|classifier)\s+(\S+)/.exec(textLines[li]);
    if (definition) { where = `%${definition[1]} ${definition[2]}`; continue; }
    if (!/^%conditions\b/.test(textLines[li])) continue;
    // A condition can start on the %conditions line itself, so the
    // section starts with what follows the keyword on that line.
    let section = textLines[li].slice("%conditions".length) + "\n";
    let lj = li + 1;
    for (; lj < textLines.length && !/^%/.test(textLines[lj]); lj++) section += textLines[lj] + "\n";
    const base = (lineStarts[li] ?? 0) + "%conditions".length;
    const sectionChars = [...section];
    let depth = 0, itemStart = 0;
    /** @type {[number, number][]} */
    const items = [];
    for (let i = 0; i < sectionChars.length; i++) {
      const c = sectionChars[i];
      if ("([{<«".includes(c)) depth++;
      else if (")]}>»".includes(c)) depth--;
      else if (depth === 0 && c === ",") { items.push([itemStart, i]); itemStart = i + 1; }
    }
    items.push([itemStart, sectionChars.length]);
    for (const [from, to] of items) {
      const itemLines = sectionChars.slice(from, to).join("").split("\n");
      let itemDepth = 0;
      /** @type {{text: string, startDepth: number, endDepth: number, offset: number}[]} */
      const linesOfItem = [];
      let offset = from;
      for (const itemLine of itemLines) {
        const startDepth = itemDepth;
        for (const ch of itemLine) {
          if ("([{<«".includes(ch)) itemDepth++;
          else if (")]}>»".includes(ch)) itemDepth--;
        }
        linesOfItem.push({ text: itemLine, startDepth, endDepth: itemDepth, offset });
        offset += [...itemLine].length + 1;
      }
      const content = linesOfItem.filter((l) => l.text.trim());
      for (let k = 0; k + 1 < content.length; k++) {
        if (content[k].startDepth !== 0 || content[k].endDepth !== 0) continue;
        const trimmed = content[k].text.trimEnd();
        if ("∧∨⟹∪∩∖⊆⊈=≠≅≇".includes(trimmed[trimmed.length - 1]) || trimmed.endsWith("++")) continue;
        const first = content[k].text.search(/\S/);
        problems.push(`${path}:${positions[base + content[k].offset + first][0]}: a line of a condition of ${where} does not end with its operator`);
      }
    }
    li = lj - 1;
  }
  return problems;
}

// The layout inside brackets: a long condition or term ends each line
// with its operator, and the next line stands one column after the
// opening bracket. A ranked choice `#(...)` and a bracketed choice with
// `|` follow their own rules, so this check skips them. String contents
// and comments make no brackets or operators.
/** @param {string} markdown @param {string} path @returns {string[]} */
function bracketProblems(markdown, path) {
  const { text, positions } = extractGrammarText(markdown, path, unicode);
  /** @type {string[]} */
  const problems = [];
  const chars = scrubComments([...text]);
  let string = false;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (string) { if (c === '"') string = false; else if (c !== "\n") chars[i] = " "; continue; }
    if (c === '"') string = true;
  }
  /** @type {number[]} */
  const lineStarts = [0];
  chars.forEach((c, i) => { if (c === "\n") lineStarts.push(i + 1); });
  /** @type {string[]} */
  const whereByLine = [];
  let where = "";
  for (const lineText of chars.join("").split("\n")) {
    const definition = /^%(rule|redefine-rule|extend-rule|template|const|classifier)\s+(\S+)/.exec(lineText);
    if (definition) where = `%${definition[1]} ${definition[2]}`;
    whereByLine.push(where);
  }
  const OPEN = "([{<«", CLOSE = ")]}>»";
  /** @type {{at: number, line: number, col: number}[]} */
  const stack = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (OPEN.includes(c)) { stack.push({ at: i, line: positions[i][0], col: positions[i][1] }); continue; }
    if (!CLOSE.includes(c)) continue;
    const open = stack.pop();
    if (!open || positions[i][0] === open.line) continue;
    if (open.at > 0 && chars[open.at - 1] === "#") continue;
    // Operators at the top level of this span, and any top-level bar.
    // Every condition and term operator makes a span subject to the
    // rule, not only the joining ones.
    let depth = 0, hasBar = false, hasOperator = false;
    for (let j = open.at + 1; j < i; j++) {
      const ch = chars[j];
      if (OPEN.includes(ch)) depth++;
      else if (CLOSE.includes(ch)) depth--;
      else if (depth === 0 && ch === "|") hasBar = true;
      else if (depth === 0 && "∧∨⟹∪∩∖⊆⊈=≠≅≇".includes(ch)) hasOperator = true;
      else if (depth === 0 && ch === "+" && chars[j + 1] === "+") hasOperator = true;
    }
    if (hasBar || !hasOperator) continue;
    let openTextLine = 0;
    while (openTextLine + 1 < lineStarts.length && lineStarts[openTextLine + 1] <= open.at) openTextLine++;
    const name = whereByLine[openTextLine] ?? "";
    // Each line of the span, as a range of code-point indexes. The
    // first range starts after the opening bracket, and the last ends
    // before the closing bracket. Only the lines at the top level of
    // this span are checked. A line inside a nested bracket belongs
    // to that bracket's span, so each problem is reported once.
    let segmentStart = open.at + 1;
    let firstSegment = true;
    let segmentDepth = 0;
    // A wrapped part of a tighter operator stands deeper than the
    // line that starts it. `tightChain` holds while a run that starts
    // in the bracket's column keeps ending with `∧` or `∩`.
    let tightChain = false;
    for (let j = open.at + 1; j <= i; j++) {
      if (j < i && chars[j] !== "\n") continue;
      const segment = chars.slice(segmentStart, j).join("");
      const startDepth = segmentDepth;
      for (const ch of segment) {
        if (OPEN.includes(ch)) segmentDepth++;
        else if (CLOSE.includes(ch)) segmentDepth--;
      }
      const first = segment.search(/\S/);
      if (first >= 0 && startDepth === 0) {
        const line = positions[segmentStart + first][0];
        const trimmed = segment.trim();
        if (j < i && segmentDepth === 0 && !"∧∨⟹∪∩∖⊆⊈=≠≅≇".includes(trimmed[trimmed.length - 1]) && !trimmed.endsWith("++")) problems.push(`${path}:${line}: a line inside brackets of ${name} does not end with its operator`);
        if (!firstSegment && !trimmed.startsWith(")") && !trimmed.startsWith("]") && !trimmed.startsWith("}")) {
          const col = positions[segmentStart + first][1];
          const endOperator = trimmed[trimmed.length - 1];
          if (col !== open.col + 1 && !(col > open.col + 1 && tightChain)) problems.push(`${path}:${line}: a line inside brackets of ${name} does not stand one column after the opening bracket`);
          if (col === open.col + 1 && (endOperator === "∧" || endOperator === "∩")) tightChain = true;
          else if (!(col > open.col + 1 && tightChain && (endOperator === "∧" || endOperator === "∩"))) tightChain = false;
        }
      }
      firstSegment = false;
      segmentStart = j + 1;
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
// A line whose only item is one string cannot break, so the limit
// does not apply to it.
function unbreakable(line) {
  return /^\s*"(?:[^"\\]|\\.)*"\s*$/u.test(line);
}

export function layoutProblems(markdown, dom, path, limit = LINE_LIMIT) {
  const lines = splitLines(markdown);
  /** @type {string[]} */
  const problems = clauseLayoutProblems(markdown, dom, path);
  for (const problem of clauseTermProblems(markdown, dom, path)) problems.push(problem);
  for (const problem of commentLayoutProblems(markdown, path)) problems.push(problem);
  const { text, positions } = extractGrammarText(markdown, path, unicode);
  const chars = [...text];
  /** @type {Set<number>} */
  const bodyLinesAll = new Set();
  for (const { rule, keyword, alternatives } of alternativeLayouts(markdown, dom, path)) {
    // How many alternatives occupy each line of the body.
    /** @type {Map<number, number>} */
    const occupants = new Map();
    for (const alternative of alternatives) for (const number of alternative.lines) occupants.set(number, (occupants.get(number) ?? 0) + 1);
    const bodyLines = [...occupants.keys()].sort((a, b) => a - b);
    for (const number of bodyLines) {
      bodyLinesAll.add(number);
      if (/^\s*--/.test(lines[number - 1])) continue;
      const width = [...lines[number - 1]].length;
      if (width > limit) problems.push(`${path}:${number}: a line of ${keyword} ${rule.name} holds ${width} characters, more than ${limit}`);
    }
    // A sole alternative under a bare header stands without a leading
    // bar. A header with a clause keeps its bar.
    if (alternatives.length === 1 && rule.tags === undefined && rule.value === undefined && rule.image === undefined) {
      let before = alternatives[0].from - 1;
      while (before >= 0 && /\s/u.test(chars[before])) before--;
      if (chars[before] === "|") problems.push(`${path}:${positions[before][0]}: a sole alternative of ${keyword} ${rule.name} follows a leading | under a bare header`);
    }
    // Each marked alternative stands on lines of its own.
    const markedShared = new Set();
    for (const alternative of alternatives) {
      if (alternative.plain) continue;
      for (const number of alternative.lines) if ((occupants.get(number) ?? 0) > 1) markedShared.add(number);
    }
    for (const number of [...markedShared].sort((a, b) => a - b)) problems.push(`${path}:${number}: a marked alternative of ${keyword} ${rule.name} shares its line with another alternative; put it on lines of its own`);
  }
  // The limit covers every line of a grammar block, not only rule
  // bodies: headers, conditions, emission items and classifier
  // entries count too. A line that holds only a comment does not.
  for (const number of [...new Set(positions.map(([line]) => line))].sort((a, b) => a - b)) {
    if (bodyLinesAll.has(number)) continue;
    if (/^\s*--/.test(lines[number - 1] ?? "")) continue;
    const width = [...(lines[number - 1] ?? "")].length;
    if (width > limit && !unbreakable(lines[number - 1])) problems.push(`${path}:${number}: a line of a grammar block holds ${width} characters, more than ${limit}`);
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
