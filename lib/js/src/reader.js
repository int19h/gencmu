// From the notation's syntax tree to a grammar DOM (engine §9).

import { GencmuError } from "./errors.js";
import { DOM_FORMAT, definitionProblem, readsOwnTags } from "./dom.js";

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
    if (ruleOf(item) === "directive") {
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
  return { format: DOM_FORMAT, rules, directives };

  /**
   * @param {ResultNode} node
   * @returns {DomRule}
   */
  function readRule(node) {
    const children = parts(node);
    const keyword = tokenText(parts(only(node, "definer"))[0]);
    /** @type {Partial<DomRule>} */
    const rule = { name: text(children[1]), op: keyword === "%extend-rule" ? "extend" : keyword === "%redefine-rule" ? "redefine" : "define" };
    const tags = one(node, "tags-clause");
    if (tags) rule.tags = readConstituentTags(tags);
    rule.alternatives = ofRule(only(node, "body"), "alternative").map(readAlternative);
    const emits = one(node, "emits-clause");
    if (emits) rule.emit = readEmission(emits);
    // Each condition of the list is one condition, applying where its
    // captures are (engine §3.6).
    const conditions = one(node, "conditions-clause");
    rule.conditions = conditions ? ofRule(conditions, "implication").map(readImplication) : [];
    rule.at = at(node);
    const problem = definitionProblem(rule);
    if (problem) fail(problem, node);
    return /** @type {DomRule} */ (rule);
  }

  /**
   * @param {ResultNode} node
   * @returns {DomAlternative}
   */
  function readAlternative(node) {
    // A guard's token is its spelling: `@f?` or `@¬f?` for a gate, `@f!`
    // for a warning (engine §9).
    const guards = ofRule(node, "guard").map((guard) => {
      const spelled = text(parts(guard)[0]);
      /** @type {import("./types.js").Guard} */
      const read = { feature: spelled.slice(spelled.startsWith("@¬") ? 2 : 1, -1), kind: spelled.endsWith("!") ? "warning" : "gate", negated: spelled.startsWith("@¬") };
      return read;
    });
    /** @type {DomAlternative} */
    const alternative = { guards, expr: readExpression(only(node, "conjunction"), true) };
    const tags = one(node, "alternative-tags");
    if (tags) alternative.tags = readConstituentTags(tags);
    return alternative;
  }

  /**
   * @param {ResultNode} node
   * @param {boolean} [top] whether the expression is an alternative's top
   *   level, where a capture may stand (engine §3.5)
   * @returns {Expr}
   */
  function readExpression(node, top = false) {
    switch (ruleOf(node)) {
      case "choice": {
        const found = ofRule(node, "conjunction");
        const items = found.map((item) => readExpression(item, top && found.length === 1));
        return items.length === 1 ? items[0] : { choice: items };
      }
      case "conjunction": {
        const found = ofRule(node, "sequence");
        const items = found.map((item) => readExpression(item, top && found.length === 1));
        // A & of n items expands to 2ⁿ−1 sequences (engine §3.2).
        if (items.length > 16) fail("an & joins at most 16 items", node);
        return items.length === 1 ? items[0] : { and: items };
      }
      case "sequence": {
        const items = ofRule(node, "element").map((item) => readExpression(item, top));
        return items.length === 1 ? items[0] : { seq: items };
      }
      case "element": {
        const repeated = parts(node).some((child) => tokenText(child) === "...");
        const primary = readPrimary(parts(one(node, "primary") || node)[0], top && !repeated);
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
   * @param {boolean} [top] whether a capture may stand here
   * @returns {Expr}
   */
  function readPrimary(node, top = false) {
    switch (ruleOf(node)) {
      case "reference": return { ref: text(parts(node)[0]) };
      case "string": return { terminal: decode(parts(node)[0]) };
      case "phoneme": return { terminal: text(parts(node)[0]) };
      case "capture": {
        if (!top) fail("a capture stands at the top level of an alternative, not inside [ ], ( ), ..., & or a choice", node);
        const [captureToken, , inner] = parts(node);
        if (text(captureToken) === "$") fail("$ is the whole constituent and wraps nothing", node);
        const wrapped = parts(inner)[0];
        const kind = ruleOf(wrapped);
        if (kind !== "reference" && kind !== "string" && kind !== "phoneme") fail("a capture wraps one symbol", node);
        const expr = readPrimary(wrapped);
        return { capture: text(captureToken).slice(1), expr };
      }
      case "group": return readExpression(only(node, "choice"));
      case "optional": return { optional: readExpression(only(node, "choice")) };
      case "empty": return { empty: true };
      default: return fail(`unexpected ${ruleOf(node)}`, node);
    }
  }

  /**
   * @param {ResultNode} node
   * @returns {Emission}
   */
  function readEmission(node) {
    // `%emits ε` emits nothing, and the constituent does not count.
    if (parts(node).some((child) => tokenText(child) === "ε")) return { items: [] };
    const items = ofRule(node, "emit-item").map((itemNode) => {
      const target = parts(only(itemNode, "emit-target"))[0];
      const kind = target.kind === "rule" ? undefined : target.terminal;
      /** @type {EmitItem} */
      let item = {};
      if (kind === "capture") item = { capture: text(target).slice(1) };
      else if (kind === "string") item = { insert: decode(target) };
      else if (kind === "phoneme") item = { insert: text(target) };
      else fail("expected a capture or a tag after %emits", itemNode);
      const tags = one(itemNode, "emit-tags");
      if (tags && item.insert !== undefined) fail("an inserted tag takes no tags of its own", itemNode);
      if (tags) {
        item.tags = readTerm(only(tags, "term"));
        if ("emptySet" in item.tags) fail("<∅> emits a token no terminal can read; %emits ε emits nothing", itemNode);
      }
      return item;
    });
    if (items.some((item) => item.capture === "") && !items.every((item) => item.capture === "")) {
      fail("$ goes with no item but another $", node);
    }
    const named = items.flatMap((item) => (item.capture !== undefined && item.capture !== "" ? [item.capture] : []));
    if (named.some((name, index) => named.indexOf(name) !== index)) fail("%emits lists a capture twice", node);
    return { items };
  }

  /**
   * A constituent's tag term, which cannot read the tags it defines: `$`,
   * `tags($)` or `classes($)` (engine §9).
   * @param {ResultNode} node
   * @returns {Term}
   */
  function readConstituentTags(node) {
    const term = readTerm(only(node, "term"));
    if (readsOwnTags(term)) fail("a constituent's tags cannot be made of its own tags, $, tags($) or classes($)", node);
    return term;
  }

  /**
   * A condition, or conditions joined by ⟹, grouping to the right.
   * @param {ResultNode} node
   * @returns {Condition}
   */
  function readImplication(node) {
    const antecedent = readAnyOf(only(node, "any-of"));
    const consequent = one(node, "implication");
    return consequent ? { if: antecedent, then: readImplication(consequent) } : antecedent;
  }

  /**
   * Conditions joined by ∨, each several joined by ∧; a parenthesized group
   * of the same connective is part of the one around it (engine §9).
   * @param {ResultNode} node
   * @returns {Condition}
   */
  function readAnyOf(node) {
    // Parentheses make no node, so a group of the same connective as the
    // one around it is part of it: (a ∧ b) ∧ c is a ∧ b ∧ c (engine §9).
    const items = ofRule(node, "all-of").flatMap((allNode) => {
      const all = ofRule(allNode, "condition").map(readCondition).flatMap((item) => ("all" in item ? item.all : [item]));
      const one = all.length === 1 ? all[0] : { all };
      return "any" in one ? one.any : [one];
    });
    return items.length === 1 ? items[0] : { any: items };
  }

  /**
   * @param {ResultNode} node
   * @returns {Condition}
   */
  function readCondition(node) {
    const inner = /** @type {ResultNode} */ (parts(node).find((child) => child.kind === "rule"));
    switch (ruleOf(inner)) {
      case "implication":
        return readImplication(inner);
      case "presence":
        return { captured: text(parts(inner)[0]).slice(1) };
      case "comparison": {
        const [left, comparator, right] = parts(inner);
        return { op: /** @type {Comparator} */ (text(parts(comparator)[0])), left: readTerm(left), right: readTerm(right) };
      }
      case "negation":
        return { not: readCondition(only(inner, "condition")) };
      case "call": {
        const call = readCall(inner);
        const [span, rule] = call.args;
        if (call.call === "initial" && call.args.length === 1 && !("rule" in span)) return { initial: span };
        if (call.call !== "matches" || call.args.length !== 2 || !("rule" in rule) || "rule" in span) {
          return fail("a condition calls only matches(span, rule) or initial(span)", inner);
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
      const inner = /** @type {ResultNode} */ (parts(node).find((child) => child.kind === "rule"));
      return readTerm(inner, argument);
    }
    if (ruleOf(node) === "guarded-term") {
      return { if: readAnyOf(only(node, "any-of")), then: readTerm(only(node, "term")) };
    }
    if (ruleOf(node) === "union") {
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
        if (call.call === "matches" || call.call === "initial") fail(`${call.call} is a condition, not a term`, inner);
        return call;
      }
      return readTerm(inner);
    }
    switch (ruleOf(node)) {
      case "string": return { literal: decode(parts(node)[0]) };
      case "phoneme": return { literal: text(parts(node)[0]) };
      case "weak": return { weak: decode(parts(node)[1]) };
      case "empty-set": return { emptySet: true };
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

const FUNCTIONS = new Set(["phonemes", "text", "lowercase", "tags", "classes", "words", "head", "tail", "last", "matches", "initial"]);

// The functions whose value is a span, and those whose value is a string.
const SPANS = new Set(["head", "tail", "last"]);
const STRINGS = new Set(["phonemes", "text", "lowercase"]);

/** @type {Record<string, string>} */
const SIGNATURES = {
  phonemes: "one span", text: "one span", words: "one span", classes: "one span",
  head: "one span", tail: "one span", last: "one span", initial: "one span",
  lowercase: "one string", tags: "a span, and optionally a rule", matches: "a span and a rule",
};

// The rules of the notation's syntax grammar that the reader reads; every
// other rule is transparent.
const NAMED = new Set([
  "directive", "argument-word", "rule", "definer", "body", "alternative", "guard", "alternative-tags",
  "conjunction", "sequence", "element", "primary", "reference", "string", "phoneme", "capture", "group", "optional",
  "choice", "empty", "tags-clause", "conditions-clause", "emits-clause", "emit-item", "emit-target", "emit-tags",
  "implication", "any-of", "all-of", "condition", "comparison", "comparator", "negation", "presence",
  "term", "guarded-term", "union", "intersection", "term-atom", "weak", "empty-set", "call", "argument",
  "capture-reference",
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

