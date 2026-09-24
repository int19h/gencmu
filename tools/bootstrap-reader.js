// A hand-written reader for the notation, used only to produce the first
// grammars/notation/bootstrap.json and to recover if a change to the
// notation ever leaves the current bootstrap unable to read the notation
// documents. The libraries never use it: they read every grammar, the
// notation's own included, with the bootstrap. It follows
// grammars/notation/*.md and docs/engine.md §9, and must produce exactly
// the DOM the self-hosted reader does; the fixpoint check compares them.

import { extractGrammarText } from "../js/src/markdown.js";

const SYMBOLS = ["|≔", "...", "≔", "|", "&", "(", ")", "[", "]", "{", "}", "<", ">", "#", "ε", "⇒", ":", ";", ",",
  "∧", "∨", "¬", "?", "=", "≠", "∈", "∉", "⊆", "∪", "∩", "∅"];

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
      if (c === "@" && chars[i] === "!") i++;
      const nameStart = i;
      if (!isLetter(chars[i] || "")) fail(`a name after ${c}`, { at: at(start) });
      while (i < chars.length && isNameChar(chars[i])) i++;
      const kind = c === "$" ? "capture" : c === "%" ? "directive" : "guard";
      tokens.push({ kind, text: chars.slice(start, i).join(""), at: at(start), name: chars.slice(nameStart, i).join("") });
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
      if (this.is("directive")) {
        const token = this.take("directive");
        const args = [];
        while (this.is("identifier")) args.push(this.take().text);
        this.take(";");
        directives.push({ name: token.name, args, at: token.at });
      } else {
        rules.push(this.rule());
      }
    }
    return { format: 1, rules, directives };
  }

  rule() {
    const name = this.take("identifier");
    const rule = { name: name.text, op: "define" };
    if (this.is("<")) rule.tags = this.angleTerm();
    if (this.accept("|≔")) rule.op = "extend";
    else this.take("≔");
    rule.alternatives = this.body();
    rule.conditions = [];
    for (;;) {
      if (this.is("⇒")) {
        const token = this.take();
        if (rule.emit) fail("a rule may have one ⇒ clause", token);
        rule.emit = this.emission(token);
      } else if (this.accept(":")) {
        this.accept(",") || this.accept("∧");
        rule.conditions.push(this.conditionItem());
        while (this.is(",") || this.is("∧")) {
          this.index++;
          rule.conditions.push(this.conditionItem());
        }
      } else break;
    }
    this.take(";");
    const ordered = { name: rule.name, op: rule.op };
    if (rule.tags) ordered.tags = rule.tags;
    ordered.alternatives = rule.alternatives;
    if (rule.emit) ordered.emit = rule.emit;
    ordered.conditions = rule.conditions;
    ordered.at = name.at;
    return ordered;
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
      guards.push({ feature: token.name, negated: token.text.startsWith("@!") });
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
        this.take("(");
        const inner = this.primary();
        this.take(")");
        if (inner.ref === undefined && inner.terminal === undefined) fail("a capture wraps one symbol", token);
        return { capture: token.name, expr: inner };
      }
      case "(": { this.index++; const inner = this.choice(); this.take(")"); return inner; }
      case "[": { this.index++; const inner = this.choice(); this.take("]"); return { optional: inner }; }
      case "#": this.index++; return { hash: true };
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
    if (items.some((item) => item.nothing)) {
      if (items.length !== 1 || items[0].tags) fail("⇒ nothing stands alone", at);
      return { nothing: true };
    }
    if (items.some((item) => item.this) && items.length !== 1) fail("⇒ this stands alone", at);
    return { items };
  }

  emitItem() {
    const token = this.take();
    let item;
    if (token.kind === "identifier" && token.text === "this") item = { this: true };
    else if (token.kind === "identifier" && token.text === "nothing") item = { nothing: true };
    else if (token.kind === "capture") item = { capture: token.name };
    else if (token.kind === "string") item = { insert: decodeString(token.text, token) };
    else if (token.kind === "phoneme") item = { insert: token.text };
    else fail("expected this, nothing, a capture or a tag after ⇒", token);
    if (this.is("<")) item.tags = this.angleTerm();
    return item;
  }

  conditionItem() {
    this.accept("∨");
    const items = [this.condition()];
    while (this.accept("∨")) items.push(this.condition());
    return items.length === 1 ? items[0] : { any: items };
  }

  condition() {
    if (this.is("¬")) {
      const token = this.take();
      if (this.is("(")) {
        // ¬( condition ) or ¬ followed by a term in parentheses: try the
        // condition first, as the grammar's greedy reading does.
        const saved = this.index;
        try {
          this.take("(");
          const inner = this.condition();
          this.take(")");
          return { not: inner };
        } catch (error) {
          this.index = saved;
        }
      }
      void token;
      return { not: this.condition() };
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
    const left = this.term();
    const op = this.take();
    if (!["=", "≠", "∈", "∉", "⊆"].includes(op.kind)) fail("expected a comparison", op);
    const right = this.term();
    return { op: op.kind, left, right };
  }

  startsComparator() {
    return ["=", "≠", "∈", "∉", "⊆"].includes((this.peek() || {}).kind);
  }

  term() {
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
      case "{": {
        this.index++;
        const items = [];
        if (!this.is("}")) {
          items.push(this.term());
          while (this.accept(",")) items.push(this.term());
        }
        this.take("}");
        return { set: items };
      }
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
    return this.term();
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
