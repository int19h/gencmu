// A hand-written reader for the notation, used only to produce the first
// grammars/notation/bootstrap.json and to recover if a change to the
// notation ever leaves the current bootstrap unable to read the notation
// documents. The libraries never use it: they read every grammar, the
// notation's own included, with the bootstrap. Its lexer and parser follow
// grammars/notation/lexical.md and syntax.md, and build the tree that the
// notation's syntax stage gives, with its rules and tokens; the library's
// reader then reads that tree, so both readers check a document in the one
// order of docs/engine.md §9 and give the same DOM or the same error. The
// fixpoint check compares their DOMs.

import fs from "node:fs";
import { extractGrammarText } from "../lib/js/src/markdown.js";
import { domOfTree } from "../lib/js/src/dialect.js";
import { GencmuError } from "../lib/js/src/errors.js";
import { run } from "../lib/js/src/trampoline.js";
import { countWork, hooks } from "../lib/js/src/testing.js";
import { UnicodeTable } from "../lib/js/src/unicode.js";

// The lowercase mapping that the string of a sound test is checked against,
// and the marks that a character tag escapes (engine §1, §9).
const unicode = new UnicodeTable(fs.readFileSync(new URL("../grammars/unicode.txt", import.meta.url), "utf8"));

// The symbols of one character; `..`, `...`, `++` and `¬` have rules of
// their own in the lexer.
const SYMBOLS = new Set(["+", "|", "&", "(", ")", "[", "]", "{", "}", "\\", "<", ">", "#", "ε", ",", "∧", "∨", "⟹", "=", "≠",
  "∈", "∉", "⊆", "⊈", "⊇", "⊉", "∪", "∩", "∖", "∅"]);

const KEYWORDS = new Set(["%rule", "%redefine-rule", "%extend-rule", "%tags", "%conditions", "%emits", "%opaque",
  "%ambiguity-resolution", "%stage", "%include", "%features", "%const", "%redefine-const", "%classifier", "%implies"]);

// A syntax error: the text cannot be read as the notation at all, which the
// reader reports before any other error (engine §9).
class SyntaxFailure extends Error {
  constructor(message, at) {
    super(message);
    this.at = at;
  }
}

function syntaxError(message, at) {
  throw new SyntaxFailure(message, at);
}

const isCapital = (text) => /^[A-Z]/.test(text);

// The tokens of grammars/notation/lexical.md, each with its kind: the tag
// that the lexical stage gives it, or the symbol itself. The lexical stage
// reads the whole text as pieces, and under `greedy` the first piece where
// two readings differ is the longer one (engine §6). So the lexer takes,
// at each place, the longest piece after which the rest of the text can
// still be read: `$a?` is `$` and the guard `a?`, since `$a` leaves `?`.
// A text that cannot be read is an error at the furthest character that
// any reading reached, where the lexical stage reports it.
//
// A name in a token is a whole run of name characters, so each place has a
// few pieces at most. The ends of runs, comments and quoted tokens are
// found once for the whole text, so the lexer's work grows with the
// text's length. Each step of it counts as walkSteps of `hooks.work`
// (tests/README.md).
function lex(text, positions) {
  const chars = [...text];
  const n = chars.length;
  const at = (index) => positions[index] || positions[positions.length - 1] || [1, 1];
  const isLetter = (c) => c !== undefined && /^[A-Za-z]$/.test(c);
  const isNameChar = (c) => c !== undefined && /^[A-Za-z0-9-]$/.test(c);
  // For each place: the end of the run of name characters from it; the
  // first `*)` at or after it; and, for each quote, the end of a quoted
  // body that begins there, where a backslash escapes any character.
  const runEnds = new Array(n + 2).fill(n);
  const closes = new Array(n + 2).fill(n);
  /** @type {Record<string, number[]>} */
  const bodyEnds = { '"': new Array(n + 3).fill(n), "'": new Array(n + 3).fill(n) };
  for (let i = n - 1; i >= 0; i--) {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    runEnds[i] = isNameChar(chars[i]) ? runEnds[i + 1] : i;
    closes[i] = chars[i] === "*" && chars[i + 1] === ")" ? i : closes[i + 1];
    for (const quote of ['"', "'"]) {
      const ends = bodyEnds[quote];
      ends[i] = chars[i] === quote ? i : chars[i] === "\\" ? ends[i + 2] : ends[i + 1];
    }
  }
  // The end of a quoted token whose body begins at `from`, or one past the
  // end of the text.
  const quotedEnd = (from, quote) => Math.min(bodyEnds[quote][from] + 1, n + 1);
  // Whether a guard begins at `j`: a name and `?` or `!`, or `¬`, a name
  // and `?`.
  const guardAt = (j) => (isLetter(chars[j]) && (chars[runEnds[j]] === "?" || chars[runEnds[j]] === "!")) ||
    (chars[j] === "¬" && isLetter(chars[j + 1]) && chars[runEnds[j + 1]] === "?");
  // The pieces that can begin at `i`, each its end and its kind (null for
  // layout), longest first, and the furthest character that any of them,
  // complete or not, reaches.
  const pieces = (i) => {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    const c = chars[i];
    /** @type {[number, string | null][]} */
    const found = [];
    let reach = i;
    // A whole name with a prefix (`$`, `%`, `~`).
    const prefixed = (from, kindOf) => {
      if (!isLetter(chars[from])) return;
      const end = runEnds[from];
      found.push([end, kindOf(chars.slice(i, end).join(""))]);
      reach = Math.max(reach, end);
    };
    if (/^\p{White_Space}$/u.test(c)) found.push([i + 1, null]);
    if (c === "(" && chars[i + 1] === "*") {
      const j = closes[i + 2];
      if (j < n) found.push([j + 2, null]);
      reach = Math.max(reach, Math.min(j + 2, n));
    }
    if (isLetter(c)) {
      // A whole name, or the whole run and `?` or `!`, a guard.
      const end = runEnds[i];
      if (chars[end] === "?" || chars[end] === "!") found.push([end + 1, "guard"]);
      found.push([end, "identifier"]);
      reach = Math.max(reach, end);
    }
    if (c === "¬") {
      // `¬`, a negation, unless a guard begins after it; or `¬`, a name
      // and `?`, a guard. The negation reads its `¬` before its condition
      // fails.
      const end = isLetter(chars[i + 1]) ? runEnds[i + 1] : i + 1;
      if (end > i + 1 && chars[end] === "?") found.push([end + 1, "guard"]);
      if (!guardAt(i + 1)) found.push([i + 1, "¬"]);
      reach = Math.max(reach, end, i + 1);
    }
    if (c === "$") {
      prefixed(i + 1, (word) => (isCapital(word.slice(1)) ? "constant" : "capture"));
      found.push([i + 1, "capture"]);
    }
    if (c === "%") prefixed(i + 1, (word) => (KEYWORDS.has(word) ? word : "keyword"));
    if (c === "~") prefixed(i + 1, () => "tag");
    if (c === "%" || c === "~") reach = Math.max(reach, i + 1);
    if (c === "'" || c === '"') {
      const end = quotedEnd(i + 1, c);
      const kind = c === '"' ? "string" : chars[i + 1] === "\\" && chars[i + 2] === "p" ? "property" : "character";
      if (end <= n) found.push([end, kind]);
      reach = Math.max(reach, Math.min(end, n));
    }
    if (c === "/") {
      if (i + 2 < n && chars[i + 2] === "/") found.push([i + 3, "phoneme"]);
      reach = Math.max(reach, Math.min(i + 2, n));
    }
    if (c === ".") {
      if (chars[i + 1] === "." && chars[i + 2] === ".") found.push([i + 3, "..."]);
      if (chars[i + 1] === ".") found.push([i + 2, ".."]);
      reach = Math.max(reach, chars[i + 1] === "." ? Math.min(i + 3, n) : i + 1);
    }
    if (c === "+" && chars[i + 1] === "+") found.push([i + 2, "++"]);
    if (SYMBOLS.has(c)) found.push([i + 1, c]);
    for (const [end] of found) reach = Math.max(reach, end);
    found.sort((x, y) => y[0] - x[0]);
    return { found, reach };
  };
  // Whether the text from each place can be read to its end.
  const readable = new Array(n + 1).fill(false);
  readable[n] = true;
  const starting = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    starting[i] = pieces(i);
    readable[i] = starting[i].found.some(([end]) => readable[end]);
  }
  if (!readable[0]) {
    // The furthest character that a reading from a reachable place gets to.
    const reached = new Array(n + 1).fill(false);
    reached[0] = true;
    let furthest = 0;
    for (let i = 0; i < n; i++) {
      if (hooks.work) countWork(hooks.work, "walkSteps");
      if (!reached[i]) continue;
      furthest = Math.max(furthest, starting[i].reach);
      for (const [end] of starting[i].found) reached[end] = true;
    }
    syntaxError(furthest >= n ? "the text ends inside a token" : `the text cannot be read as tokens at ${chars[furthest]}`, at(furthest));
  }
  const tokens = [];
  let i = 0;
  while (i < n) {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    const [end, kind] = /** @type {[number, string | null]} */ (starting[i].found.find(([e]) => readable[e]));
    if (kind !== null) tokens.push({ kind, text: chars.slice(i, end).join(""), at: at(i), end: at(end) });
    i = end;
  }
  return tokens;
}

const DIRECTIVES = new Set(["%ambiguity-resolution", "%stage", "%include", "%features"]);
const RULE_KEYWORDS = new Set(["%rule", "%redefine-rule", "%extend-rule"]);
const CONSTANT_KEYWORDS = new Set(["%const", "%redefine-const"]);
const COMPARATORS = new Set(["=", "≠", "∈", "∉", "⊆", "⊈"]);
const TEST_COMPARATORS = new Set(["=", "≠", "⊇", "⊉"]);
// What may follow a term in parentheses that begins a comparison, and not
// conditions in parentheses: a comparator, or more of the term.
const AFTER_TERM = new Set([...COMPARATORS, "∪", "∩", "∖"]);
const PRIMARY_STARTS = new Set(["identifier", "tag", "character", "property", "phoneme", "capture", "constant", "(", "[", "{", "#", "ε"]);

// A recursive descent parser of the notation's syntax grammar
// (grammars/notation/syntax.md). It builds a node for each rule that the
// reader reads by name, with the rule's parts as its children, and leaves
// out a wrapper rule, whose parts the reader reads in its place. Where the
// grammar reads a token sequence in more than one way at first, the
// parser tries each way, and takes the one that goes on, as the syntax
// stage does; it remembers what each rule read at each token, so a way
// tried again costs nothing. It reports a syntax error at the furthest
// token that any way reached, where the syntax stage reports it.
class Parser {
  constructor(tokens, endAt) {
    this.tokens = tokens;
    this.endAt = endAt;
    this.index = 0;
    this.furthest = null;
    this.remembered = new Map();
  }

  peek(offset = 0) { return this.tokens[this.index + offset]; }
  is(kind, offset = 0) { const t = this.peek(offset); return t !== undefined && t.kind === kind; }
  kindAt(offset = 0) { const t = this.peek(offset); return t === undefined ? undefined : t.kind; }

  fail(message) {
    if (this.furthest === null || this.index > this.furthest.index) this.furthest = { index: this.index, message };
    const token = this.peek();
    throw new SyntaxFailure(message, token ? token.at : this.endAt);
  }

  // What `read` reads at the current token, remembered by `name` and the
  // token, failure too.
  *memo(name, read) {
    const key = `${name}:${this.index}`;
    const found = this.remembered.get(key);
    if (found) {
      if (found.failure) throw found.failure;
      this.index = found.end;
      return found.node;
    }
    try {
      const node = yield read.call(this);
      this.remembered.set(key, { node, end: this.index });
      return node;
    } catch (error) {
      if (error instanceof SyntaxFailure) this.remembered.set(key, { failure: error });
      throw error;
    }
  }

  // What `read` reads, or undefined, with nothing read, if it fails.
  *attempt(read) {
    const saved = this.index;
    try {
      return yield read.call(this);
    } catch (error) {
      if (!(error instanceof SyntaxFailure)) throw error;
      this.index = saved;
      return undefined;
    }
  }

  // The next token, as a token node of the tree.
  tok() {
    const index = this.index++;
    return { kind: "token", token: index, terminal: this.tokens[index].kind };
  }

  expect(kind) {
    if (!this.is(kind)) this.fail(`expected ${kind}`);
    return this.tok();
  }

  node(rule, start, children) {
    return { kind: "rule", rule, children, span: [start, this.index] };
  }

  // A node of one token.
  leaf(rule) {
    const start = this.index;
    return this.node(rule, start, [this.tok()]);
  }

  *document() {
    const children = [];
    while (this.peek()) {
      const kind = this.kindAt();
      if (DIRECTIVES.has(kind)) children.push((yield this.directive()));
      else if (RULE_KEYWORDS.has(kind)) children.push((yield this.rule()));
      else if (CONSTANT_KEYWORDS.has(kind)) children.push((yield this.constantDefinition()));
      else if (kind === "%classifier") children.push(this.classifier());
      else if (kind === "%implies") children.push((yield this.implicationDeclaration()));
      else this.fail("expected a rule or a directive");
    }
    return { kind: "rule", rule: "text", children, span: [0, this.index] };
  }

  *directive() {
    const start = this.index;
    const children = [this.tok()];
    for (;;) {
      const kind = this.kindAt();
      if (kind === "identifier") children.push(this.leaf("argument-word"));
      else if (kind === "string") children.push(this.leaf("argument-string"));
      else if (kind === "tag" || kind === "phoneme" || kind === "character" || kind === "property") {
        const at = this.index;
        children.push(this.node("argument-tag", at, [this.symbolOrRange(false)]));
      } else break;
    }
    return this.node("directive", start, children);
  }

  // A tag, phoneme or character token, a range, or a property: as a token
  // where the rule reads one (`asNode` false), or else as its own node.
  symbolOrRange(asNode) {
    const kind = this.kindAt();
    if (kind === "character" && this.is("..", 1)) return this.range();
    if (kind === "property") return this.leaf("property");
    if (!asNode) return this.tok();
    return this.leaf(kind);
  }

  range() {
    const start = this.index;
    return this.node("range", start, [this.leaf("character"), this.expect(".."), (this.is("character") ? this.leaf("character") : this.fail("expected a character"))]);
  }

  *constantDefinition() {
    const start = this.index;
    const definer = this.leaf("constant-definer");
    const name = this.is("constant") ? this.leaf("constant-reference") : this.fail("expected a constant");
    return this.node("constant-definition", start, [definer, name, (yield this.term())]);
  }

  classifier() {
    const start = this.index;
    const children = [this.tok()];
    children.push(this.is("identifier") ? this.leaf("classifier-name") : this.fail("expected a classifier's name"));
    while (this.is("guard") || this.is("string")) {
      const at = this.index;
      const entry = [];
      while (this.is("guard")) entry.push(this.leaf("guard"));
      do entry.push(this.is("string") ? this.leaf("classifier-key") : this.fail("expected a key"));
      while (this.is("string"));
      entry.push(this.is("∈") || this.is("∉") ? this.leaf("classifier-operator") : this.fail("expected ∈ or ∉"));
      entry.push(this.is("identifier") || this.is("tag") ? this.leaf("classifier-class") : this.fail("expected a class"));
      children.push(this.node("classifier-entry", at, entry));
    }
    return this.node("classifier", start, children);
  }

  *implicationDeclaration() {
    const start = this.index;
    return this.node("implication-declaration", start, [this.tok(), (yield this.union()), this.expect("⟹"), (yield this.union())]);
  }

  *rule() {
    const start = this.index;
    const children = [this.leaf("definer")];
    if (this.is("(")) {
      const at = this.index;
      const flags = [this.tok()];
      flags.push(this.is("identifier") ? this.leaf("rule-flag") : this.fail("expected a rule flag"));
      while (this.is(",")) {
        flags.push(this.tok());
        flags.push(this.is("identifier") ? this.leaf("rule-flag") : this.fail("expected a rule flag"));
      }
      flags.push(this.expect(")"));
      children.push(this.node("rule-flags", at, flags));
    }
    children.push(this.is("identifier") || this.is("#") ? this.leaf("rule-name") : this.fail("expected a rule's name"));
    children.push((yield this.body()));
    if (this.is("%tags")) {
      const at = this.index;
      children.push(this.node("tags-clause", at, [this.tok(), (yield this.term())]));
    }
    if (this.is("%conditions")) {
      const at = this.index;
      const clause = [this.tok()];
      if (this.is(",")) clause.push(this.tok());
      clause.push((yield this.implication()));
      while (this.is(",")) clause.push(this.tok(), (yield this.implication()));
      children.push(this.node("conditions-clause", at, clause));
    }
    if (this.is("%emits")) children.push((yield this.emitsClause()));
    if (this.is("%opaque")) children.push(this.leaf("opaque-clause"));
    return this.node("rule", start, children);
  }

  *body() {
    const start = this.index;
    const children = [];
    if (this.is("|")) children.push(this.tok());
    children.push((yield this.alternative()));
    while (this.is("|")) children.push(this.tok(), (yield this.alternative()));
    return this.node("body", start, children);
  }

  *alternative() {
    const start = this.index;
    const children = [];
    while (this.is("guard")) children.push(this.leaf("guard"));
    children.push((yield this.conjunction()));
    if (this.is("<")) {
      const at = this.index;
      children.push(this.node("alternative-tags", at, [this.tok(), (yield this.term()), this.expect(">")]));
    }
    return this.node("alternative", start, children);
  }

  // `|` and `&` join, each with a leading one allowed.
  *choice() {
    const start = this.index;
    const children = [];
    if (this.is("|")) children.push(this.tok());
    children.push((yield this.conjunction()));
    while (this.is("|")) children.push(this.tok(), (yield this.conjunction()));
    return this.node("choice", start, children);
  }

  *conjunction() {
    const start = this.index;
    const children = [];
    if (this.is("&")) children.push(this.tok());
    children.push((yield this.sequence()));
    while (this.is("&")) children.push(this.tok(), (yield this.sequence()));
    return this.node("conjunction", start, children);
  }

  *sequence() {
    const start = this.index;
    const children = [(yield this.primary())];
    while (PRIMARY_STARTS.has(this.kindAt())) children.push((yield this.primary()));
    return this.node("sequence", start, children);
  }

  // A primary, and a test after it makes it the primary of a tested one:
  // `A="a"="b"` is a test on a tested primary (syntax.md).
  *primary() {
    const start = this.index;
    let primary = this.node("primary", start, [(yield this.symbol())]);
    while (TEST_COMPARATORS.has(this.kindAt()) || this.is("∩")) {
      const tested = this.node("tested", start, [primary, (yield this.test())]);
      primary = this.node("primary", start, [tested]);
    }
    return primary;
  }

  *symbol() {
    const start = this.index;
    switch (this.kindAt()) {
      case "identifier": case "#": return this.leaf("reference");
      case "tag": case "character": case "phoneme": case "property": return this.symbolOrRange(true);
      case "constant": return this.leaf("constant-reference");
      case "capture": return this.node("capture", start, [this.tok(), this.expect("("), (yield this.primary()), this.expect(")")]);
      case "(": return this.node("group", start, [this.tok(), (yield this.choice()), this.expect(")")]);
      case "[": {
        const children = [this.tok()];
        if (this.is("+") || this.is("++")) children.push(this.tok());
        children.push((yield this.choice()), this.expect("]"));
        return this.node("optional", start, children);
      }
      case "{": {
        // `{... x \ s}` or `{x ... \ s}`: one marker at most (syntax.md).
        const children = [this.tok()];
        const leading = this.is("...");
        if (leading) children.push(this.tok());
        children.push((yield this.choice()));
        if (!leading && this.is("...")) children.push(this.tok());
        if (this.is("\\")) children.push(this.tok(), (yield this.choice()));
        children.push(this.expect("}"));
        return this.node("repetition", start, children);
      }
      case "ε": return this.leaf("empty");
      default: return this.fail("expected an expression");
    }
  }

  *test() {
    const start = this.index;
    if (this.is("∩")) {
      const children = [this.tok(), (yield this.testOperand())];
      children.push(this.is("=") || this.is("≠") ? this.tok() : this.fail("expected = or ≠"), this.expect("∅"));
      return this.node("test", start, children);
    }
    return this.node("test", start, [this.tok(), (yield this.testOperand())]);
  }

  // A test's operand: one atom, a bare name never a call (syntax.md).
  *testOperand() {
    const start = this.index;
    switch (this.kindAt()) {
      case "string": case "tag": case "character": case "phoneme": case "property": return this.node("test-operand", start, [this.atomSymbol()]);
      case "identifier": return this.node("test-operand", start, [this.leaf("name")]);
      case "∅": return this.node("test-operand", start, [this.leaf("empty-set")]);
      case "constant": return this.node("test-operand", start, [this.leaf("constant-reference")]);
      case "(": return this.node("test-operand", start, [this.tok(), (yield this.term()), this.expect(")")]);
      default: return this.fail("expected a test's operand");
    }
  }

  // A string, tag, character, phoneme, range or property, each its node.
  atomSymbol() {
    return this.kindAt() === "string" ? this.leaf("string") : this.symbolOrRange(true);
  }

  *emitsClause() {
    const start = this.index;
    const children = [this.tok()];
    if (this.is("ε")) {
      children.push(this.tok());
      return this.node("emits-clause", start, children);
    }
    if (this.is(",")) children.push(this.tok());
    children.push((yield this.emitItem()));
    while (this.is(",")) children.push(this.tok(), (yield this.emitItem()));
    return this.node("emits-clause", start, children);
  }

  *emitItem() {
    const start = this.index;
    const children = [];
    while (this.is("(")) children.push(this.attachment("emit-before"));
    const at = this.index;
    const kind = this.kindAt();
    if (kind === "capture" || kind === "identifier" || kind === "tag" || kind === "character" || kind === "phoneme" || kind === "property") {
      children.push(this.node("emit-target", at, [this.symbolOrRange(false)]));
    } else {
      this.fail("expected a capture or a tag after %emits");
    }
    if (this.is("<")) {
      const tagsAt = this.index;
      children.push(this.node("emit-tags", tagsAt, [this.tok(), (yield this.term()), this.expect(">")]));
    }
    while (this.is("(")) children.push(this.attachment("emit-after"));
    return this.node("emit-item", start, children);
  }

  attachment(rule) {
    const start = this.index;
    return this.node(rule, start, [this.tok(), this.expect("capture"), this.expect(")")]);
  }

  *implication() {
    const start = this.index;
    // `{any-of \ '⟹'}`: the reader groups the list to the right.
    const children = [(yield this.anyOf())];
    while (this.is("⟹")) children.push(this.tok(), (yield this.anyOf()));
    return this.node("implication", start, children);
  }

  *anyOf() {
    return (yield this.memo("any-of", function* () {
      const start = this.index;
      const children = [];
      if (this.is("∨")) children.push(this.tok());
      children.push((yield this.allOf()));
      while (this.is("∨")) children.push(this.tok(), (yield this.allOf()));
      return this.node("any-of", start, children);
    }));
  }

  *allOf() {
    const start = this.index;
    const children = [];
    if (this.is("∧")) children.push(this.tok());
    children.push((yield this.condition()));
    while (this.is("∧")) children.push(this.tok(), (yield this.condition()));
    return this.node("all-of", start, children);
  }

  // A condition. Conditions in parentheses and a comparison whose first
  // term is in parentheses begin alike, as do a call that is a condition
  // and one that begins a comparison, and a presence and a capture that
  // begins one: each that a comparator or more of a term follows is the
  // comparison.
  *condition() {
    return (yield this.memo("condition", function* () {
      const start = this.index;
      const kind = this.kindAt();
      if (kind === "¬") return this.node("condition", start, [this.node("negation", start, [this.tok(), (yield this.condition())])]);
      if (kind === "(") {
        const grouped = (yield this.attempt(function* () {
          const children = [this.tok(), (yield this.implication()), this.expect(")")];
          if (AFTER_TERM.has(this.kindAt())) throw new SyntaxFailure("a term, not conditions", null);
          return this.node("condition", start, children);
        }));
        if (grouped) return grouped;
      }
      if (kind === "capture" && !AFTER_TERM.has(this.kindAt(1))) return this.node("condition", start, [this.leaf("presence")]);
      if (kind === "identifier" && this.is("(", 1)) {
        const call = (yield this.attempt(function* () {
          const node = (yield this.call());
          if (AFTER_TERM.has(this.kindAt())) throw new SyntaxFailure("a term, not a condition", null);
          return node;
        }));
        if (call) return this.node("condition", start, [call]);
      }
      const left = (yield this.union());
      const comparator = COMPARATORS.has(this.kindAt()) ? this.leaf("comparator") : this.fail("expected a comparison");
      return this.node("condition", start, [this.node("comparison", start, [left, comparator, (yield this.union())])]);
    }));
  }

  // A whole term: a condition guarding a term, or else a union.
  *term() {
    return (yield this.memo("term", function* () {
      const start = this.index;
      // `{any-of '⟹'} union`: guards while an any-of and `⟹` follow, and
      // then the union.
      const guarded = (yield this.attempt(function* () {
        const children = [(yield this.anyOf()), this.expect("⟹")];
        for (;;) {
          const guard = (yield this.attempt(function* () { return [(yield this.anyOf()), this.expect("⟹")]; }));
          if (!guard) break;
          children.push(guard[0], guard[1]);
        }
        children.push((yield this.union()));
        return this.node("guarded-term", start, children);
      }));
      return this.node("term", start, [guarded || (yield this.union())]);
    }));
  }

  *union() {
    return (yield this.memo("union", function* () {
      const start = this.index;
      const children = [];
      if (this.is("∪")) children.push(this.tok());
      children.push((yield this.intersection()));
      while (this.is("∪") || this.is("∖")) children.push(this.tok(), (yield this.intersection()));
      return this.node("union", start, children);
    }));
  }

  *intersection() {
    const start = this.index;
    const children = [];
    if (this.is("∩")) children.push(this.tok());
    children.push((yield this.termAtom()));
    while (this.is("∩")) children.push(this.tok(), (yield this.termAtom()));
    return this.node("intersection", start, children);
  }

  *termAtom() {
    const start = this.index;
    switch (this.kindAt()) {
      case "string": case "tag": case "character": case "phoneme": case "property": return this.node("term-atom", start, [this.atomSymbol()]);
      case "identifier": return this.node("term-atom", start, [this.is("(", 1) ? (yield this.call()) : this.leaf("name")]);
      case "∅": return this.node("term-atom", start, [this.leaf("empty-set")]);
      case "(": return this.node("term-atom", start, [this.tok(), (yield this.term()), this.expect(")")]);
      case "capture": return this.node("term-atom", start, [this.leaf("capture-reference")]);
      case "constant": return this.node("term-atom", start, [this.leaf("constant-reference")]);
      default: return this.fail("expected a term");
    }
  }

  *call() {
    const start = this.index;
    const children = [this.tok(), this.expect("(")];
    children.push((yield this.argument()));
    while (this.is(",")) children.push(this.tok(), (yield this.argument()));
    children.push(this.expect(")"));
    return this.node("call", start, children);
  }

  *argument() {
    const start = this.index;
    return this.node("argument", start, [(yield this.union())]);
  }
}

/**
 * Reads a grammar document's Markdown into its DOM, or throws the grammar
 * error that the library's reader gives, at the same place (engine §9).
 * @param {string} markdown
 * @param {string} path
 */
export function readDocument(markdown, path) {
  const { text, positions } = extractGrammarText(markdown, path);
  let tokens;
  let tree;
  try {
    tokens = lex(text, positions);
    // An error at the end of the text stands where the last token ends, as
    // the syntax stage reports it.
    const endAt = tokens.length ? tokens[tokens.length - 1].end : positions[positions.length - 1] || [1, 1];
    const parser = new Parser(tokens, endAt);
    try {
      tree = run(parser.document());
    } catch (error) {
      if (!(error instanceof SyntaxFailure) || parser.furthest === null) throw error;
      // The furthest token that a reading reached.
      const token = tokens[parser.furthest.index];
      throw new SyntaxFailure(parser.furthest.message, token ? token.at : endAt);
    }
  } catch (error) {
    if (!(error instanceof SyntaxFailure)) throw error;
    const [line, column] = error.at;
    throw new GencmuError("grammar", `${path}:${line}:${column}: ${error.message}`, { document: path, line, column });
  }
  return domOfTree(tree, tokens, (token) => token.at, path, unicode);
}
