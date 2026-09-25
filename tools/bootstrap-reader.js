// A hand-written reader for the notation, used only to produce the first
// grammars/notation/bootstrap.json and to recover if a change to the
// notation ever leaves the current bootstrap unable to read the notation
// documents. The libraries never use it: they read every grammar, the
// notation's own included, with the bootstrap. It follows
// grammars/notation/*.md and docs/engine.md §9, and must produce exactly
// the DOM the self-hosted reader does; the fixpoint check compares them.

import { extractGrammarText } from "../js/src/markdown.js";

const SYMBOLS = ["...", "|", "&", "(", ")", "[", "]", "<", ">", "#", "ε", ",", "∧", "∨", "¬", "⟹", "?", "=", "≠",
  "∈", "∉", "⊆", "∪", "∩", "∅"];

const KEYWORDS = new Set(["%rule", "%redefine-rule", "%extend-rule", "%tags", "%conditions", "%emits",
  "%ambiguity-resolution", "%elidable"]);

function fail(message, token) {
  const error = new Error(message);
  error.at = token ? token.at : null;
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
      if (j >= chars.length) fail("an unclosed comment", { at: at(i) });
      i = j + 2;
      continue;
    }
    const start = i;
    if (isLetter(c)) {
      while (i < chars.length && isNameChar(chars[i])) i++;
      tokens.push({ kind: "identifier", text: chars.slice(start, i).join(""), at: at(start) });
      continue;
    }
    if (c === '"') {
      i++;
      while (i < chars.length && chars[i] !== '"') i += chars[i] === "\\" ? 2 : 1;
      if (i >= chars.length) fail("an unclosed string", { at: at(start) });
      i++;
      tokens.push({ kind: "string", text: chars.slice(start, i).join(""), at: at(start) });
      continue;
    }
    if (c === "/" && chars[i + 2] === "/") {
      tokens.push({ kind: "phoneme", text: chars.slice(i, i + 3).join(""), at: at(start) });
      i += 3;
      continue;
    }
    if (c === "$" || c === "%" || c === "@") {
      i++;
      if (c === "@" && chars[i] === "¬") i++;
      const nameStart = i;
      // `$` alone is the whole constituent; every other sigil needs a name.
      if (!isLetter(chars[i] || "") && c !== "$") fail(`a name after ${c}`, { at: at(start) });
      while (i < chars.length && isNameChar(chars[i])) i++;
      const text = chars.slice(start, i).join("");
      if (c === "%" && !KEYWORDS.has(text)) fail(`an unknown keyword ${text}`, { at: at(start) });
      const kind = c === "$" ? "capture" : c === "%" ? text : "guard";
      tokens.push({ kind, text, at: at(start), name: chars.slice(nameStart, i).join("") });
      continue;
    }
    const symbol = SYMBOLS.find((s) => chars.slice(i, i + [...s].length).join("") === s);
    if (!symbol) fail(`unexpected character ${c}`, { at: at(i) });
    tokens.push({ kind: symbol, text: symbol, at: at(start) });
    i += [...symbol].length;
  }
  return tokens;
}

export function decodeString(text, token) {
  const inner = [...text.slice(1, -1)];
  let result = "";
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] !== "\\") { result += inner[i]; continue; }
    const next = inner[++i];
    if (next === "\\" || next === '"') result += next;
    else if (next === "u" && inner[i + 1] === "{") {
      let j = i + 2;
      let hex = "";
      while (j < inner.length && inner[j] !== "}") hex += inner[j++];
      if (!/^[0-9A-Fa-f]{1,6}$/.test(hex) || j >= inner.length) fail("a bad \\u{...} escape", token);
      result += String.fromCodePoint(parseInt(hex, 16));
      i = j;
    } else fail(`an unknown escape \\${next || ""}`, token);
  }
  return result;
}

const RULE_KEYWORDS = { "%rule": "define", "%redefine-rule": "redefine", "%extend-rule": "extend" };
const COMPARATORS = ["=", "≠", "∈", "∉", "⊆"];

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
  }
  peek(offset = 0) { return this.tokens[this.index + offset]; }
  is(kind, offset = 0) { const t = this.peek(offset); return t !== undefined && t.kind === kind; }
  take(kind) {
    const token = this.peek();
    if (!token || (kind && token.kind !== kind)) fail(`expected ${kind || "more"}`, token || { at: this.endAt });
    this.index++;
    return token;
  }
  accept(kind) { if (this.is(kind)) { this.index++; return true; } return false; }

  document() {
    const rules = [];
    const directives = [];
    while (this.peek()) {
      const token = this.peek();
      if (token.kind === "%ambiguity-resolution" || token.kind === "%elidable") {
        this.index++;
        const args = [];
        while (this.is("identifier")) args.push(this.take().text);
        directives.push({ name: token.name, args, at: token.at });
      } else if (RULE_KEYWORDS[token.kind]) {
        rules.push(this.rule());
      } else {
        fail("expected a rule or a directive", token);
      }
    }
    return { format: 3, rules, directives };
  }

  rule() {
    const keyword = this.take();
    const name = this.is("#") ? this.take("#") : this.take("identifier");
    const rule = { name: name.text, op: RULE_KEYWORDS[keyword.kind] };
    const alternatives = this.body();
    if (this.accept("%tags")) rule.tags = this.term();
    rule.alternatives = alternatives;
    const conditions = [];
    if (this.accept("%conditions")) {
      this.accept(",");
      conditions.push(this.implication());
      while (this.accept(",")) conditions.push(this.implication());
    }
    if (this.accept("%emits")) rule.emit = this.emission(keyword);
    rule.conditions = conditions;
    rule.at = keyword.at;
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
      guards.push({ feature: token.name, negated: token.text.startsWith("@¬") });
    }
    const alternative = { guards, expr: this.conjunction() };
    if (this.is("<")) alternative.tags = this.angleTerm();
    return alternative;
  }

  conjunction() {
    this.accept("&");
    const items = [this.sequence()];
    while (this.accept("&")) items.push(this.sequence());
    return items.length === 1 ? items[0] : { and: items };
  }

  sequence() {
    const items = [this.element()];
    while (this.startsPrimary()) items.push(this.element());
    return items.length === 1 ? items[0] : { seq: items };
  }

  startsPrimary() {
    return ["identifier", "string", "phoneme", "capture", "(", "[", "#", "ε"].includes((this.peek() || {}).kind);
  }

  element() {
    const primary = this.primary();
    if (!this.accept("...")) return primary;
    if (primary.optional !== undefined) return { repeat: primary.optional, min: 0 };
    return { repeat: primary, min: 1 };
  }

  primary() {
    const token = this.peek();
    if (!token) fail("expected an expression", { at: this.endAt });
    switch (token.kind) {
      case "identifier": this.index++; return { ref: token.text };
      case "string": this.index++; return { terminal: decodeString(token.text, token) };
      case "phoneme": this.index++; return { terminal: token.text };
      case "capture": {
        this.index++;
        if (token.name === "") fail("$ is the whole constituent and wraps nothing", token);
        this.take("(");
        const inner = this.primary();
        this.take(")");
        if (inner.ref === undefined && inner.terminal === undefined) fail("a capture wraps one symbol", token);
        return { capture: token.name, expr: inner };
      }
      case "(": { this.index++; const inner = this.choice(); this.take(")"); return inner; }
      case "[": { this.index++; const inner = this.choice(); this.take("]"); return { optional: inner }; }
      case "#": this.index++; return { ref: "#" };
      case "ε": this.index++; return { empty: true };
      default: fail("expected an expression", token);
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
    this.accept(",");
    const items = [this.emitItem()];
    while (this.accept(",")) items.push(this.emitItem());
    if (items.some((item) => item.capture === "") && !items.every((item) => item.capture === "")) fail("$ goes with no item but another $", at);
    if (items.some((item) => item.capture === "" && item.silent) && items.length !== 1) fail("$ <> stands alone", at);
    return { items };
  }

  emitItem() {
    const token = this.take();
    let item;
    if (token.kind === "capture") item = { capture: token.name };
    else if (token.kind === "string") item = { insert: decodeString(token.text, token) };
    else if (token.kind === "phoneme") item = { insert: token.text };
    else fail("expected a capture or a tag after %emits", token);
    if (this.is("<") && this.is(">", 1)) {
      if (item.insert !== undefined) fail("an inserted tag takes no tags of its own", token);
      this.index += 2;
      item.silent = true;
    } else if (this.is("<")) {
      if (item.insert !== undefined) fail("an inserted tag takes no tags of its own", token);
      item.tags = this.angleTerm();
    }
    return item;
  }

  // Tries a parse, and rewinds if it fails.
  attempt(parse) {
    const saved = this.index;
    try {
      return parse();
    } catch (error) {
      void error;
      this.index = saved;
      return undefined;
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
        if (this.startsComparator() || this.is("∪") || this.is("∩")) fail("a term, not a condition", this.peek());
        return inner;
      });
      if (grouped) return grouped;
    }
    if (this.is("capture") && !this.startsComparator(1) && !this.is("∪", 1) && !this.is("∩", 1)) {
      return { captured: this.take().name };
    }
    if (this.is("identifier") && this.peek().text === "matches" && this.is("(", 1)) {
      const saved = this.index;
      const call = this.call();
      if (!this.startsComparator()) {
        if (call.args.length !== 2 || call.args[1].rule === undefined) fail("matches takes a span and a rule", this.tokens[saved]);
        return { matches: call.args[0], rule: call.args[1].rule };
      }
      this.index = saved;
    }
    const left = this.union();
    const op = this.take();
    if (!COMPARATORS.includes(op.kind)) fail("expected a comparison", op);
    const right = this.union();
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

  union() {
    this.accept("∪");
    const items = [this.intersection()];
    while (this.accept("∪")) items.push(this.intersection());
    return items.length === 1 ? items[0] : { union: items };
  }

  intersection() {
    this.accept("∩");
    const items = [this.termAtom()];
    while (this.accept("∩")) items.push(this.termAtom());
    return items.length === 1 ? items[0] : { intersection: items };
  }

  termAtom() {
    const token = this.peek();
    if (!token) fail("expected a term", { at: this.endAt });
    switch (token.kind) {
      case "string": this.index++; return { literal: decodeString(token.text, token) };
      case "phoneme": this.index++; return { literal: token.text };
      case "?": { this.index++; const s = this.take("string"); return { weak: decodeString(s.text, s) }; }
      case "∅": this.index++; return { emptySet: true };
      case "(": { this.index++; const inner = this.term(); this.take(")"); return inner; }
      case "capture": this.index++; return { capture: token.name };
      case "identifier": return this.call();
      default: fail("expected a term", token);
    }
  }

  call() {
    const name = this.take("identifier");
    this.take("(");
    const args = [this.argument()];
    while (this.accept(",")) args.push(this.argument());
    this.take(")");
    return { call: name.text, args };
  }

  argument() {
    if (this.is("identifier") && !this.is("(", 1)) return { rule: this.take().text };
    return this.union();
  }
}

// Reads a grammar document's Markdown into its DOM.
export function readDocument(markdown, path) {
  const { text, positions } = extractGrammarText(markdown, path);
  const tokens = lex(text, positions);
  const parser = new Parser(tokens);
  parser.endAt = positions.length ? positions[positions.length - 1] : [1, 1];
  return parser.document();
}
