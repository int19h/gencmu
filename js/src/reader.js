// From the notation's syntax tree to a grammar DOM (engine §9).

import { GencmuError } from "./errors.js";

/**
 * @import { Argument, Comparator, Condition, DomAlternative, DomDirective, DomRule, EmitItem, Emission, Expr, GrammarDom, Position, ResultNode, RuleNode, Term } from "./types.js"
 * @import { Token } from "./tokens.js"
 */

/**
 * `tree` is the syntax stage's result tree; `tokens` the syntax stage's
 * input tokens, whose text is what the author wrote; `positionOf` maps a
 * token to its [line, column] in the document.
 * @param {ResultNode} tree
 * @param {Token[]} tokens
 * @param {(token: Token) => Position} positionOf
 * @param {string} path
 * @returns {GrammarDom}
 */
export function treeToDom(tree, tokens, positionOf, path) {
  /** @type {(node: ResultNode) => string} */
  const text = (node) => tokens[/** @type {import("./types.js").TokenNode} */ (node).token].text;
  /** @type {(node: ResultNode) => Position} */
  const at = (node) => positionOf(tokens[firstToken(node)]);
  /** @type {(message: string, node: ResultNode) => never} */
  const fail = (message, node) => {
    const [line, column] = at(node);
    throw new GencmuError("grammar", `${path}:${line}:${column}: ${message}`, { document: path, line, column });
  };

  // A rule node's children, with transparent rules read in their place.
  /** @type {(node: ResultNode) => ResultNode[]} */
  const parts = (node) => {
    /** @type {ResultNode[]} */
    const result = [];
    if (node.kind !== "rule") return result;
    for (const child of node.children) {
      if (child.kind === "rule" && !NAMED.has(child.rule)) result.push(...parts(child));
      else result.push(child);
    }
    return result;
  };
  /** @type {(node: ResultNode) => string | null} */
  const tokenText = (node) => (node.kind === "token" ? text(node) : null);
  /** @type {(node: ResultNode, name: string) => RuleNode[]} */
  const ofRule = (node, name) => parts(node).flatMap((child) => (child.kind === "rule" && child.rule === name ? [child] : []));
  /** @type {(node: ResultNode, name: string) => RuleNode | undefined} */
  const one = (node, name) => ofRule(node, name)[0];
  /** @type {(node: ResultNode, name: string) => RuleNode} */
  const only = (node, name) => {
    const found = one(node, name);
    return found || fail(`expected ${name}`, node);
  };
  /** @type {(node: ResultNode) => string | undefined} */
  const ruleOf = (node) => (node.kind === "rule" ? node.rule : undefined);

  /** @type {DomRule[]} */
  const rules = [];
  /** @type {DomDirective[]} */
  const directives = [];
  for (const item of parts(tree)) {
    if (ruleOf(item) === "directive-statement") {
      const [directiveToken, ...rest] = parts(item);
      directives.push({
        name: text(directiveToken).slice(1),
        args: rest.filter((child) => ruleOf(child) === "argument-word").map((child) => text(parts(child)[0])),
        at: at(item),
      });
    } else if (ruleOf(item) === "rule") {
      rules.push(readRule(item));
    }
  }
  return { format: 1, rules, directives };

  /**
   * @param {ResultNode} node
   * @returns {DomRule}
   */
  function readRule(node) {
    const children = parts(node);
    const name = text(children[0]);
    const definer = only(node, "definer");
    /** @type {Partial<DomRule>} */
    const rule = { name, op: tokenText(parts(definer)[0]) === "|≔" ? "extend" : "define" };
    const tags = one(node, "rule-tags");
    if (tags) rule.tags = readTerm(only(tags, "term"));
    rule.alternatives = ofRule(only(node, "body"), "alternative").map(readAlternative);
    /** @type {Condition[]} */
    const conditions = [];
    /** @type {Emission | undefined} */
    let emit;
    for (const clause of ofRule(node, "clause")) {
      const inner = parts(clause)[0];
      if (ruleOf(inner) === "emission") {
        if (emit) fail("a rule may have one ⇒ clause", inner);
        emit = readEmission(inner);
      } else {
        for (const itemNode of ofRule(inner, "condition-item")) conditions.push(readConditionItem(itemNode));
      }
    }
    if (emit) rule.emit = emit;
    rule.conditions = conditions;
    rule.at = at(node);
    return /** @type {DomRule} */ (rule);
  }

  /**
   * @param {ResultNode} node
   * @returns {DomAlternative}
   */
  function readAlternative(node) {
    const guards = ofRule(node, "guard").map((guard) => {
      const spelled = text(parts(guard)[0]);
      return { feature: spelled.replace(/^@!?/, ""), negated: spelled.startsWith("@!") };
    });
    /** @type {DomAlternative} */
    const alternative = { guards, expr: readExpression(only(node, "conjunction")) };
    const tags = one(node, "alternative-tags");
    if (tags) alternative.tags = readTerm(only(tags, "term"));
    return alternative;
  }

  /**
   * @param {ResultNode} node
   * @returns {Expr}
   */
  function readExpression(node) {
    switch (ruleOf(node)) {
      case "choice": {
        const items = ofRule(node, "conjunction").map(readExpression);
        return items.length === 1 ? items[0] : { choice: items };
      }
      case "conjunction": {
        const items = ofRule(node, "sequence").map(readExpression);
        // A & of n items expands to 2ⁿ−1 sequences (engine §3.2).
        if (items.length > 16) fail("an & joins at most 16 items", node);
        return items.length === 1 ? items[0] : { and: items };
      }
      case "sequence": {
        const items = ofRule(node, "element").map(readExpression);
        return items.length === 1 ? items[0] : { seq: items };
      }
      case "element": {
        const primary = readPrimary(parts(one(node, "primary") || node)[0]);
        const repeated = parts(node).some((child) => tokenText(child) === "...");
        if (!repeated) return primary;
        if ("optional" in primary) return { repeat: primary.optional, min: 0 };
        return { repeat: primary, min: 1 };
      }
      default:
        return fail(`unexpected ${ruleOf(node)}`, node);
    }
  }

  /**
   * @param {ResultNode} node
   * @returns {Expr}
   */
  function readPrimary(node) {
    switch (ruleOf(node)) {
      case "reference": return { ref: text(parts(node)[0]) };
      case "string": return { terminal: decode(parts(node)[0]) };
      case "phoneme": return { terminal: text(parts(node)[0]) };
      case "capture": {
        const [captureToken, , inner] = parts(node);
        const wrapped = parts(inner)[0];
        const kind = ruleOf(wrapped);
        if (kind !== "reference" && kind !== "string" && kind !== "phoneme") fail("a capture wraps one symbol", node);
        const expr = readPrimary(wrapped);
        return { capture: text(captureToken).slice(1), expr };
      }
      case "group": return readExpression(only(node, "choice"));
      case "optional": return { optional: readExpression(only(node, "choice")) };
      case "hash": return { hash: true };
      case "empty": return { empty: true };
      default: return fail(`unexpected ${ruleOf(node)}`, node);
    }
  }

  /**
   * @param {ResultNode} node
   * @returns {Emission}
   */
  function readEmission(node) {
    const items = ofRule(node, "emit-item").map((itemNode) => {
      const target = parts(only(itemNode, "emit-target"))[0];
      const kind = target.kind === "rule" ? undefined : target.terminal;
      /** @type {EmitItem} */
      let item = {};
      if (kind === "identifier" && text(target) === "this") item = { this: true };
      else if (kind === "identifier" && text(target) === "nothing") item = { nothing: true };
      else if (kind === "capture") item = { capture: text(target).slice(1) };
      else if (kind === "string") item = { insert: decode(target) };
      else if (kind === "phoneme") item = { insert: text(target) };
      else fail("expected this, nothing, a capture or a tag after ⇒", itemNode);
      const tags = one(itemNode, "emit-tags");
      if (tags && item.insert !== undefined) fail("an inserted tag takes no tags of its own", itemNode);
      if (tags) item.tags = readTerm(only(tags, "term"));
      return item;
    });
    if (items.some((item) => item.nothing)) {
      if (items.length !== 1 || items[0].tags) fail("⇒ nothing stands alone", node);
      return { nothing: true };
    }
    if (items.some((item) => item.this) && !items.every((item) => item.this)) fail("⇒ this goes with no item but another this", node);
    const named = items.flatMap((item) => (item.capture !== undefined ? [item.capture] : []));
    if (named.some((name, index) => named.indexOf(name) !== index)) fail("⇒ lists a capture twice", node);
    return { items };
  }

  /**
   * @param {ResultNode} node
   * @returns {Condition}
   */
  function readConditionItem(node) {
    const items = ofRule(node, "condition").map(readCondition);
    return items.length === 1 ? items[0] : { any: items };
  }

  /**
   * @param {ResultNode} node
   * @returns {Condition}
   */
  function readCondition(node) {
    const inner = parts(node)[0];
    switch (ruleOf(inner)) {
      case "comparison": {
        const [left, comparator, right] = parts(inner);
        return { op: /** @type {Comparator} */ (text(parts(comparator)[0])), left: readTerm(left), right: readTerm(right) };
      }
      case "negation":
        return { not: readCondition(only(inner, "condition")) };
      case "call": {
        const call = readCall(inner);
        const [span, rule] = call.args;
        if (call.call !== "matches" || call.args.length !== 2 || !("rule" in rule) || "rule" in span) {
          return fail("a condition calls only matches(span, rule)", inner);
        }
        return { matches: span, rule: rule.rule };
      }
      default:
        return fail(`unexpected ${ruleOf(inner)}`, inner);
    }
  }

  /**
   * @param {ResultNode} node
   * @param {boolean} [argument] whether the term is a function's argument,
   *   where a span may stand
   * @returns {Term}
   */
  function readTerm(node, argument = false) {
    if (ruleOf(node) === "term") {
      const found = ofRule(node, "intersection");
      const items = found.map((item) => readTerm(item, argument && found.length === 1));
      return items.length === 1 ? items[0] : { union: items };
    }
    if (ruleOf(node) === "intersection") {
      const found = ofRule(node, "term-atom");
      const items = found.map((item) => readTerm(item, argument && found.length === 1));
      return items.length === 1 ? items[0] : { intersection: items };
    }
    if (ruleOf(node) === "term-atom") {
      const inner = parts(node).find((child) => child.kind === "rule");
      if (!inner) return fail("expected a term", node);
      if (ruleOf(inner) === "call") {
        const call = readCall(inner);
        if (!argument && SPANS.has(call.call)) fail(`${call.call} gives a span, which is not a value`, inner);
        if (call.call === "matches") fail("matches is a condition, not a term", inner);
        return call;
      }
      return readTerm(inner);
    }
    switch (ruleOf(node)) {
      case "string": return { literal: decode(parts(node)[0]) };
      case "phoneme": return { literal: text(parts(node)[0]) };
      case "weak": return { weak: decode(parts(node)[1]) };
      case "empty-set": return { emptySet: true };
      case "set": return { set: ofRule(node, "term").map((item) => readTerm(item)) };
      case "call": return readCall(node);
      case "capture-reference": return { capture: text(parts(node)[0]).slice(1) };
      default: return fail(`unexpected ${ruleOf(node)}`, node);
    }
  }

  /**
   * @param {ResultNode} node
   * @returns {{call: string, args: Argument[]}}
   */
  function readCall(node) {
    const name = text(parts(node)[0]);
    if (!FUNCTIONS.has(name)) fail(`unknown function ${name}`, node);
    /** @type {Argument[]} */
    const args = ofRule(node, "argument").map((argument) => {
      const inner = parts(argument)[0];
      if (inner.kind === "token") return { rule: text(inner) };
      return readTerm(inner, true);
    });
    /** @type {(argument: Argument | undefined) => boolean} */
    const isSpan = (argument) => argument !== undefined && ("capture" in argument || ("call" in argument && SPANS.has(argument.call)));
    /** @type {(argument: Argument | undefined) => boolean} */
    const isRule = (argument) => argument !== undefined && "rule" in argument;
    /** @type {(argument: Argument | undefined) => boolean} */
    const isString = (argument) => argument !== undefined && ("literal" in argument || ("call" in argument && STRINGS.has(argument.call)));
    let ok;
    if (name === "tags") ok = (args.length === 1 && isSpan(args[0])) || (args.length === 2 && isSpan(args[0]) && isRule(args[1]));
    else if (name === "matches") ok = args.length === 2 && isSpan(args[0]) && isRule(args[1]);
    else if (name === "lowercase") ok = args.length === 1 && isString(args[0]);
    else ok = args.length === 1 && isSpan(args[0]);
    if (!ok) fail(`${name} takes ${SIGNATURES[name]}`, node);
    return { call: name, args };
  }

  /**
   * @param {ResultNode} tokenNode
   * @returns {string}
   */
  function decode(tokenNode) {
    const spelled = [...text(tokenNode)].slice(1, -1);
    let result = "";
    for (let index = 0; index < spelled.length; index++) {
      if (spelled[index] !== "\\") {
        result += spelled[index];
        continue;
      }
      const next = spelled[++index];
      if (next === "\\" || next === '"') result += next;
      else if (next === "u" && spelled[index + 1] === "{") {
        let end = index + 2;
        let hex = "";
        while (end < spelled.length && spelled[end] !== "}") hex += spelled[end++];
        if (end >= spelled.length || !/^[0-9A-Fa-f]{1,6}$/.test(hex)) fail("a bad \\u{...} escape", tokenNode);
        result += String.fromCodePoint(parseInt(hex, 16));
        index = end;
      } else {
        fail(`an unknown escape \\${next || ""}`, tokenNode);
      }
    }
    return result;
  }
}

const FUNCTIONS = new Set(["phonemes", "text", "lowercase", "tags", "classes", "words", "head", "tail", "last", "matches"]);

// The functions whose value is a span, and those whose value is a string.
const SPANS = new Set(["head", "tail", "last"]);
const STRINGS = new Set(["phonemes", "text", "lowercase"]);

/** @type {Record<string, string>} */
const SIGNATURES = {
  phonemes: "one span", text: "one span", words: "one span", classes: "one span",
  head: "one span", tail: "one span", last: "one span",
  lowercase: "one string", tags: "a span, and optionally a rule", matches: "a span and a rule",
};

// The rules of the notation's syntax grammar that the reader reads; every
// other rule is transparent.
const NAMED = new Set([
  "directive-statement", "argument-word", "rule", "rule-tags", "definer", "body", "alternative", "guard",
  "alternative-tags", "conjunction", "sequence", "element", "primary", "reference", "string", "phoneme",
  "capture", "group", "optional", "choice", "hash", "empty", "clause", "emission", "emit-item", "emit-target",
  "emit-tags", "conditions", "condition-item", "condition", "comparison", "comparator", "negation", "term",
  "intersection", "term-atom", "weak", "empty-set", "set", "call", "argument", "capture-reference",
]);

/**
 * @param {ResultNode} node
 * @returns {number}
 */
function firstToken(node) {
  if (node.kind === "token") return node.token;
  if (node.kind === "elided") return node.span[0];
  for (const child of node.children) {
    if (child.kind === "token") return child.token;
    if (child.kind === "rule") {
      const found = firstToken(child);
      if (found !== undefined) return found;
    }
  }
  return node.span[0];
}
