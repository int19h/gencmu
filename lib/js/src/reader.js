// From the notation's syntax tree to a grammar DOM (engine §9).

import { GencmuError } from "./errors.js";
import { CAPTURE_NAME, DOM_FORMAT, comparisonProblem, conditionTypeProblem, constantValueType, definitionProblem, expectedProblem, joinedType, literalCallProblem, propertyProblem, rangeProblem, readsOwnTags, spellingProblem, termType } from "./dom.js";
import { characterTag } from "./tags.js";

/**
 * @import { Argument, Comparator, Condition, DomAlternative, DomConstant, DomDirective, DomRule, EmitItem, Emission, Expr, GrammarDom, Position, ResultNode, RuleNode, Term } from "./types.js"
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
 * @param {{lowercase(text: string): string, isMark(code: number): boolean}} unicode
 *   the lowercase mapping that spellings are checked against (engine §9,
 *   §10), and the marks that a character tag escapes (engine §1)
 * @returns {GrammarDom}
 */
export function treeToDom(tree, tokens, positionOf, path, unicode) {
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
  /** @type {DomConstant[]} */
  const constants = [];
  // Whether the reader is reading a constant's value, a closed term (engine
  // §9, §10).
  let inConstant = false;
  for (const item of parts(tree)) {
    if (ruleOf(item) === "directive") {
      const [directiveToken, ...rest] = parts(item);
      const name = text(directiveToken).slice(1);
      const operands = rest.filter((child) => ruleOf(child) === "argument-word" || ruleOf(child) === "argument-string" || ruleOf(child) === "argument-tag");
      const problem = operandProblem(name, operands.map((child) => operandKind(child)));
      if (problem) fail(problem, item);
      directives.push({
        name,
        // A string operand is decoded, as a string of a rule is, and a tag
        // literal is its name.
        args: operands.map((child) => {
          const token = parts(child)[0];
          if (ruleOf(child) === "argument-word") return text(token);
          if (ruleOf(child) === "argument-string") return decode(token);
          // A range or a property has no tag; operandProblem has refused it.
          return tagOf(token);
        }),
        at: at(item),
      });
    } else if (ruleOf(item) === "rule") {
      rules.push(readRule(item));
    } else if (ruleOf(item) === "constant-definition") {
      constants.push(readConstant(item));
    }
  }
  return { format: DOM_FORMAT, rules, directives, constants };

  /**
   * A constant's definition: its name without `$`, and its value, a closed
   * term of a type that a constant can have (engine §2, §9, §10).
   * @param {ResultNode} node
   * @returns {DomConstant}
   */
  function readConstant(node) {
    const keyword = tokenText(parts(only(node, "constant-definer"))[0]);
    const name = text(parts(only(node, "constant-reference"))[0]).slice(1);
    const valueNode = only(node, "term");
    inConstant = true;
    const value = readTerm(valueNode);
    inConstant = false;
    const op = keyword === "%redefine-const" ? "redefine" : "define";
    const found = constantValueType(value, op === "redefine");
    if ("problem" in found) fail(found.problem, valueNode);
    return { name, op, value, at: at(node) };
  }

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
    if (one(node, "verbatim-clause")) rule.verbatim = true;
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
    // A guard's token is its spelling: `f?` or `¬f?` for a gate, `f!` for
    // a warning (engine §9).
    const guards = ofRule(node, "guard").map((guard) => {
      const spelled = text(parts(guard)[0]);
      const negated = spelled.startsWith("¬");
      /** @type {import("./types.js").Guard} */
      const read = { feature: spelled.slice(negated ? 1 : 0, -1), kind: spelled.endsWith("!") ? "warning" : "gate", negated };
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
      case "tag": case "character": case "phoneme": return { terminal: tagOf(parts(node)[0]) };
      case "range": return { range: readRange(node) };
      case "property": return { property: readProperty(parts(node)[0]) };
      case "spelled": {
        // A reference or a terminal and its spelling, which the syntax
        // grammar gives nothing else (engine §9).
        const [symbol, spellingToken] = parts(node);
        const expr = readPrimary(symbol);
        if ("range" in expr || "property" in expr) fail("a range or a property takes no spelling", spellingToken);
        const spelling = [...text(spellingToken)].slice(1, -1).join("");
        const problem = spellingProblem(spelling, expr, unicode);
        if (problem) fail(problem, spellingToken);
        return { spelling, expr: /** @type {import("./types.js").SpelledSymbol} */ (expr) };
      }
      case "capture": {
        if (!top) fail("a capture stands at the top level of an alternative, not inside [ ], ( ), ..., & or a choice", node);
        const [captureToken, , inner] = parts(node);
        if (text(captureToken) === "$") fail("$ is the whole constituent and wraps nothing", node);
        if (!CAPTURE_NAME.test(text(captureToken).slice(1))) fail("a capture's name is all lower case", node);
        const wrapped = parts(inner)[0];
        const kind = ruleOf(wrapped);
        if (kind === "constant-reference") fail(CONSTANT_IN_BODY, wrapped);
        if (!["reference", "tag", "character", "phoneme", "range", "property", "spelled"].includes(/** @type {string} */ (kind))) fail("a capture wraps one symbol", node);
        const expr = readPrimary(wrapped);
        return { capture: text(captureToken).slice(1), expr };
      }
      case "constant-reference": return fail(CONSTANT_IN_BODY, node);
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
      const kind = target.kind === "rule" ? target.rule : target.terminal;
      /** @type {EmitItem} */
      let item = {};
      if (kind === "capture") item = { capture: text(target).slice(1) };
      else if (kind === "tag" || kind === "character" || kind === "phoneme") item = { insert: tagOf(target) };
      else if (kind === "identifier" && isCapital(text(target))) item = { insert: text(target) };
      else if (kind === "identifier") fail(`${text(target)} names a rule; an inserted tag is a tag literal, such as ~${text(target)}`, itemNode);
      else if (kind === "range" || kind === "property") fail("an inserted item is one tag, not a range or a property", itemNode);
      else fail("expected a capture or a tag after %emits", itemNode);
      const tags = one(itemNode, "emit-tags");
      if (tags && item.insert !== undefined) fail("an inserted tag takes no tags of its own", itemNode);
      if (tags) {
        item.tags = readTagTerm(only(tags, "term"));
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
    const term = readTagTerm(only(node, "term"));
    if (readsOwnTags(term)) fail("a constituent's tags cannot be made of its own tags, tags($) or classes($)", node);
    return term;
  }

  /**
   * A whole term that must be a tag set: a constituent's or an item's tags
   * (engine §10). The error stands at the term.
   * @param {ResultNode} node
   * @returns {Term}
   */
  function readTagTerm(node) {
    const term = readTerm(node);
    const found = termType(term);
    const problem = "problem" in found ? found.problem : expectedProblem(found.type, "tags");
    if (problem) fail(problem, node);
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
        const op = /** @type {Comparator} */ (text(parts(comparator)[0]));
        const condition = { op, left: readTerm(left), right: readTerm(right) };
        // The two sides fit the comparator (engine §10).
        const leftType = termType(condition.left);
        const rightType = termType(condition.right);
        const problem = "problem" in leftType ? leftType.problem : "problem" in rightType ? rightType.problem
          : comparisonProblem(op, leftType.type, rightType.type);
        if (problem) fail(problem, inner);
        return condition;
      }
      case "negation":
        return { not: readCondition(only(inner, "condition")) };
      case "call": {
        const call = readCall(inner);
        const [span, rule] = call.args;
        if (call.call === "initial" && call.args.length === 1 && !("rule" in span)) return { initial: span };
        if ((call.call !== "matches" && call.call !== "begins") || call.args.length !== 2 || !("rule" in rule) || "rule" in span) {
          return fail("a condition calls only matches(span, rule), begins(span, rule) or initial(span)", inner);
        }
        if (call.call === "begins") return { begins: span, rule: rule.rule };
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
      if (inConstant) fail("a constant's value is a closed term, and holds no guarded term", node);
      const condition = readAnyOf(only(node, "any-of"));
      const conditionProblem = conditionTypeProblem(condition);
      if (conditionProblem) fail(conditionProblem, node);
      /** @type {Term} */
      const guarded = { if: condition, then: readTerm(only(node, "term")) };
      const found = termType(guarded);
      if ("problem" in found) fail(found.problem, node);
      return guarded;
    }
    if (ruleOf(node) === "union") {
      // Parts joined by ∪ and ∖ group from the left: a run joined by ∪ is
      // one union, and each ∖ takes what stands before it (engine §9).
      const found = ofRule(node, "intersection");
      if (found.length === 1) return readTerm(found[0], argument);
      /** @type {string[]} */
      const operators = parts(node).flatMap((child) => {
        const written = tokenText(child);
        return written === "∪" || written === "∖" ? [written] : [];
      });
      // A leading ∪ is a separator, not an operator.
      while (operators.length >= found.length) operators.shift();
      const items = found.map((item) => readTerm(item));
      const joined = joinedType(items.map((item) => {
        const type = termType(item);
        return "problem" in type ? fail(type.problem, node) : type.type;
      }), operators.includes("∖") ? "∖" : "∪");
      if ("problem" in joined) fail(joined.problem, node);
      /** @type {Term} */
      let result = items[0];
      let open = false;
      operators.forEach((operator, index) => {
        const next = items[index + 1];
        if (operator === "∖") {
          result = { difference: [result, next] };
          open = false;
        } else if (open && "union" in result) {
          result.union.push(next);
        } else {
          result = { union: [result, next] };
          open = true;
        }
      });
      return result;
    }
    if (ruleOf(node) === "intersection") {
      const found = ofRule(node, "term-atom");
      const items = found.map((item) => readTerm(item, argument && found.length === 1));
      if (items.length === 1) return items[0];
      const joined = joinedType(items.map((item) => {
        const type = termType(item);
        return "problem" in type ? fail(type.problem, node) : type.type;
      }), "∩");
      if ("problem" in joined) fail(joined.problem, node);
      return { intersection: items };
    }
    if (ruleOf(node) === "term-atom") {
      const inner = parts(node).find((child) => child.kind === "rule");
      if (!inner) return fail("expected a term", node);
      if (ruleOf(inner) === "call") {
        const call = readCall(inner);
        if (!argument && SPANS.has(call.call)) fail(`${call.call} gives a span, which is not a value`, inner);
        if (call.call === "matches" || call.call === "begins" || call.call === "initial") fail(`${call.call} is a condition, not a term`, inner);
        return call;
      }
      return readTerm(inner, argument);
    }
    switch (ruleOf(node)) {
      case "string": return { string: decode(parts(node)[0]) };
      case "tag": case "character": case "phoneme": return { tag: tagOf(parts(node)[0]) };
      case "range": return { range: readRange(node) };
      case "property": return fail("a property is not a tag set, and stands only as a terminal in a body", node);
      case "name": {
        // A bare name is a tag literal if it begins with a capital, and
        // otherwise a rule, which only a function's argument names.
        const name = text(parts(node)[0]);
        if (isCapital(name)) return { tag: name };
        if (argument) return /** @type {Term} */ (/** @type {unknown} */ ({ rule: name }));
        return fail(`${name} names a rule, which is not a value; ~${name} is the tag`, node);
      }
      case "empty-set": return { emptySet: true };
      case "call": return readCall(node);
      case "constant-reference": return { const: text(parts(node)[0]).slice(1), at: at(node) };
      case "capture-reference": {
        const capture = text(parts(node)[0]).slice(1);
        if (inConstant) fail("a constant's value is a closed term, and holds no capture", node);
        if (!argument) fail(`a span is not a value: tags($${capture}) is the tag set of $${capture}`, node);
        return { capture };
      }
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
    if (inConstant && name !== "split" && name !== "tag") fail(`a constant's value is a closed term, and ${name} reads a span`, node);
    /** @type {Argument[]} */
    const args = ofRule(node, "argument").map((argument) => readTerm(parts(argument)[0], true));
    /** @type {(argument: Argument | undefined) => boolean} */
    const isSpan = (argument) => argument !== undefined && ("capture" in argument || ("call" in argument && SPANS.has(argument.call)));
    /** @type {(argument: Argument | undefined) => boolean} */
    const isRule = (argument) => argument !== undefined && "rule" in argument;
    /** @type {(argument: Argument | undefined) => boolean} */
    const isString = (argument) => {
      if (argument === undefined || "rule" in argument) return false;
      const found = termType(argument);
      // A constant's type is known only when the loader stitches the stage.
      return "type" in found && (found.type === "string" || found.type === "any");
    };
    let ok;
    if (name === "tags") ok = (args.length === 1 && isSpan(args[0])) || (args.length === 2 && isSpan(args[0]) && isRule(args[1]));
    else if (name === "matches" || name === "begins") ok = args.length === 2 && isSpan(args[0]) && isRule(args[1]);
    else if (name === "split") ok = args.length === 2 && args.every(isString);
    else if (name === "tag") ok = args.length === 1 && isString(args[0]);
    else ok = args.length === 1 && isSpan(args[0]);
    if (!ok) fail(`${name} takes ${SIGNATURES[name]}`, node);
    // A rule stands only as the second argument.
    if (args.some((argument, index) => "rule" in argument && index !== 1)) fail(`${name} takes ${SIGNATURES[name]}`, node);
    // An empty delimiter or a tag's name that the reader sees (engine §9).
    const seen = literalCallProblem(name, args);
    if (seen) fail(seen, node);
    return { call: name, args };
  }

  /**
   * @param {ResultNode} tokenNode
   * @returns {string}
   */
  function decode(tokenNode) {
    const written = text(tokenNode);
    // A string escapes its double quote, and a character tag its quote.
    const quote = written[0];
    const spelled = [...written].slice(1, -1);
    let result = "";
    for (let index = 0; index < spelled.length; index++) {
      if (spelled[index] !== "\\") {
        result += spelled[index];
        continue;
      }
      const next = spelled[++index];
      if (next === "\\" || next === quote) result += next;
      else if (next === "u" && spelled[index + 1] === "{") {
        let end = index + 2;
        let hex = "";
        while (end < spelled.length && spelled[end] !== "}") hex += spelled[end++];
        // One to six hexadecimal digits of a Unicode scalar value (engine §9).
        const value = parseInt(hex, 16);
        if (end >= spelled.length || !/^[0-9A-Fa-f]{1,6}$/.test(hex) || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) {
          fail("a bad \\u{...} escape", tokenNode);
        }
        result += String.fromCodePoint(value);
        index = end;
      } else {
        fail(`an unknown escape \\${next || ""}`, tokenNode);
      }
    }
    return result;
  }

  /**
   * The tag of a tag literal `~name`, a character tag or a phoneme tag
   * token: a character tag in its canonical spelling (engine §1, §9).
   * @param {ResultNode} tokenNode
   * @returns {string}
   */
  function tagOf(tokenNode) {
    const written = text(tokenNode);
    if (written.startsWith("~")) return written.slice(1);
    if (written.startsWith("/")) return written;
    const decoded = [...decode(tokenNode)];
    if (decoded.length !== 1) fail("a character tag holds exactly one character", tokenNode);
    return characterTag(/** @type {number} */ (decoded[0].codePointAt(0)), unicode);
  }

  /**
   * A range's two ends, each a character tag in its canonical spelling; its
   * start must not be above its end (engine §1, §9).
   * @param {ResultNode} node
   * @returns {[string, string]}
   */
  function readRange(node) {
    const ends = ofRule(node, "character").map((end) => tagOf(parts(end)[0]));
    /** @type {[string, string]} */
    const range = [ends[0], ends[1]];
    const problem = rangeProblem(range, unicode);
    if (problem) fail(problem, node);
    return range;
  }

  /**
   * A property's name: its token is `'\p{Name}'`, with a name of engine §1.
   * @param {ResultNode} tokenNode
   * @returns {string}
   */
  function readProperty(tokenNode) {
    const match = /^'\\p\{([^}]*)\}'$/.exec(text(tokenNode));
    if (!match) fail("a property is written '\\p{Name}'", tokenNode);
    const name = /** @type {RegExpExecArray} */ (match)[1];
    const problem = propertyProblem(name);
    if (problem) fail(problem, tokenNode);
    return name;
  }

  /**
   * The kind of a directive's operand (engine §9).
   * @param {ResultNode} node
   * @returns {OperandKind}
   */
  function operandKind(node) {
    const token = parts(node)[0];
    if (ruleOf(node) === "argument-string") return "string";
    if (ruleOf(node) === "argument-word") return isCapital(text(token)) ? "class" : "name";
    if (ruleOf(token) === "range" || ruleOf(token) === "property") return /** @type {OperandKind} */ (ruleOf(token));
    const written = text(token);
    return written.startsWith("~") ? "tag" : written.startsWith("/") ? "phoneme" : "character";
  }
}

/**
 * Whether a name begins with a capital, and so is a terminal and a tag
 * literal (engine §2).
 * @param {string} name
 * @returns {boolean}
 */
function isCapital(name) {
  const first = name.codePointAt(0);
  return first !== undefined && first >= 0x41 && first <= 0x5a;
}

/**
 * A directive's operand: a bare name, lower case or with a capital, a
 * string, a tag literal `~name`, a phoneme tag or a character tag.
 * @typedef {"name" | "class" | "string" | "tag" | "phoneme" | "character" | "range" | "property"} OperandKind
 */

const FUNCTIONS = new Set(["phonemes", "text", "split", "tag", "tags", "classes", "head", "tail", "last", "from", "after", "matches", "begins", "initial"]);

/**
 * What is wrong with a directive's operands, or null (engine §9).
 * @param {string} name
 * @param {OperandKind[]} kinds
 * @returns {string | null}
 */
export function operandProblem(name, kinds) {
  const names = kinds.every((kind) => kind === "name" || kind === "class");
  if (name === "stage") return kinds.length === 1 && names ? null : "%stage takes one name";
  if (name === "include") return kinds.length === 1 && kinds[0] === "string" ? null : "%include takes one string";
  if (name === "features") return kinds.length > 0 && names ? null : "%features takes one or more names";
  // %elidable takes identifier tags: a name with a capital, or ~name.
  if (name === "elidable") return kinds.every((kind) => kind === "class" || kind === "tag") ? null : "%elidable takes identifier tags: names with a capital, or ~name";
  return names ? null : `%${name} takes names only`;
}

const CONSTANT_IN_BODY = "a constant cannot stand in a body: a body names a class of tokens with a rule, such as %rule digit '0'..'9'";

// The functions whose value is a span.
const SPANS = new Set(["head", "tail", "last", "from", "after"]);

/** @type {Record<string, string>} */
const SIGNATURES = {
  phonemes: "one span", text: "one span", words: "one span", classes: "one span",
  head: "one span", tail: "one span", last: "one span", from: "one span", after: "one span", initial: "one span",
  split: "two strings", tag: "one string", tags: "a span, and optionally a rule", matches: "a span and a rule", begins: "a span and a rule",
};

// The rules of the notation's syntax grammar that the reader reads; every
// other rule is transparent.
const NAMED = new Set([
  "directive", "argument-word", "argument-string", "rule", "definer", "body", "alternative", "guard", "alternative-tags",
  "conjunction", "sequence", "element", "primary", "reference", "string", "phoneme", "spelled", "capture", "group", "optional",
  "choice", "empty", "tags-clause", "conditions-clause", "emits-clause", "verbatim-clause", "emit-item", "emit-target", "emit-tags",
  "implication", "any-of", "all-of", "condition", "comparison", "comparator", "negation", "presence",
  "term", "guarded-term", "union", "intersection", "term-atom", "tag", "character", "name", "empty-set", "call", "argument",
  "capture-reference", "argument-tag", "range", "property", "constant-definition", "constant-definer", "constant-reference",
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

