// A hand-written reader for the notation, used only to produce the first
// grammars/notation/bootstrap.json and to recover if a change to the
// notation ever leaves the current bootstrap unable to read the notation
// documents. The libraries never use it: they read every grammar, the
// notation's own included, with the bootstrap. It follows
// grammars/notation/*.md and docs/engine.md §9, and must produce exactly
// the DOM the self-hosted reader does; the fixpoint check compares them.

import fs from "node:fs";
import { extractGrammarText } from "../lib/js/src/markdown.js";
import { DOM_FORMAT, captureSequences, comparisonProblem, constantValueType, definitionProblem, elidableHead, expectedProblem, readsOwnTags, openPart, propertyProblem, rangeProblem, soundProblem, termType, testValueFault } from "../lib/js/src/dom.js";
import { operandProblem } from "../lib/js/src/reader.js";
import { UnicodeTable } from "../lib/js/src/unicode.js";
import { characterTag } from "../lib/js/src/tags.js";

// The lowercase mapping that the string of a sound test is checked against
// (engine §9).
const unicode = new UnicodeTable(fs.readFileSync(new URL("../grammars/unicode.txt", import.meta.url), "utf8"));

const SYMBOLS = ["...", "..", "++", "+", "|", "&", "(", ")", "[", "]", "{", "}", "\\", "<", ">", "#", "ε", ",", "∧", "∨", "¬", "⟹", "=", "≠",
  "∈", "∉", "⊆", "⊈", "⊇", "⊉", "∪", "∩", "∖", "∅"];

const KEYWORDS = new Set(["%rule", "%redefine-rule", "%extend-rule", "%tags", "%conditions", "%emits", "%opaque",
  "%ambiguity-resolution", "%stage", "%include", "%features", "%const", "%redefine-const", "%classifier", "%implies"]);

// The reader reports a syntax error before any other error of the document,
// wherever each stands, as the notation's reader does, which reads only a
// tree that the syntax grammar gave (engine §9). So a document with another
// error is read again with only its syntax checked: there, an error of any
// other kind does not end the reading, except inside an attempt, whose
// failure decides how the parser reads on.
let syntaxOnly = false;
let attempts = 0;

function fail(message, token, syntax = false) {
  const error = new Error(message);
  error.at = token ? token.at : null;
  error.syntax = syntax;
  if (syntaxOnly && !syntax && attempts === 0) return { tag: "X" };
  throw error;
}

function lex(text, positions) {
  const chars = [...text];
  const tokens = [];
  let i = 0;
  const at = (index) => positions[index] || [0, 0];
  const isLetter = (c) => /^[A-Za-z]$/.test(c);
  const isNameChar = (c) => /^[A-Za-z0-9-]$/.test(c);
  while (i < chars.length) {
    const c = chars[i];
    if (/\s/u.test(c) && [" ", "\t", "\n", "\r", "\u000b", "\u000c"].includes(c)) { i++; continue; }
    if (c === "(" && chars[i + 1] === "*") {
      let j = i + 2;
      while (j < chars.length && !(chars[j] === "*" && chars[j + 1] === ")")) j++;
      if (j >= chars.length) fail("an unclosed comment", { at: at(i) }, true);
      i = j + 2;
      continue;
    }
    const start = i;
    // A name, or a guard: a name and `?` or `!`, with `¬` before a gate.
    if (isLetter(c) || (c === "¬" && isLetter(chars[i + 1] || ""))) {
      const negated = c === "¬";
      let j = negated ? i + 1 : i;
      while (j < chars.length && isNameChar(chars[j])) j++;
      const name = chars.slice(negated ? i + 1 : i, j).join("");
      if (chars[j] === "?" || chars[j] === "!") {
        if (negated && chars[j] === "!") fail("a warning has no negated form", { at: at(j) }, true);
        tokens.push({ kind: "guard", text: chars.slice(i, j + 1).join(""), at: at(start), name });
        i = j + 1;
        continue;
      }
      if (!negated) {
        tokens.push({ kind: "identifier", text: name, at: at(start) });
        i = j;
        continue;
      }
    }
    if (c === "~") {
      i++;
      if (!isLetter(chars[i] || "")) fail("a name after ~", { at: at(start) }, true);
      while (i < chars.length && isNameChar(chars[i])) i++;
      tokens.push({ kind: "tag", text: chars.slice(start, i).join(""), at: at(start) });
      continue;
    }
    // A property: a quote, \p, and anything up to the next quote that no
    // backslash escapes. A character tag never begins with \p, but a later
    // \p in either token is an escape that the decoding refuses.
    if (c === "'" && chars[i + 1] === "\\" && chars[i + 2] === "p") {
      i += 3;
      while (i < chars.length && chars[i] !== "'") i += chars[i] === "\\" ? 2 : 1;
      if (i >= chars.length) fail("an unclosed property", { at: at(start) }, true);
      i++;
      tokens.push({ kind: "property", text: chars.slice(start, i).join(""), at: at(start) });
      continue;
    }
    if (c === "'") {
      i++;
      while (i < chars.length && chars[i] !== "'") i += chars[i] === "\\" ? 2 : 1;
      if (i >= chars.length) fail("an unclosed character tag", { at: at(start) }, true);
      i++;
      tokens.push({ kind: "character", text: chars.slice(start, i).join(""), at: at(start) });
      continue;
    }
    if (c === '"') {
      i++;
      while (i < chars.length && chars[i] !== '"') i += chars[i] === "\\" ? 2 : 1;
      if (i >= chars.length) fail("an unclosed string", { at: at(start) }, true);
      i++;
      tokens.push({ kind: "string", text: chars.slice(start, i).join(""), at: at(start) });
      continue;
    }
    if (c === "/" && chars[i + 2] === "/") {
      tokens.push({ kind: "phoneme", text: chars.slice(i, i + 3).join(""), at: at(start) });
      i += 3;
      continue;
    }
    if (c === "$" || c === "%") {
      i++;
      const nameStart = i;
      // `$` alone is the whole constituent; a keyword needs a name.
      if (!isLetter(chars[i] || "") && c !== "$") fail(`a name after ${c}`, { at: at(start) }, true);
      while (i < chars.length && isNameChar(chars[i])) i++;
      const text = chars.slice(start, i).join("");
      if (c === "%" && !KEYWORDS.has(text)) fail(`an unknown keyword ${text}`, { at: at(start) }, true);
      // `$` and a name with a capital is a constant (engine §2).
      const kind = c === "$" ? (isCapital(chars[nameStart] || "") ? "constant" : "capture") : text;
      tokens.push({ kind, text, at: at(start), name: chars.slice(nameStart, i).join("") });
      continue;
    }
    const symbol = SYMBOLS.find((s) => chars.slice(i, i + [...s].length).join("") === s);
    if (!symbol) fail(`unexpected character ${c}`, { at: at(i) }, true);
    tokens.push({ kind: symbol, text: symbol, at: at(start) });
    i += [...symbol].length;
  }
  return tokens;
}

export function decodeString(text, token) {
  const inner = [...text.slice(1, -1)];
  // A string escapes its double quote, and a character tag its quote.
  const quote = text[0];
  let result = "";
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] !== "\\") { result += inner[i]; continue; }
    const next = inner[++i];
    if (next === "\\" || next === quote) result += next;
    else if (next === "u" && inner[i + 1] === "{") {
      let j = i + 2;
      let hex = "";
      while (j < inner.length && inner[j] !== "}") hex += inner[j++];
      const value = parseInt(hex, 16);
      if (!/^[0-9A-Fa-f]{1,6}$/.test(hex) || j >= inner.length || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) fail("a bad \\u{...} escape", token);
      result += String.fromCodePoint(value);
      i = j;
    } else fail(`an unknown escape \\${next || ""}`, token);
  }
  return result;
}

const DIRECTIVES = new Set(["%ambiguity-resolution", "%stage", "%include", "%features"]);
const RULE_KEYWORDS = { "%rule": "define", "%redefine-rule": "redefine", "%extend-rule": "extend" };
const CONSTANT_KEYWORDS = { "%const": "define", "%redefine-const": "redefine" };
const COMPARATORS = ["=", "≠", "∈", "∉", "⊆", "⊈"];

// A character tag's DOM form: its one character in its canonical spelling
// (engine §1, §9).
function characterOf(token) {
  const decoded = [...decodeString(token.text, token)];
  if (decoded.length !== 1) fail("a character tag holds one character", token);
  return characterTag(decoded[0].codePointAt(0), unicode);
}

// A range's DOM form: its two ends in their canonical spelling (engine §9).
function rangeOf(first, last) {
  const range = [characterOf(first), characterOf(last)];
  const problem = rangeProblem(range, unicode);
  if (problem) fail(problem, first);
  return range;
}

// A property's DOM form: its name (engine §1, §9).
function propertyOf(token) {
  const match = /^'\\p\{([^}]*)\}'$/.exec(token.text);
  if (!match) fail("a property is written '\\p{Name}'", token);
  const problem = propertyProblem(match[1]);
  if (problem) fail(problem, token);
  return match[1];
}

// The tag of a tag token, a character token or a phoneme token.
function tagOf(token) {
  if (token.kind === "tag") return token.text.slice(1);
  if (token.kind === "character") return characterOf(token);
  return token.text;
}

const isCapital = (text) => /^[A-Z]/.test(text);

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
    // How many braces the parser is inside, where no capture stands, and
    // the chains of the alternative being read, each with its `{`.
    this.braces = 0;
    // How many elidable optionals the parser is inside, where no capture
    // stands either, and the token of each capture of the alternative.
    this.marked = 0;
    this.captureTokens = new Map();
    // How many groups, optionals, braces and captures the parser is
    // inside, and where the expression of the alternative begins: a chain
    // is that whole expression, or misplaced.
    this.nest = 0;
    this.start = 0;
  }
  peek(offset = 0) { return this.tokens[this.index + offset]; }
  is(kind, offset = 0) { const t = this.peek(offset); return t !== undefined && t.kind === kind; }
  take(kind) {
    const token = this.peek();
    if (!token || (kind && token.kind !== kind)) fail(`expected ${kind || "more"}`, token || { at: this.endAt }, true);
    this.index++;
    return token;
  }
  accept(kind) { if (this.is(kind)) { this.index++; return true; } return false; }

  // The index of the token that closes the (, [ or { at `index`.
  closing(index) {
    let depth = 0;
    for (let i = index; i < this.tokens.length; i++) {
      const kind = this.tokens[i].kind;
      if (kind === "(" || kind === "[" || kind === "{") depth++;
      else if (kind === ")" || kind === "]" || kind === "}") depth--;
      if (depth === 0) return i;
    }
    return this.tokens.length;
  }

  // Whether the tokens from `from` to `to`, not inside any (, [ or {
  // between them, hold one of `kinds`.
  holdsAtTop(from, to, kinds) {
    let depth = 0;
    for (let i = from; i < to; i++) {
      const kind = this.tokens[i].kind;
      if (kind === "(" || kind === "[" || kind === "{") depth++;
      else if (kind === ")" || kind === "]" || kind === "}") depth--;
      else if (depth === 0 && kinds.includes(kind)) return true;
    }
    return false;
  }

  document() {
    const rules = [];
    const directives = [];
    const constants = [];
    const classifiers = [];
    const implications = [];
    while (this.peek()) {
      const token = this.peek();
      if (DIRECTIVES.has(token.kind)) {
        this.index++;
        const args = [];
        const kinds = [];
        while (["identifier", "string", "tag", "phoneme", "character", "property"].some((kind) => this.is(kind))) {
          const operand = this.take();
          if (operand.kind === "character" && this.accept("..")) {
            this.take("character");
            kinds.push("range");
            continue;
          }
          kinds.push(operand.kind === "identifier" ? (isCapital(operand.text) ? "class" : "name") : operand.kind);
          args.push(operand.kind === "identifier" ? operand.text : operand.kind === "string" ? decodeString(operand.text, operand) : tagOf(operand));
        }
        const problem = operandProblem(token.name, kinds);
        if (problem) fail(problem, token);
        directives.push({ name: token.name, args, at: token.at });
      } else if (RULE_KEYWORDS[token.kind]) {
        rules.push(this.rule());
      } else if (CONSTANT_KEYWORDS[token.kind]) {
        // A constant's definition; the reader of the libraries checks its
        // value, which the notation's own documents never hold.
        this.index++;
        const name = this.take("constant");
        const valueStart = this.peek();
        const value = this.term();
        // The value is a closed term of a type that a constant can have
        // (engine §2, §9, §10).
        const found = constantValueType(value, CONSTANT_KEYWORDS[token.kind] === "redefine");
        if ("problem" in found) fail(found.problem, valueStart);
        constants.push({ name: name.name, op: CONSTANT_KEYWORDS[token.kind], value, at: token.at });
      } else if (token.kind === "%classifier") {
        classifiers.push(this.classifier());
      } else if (token.kind === "%implies") {
        this.index++;
        const sides = [];
        for (const last of [false, true]) {
          const start = this.peek();
          const side = this.union();
          const found = openPart(side) === null ? termType(side) : { problem: "a side of an implication is a closed term" };
          const problem = "problem" in found ? found.problem : expectedProblem(found.type, "tags");
          if (problem) fail(problem, start);
          sides.push(side);
          if (!last) this.take("⟹");
        }
        implications.push({ if: sides[0], then: sides[1], at: token.at });
      } else {
        fail("expected a rule or a directive", token, true);
      }
    }
    return { format: DOM_FORMAT, rules, directives, constants, classifiers, implications };
  }

  // A classifier: its name, and entries of gates, keys, ∈ or ∉, and a class
  // (engine §2, §9).
  classifier() {
    const keyword = this.take();
    const name = this.take("identifier");
    if (!/^[a-z]/.test(name.text)) fail("a classifier's name begins with a lower-case letter", name);
    const entries = [];
    while (this.is("guard") || this.is("string")) {
      const first = this.peek();
      const guards = [];
      while (this.is("guard")) {
        const guard = this.take();
        if (guard.text.endsWith("!")) fail("an entry of a classifier takes gates only", guard);
        guards.push({ feature: guard.name, kind: "gate", negated: guard.text.startsWith("¬") });
      }
      const keys = [];
      do {
        const token = this.take("string");
        const key = decodeString(token.text, token);
        const wrong = soundProblem(key, unicode);
        if (wrong) fail(wrong, token);
        keys.push(key);
      } while (this.is("string"));
      const op = this.take();
      if (op.kind !== "∈" && op.kind !== "∉") fail("expected ∈ or ∉", op, true);
      const written = this.take();
      if (written.kind !== "identifier" && written.kind !== "tag") fail("expected a class", written, true);
      const className = written.kind === "tag" ? written.text.slice(1) : written.text;
      if (!isCapital(className)) fail("a class begins with a capital", written);
      entries.push({ guards, keys, op: op.kind, class: className, at: first.at });
    }
    return { name: name.text, entries, at: keyword.at };
  }

  rule() {
    const keyword = this.take();
    const name = this.is("#") ? this.take("#") : this.take("identifier");
    const rule = { name: name.text, op: RULE_KEYWORDS[keyword.kind] };
    // The parts of a definition are checked in the order written: the body,
    // then its clauses, and the checks of the whole definition last
    // (engine §9).
    const alternatives = this.body();
    if (this.is("%tags")) {
      const clause = this.take();
      rule.tags = this.term();
      if (readsOwnTags(rule.tags)) fail("a constituent's tags cannot be made of its own tags", clause);
    }
    rule.alternatives = alternatives;
    const conditions = [];
    if (this.accept("%conditions")) {
      this.accept(",");
      conditions.push(this.implication());
      while (this.accept(",")) conditions.push(this.implication());
    }
    if (this.is("%emits")) rule.emit = this.emission(this.take());
    rule.conditions = conditions;
    if (this.accept("%opaque")) {
      // A constituent that does not count is never an opaque part (engine §9).
      if (rule.emit && rule.emit.items.length === 0) fail(`${rule.name} is opaque and emits ε`, keyword);
      rule.opaque = true;
    }
    rule.at = keyword.at;
    const problem = definitionProblem(rule);
    if (problem) fail(problem, keyword);
    return rule;
  }

  body() {
    this.accept("|");
    const alternatives = [this.alternative()];
    while (this.accept("|")) alternatives.push(this.alternative());
    return alternatives;
  }

  alternative() {
    const guards = [];
    while (this.is("guard")) {
      const token = this.take();
      guards.push({ feature: token.name, kind: token.text.endsWith("!") ? "warning" : "gate", negated: token.text.startsWith("¬") });
    }
    this.captureTokens = new Map();
    this.start = this.index;
    const alternative = { guards, expr: this.conjunction() };
    // A name stands at most once in each production (engine §3.5, §9).
    const twice = captureSequences(alternative.expr).duplicates.map((capture) => this.captureTokens.get(capture));
    if (twice.length > 0) {
      const first = twice.reduce((a, b) => (b.at[0] < a.at[0] || (b.at[0] === a.at[0] && b.at[1] < a.at[1]) ? b : a));
      fail("a capture name is read twice by one production", first);
    }
    if (this.is("<")) {
      const open = this.peek();
      alternative.tags = this.angleTerm();
      if (readsOwnTags(alternative.tags)) fail("a constituent's tags cannot be made of its own tags", open);
    }
    return alternative;
  }

  conjunction() {
    this.accept("&");
    const items = [this.sequence()];
    while (this.accept("&")) items.push(this.sequence());
    return items.length === 1 ? items[0] : { and: items };
  }

  sequence() {
    const items = [this.primary()];
    while (this.startsPrimary()) items.push(this.primary());
    return items.length === 1 ? items[0] : { seq: items };
  }

  startsPrimary() {
    return ["identifier", "tag", "character", "property", "phoneme", "capture", "(", "[", "{", "#", "ε"].includes((this.peek() || {}).kind);
  }

  // An optional, or with `+` or `++` an elidable one, whose terminator
  // stands directly after the marker, with no group around it, and which
  // joins it to nothing with | or & (engine §3.8, §9). As the notation's
  // reader does, it checks the optional's form first, then the test on its
  // terminator, and then what it holds, in the order written.
  optional() {
    const open = this.take("[");
    const marker = this.is("+") || this.is("++") ? this.take().kind : null;
    this.nest++;
    if (!marker) {
      const inner = this.choice();
      this.take("]");
      this.nest--;
      return { optional: inner };
    }
    const first = this.peek();
    // A second marker is a syntax error, as the notation's grammar reads it.
    if (first && (first.kind === "+" || first.kind === "++")) fail("an optional has one marker", first, true);
    const close = this.closing(this.index - 2);
    const terminal = first && ((first.kind === "identifier" && isCapital(first.text)) || first.kind === "tag");
    if (!terminal || this.holdsAtTop(this.index, close, ["|", "&"])) fail("an elidable optional begins with its terminator, and joins it to nothing with | or &", open);
    const testToken = this.peek(1);
    if (testToken && ["≠", "⊇", "⊉", "∩"].includes(testToken.kind)) fail("the terminator of an elidable optional takes no test but =", testToken);
    this.marked++;
    const inner = this.choice();
    this.marked--;
    this.take("]");
    this.nest--;
    if (elidableHead(inner) === null) fail("an elidable optional begins with its terminator, and joins it to nothing with | or &", open);
    return marker === "++" ? { optional: inner, elidable: true, maximal: true } : { optional: inner, elidable: true };
  }

  // Braces: `{x}`, `{x \ s}`, and the chains `{... x \ s}` and
  // `{x ... \ s}` (engine §9). Before what they hold, the braces of a
  // chain must be the whole expression of their alternative.
  repetition() {
    const openIndex = this.index;
    const open = this.take("{");
    const close = this.closing(openIndex);
    if (this.holdsAtTop(openIndex + 1, close, ["..."])) {
      const after = this.tokens[close + 1];
      const ends = after === undefined || after.kind === "|" || after.kind === "<" || after.kind.startsWith("%");
      if (this.nest > 0 || openIndex !== this.start || !ends) fail("a chain is the whole expression of its alternative", open);
    }
    let chain = this.accept("...") ? "left" : null;
    this.braces++;
    this.nest++;
    const item = this.choice();
    if (this.is("...")) {
      if (chain) fail("braces have one chain marker ... at most", this.peek(), true);
      this.index++;
      chain = "right";
    }
    const separator = this.accept("\\") ? this.choice() : undefined;
    this.braces--;
    this.nest--;
    this.take("}");
    const expr = { repeat: item };
    if (separator !== undefined) expr.separator = separator;
    if (chain) expr.chain = chain;
    return expr;
  }

  primary() {
    const token = this.peek();
    // A test after a group, an optional, braces or a capture is refused
    // before what they hold, as the notation's reader does (engine §9).
    if (token && ["(", "[", "{", "capture"].includes(token.kind)) {
      const after = this.tokens[this.closing(token.kind === "capture" ? this.index + 1 : this.index) + 1];
      if (after && ["=", "≠", "⊇", "⊉", "∩"].includes(after.kind)) {
        fail("a test follows only a reference other than # or a terminal, not a group, an optional, braces, a capture, ε, # or another test", after);
      }
    }
    let expr = this.symbol();
    // A reference other than # or a terminal may take one test on its own
    // span; the reader refuses a test after anything else (engine §2, §9).
    while (this.startsTest()) {
      const testToken = this.peek();
      const testable = ["identifier", "tag", "character", "property", "phoneme"].includes(token.kind) && expr.test === undefined;
      if (!testable) fail("a test follows only a reference other than # or a terminal, not a group, an optional, braces, a capture, ε, # or another test", testToken);
      let test = this.take().kind;
      const operandToken = this.peek();
      const value = this.testOperand();
      if (test === "∩") {
        const emptiness = this.accept("=") ? "=" : (this.take("≠"), "≠");
        this.take("∅");
        test = `∩${emptiness}∅`;
      }
      const fault = testValueFault(test, value, unicode);
      if (fault) fail(fault.problem, operandToken);
      expr = { test, value, expr };
    }
    return expr;
  }

  startsTest() {
    return ["=", "≠", "⊇", "⊉", "∩"].includes((this.peek() || {}).kind);
  }

  // A test's operand: one term, a bare name never a call (engine §9).
  testOperand() {
    const token = this.peek();
    if (token && token.kind === "identifier") {
      if (!isCapital(token.text)) fail("a rule is not a value", token);
      this.index++;
      return { tag: token.text };
    }
    if (token && token.kind === "capture") fail("expected a term", token, true);
    return this.termAtom();
  }

  symbol() {
    const token = this.peek();
    if (!token) fail("expected an expression", { at: this.endAt }, true);
    switch (token.kind) {
      case "identifier": this.index++; return { ref: token.text };
      case "character":
        this.index++;
        if (this.accept("..")) return { range: rangeOf(token, this.take("character")) };
        return { terminal: tagOf(token) };
      case "property": this.index++; return { property: propertyOf(token) };
      case "tag": case "phoneme": this.index++; return { terminal: tagOf(token) };
      case "capture": {
        this.index++;
        if (this.braces > 0) fail("a capture cannot stand inside braces", token);
        if (this.marked > 0) fail("a capture cannot stand inside an elidable optional", token);
        if (token.name === "") fail("$ is the whole constituent and wraps nothing", token);
        this.take("(");
        this.nest++;
        // A capture wraps one symbol, never a group, an optional or braces,
        // even of one symbol (engine §9).
        if (["(", "[", "{"].includes((this.peek() || {}).kind)) fail("a capture wraps one symbol", token);
        const inner = this.primary();
        this.take(")");
        this.nest--;
        if (inner.ref === undefined && inner.terminal === undefined && inner.test === undefined && inner.range === undefined && inner.property === undefined) fail("a capture wraps one symbol", token);
        const capture = { capture: token.name, expr: inner };
        this.captureTokens.set(capture, token);
        return capture;
      }
      case "(": {
        this.index++;
        this.nest++;
        const inner = this.choice();
        this.take(")");
        this.nest--;
        return inner;
      }
      case "[": return this.optional();
      case "{": return this.repetition();
      case "#": this.index++; return { ref: "#" };
      case "ε": this.index++; return { empty: true };
      default: fail("expected an expression", token, true);
    }
  }

  choice() {
    this.accept("|");
    const items = [this.conjunction()];
    while (this.accept("|")) items.push(this.conjunction());
    return items.length === 1 ? items[0] : { choice: items };
  }

  angleTerm() {
    this.take("<");
    const term = this.term();
    this.take(">");
    return term;
  }

  emission(at) {
    if (this.accept("ε")) return { items: [] };
    this.accept(",");
    const items = [this.emitItem()];
    while (this.accept(",")) items.push(this.emitItem());
    if (items.some((item) => item.capture === "") && !items.every((item) => item.capture === "")) fail("$ goes with no item but another $", at);
    // A capture stands once in an emission, as an item or as an attachment
    // (engine §9).
    const named = items.flatMap((item) => (item.capture ? [item.capture, ...(item.before || []), ...(item.after || [])] : []));
    if (named.some((name, index) => named.indexOf(name) !== index)) fail("%emits lists a capture twice", at);
    return { items };
  }

  // An attachment: a named capture in parentheses (engine §9, §11).
  attachment() {
    const open = this.take("(");
    const capture = this.take("capture");
    if (capture.name === "") fail("an attachment holds a named capture, not $", open);
    this.take(")");
    return capture.name;
  }

  emitItem() {
    const first = this.peek();
    const before = [];
    while (this.is("(")) before.push(this.attachment());
    const token = this.take();
    let item;
    if (token.kind === "capture") item = { capture: token.name };
    else if (token.kind === "property" || (token.kind === "character" && this.is(".."))) fail("an inserted item is one tag, not a range or a property", token);
    else if (token.kind === "tag" || token.kind === "character" || token.kind === "phoneme") item = { insert: tagOf(token) };
    else if (token.kind === "identifier" && isCapital(token.text)) item = { insert: token.text };
    else fail("expected a capture or a tag after %emits", token, true);
    if (this.is("<")) {
      if (item.insert !== undefined) fail("an inserted tag takes no tags of its own", token);
      item.tags = this.angleTerm();
    }
    const after = [];
    while (this.is("(")) after.push(this.attachment());
    if ((before.length || after.length) && item.capture === undefined) fail("an inserted tag carries no attachments", first);
    if ((before.length || after.length) && item.capture === "") fail("$ carries no attachments; name a capture", first);
    if (before.length) item.before = before;
    if (after.length) item.after = after;
    return item;
  }

  // Tries a parse, and rewinds if it fails.
  attempt(parse) {
    const saved = this.index;
    attempts++;
    try {
      return parse();
    } catch (error) {
      void error;
      this.index = saved;
      return undefined;
    } finally {
      attempts--;
    }
  }

  implication() {
    const left = this.anyOf();
    if (!this.accept("⟹")) return left;
    return { if: left, then: this.implication() };
  }

  anyOf() {
    this.accept("∨");
    const items = [this.allOf()];
    while (this.accept("∨")) items.push(this.allOf());
    const flat = items.flatMap((item) => (item.any ? item.any : [item]));
    return flat.length === 1 ? flat[0] : { any: flat };
  }

  allOf() {
    this.accept("∧");
    const items = [this.condition()];
    while (this.accept("∧")) items.push(this.condition());
    const flat = items.flatMap((item) => (item.all ? item.all : [item]));
    return flat.length === 1 ? flat[0] : { all: flat };
  }

  condition() {
    if (this.accept("¬")) return { not: this.condition() };
    if (this.is("(")) {
      // Conditions in parentheses, or a comparison whose first term is in
      // parentheses: only one of the two reads on to a whole condition.
      const grouped = this.attempt(() => {
        this.take("(");
        const inner = this.implication();
        this.take(")");
        if (this.startsComparator() || this.is("∪") || this.is("∩") || this.is("∖")) fail("a term, not a condition", this.peek());
        return inner;
      });
      if (grouped) return grouped;
    }
    if (this.is("capture") && !this.startsComparator(1) && !this.is("∪", 1) && !this.is("∩", 1) && !this.is("∖", 1)) {
      return { captured: this.take().name };
    }
    if (this.is("identifier") && ["matches", "begins"].includes(this.peek().text) && this.is("(", 1)) {
      const saved = this.index;
      const call = this.call();
      if (!this.startsComparator()) {
        if (call.args.length !== 2 || call.args[1].rule === undefined) fail(`${call.call} takes a span and a rule`, this.tokens[saved]);
        return call.call === "matches" ? { matches: call.args[0], rule: call.args[1].rule } : { begins: call.args[0], rule: call.args[1].rule };
      }
      this.index = saved;
    }
    if (this.is("identifier") && this.peek().text === "initial" && this.is("(", 1)) {
      const saved = this.index;
      const call = this.call();
      if (!this.startsComparator()) {
        if (call.args.length !== 1) fail("initial takes a span", this.tokens[saved]);
        return { initial: call.args[0] };
      }
      this.index = saved;
    }
    const start = this.peek();
    const left = this.union();
    const op = this.take();
    if (!COMPARATORS.includes(op.kind)) fail("expected a comparison", op, true);
    const rightStart = this.peek();
    const right = this.union();
    // Each side is a value, at its own place, and the two sides fit the
    // comparator, at the comparison (engine §9, §10).
    const leftType = termType(left);
    const rightType = termType(right);
    if ("problem" in leftType || leftType.type === "span") fail("problem" in leftType ? leftType.problem : "a span is not a value", start);
    if ("problem" in rightType || rightType.type === "span") fail("problem" in rightType ? rightType.problem : "a span is not a value", rightStart);
    const problem = comparisonProblem(op.kind, leftType.type, rightType.type);
    if (problem) fail(problem, start);
    return { op: op.kind, left, right };
  }

  startsComparator(offset = 0) {
    return COMPARATORS.includes((this.peek(offset) || {}).kind);
  }

  // A whole tag term: a union, or a condition guarding a term.
  term() {
    const guarded = this.attempt(() => {
      const condition = this.anyOf();
      this.take("⟹");
      return { if: condition, then: this.term() };
    });
    return guarded || this.union();
  }

  // Parts joined by ∪ and ∖, from the left: a run of ∪ is one union.
  union() {
    this.accept("∪");
    let result = this.intersection();
    let open = false;
    for (;;) {
      if (this.accept("∪")) {
        const next = this.intersection();
        if (open) result.union.push(next);
        else result = { union: [result, next] };
        open = true;
      } else if (this.accept("∖")) {
        result = { difference: [result, this.intersection()] };
        open = false;
      } else return result;
    }
  }

  intersection() {
    this.accept("∩");
    const items = [this.termAtom()];
    while (this.accept("∩")) items.push(this.termAtom());
    return items.length === 1 ? items[0] : { intersection: items };
  }

  termAtom() {
    const token = this.peek();
    if (!token) fail("expected a term", { at: this.endAt }, true);
    switch (token.kind) {
      case "string": this.index++; return { string: decodeString(token.text, token) };
      case "character":
        this.index++;
        if (this.accept("..")) return { range: rangeOf(token, this.take("character")) };
        return { tag: tagOf(token) };
      case "property": return fail("a property is not a tag set, and stands only as a terminal in a body", token);
      case "tag": case "phoneme": this.index++; return { tag: tagOf(token) };
      case "∅": this.index++; return { emptySet: true };
      case "(": { this.index++; const inner = this.term(); this.take(")"); return inner; }
      case "capture": this.index++; return { capture: token.name };
      case "constant": this.index++; return { const: token.name, at: token.at };
      case "identifier":
        if (this.is("(", 1)) return this.call();
        if (!isCapital(token.text)) fail("a rule is not a value", token);
        this.index++;
        return { tag: token.text };
      default: fail("expected a term", token, true);
    }
  }

  call() {
    const name = this.take("identifier");
    this.take("(");
    const args = [this.argument()];
    while (this.accept(",")) args.push(this.argument());
    this.take(")");
    // A bare name is only the second argument of tags, matches, begins or
    // classify. Elsewhere the call has the wrong arguments (engine §9).
    args.forEach((arg, i) => {
      if (arg.rule !== undefined && !(i === 1 && ["tags", "matches", "begins", "classify"].includes(name.text))) fail(`${name.text} is called with the wrong arguments`, name);
    });
    // The second argument of classify names a classifier (engine §9).
    if (name.text === "classify" && args.length === 2 && args[1].rule !== undefined) return { call: name.text, args: [args[0], { classifier: args[1].rule }] };
    return { call: name.text, args };
  }

  // A bare name, in any number of parentheses, names a rule or a
  // classifier, as it does outside them (engine §9).
  argument() {
    let depth = 0;
    while (this.is("(", depth)) depth++;
    if (this.is("identifier", depth) && !this.is("(", depth + 1)) {
      let closed = 0;
      while (closed < depth && this.is(")", depth + 1 + closed)) closed++;
      if (closed === depth) {
        this.index += depth;
        const name = this.take().text;
        for (let i = 0; i < depth; i++) this.take(")");
        return { rule: name };
      }
    }
    return this.union();
  }
}

// Reads a grammar document's Markdown into its DOM.
export function readDocument(markdown, path) {
  const { text, positions } = extractGrammarText(markdown, path);
  const tokens = lex(text, positions);
  const parse = () => {
    const parser = new Parser(tokens);
    parser.endAt = positions.length ? positions[positions.length - 1] : [1, 1];
    return parser.document();
  };
  try {
    return parse();
  } catch (error) {
    if (error.syntax) throw error;
    // Another error: a syntax error anywhere in the document comes first.
    syntaxOnly = true;
    try {
      parse();
    } catch (syntax) {
      if (syntax.syntax) throw syntax;
    } finally {
      syntaxOnly = false;
      attempts = 0;
    }
    throw error;
  }
}
