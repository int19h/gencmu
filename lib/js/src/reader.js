import { boundaryLocations, boundaryProblem } from "./boundary.js";
import { recipeLocations } from "./recipes.js";
// From the notation's syntax tree to a grammar DOM (engine §9).

import { patternProblem } from "./patterns.js";
import { GencmuError } from "./errors.js";
import { CAPTURE_NAME, duplicateCaptures, CLASSIFIER_NAME, DOM_FORMAT, engineLiterals, comparisonProblem, constantValueType, definitionProblem, expectedProblem, isSoundTest, joinedType, rangeProblem, readsOwnTags, termType } from "./dom.js";
import { PROPERTY_NAMES } from "./unicode.js";
import { methodProblem, methodShapeProblem, QUERY_METHODS, TARGET_METHODS } from "./methods.js";
import { run } from "./trampoline.js";
import { countWork, hooks } from "./testing.js";
import { rankedLocations } from "./ranked.js";

/**
 * @import { Step } from "./trampoline.js"
 * @import { Argument, Comparator, Condition, DomAlternative, DomClassifier, DomConstant, DomDirective, DomEntry, DomImplication, DomRule, EmitItem, Emission, Expr, GrammarDom, Position, ResultNode, RuleNode, Term } from "./types.js"
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
 * @param {{isMark(code: number): boolean, changesInDocument?(code:number):boolean}} unicode
 *   the configured category table for diagnostic strings
 * @param {boolean} [deferEmission] slot checks precede absent-carrier pruning
 * @returns {GrammarDom}
 */
export function treeToDom(tree, tokens, positionOf, path, unicode, deferEmission = false) {
  /** @type {(node: ResultNode) => string} */
  const sourceText = (node) => tokens[/** @type {import("./types.js").TokenNode} */ (node).token].text;
  /** @type {(node: ResultNode) => Position} */
  const at = (node) => positionOf(tokens[firstToken(node)]);
  /** @type {(message: string, node: ResultNode) => never} */
  const fail = (message, node) => {
    const [line, column] = at(node);
    throw new GencmuError("grammar", `${path}:${line}:${column}: ${message}`, { document: path, line, column });
  };

  // A rule node's children, with transparent rules read in their place,
  // in the order written, with an explicit stack.
  /** @type {(node: ResultNode) => ResultNode[]} */
  const parts = (node) => {
    /** @type {ResultNode[]} */
    const result = [];
    if (node.kind !== "rule") return result;
    /** @type {ResultNode[]} */
    const stack = node.children.slice().reverse();
    while (stack.length > 0) {
      if (hooks.work) countWork(hooks.work, "walkSteps");
      const child = /** @type {ResultNode} */ (stack.pop());
      if (child.kind === "rule" && !NAMED.has(child.rule)) for (let index = child.children.length - 1; index >= 0; index--) stack.push(child.children[index]);
      else result.push(child);
    }
    return result;
  };
  /** @type {(node: ResultNode) => string} */
  const valueOf = (node) => tokens[/** @type {import("./types.js").TokenNode} */ (node).token].value;
  /** @type {(node: ResultNode) => string} */
  const operator = (node) => ({ "≠": "≠", "∉": "∉", "⊈": "⊈", "≇": "≇" })[valueOf(node)] || valueOf(node);
  /** @type {(node: ResultNode) => string | null} */
  const tokenValue = (node) => (node.kind === "token" ? valueOf(node) : null);
  /** @type {(node: ResultNode, name: string) => RuleNode[]} */
  const ofRule = (node, name) => parts(node).flatMap((child) => (child.kind === "rule" && child.rule === name ? [child] : []));
  /** @type {(node: ResultNode, name: string) => RuleNode | undefined} */
  const one = (node, name) => ofRule(node, name)[0];
  // The parts that the reader reads from a node (engine §9). A node that
  // lacks one is an error of the document, which only a bootstrap of
  // another notation gives.
  /** @type {(node: ResultNode, what: string) => never} */
  const lacks = (node, what) => fail(`the notation's ${ruleOf(node)} has no ${what}`, node);
  /** @type {(node: ResultNode, name: string) => RuleNode} */
  const only = (node, name) => {
    const found = one(node, name);
    return found || lacks(node, name);
  };
  /** @type {(node: ResultNode, name: string, least?: number) => RuleNode[]} */
  const some = (node, name, least = 1) => {
    const found = ofRule(node, name);
    return found.length >= least ? found : lacks(node, least === 1 ? name : `${least} of ${name}`);
  };
  /** @type {(node: ResultNode) => ResultNode} */
  const token = (node) => parts(node).find((child) => child.kind === "token") || lacks(node, "token");
  // The first part, a token, a range or a property.
  /** @type {(node: ResultNode) => ResultNode} */
  const symbolPart = (node) => {
    const first = parts(node)[0];
    if (first && (first.kind === "token" || ruleOf(first) === "range" || ruleOf(first) === "property")) return first;
    return lacks(node, "token, range or property");
  };
  // The one rule among the parts, which must be one of `kinds`.
  /** @type {(node: ResultNode, kinds: Set<string>) => RuleNode} */
  const knownOf = (node, kinds) => {
    const found = parts(node).filter((child) => child.kind === "rule");
    if (found.length !== 1 || !kinds.has(/** @type {RuleNode} */ (found[0]).rule)) return lacks(node, `single part of these: ${[...kinds].join(", ")}`);
    return /** @type {RuleNode} */ (found[0]);
  };
  /** @type {(node: ResultNode) => string} */
  const ruleOf = (node) => (node.kind === "rule" ? node.rule : "");
  // The first node of a rule at or below a node, in the order written.
  /** @type {(node: ResultNode, name: string) => ResultNode | null} */
  const firstOfRule = (node, name) => {
    const stack = [node];
    while (stack.length > 0) {
      if (hooks.work) countWork(hooks.work, "walkSteps");
      const current = /** @type {ResultNode} */ (stack.pop());
      if (ruleOf(current) === name) return current;
      const children = parts(current);
      for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
    }
    return null;
  };

  /** @type {DomRule[]} */
  const rules = [];
  /** @type {DomDirective[]} */
  const directives = [];
  /** @type {DomConstant[]} */
  const constants = [];
  /** @type {DomClassifier[]} */
  const classifiers = [];
  /** @type {DomImplication[]} */
  const implications = [];
  // What the reader is reading as a closed term, a constant's value or a
  // test's operand, or null (engine §9, §10).
  /** @type {string | null} */
  let closedFor = null;
  // The notation node of each capture of the alternative being read, where
  // an error about it is reported.
  /** @type {Map<object, ResultNode>} */
  let captureNodes = new Map();
  // How many braces and elidable optionals the reader is inside, where no
  // capture stands.
  let braces = 0;
  let marked = 0;
  let recipeContext = false;
  let featureContext = false;
  const tagSources = new Map();
  for (const item of parts(tree)) {
    if (item.kind === "rule" && !ITEMS.has(item.rule)) fail(`the notation gives a ${item.rule} where an item stands`, item);
    if (ruleOf(item) === "directive") {
      const name = valueOf(token(item)).slice(1);
      const operands = parts(item).filter((child) => ruleOf(child) === "argument-word" || ruleOf(child) === "argument-string" || ruleOf(child) === "argument-tag" || ruleOf(child) === "argument-term");
      const problem = operandProblem(name, operands.map((child) => operandKind(child)));
      if (problem) fail(problem, item);
      const args = operands.map((child) => {
          if (ruleOf(child) === "argument-word") return valueOf(token(child));
          if (ruleOf(child) === "argument-string") return sourceText(token(child)).slice(1, -1);
          // A range or a property has no tag; operandProblem has refused it.
          return tagOf(symbolPart(child));
        });
      if (["stage", "extend-stage", "redefine-stage"].includes(name) && !CLASSIFIER_NAME.test(args[0])) {
        fail(`%${name} takes one lowercase name`, item);
      }
      if (name === "features" && args.some(arg => !/^[A-Za-z][A-Za-z0-9-]*$/.test(arg))) {
        fail("%features takes feature names", item);
      }
      if (name === "ambiguity-resolution" && !(["greedy", "lazy", "late-elision"].includes(args[0]) && (args.length === 1 || args[1] === "elision-only"))) {
        fail("%ambiguity-resolution takes a ranking name and optionally elision-only", item);
      }
      const clause = one(item, "conditions-clause");
      let conditions;
      featureContext = name === "features";
      try {
        conditions = clause ? some(clause, "implication").map(condition => run(readImplication(condition))) : undefined;
      } catch (error) {
        if (!featureContext || !(error instanceof GencmuError)) throw error;
        const [line,column] = at(item);
        throw new GencmuError("grammar",error.message,{document:path,line,column});
      } finally {
        featureContext = false;
      }
      if (conditions && name !== "features") fail("only %features accepts conditions", item);
      directives.push({
        ...(conditions ? { conditions } : {}),
        name,
        args,
        at: at(item),
      });
    } else if (ruleOf(item) === "rule") {
      rules.push(run(readRule(item)));
    } else if (ruleOf(item) === "constant-definition") {
      constants.push(run(readConstant(item)));
    } else if (ruleOf(item) === "classifier") {
      classifiers.push(readClassifier(item));
    } else if (ruleOf(item) === "implication-declaration") {
      implications.push(run(readImplicationDeclaration(item)));
    }
  }
  const dom = { format: DOM_FORMAT, rules, directives, constants, classifiers, implications };
  flattenGroups(dom);
  return dom;

  /**
   * A `%classifier` item: its name, which begins with a lower-case letter,
   * and its entries (engine §2, §9).
   * @param {ResultNode} node
   * @returns {DomClassifier}
   */
  function readClassifier(node) {
    const nameNode = only(node, "classifier-name");
    const name = valueOf(token(nameNode));
    if (!CLASSIFIER_NAME.test(name)) fail(`${name} begins with a capital, so it is a tag; a classifier's name begins with a lower-case letter`, nameNode);
    return { name, entries: ofRule(node, "classifier-entry").map(readEntry), at: at(node) };
  }

  /**
   * An entry of a classifier: gates, canonical keys, `∈` or `∉`, and a class
   * (engine §2, §9).
   * @param {ResultNode} node
   * @returns {DomEntry}
   */
  function readEntry(node) {
    const guards = ofRule(node, "guard").map((guard) => {
      const read = readGuard(guard);
      if (read.kind === "warning") fail("an entry of a classifier takes gates only, not a warning", guard);
      return read;
    });
    const keys = some(node, "classifier-key").map((keyNode) => {
      const key = decode(token(only(keyNode, "string")));

      return key;
    });
    const op = /** @type {"∈" | "∉"} */ (operator(token(only(node, "classifier-operator"))));
    const classNode = only(node, "classifier-class");
    const name = valueOf(token(classNode));
    if (!/^[A-Z](?:[A-Za-z0-9_-]*[A-Z])?$/.test(name)) fail(`${name} is not a class: a class starts and ends with a capital`, classNode);
    return { guards, keys, op, class: name, at: at(node) };
  }

  /**
   * An implication, `%implies A ⟹ B`: two closed terms whose type is a tag
   * set (engine §2, §9).
   * @param {ResultNode} node
   * @returns {Generator<Step, DomImplication, any>}
   */
  function* readImplicationDeclaration(node) {
    /** @type {Term[]} */
    const sides = [];
    for (const side of some(node, "union", 2).slice(0, 2)) {
      closedFor = "a side of an implication";
      const term = /** @type {Term} */ (yield readTerm(side));
      closedFor = null;
      const found = termType(term);
      const problem = "problem" in found ? found.problem : expectedProblem(found.type, "tags");
      if (problem) fail(`a side of an implication is a tag set: ${problem}`, side);
      sides.push(term);
    }
    return { if: sides[0], then: sides[1], at: at(node) };
  }

  /**
   * A constant's definition: its name without `$`, and its value, a closed
   * term of a type that a constant can have (engine §2, §9, §10).
   * @param {ResultNode} node
   * @returns {Generator<Step, DomConstant, any>}
   */
  function* readConstant(node) {
    const keyword = valueOf(token(only(node, "constant-definer")));
    const name = valueOf(token(only(node, "constant-reference"))).slice(1);
    if (!/^[A-Z][A-Za-z0-9_-]*$/.test(name)) fail("an engine constant cannot be declared", only(node, "constant-reference"));
    const valueNode = only(node, "term");
    closedFor = "a constant's value";
    const value = /** @type {Term} */ (yield readTerm(valueNode));
    closedFor = null;
    const op = keyword === "%redefine-const" ? "redefine" : "define";
    const found = constantValueType(value, op === "redefine");
    if ("problem" in found) fail(found.problem, valueNode);
    return { name, op, value, at: at(node) };
  }

  /**
   * @param {ResultNode} node
   * @returns {Generator<Step, DomRule, any>}
   */
  function* readRule(node) {
    const keyword = valueOf(token(only(node, "definer")));
    /** @type {Partial<DomRule>} */
    const rule = { name: valueOf(token(only(node, "rule-name"))), op: keyword === "%extend-rule" ? "extend" : keyword === "%redefine-rule" ? "redefine" : "define" };
    if (rule.name !== "#" && !/^[a-z][A-Za-z0-9_-]*$/.test(rule.name || "")) fail("a rule name begins with a lowercase letter", only(node, "rule-name"));
    const flags = one(node, "rule-flags");
    rule.flags = [];
    if (flags) {
      if (rule.op === "extend") fail("%extend-rule accepts no flags", flags);
      for (const flag of some(flags, "rule-flag")) {
        const name = valueOf(token(flag));
        if (!["leftmost-longest", "fewest"].includes(name)) fail(`unknown rule flag ${name}`, flag);
        if (rule.flags.includes(name)) fail(`duplicate rule flag ${name}`, flag);
        if (rule.flags.length) fail("a rule accepts only one flag", flag);
        rule.flags.push(name);
      }
    }
    const tagsClause = one(node, "tags-clause");
    const tags = tagsClause ? /** @type {Term} */ (yield readConstituentTags(tagsClause)) : undefined;
    const channels = yield readChannels(node);
    /** @type {DomAlternative[]} */
    const alternatives = [];
    const body = one(node, "body") || only(node, "headed-body");
    const ranked = one(body, "ranked-alternative");
    for (const alternative of ranked ? [ranked] : some(body, "alternative")) alternatives.push(yield readAlternative(alternative));
    // Each condition of the list is one condition, applying where its
    // captures are (engine §3.6).
    const conditionsClause = one(node, "conditions-clause");
    /** @type {Condition[]} */
    const conditions = [];
    if (conditionsClause) for (const condition of some(conditionsClause, "implication")) conditions.push(yield readImplication(condition));
    const emits = one(node, "emits-clause");
    const emit = emits ? /** @type {Emission} */ (yield readEmission(emits)) : undefined;
    if (tags) rule.tags = tags;
    Object.assign(rule, channels);
    rule.alternatives = alternatives;
    if (emit) rule.emit = emit;
    rule.conditions = conditions;
    if (one(node, "erased-clause")) rule.erased = true;
    rule.at = at(node);
    flattenGroups(rule);
    const boundaryFault = boundaryProblem(rule);
    if (boundaryFault) fail(boundaryFault.problem, boundaryLocations.get(boundaryFault.node)?.tree ?? node);
    const problem = definitionProblem(rule, deferEmission);
    if (problem) fail(problem, node);
    return /** @type {DomRule} */ (rule);
  }

  /** @param {ResultNode} node @returns {import("./types.js").Guard} */
  function readGuard(node) {
    const spelled = valueOf(token(node));
    const found = /^(¬?)([A-Za-z][A-Za-z0-9-]*)([?!])$/.exec(spelled);
    if (!found || (found[1] && found[3] === "!")) fail("invalid feature guard", node);
    return { feature: found[2], kind: found[3] === "!" ? "warning" : "gate", negated: found[1] === "¬" };
  }

  /**
   * @param {ResultNode} node
   * @returns {Generator<Step, DomAlternative, any>}
   */
  function* readAlternative(node) {
    const guards = ofRule(node, "guard").map(readGuard);
    captureNodes = new Map();
    /** @type {DomAlternative} */
    const alternative = { guards, expr: /** @type {Expr} */ (yield readExpression(only(node, ruleOf(node) === "ranked-alternative" ? "ranked-choice" : "conjunction"), true)) };
    // A name stands at most once in each production, gates aside: the
    // error stands at the second capture that such a production reads,
    // the first in the text where there are several (engine §3.5, §9).
    const twice = duplicateCaptures(alternative.expr).map((capture) => /** @type {ResultNode} */ (captureNodes.get(capture)));
    if (twice.length > 0) {
      const first = twice.reduce((a, b) => (firstToken(b) < firstToken(a) ? b : a));
      fail(`the capture $${valueOf(token(first)).slice(1)} is read twice by one production of the alternative`, first);
    }
    const tags = one(node, "alternative-tags");
    if (tags) alternative.tags = yield readConstituentTags(tags);
    Object.assign(alternative, yield readChannels(node));
    return alternative;
  }

  /**
   * @param {ResultNode} node
   * @param {boolean} [whole] whether it is the alternative's whole
   *   expression, where a chain may stand (engine §9)
   * @returns {Generator<Step, Expr, any>}
   */
  function* readExpression(node, whole = false) {
    switch (ruleOf(node)) {
      case "choice": {
        const ranked = one(node, "ranked-choice");
        if (ranked) return yield readExpression(ranked);
        const found = some(node, "conjunction");
        /** @type {Expr[]} */
        const items = [];
        for (const item of found) items.push(yield readExpression(item));
        return items.length === 1 ? items[0] : { choice: items };
      }
      case "ranked-choice": {
        const found = some(node, "conjunction", 2);
        /** @type {Expr[]} */
        const items = [];
        for (const item of found) items.push(yield readExpression(item));
        const expr = {ranked:items};
        const separator = parts(node).find(child => child.kind === "token" && valueOf(child) === "≻");
        if (separator) rankedLocations.set(expr,at(separator));
        return expr;
      }
      case "conjunction": {
        const found = some(node, "sequence");
        // A & of n items expands to 2ⁿ−1 sequences (engine §3.2). The
        // bound is the &'s own form, so it comes before its items (§9).
        if (found.length > 16) fail("an & joins at most 16 items", node);
        /** @type {Expr[]} */
        const items = [];
        for (const item of found) items.push(yield readExpression(item, whole && found.length === 1));
        return items.length === 1 ? items[0] : { and: items };
      }
      case "sequence": {
        const found = some(node, "primary");
        /** @type {Expr[]} */
        const items = [];
        for (const item of found) items.push(yield readPrimary(knownOf(item, PRIMARIES), whole && found.length === 1));
        return items.length === 1 ? items[0] : { seq: items };
      }
      default:
        return fail(`unexpected ${ruleOf(node)}`, node);
    }
  }

  /**
   * An optional, and with a marker `+` or `++` among its parts an elidable
   * one (engine §3.8, §9). Its form is checked on the tree, where a group
   * is still a node: one sequence, whose first primary is the terminal
   * itself, `=`-tested or not.
   * @param {RuleNode} node
   * @returns {Generator<Step, Expr, any>}
   */
  function* readOptional(node) {
    // Its required part first, then its markers (engine §9).
    const choice = only(node, "choice");
    const found = parts(node);
    const markers = found.filter((child) => tokenValue(child) === "+");
    if (markers.length >= 2) fail("an optional has one marker + at most", markers[1]);
    if (markers.length === 0) return { optional: yield readExpression(choice) };
    const form = "an elidable optional begins with its terminator, a name with a capital or ~name, written directly after the marker, and joins it to nothing with | or &";
    // One conjunction of one sequence, with no leading | or & either: the
    // terminator stands directly after the marker (engine §9).
    const conjunctions = ofRule(choice, "conjunction");
    const leading = parts(choice).some((child) => tokenValue(child) === "|") ||
      (conjunctions.length === 1 && parts(conjunctions[0]).some((child) => tokenValue(child) === "&"));
    const sequences = conjunctions.length === 1 && !leading ? ofRule(conjunctions[0], "sequence") : [];
    const primary = sequences.length === 1 ? ofRule(sequences[0], "primary")[0] : undefined;
    const head = primary ? knownOf(primary, PRIMARIES) : undefined;
    /** @type {(symbol: RuleNode) => boolean} */
    const isTerminal = (symbol) => ["tag", "reference"].includes(ruleOf(symbol)) && /^[A-Z]/.test(valueOf(token(symbol)));
    if (!head) fail(form, node);
    const symbol = /** @type {RuleNode} */ (head);
    if (ruleOf(symbol) === "tested") {
      const wrapper = one(symbol, "primary");
      const base = wrapper ? knownOf(wrapper, PRIMARIES) : parts(symbol).find(child => child.kind === "rule" && PRIMARIES.has(child.rule));
      if (!base || !isTerminal(/** @type {RuleNode} */ (base))) fail(form, node);

    } else if (!isTerminal(symbol)) {
      fail(form, node);
    }
    marked++;
    const expr = /** @type {Expr} */ (yield readExpression(choice));
    marked--;
    return { optional: expr, elidable: true };
  }

  /**
   * Braces: the item, its separator if a backslash has one, and a chain's
   * direction from its marker, a `...` among the parts (engine §9).
   * @param {RuleNode} node
   * @param {boolean} whole whether the braces are their alternative's whole
   *   expression
   * @returns {Generator<Step, Expr, any>}
   */
  function* readRepetition(node, whole) {
    const found = parts(node);
    const choices = some(node, "choice");
    const markers = found.flatMap((child, index) => (tokenValue(child) === "..." ? [index] : []));
    // Two markers are an error at the second, and a marker after the
    // separator is an error at that marker, whichever a reader meets first.
    if (markers.length >= 2) fail("braces have one chain marker ... at most", found[markers[1]]);
    const second = choices.length >= 2 ? found.indexOf(choices[1]) : found.length;
    if (markers.length === 1 && markers[0] > second) fail("a separator has no chain marker: ... stands after { or after the item", found[markers[0]]);
    const chain = markers.length === 0 ? null : markers[0] < found.indexOf(choices[0]) ? "left" : "right";
    // A chain is the whole expression of its alternative, as the lowering
    // of its levels needs (engine §3.3, §9).
    if (chain && !whole) fail("a chain is the whole expression of its alternative: name it as a rule to use it here", node);
    braces++;
    /** @type {Expr} */
    const result = { repeat: yield readExpression(choices[0]) };
    if (choices.length >= 2) result.separator = yield readExpression(choices[1]);
    braces--;
    if (chain) result.chain = chain;
    return result;
  }

  /**
   * @param {ResultNode} node
   * @param {boolean} [whole] whether a chain may stand here
   * @returns {Generator<Step, Expr, any>}
   */
  function* readPrimary(node, whole = false) {
    switch (ruleOf(node)) {
      case "reference": return { ref: valueOf(token(node)) };
      case "tag": return { ref: tagOf(token(node)) };
      case "string-terminal": return { literal: yield readTerm(knownOf(node, new Set(["string", "constant-reference"]))) };
      case "wildcard": token(node); return { wildcard: true };
      case "range": return { range: yield readRange(node) };
      case "tested": {
        const tests = parts(node).filter(child => ["tag-test", "value-test"].includes(ruleOf(child)));
        if (!tests.length) lacks(node, "test");
        const wrapper = one(node, "primary");
        const symbol = wrapper ? knownOf(wrapper, PRIMARIES) : parts(node).find(child => child.kind === "rule" && PRIMARIES.has(child.rule)) || lacks(node, "base primary");
        checkTestOrder(tests, ["reference", "tag", "string-terminal", "range", "wildcard"].includes(ruleOf(symbol)) && !(ruleOf(symbol) === "reference" && valueOf(token(symbol)) === "#"));
        // Convert the base before test operands (engine §9.3).
        let expr = yield readPrimary(symbol);
        for (const test of tests) expr = { ...(yield readTest(test)), expr };
        return expr;
      }
      case "capture": {
        if (braces > 0) fail("a capture cannot stand inside braces, whose parts repeat: name the list as a rule, and capture that", node);
        if (marked > 0) fail("a capture cannot stand inside an elidable optional, which elision restores as one unit", node);
        const captureToken = token(node);
        const inner = only(node, "primary");
        if (valueOf(captureToken) === "$") fail("$ is the whole constituent and wraps nothing", node);
        if (!CAPTURE_NAME.test(valueOf(captureToken).slice(1))) fail("a capture's name is all lower case", node);
        const wrapped = knownOf(inner, PRIMARIES);
        const target = one(wrapped, "primary");
        const base = ruleOf(wrapped) === "tested" ? target ? knownOf(target, PRIMARIES) : parts(wrapped).find(child => child.kind === "rule" && PRIMARIES.has(child.rule)) || lacks(wrapped, "base primary") : wrapped;
        if (!["reference", "tag", "string-terminal", "range", "wildcard"].includes(ruleOf(base))) fail("a capture wraps one symbol", node);
        const name = valueOf(captureToken).slice(1);
        const expr = /** @type {Expr} */ (yield readPrimary(wrapped));
        const capture = { capture: name, expr };
        captureNodes.set(capture, node);
        return capture;
      }
      case "group": return yield readExpression(only(node, "choice"));
      case "optional": return yield readOptional(/** @type {RuleNode} */ (node));
      case "repetition": return yield readRepetition(/** @type {RuleNode} */ (node), whole);
      case "empty": return { empty: true };
      default: return fail(`unexpected ${ruleOf(node)}`, node);
    }
  }

  /**
   * @param {ResultNode} node
   * @returns {Generator<Step, Emission, any>}
   */
  function* readEmission(node) {
    const itemNodes = ofRule(node, "emit-item");
    if (!itemNodes.length) {
      /** @type {any} */
      const item = { capture: "" };
      const tags = one(node, "emit-tags");
      if (tags) item.tags = yield readTagTerm(only(tags, "term"));
      Object.assign(item, yield readChannels(node));
      return { items: [item] };
    }
    const items = [];
    for (const itemNode of itemNodes) {
      const targetNode = only(itemNode, "emit-target");
      const target = symbolPart(targetNode);
      const written = target.kind === "token" ? valueOf(target) : "";
      if (written !== "ε" && !written.startsWith("$")) fail("an emission target is a capture or ε", targetNode);
      /** @type {any} */
      const item = written === "ε" ? { insert: true } : { capture: written.slice(1) };
      const before = ofRule(itemNode, "emit-before").flatMap(readAttachment);
      const after = ofRule(itemNode, "emit-after").flatMap(readAttachment);
      if ((before.length || after.length) && !item.capture) fail("only a named capture carries attachments", itemNode);
      const tags = one(itemNode, "emit-tags");
      if (tags) item.tags = yield readTagTerm(only(tags, "term"));
      Object.assign(item, yield readChannels(itemNode));
      if (before.length) item.before = before;
      if (after.length) item.after = after;
      items.push(item);
    }
    const named = items.flatMap(item => [item.capture, ...(item.before || []), ...(item.after || [])].filter(name => name));
    if (new Set(named).size !== named.length) fail("%emits lists a capture twice", node);
    return { items };
  }

  /** @param {RuleNode} node @returns {string[]} */
  function readAttachment(node) {
    return some(node, "capture-reference").map(child => {
      const name = valueOf(token(child)).slice(1);
      if (!name) fail("an attachment holds a named capture, not $", node);
      return name;
    });
  }

  /** @param {ResultNode} node @returns {Generator<Step, any, any>} */
  function* readChannels(node) {
    /** @type {Record<string, any>} */
    const result = {};
    for (const channel of ["value", "image"]) {
      const clause = one(node, `${channel}-clause`);
      if (clause) result[channel] = yield readRecipe(only(clause, "recipe"));
    }
    return result;
  }

  /** @param {ResultNode} node @returns {Generator<Step, any, any>} */
  function* readRecipe(node) {
    const concat = [];
    for (const atom of some(node, "recipe-atom")) {
      if (tokens.slice(atom.span[0], atom.span[1]).some(token => ["(", ")"].includes(token.value))) fail("a recipe atom has no grouping or arguments", atom);
      if (tokens.slice(atom.span[0], atom.span[1]).some(token => ["∪", "∩", "∖", "⟹"].includes(token.value))) fail("a recipe atom has no set operator", atom);
      recipeContext = true;
      const term = yield readTerm(only(atom, "term"));
      recipeContext = false;
      const items = "concat" in term ? term.concat : [term];
      if (concat.length || items.some((/** @type {Term} */ item) => "union" in item)) fail("juxtaposed recipe strings require ++. Use ++ between string atoms", atom);
      for (const item of items) {
        if ("method" in item) {
          const receiver = item.receiver;
          const input = ["value", "image", "source-text", "decomposed-source-text", "verbatim-text"].includes(item.method) && receiver.capture !== undefined;
          const emitted = ["value", "image"].includes(item.method) && receiver.method === "emitted" && receiver.receiver.capture !== undefined;
          if (!input && !emitted) fail("a recipe requires a bare capture string method", atom);
        } else if (!("string" in item || "const" in item)) fail("a recipe requires a string or captured string method", atom);
        concat.push(item);
      }
    }
    const recipe = { concat };
    recipeLocations.set(recipe,at(node));
    return recipe;
  }

  /** @param {ResultNode[]} tests @param {boolean} allowed */
  function checkTestOrder(tests, allowed) {
    const seen = new Set();
    for (const test of tests) {
      const kind = ruleOf(test);
      if (!allowed || seen.has(kind) || (kind === "tag-test" && seen.has("value-test"))) fail("this target or test order is invalid", test);
      seen.add(kind);
    }
  }

  /** @param {ResultNode} node @returns {Generator<Step, any, any>} */
  function* readTest(node) {
    if (ruleOf(node) === "tag-test") {
      const requirements = [];
      for (const requirement of ofRule(node, "tag-requirement")) {
        const operand = only(requirement, "test-operand");
        const inner = knownOf(operand, ATOMS);
        if (!["tag", "constant-reference"].includes(ruleOf(inner))) fail("a tag requirement is a tag or tag-set constant", operand);
        const value = yield readTerm(inner);
        const type = termType(value);
        const problem = "problem" in type ? type.problem : expectedProblem(type.type, "tags");
        if (problem) fail(problem, operand);
        requirements.push({ negated: parts(requirement).some(child => tokenValue(child) === "¬"), value });
      }
      return { test: "tags", requirements };
    }
    const comparator = operator(token(only(node, "test")));
    const operand = only(node, "test-operand");
    const inner = knownOf(operand, ATOMS);
    if (!["string", "constant-reference"].includes(ruleOf(inner))) fail("a value test requires a string literal or string constant", operand);
    return { test: comparator, value: yield readTerm(inner) };
  }

  /**
   * A constituent's tag term, which cannot read the tags it defines: `$`,
   * `tags($)` or `classes($)` (engine §9).
   * @param {ResultNode} node
   * @returns {Generator<Step, Term, any>}
   */
  function* readConstituentTags(node) {
    const term = /** @type {Term} */ (yield readTagTerm(only(node, "term")));
    if (readsOwnTags(term)) fail("a constituent's tags cannot be made of its own tags, tags($) or classes($)", node);
    return term;
  }

  /**
   * A whole term that must be a tag set: a constituent's or an item's tags
   * (engine §10). The error stands at the term.
   * @param {ResultNode} node
   * @returns {Generator<Step, Term, any>}
   */
  function* readTagTerm(node) {
    const term = /** @type {Term} */ (yield readTerm(node));
    const found = termType(term);
    const problem = "problem" in found ? found.problem : expectedProblem(found.type, "tags");
    if (problem) fail(problem, node);
    const retained = yield literalTerms(term);
    if (retained.length) {
      const first = retained.map((/** @type {object} */ value) => tagSources.get(value)).filter(Boolean).sort((/** @type {ResultNode} */ a, /** @type {ResultNode} */ b) => firstToken(a) - firstToken(b))[0];
      fail("a tag clause cannot introduce an engine tag", first || node);
    }
    return term;
  }

  /** @param {any} term @returns {Generator<Step, any[], any>} */
  function* literalTerms(term) {
    if (term.tag?.startsWith("_")) return [term];
    if (term.if) return yield literalTerms(term.then);
    if (term.difference) return yield literalTerms(term.difference[0]);
    const values = term.union ?? term.intersection;
    if (!values) return [];
    const parts = [];
    for (const value of values) parts.push(yield literalTerms(value));
    if (term.union) return parts.flat();
    const names = parts.map(values => new Set(values.map((/** @type {any} */ value) => value.tag)));
    return parts.flat().filter(value => names.every(set => set.has(value.tag)));
  }

  /**
   * A condition, or conditions joined by ⟹, grouping to the right.
   * @param {ResultNode} node
   * @returns {Generator<Step, Condition, any>}
   */
  function* readImplication(node) {
    // Its any-ofs in order, and after them the implication of a notation
    // that writes one after `⟹`, grouped to the right (engine §9).
    /** @type {Condition[]} */
    const items = [];
    for (const anyOf of some(node, "any-of")) items.push(yield readAnyOf(anyOf));
    const consequent = one(node, "implication");
    if (consequent) items.push(yield readImplication(consequent));
    let result = /** @type {Condition} */ (items.pop());
    while (items.length > 0) result = { if: /** @type {Condition} */ (items.pop()), then: result };
    return result;
  }

  /**
   * Conditions joined by ∨, each several joined by ∧; a parenthesized group
   * of the same connective is part of the one around it (engine §9).
   * @param {ResultNode} node
   * @returns {Generator<Step, Condition, any>}
   */
  function* readAnyOf(node) {
    // Parentheses make no node, so a group of the same connective as the
    // one around it is part of it: (a ∧ b) ∧ c is a ∧ b ∧ c (engine §9).
    // The reader joins such groups once the rule is read (flattenGroups),
    // in one walk, since joining them here would copy a list at each depth.
    /** @type {Condition[]} */
    const items = [];
    for (const allNode of some(node, "all-of")) {
      /** @type {Condition[]} */
      const all = [];
      for (const conditionNode of some(allNode, "condition")) all.push(yield readCondition(conditionNode));
      items.push(all.length === 1 ? all[0] : { all });
    }
    return items.length === 1 ? items[0] : { any: items };
  }

  /**
   * @param {ResultNode} node
   * @returns {Generator<Step, Condition, any>}
   */
  function* readCondition(node) {
    const inner = knownOf(node, CONDITIONS);
    switch (ruleOf(inner)) {
      case "implication":
        return yield readImplication(inner);
      case "presence":
        return { captured: valueOf(token(inner)).slice(1) };
      case "tree-comparison": {
        const leftNode = only(inner,"capture-reference");
        const rightNode = only(inner,"union");
        const leaf = firstOfRule(rightNode,"name");
        // A bare name gets this error before capital-initial tag typing.
        if (leaf && tokens.slice(rightNode.span[0],rightNode.span[1]).length === 1) {
          const name = valueOf(token(leaf));
          fail(`tree comparison requires a pattern; write @(${name}), not ${name}`,leaf);
        }
        const op = /** @type {Comparator} */ (operator(token(only(inner,"tree-comparator"))));
        const right = /** @type {Term} */ (yield readTerm(rightNode));
        const found = termType(right);
        const problem = "problem" in found ? found.problem : expectedProblem(found.type,"pattern");
        if (problem && !featureContext) fail(problem,rightNode);
        return {op,left:{capture:valueOf(token(leftNode)).slice(1)},right};
      }
      case "comparison": {
        const [left, right] = some(inner, "union", 2);
        const op = /** @type {Comparator} */ (operator(token(only(inner, "comparator"))));
        const condition = { op, left: /** @type {Term} */ (yield readTerm(left)), right: /** @type {Term} */ (yield readTerm(right)) };
        // The two sides fit the comparator (engine §10).
        const leftType = termType(condition.left);
        const rightType = termType(condition.right);
        const problem = "problem" in leftType ? leftType.problem : "problem" in rightType ? rightType.problem
          : comparisonProblem(op, leftType.type, rightType.type);
        if (problem && !featureContext) fail(problem, inner);
        return condition;
      }
      case "negation":
        return { not: yield readCondition(only(inner, "condition")) };
      case "method": {
        const method = yield readMethod(inner);
        if (!QUERY_METHODS.has(method.method)) fail("a condition requires a query method", inner);
        return method;
      }
      default:
        return fail(`unexpected ${ruleOf(inner)}`, inner);
    }
  }

  /**
   * @param {ResultNode} node
   * @param {boolean} [argument] whether the term is a function's argument,
   *   where a span may stand
   * @returns {Generator<Step, Term, any>}
   */
  function* readTerm(node, argument = false) {
    if (ruleOf(node) === "term") return yield readTerm(knownOf(node, TERMS), argument);
    if (ruleOf(node) === "guarded-term") {
      if (closedFor) fail(`${closedFor} is a closed term, and holds no guarded term`, node);
      // Its any-ofs, each guarding the rest, and then its union, or the
      // term of a notation that writes one after `⟹` (engine §9). The
      // reader has checked each comparison of a condition, so a condition's
      // terms agree; the term guarded last must be a tag set, an error at
      // its guard.
      const guards = some(node, "any-of");
      /** @type {Condition[]} */
      const conditions = [];
      for (const guard of guards) conditions.push(yield readAnyOf(guard));
      const last = one(node, "union") || only(node, "term");
      /** @type {Term} */
      let guarded = yield readTerm(last);
      const found = termType(guarded);
      const joined = "problem" in found ? found : joinedType([found.type], "⟹");
      const problem = "problem" in joined ? joined.problem : joined.type === "pattern" ? "a guarded term requires a set" : null;
      if (problem && !featureContext) fail(problem, guards[guards.length - 1]);
      for (let index = conditions.length - 1; index >= 0; index--) guarded = { if: conditions[index], then: guarded };
      return guarded;
    }
    if (ruleOf(node) === "union") {
      // Parts joined by ∪ and ∖ group from the left: a run joined by ∪ is
      // one union, and each ∖ takes what stands before it (engine §9).
      const found = some(node, "intersection");
      if (found.length === 1) return yield readTerm(found[0], argument);
      /** @type {string[]} */
      const operators = parts(node).flatMap((child) => {
        const written = tokenValue(child);
        return written === "∪" || written === "∖" ? [written] : [];
      });
      // A leading ∪ is a separator, not an operator.
      while (operators.length >= found.length) operators.shift();
      /** @type {Term[]} */
      const items = [];
      for (const item of found) items.push(yield readTerm(item));
      const joined = joinedType(items.map((item) => {
        const type = termType(item);
        return "problem" in type ? (featureContext ? "any" : fail(type.problem, node)) : type.type;
      }), operators.includes("∖") ? "∖" : "∪");
      if ("problem" in joined && !featureContext) fail(joined.problem, node);
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
    if (ruleOf(node) === "concatenation") {
      const nodes = some(node, "term-atom");
      const items = [];
      for (const part of nodes) {
        const term = yield readTerm(part, argument && nodes.length === 1);
        if ("concat" in term) for (const child of term.concat) items.push(child);
        else items.push(term);
      }
      if (nodes.length === 1) return items.length === 1 ? items[0] : {concat: items};
      for (const item of items) {
        const found = termType(item);
        const problem = "problem" in found ? found.problem : !["string", "any"].includes(found.type) ? "++ requires string operands" : null;
        if (problem && !featureContext) fail(problem, node);
      }
      return {concat: items};
    }
    if (ruleOf(node) === "intersection") {
      const found = some(node, "concatenation");
      /** @type {Term[]} */
      const items = [];
      for (const item of found) items.push(yield readTerm(item, argument && found.length === 1));
      if (items.length === 1) return items[0];
      const joined = joinedType(items.map((item) => {
        const type = termType(item);
        return "problem" in type ? (featureContext ? "any" : fail(type.problem, node)) : type.type;
      }), "∩");
      if ("problem" in joined && !featureContext) fail(joined.problem, node);
      return { intersection: items };
    }
    if (ruleOf(node) === "term-atom" || ruleOf(node) === "test-operand") {
      const inner = knownOf(node, ATOMS);
      if (ruleOf(inner) === "method") {
        const method = yield readMethod(inner);
        if (QUERY_METHODS.has(method.method)) fail("a query method is a condition, not a term", inner);
        return method;
      }
      return yield readTerm(inner, argument);
    }
    switch (ruleOf(node)) {
      case "pattern-literal": {
        const before = closedFor;
        closedFor = null;
        const pattern = asPattern(yield readPattern(one(node, "pattern-union") || only(node, "pattern-atom")));
        closedFor = before;
        const problem = patternProblem(pattern, () => null);
        if (problem) fail(problem,node);
        return {pattern};
      }
      case "string": return decode(token(node));
      case "tag": {
        const tag = tagOf(token(node));
        if (closedFor && tag.startsWith("_")) fail(`${closedFor} cannot contain an engine-tag literal`, node);
        const term = { tag };
        tagSources.set(term, node);
        return term;
      }
      case "string-run":
      case "tag-run": {
        const start = node.span[0];
        const end = node.span[1];
        if (["∩", "∖"].includes(tokens[start - 1]?.value) || ["∩", "∖"].includes(tokens[end]?.value)) fail("a tag run beside ∩ or ∖ requires parentheses", node);
        const union = [];
        for (const tag of some(node, ruleOf(node) === "string-run" ? "string" : "tag", 2)) union.push(yield readTerm(tag));
        return { union };
      }
      case "range": return fail("a range is a terminal, not a term", node);
      case "property": return fail("a property is not a tag set, and stands only as a terminal in a body", node);
      case "name": {
        // A bare name is a tag literal if it begins with a capital, and
        // otherwise a rule, which only a function's argument names.
        const name = valueOf(token(node));
        if (isCapital(name)) return { tag: name };
        if (argument) return /** @type {Term} */ (/** @type {unknown} */ ({ rule: name }));
        return fail(`${name} names a rule, which is not a value; ~${name} is the tag`, node);
      }
      case "empty-set": return { emptySet: true };
      case "method": return yield readMethod(node);
      case "constant-reference": {
        const name = valueOf(token(node)).slice(1);
        if (name.startsWith("_")) {
          const code = parseInt(name.slice(1), 16);
          if (!/^_[0-9A-F]{4,6}$/.test(name) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) fail("an engine constant requires a scalar in uppercase hexadecimal", node);
        } else if (!/^[A-Z][A-Za-z0-9_-]*$/.test(name)) fail("a user constant begins with a capital", node);
        return { const: name, at: at(node) };
      }
      case "capture-reference": {
        const capture = valueOf(token(node)).slice(1);
        if (closedFor) fail(`${closedFor} is a closed term, and holds no capture`, node);

        return { capture };
      }
      default: return fail(`unexpected ${ruleOf(node)}`, node);
    }
  }

  /** @param {any} n @returns {any} */
  function asPattern(n) { return 'node' in n ? n.node : {children:n}; }
  /** @param {any[]} items @returns {any} */
  function sequencePattern(items) {
    const flat=items.flatMap(n => n.sequence ?? [n]);
    return flat.length===1 ? flat[0] : {sequence:flat};
  }
  /** @param {ResultNode} node @returns {Generator<Step, any, any>} */
  function* readPattern(node) {
    const kind=ruleOf(node);
    if (kind==='pattern-union' || kind==='pattern-intersection') {
      const nodes=some(node,kind==='pattern-union'?'pattern-intersection':'pattern-sequence');
      const items=[];for(const child of nodes)items.push(yield readPattern(child));
      if(items.length===1)return items[0];
      const operators=parts(node).filter(n=>n.kind==='token').map(n=>valueOf(n));
      let result=asPattern(items[0]);
      for(let i=1;i<items.length;i++) {
        const op=kind==='pattern-intersection'?'intersection':operators[i-1]==='∖'?'difference':'union';
        result={[op]:[result,asPattern(items[i])]};
      }
      return {node:result};
    }
    if(kind==='pattern-sequence') {
      const items=[];for(const child of some(node,'pattern-item'))items.push(yield readPattern(child));
      return sequencePattern(items);
    }
    if(kind==='pattern-item') {
      const child=parts(node)[0];if(!child)return lacks(node,'pattern item');
      return child.kind==='token'&&valueOf(child)==='⋯'?{siblings:true}:yield readPattern(child);
    }
    if (kind === "pattern-atom") {
      const inner = parts(node);
      const first = inner[0];
      if (!first) return lacks(node, "pattern atom");
      const tests = inner.filter(child => ["tag-test", "value-test"].includes(ruleOf(child)));
      const testable = first.kind === "token" ? isCapital(valueOf(first)) || valueOf(first).startsWith("_")
        : ["tag", "string", "string-terminal", "range", "wildcard", "constant-reference"].includes(ruleOf(first));
      const grouped = first.kind === "token" && valueOf(first) === "(";
      const nested = ruleOf(first) === "pattern-literal";
      checkTestOrder(tests, testable);
      if (grouped) return yield readPattern(only(node, "pattern-union"));
      if (nested) return { node: asPattern(yield readPattern(one(first, "pattern-union") || only(first, "pattern-atom"))) };
      let expr;
      if (first.kind === "token") {
        const name = valueOf(first);
        expr = isCapital(name) || name.startsWith("_") ? { terminal: tagOf(first), at: at(first) } : { name, at: at(first) };
      } else if (ruleOf(first) === "tag") expr = { terminal: tagOf(token(first)), at: at(first) };
      else if (ruleOf(first) === "string") expr = { literal: decode(token(first)), at: at(first) };
      else if (ruleOf(first) === "string-terminal") expr = { literal: yield readTerm(knownOf(first, new Set(["string", "constant-reference"]))), at: at(first) };
      else if (ruleOf(first) === "range") expr = { range: yield readRange(first), at: at(first) };
      else if (ruleOf(first) === "wildcard") expr = { wildcard: true, at: at(first) };
      else if (ruleOf(first) === "constant-reference") {
        const value = yield readTerm(first);
        expr = value.const.startsWith("_") ? { literal: value, at: at(first) } : { constant: value.const, at: at(first) };
      } else return lacks(node, "pattern atom");
      for (const test of tests) expr = { ...(yield readTest(test)), expr };
      return { node: expr };
    }
    if(kind==='pattern-brackets')return {optional:yield readPattern(only(node,'pattern-union'))};
    if(kind==='pattern-repeat') {
      const unions=some(node,'pattern-union');
      const repeat=yield readPattern(unions[0]);
      return unions.length===1?{repeat}:{repeat,separator:yield readPattern(unions[1])};
    }
    if(kind==='pattern-path') {
      // The operator is a direct token, before or after the named atom.
      const operator=valueOf(token(node));
      return {node:{path:operator==='⋮'?'descendant':operator==='⋰'?'first':'last',pattern:asPattern(yield readPattern(only(node,'pattern-atom')))}};
    }
    return fail(`unexpected ${kind} in pattern`,node);
  }

  /**
   * @param {ResultNode} node
   * @returns {Generator<Step, {method: string, receiver:Term, args: Argument[]}, any>}
   */
  function* readMethod(node) {
    let receiver = yield readTerm(only(only(node, "method-receiver"), "term-atom"), true);
    for (const selector of some(node, "method-selector")) {
      const name = valueOf(token(only(selector, "method-name")));
      /** @type {any[]} */
      const args = [];
      const argumentsNode = one(selector, "arguments");
      if (argumentsNode) for (const argument of some(argumentsNode, "argument")) {
        const integer = one(argument, "integer");
        if (integer) {
          const digits = valueOf(token(integer));
          if (!/^[1-9][0-9]*$/.test(digits)) fail("an integer argument is positive and has no leading zeros", integer);
          args.push({integer:digits});
        } else args.push(yield readTerm(only(argument, "term"), true));
      }
      if (name === "classify" && args.length === 1 && args[0].rule && CLASSIFIER_NAME.test(args[0].rule)) args[0] = { classifier: args[0].rule };
      if (TARGET_METHODS.has(name)) {
        for (let index = 0; index < args.length; index++) if (args[index].tag && !args[index].tag.startsWith("_")) args[index] = {terminal:args[index].tag};
      }
      if (argumentsNode) {
        const separators = parts(argumentsNode).filter(child => child.kind === "token").map(valueOf);
        if (separators.some(separator => separator !== (TARGET_METHODS.has(name) ? "|" : ","))) fail("invalid method argument separator", argumentsNode);
      }
      if (featureContext) {
        const problem = methodShapeProblem(name, receiver, args, recipeContext);
        if (problem) fail(problem, node);
      }
      const found = featureContext ? {type:"any"} : termType(receiver);
      if ("problem" in found) fail(found.problem, node);
      const types = [];
      for (const arg of args) {
        if (arg.rule || arg.classifier || arg.terminal || arg.integer) types.push("name");
        else {
          const type = featureContext ? {type:"any"} : termType(arg);
          if ("problem" in type) fail(type.problem, node);
          types.push(type.type);
        }
      }
      const problem = methodProblem(name, receiver, args, found.type, types, recipeContext);
      if (problem && !featureContext) fail(problem, node);
      if (closedFor && (!["split", "ngrams"].includes(name) || found.type === "span")) fail(`${closedFor} cannot read an input method`, node);
      receiver = { method: name, receiver, args };
      boundaryLocations.set(receiver, {tree:node,at:at(node)});
      if (argumentsNode) ofRule(argumentsNode,"argument").forEach((argument,index) => boundaryLocations.set(args[index],{tree:argument,at:at(argument)}));
    }
    return receiver;
  }

  /** @param {ResultNode} tokenNode @returns {any} */
  function decode(tokenNode) {
    return { string: [...valueOf(tokenNode)].slice(1, -1).join("") };
  }

  /** @param {ResultNode} tokenNode @returns {string} */
  function tagOf(tokenNode) {
    const name = valueOf(tokenNode);
    if (name.startsWith("_") && !PROPERTY_NAMES.has(name.slice(1))) fail("an unknown engine tag", tokenNode);
    if (!name.startsWith("_") && !/^[A-Z][A-Za-z0-9_-]*$/.test(name)) fail("a user tag begins with a capital", tokenNode);
    return name;
  }

  /** @param {ResultNode} node @returns {Generator<Step, any, any>} */
  function* readRange(node) {
    const found = parts(node).filter(child => ["string", "constant-reference"].includes(ruleOf(child)));
    if (found.length < 2) lacks(node, "two string operands");
    const range = [];
    for (const end of found.slice(0, 2)) range.push(yield readTerm(end));
    const scalars = range.map(term => typeof term.string === "string" ? term.string : term.const?.startsWith("_") ? String.fromCodePoint(parseInt(term.const.slice(1), 16)) : null);
    if (scalars.some(value => value !== null && [...value].length !== 1)) fail("a range endpoint is one scalar", node);
    if (scalars.every(value => value !== null) && scalars[0].codePointAt(0) > scalars[1].codePointAt(0)) fail("a range starts above its end", node);
    return range;
  }

  /**
   * The kind of a directive's operand (engine §9).
   * @param {ResultNode} node
   * @returns {OperandKind}
   */
  function operandKind(node) {
    if (ruleOf(node) === "argument-string") return "string";
    if (ruleOf(node) === "argument-word") return isCapital(valueOf(token(node))) ? "class" : "name";
    return "tag";
  }
}

/**
 * Joins each `any` that stands directly in an `any`, and each `all` in an
 * `all`, into the one around it, in place: a group in parentheses of the
 * same connective is part of the one around it (engine §9). One walk, with
 * an explicit stack, that gathers each joined list once.
 * @param {unknown} root
 */
function flattenGroups(root) {
  /** @type {unknown[]} */
  const stack = [root];
  while (stack.length > 0) {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    const current = stack.pop();
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    if (current === null || typeof current !== "object") continue;
    const node = /** @type {Record<string, unknown>} */ (current);
    for (const key of ["any", "all", "union"]) {
      const items = node[key];
      if (!Array.isArray(items)) continue;
      /** @type {unknown[]} */
      const joined = [];
      /** @type {unknown[]} */
      const pending = items.slice().reverse();
      while (pending.length > 0) {
        if (hooks.work) countWork(hooks.work, "walkSteps");
        const item = pending.pop();
        const inner = item !== null && typeof item === "object" ? /** @type {Record<string, unknown>} */ (item)[key] : undefined;
        if (Array.isArray(inner)) for (let index = inner.length - 1; index >= 0; index--) pending.push(inner[index]);
        else joined.push(item);
      }
      node[key] = joined;
    }
    for (const value of Object.values(node)) if (value !== null && typeof value === "object") stack.push(value);
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
 * string, or another recognized term atom.
 * @typedef {"name" | "class" | "string" | "tag" | "range" | "term"} OperandKind
 */



/**
 * What is wrong with a directive's operands, or null (engine §9).
 * @param {string} name
 * @param {OperandKind[]} kinds
 * @returns {string | null}
 */
export function operandProblem(name, kinds) {
  const names = kinds.every((kind) => kind === "name" || kind === "class");
  if (["stage", "extend-stage", "redefine-stage"].includes(name)) return kinds.length === 1 && names ? null : `%${name} takes one name`;
  if (name === "include") return kinds.length === 1 && kinds[0] === "string" ? null : "%include takes one string";
  if (name === "features") return kinds.length > 0 && names ? null : "%features takes one or more names";
  if (name === "ambiguity-resolution" && !(kinds.length >= 1 && kinds.length <= 2)) return "%ambiguity-resolution takes one or two names";
  return names ? null : `%${name} takes names only`;
}

// What a primary, a condition, a term and a term atom hold: the one rule
// among their parts is one of these (engine §9).
const PRIMARIES = new Set(["reference", "tag", "string-terminal", "wildcard", "range", "tested", "capture", "group", "optional", "repetition", "empty"]);
const CONDITIONS = new Set(["tree-comparison", "comparison", "method", "negation", "presence", "implication"]);
const TERMS = new Set(["union", "guarded-term"]);
const ATOMS = new Set(["pattern-literal", "string", "tag", "tag-run", "string-run", "range", "name", "empty-set", "term", "guarded-term", "union", "term-atom", "method", "capture-reference", "constant-reference"]);
const ITEMS = new Set(["directive", "rule", "constant-definition", "classifier", "implication-declaration"]);
const NAMED = new Set([
  ...ITEMS, ...PRIMARIES, ...CONDITIONS, ...TERMS, ...ATOMS,
  "argument-word", "argument-string", "argument-tag", "argument-term", "classifier-name", "classifier-class", "classifier-key", "classifier-operator", "classifier-entry",
  "constant-definer", "definer", "rule-name", "rule-flags", "rule-flag", "body", "headed-body", "alternative", "ranked-alternative", "guard", "ranked-choice", "choice", "conjunction", "sequence", "primary",
  "tag-test", "tag-requirement", "value-test", "test", "test-operand", "tags-clause", "alternative-tags", "emit-tags", "value-clause", "image-clause", "conditions-clause", "emits-clause", "erased-clause",
  "emit-item", "emit-target", "emit-before", "emit-after", "recipe", "recipe-atom", "method-receiver", "method-selector", "method-name", "arguments", "argument", "integer", "intersection", "concatenation", "any-of", "all-of", "condition", "comparator", "tree-comparator",
  "pattern-literal", "pattern-union", "pattern-intersection", "pattern-sequence", "pattern-item", "pattern-atom", "pattern-brackets", "pattern-repeat", "pattern-path",
]);

/**
 * @param {ResultNode} node
 * @returns {number}
 */
function firstToken(node) {
  // Down the first child that is a token or a rule, in a loop: a deep
  // nesting cannot exhaust the call stack.
  let current = node;
  for (;;) {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    if (current.kind === "token") return current.token;
    if (current.kind === "elided") return current.span[0];
    const child = current.children.find((candidate) => candidate.kind === "token" || candidate.kind === "rule");
    if (!child) return current.span[0];
    current = child;
  }
}
