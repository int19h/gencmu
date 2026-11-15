import { argumentOfExpression } from "./template-nodes.js";
// From the notation's syntax tree to a grammar DOM (engine §9).

import { GencmuError } from "./errors.js";
import { CLASSIFIER_NAME, DOM_FORMAT, hideAt, KEY_STEPS, LEANS } from "./dom.js";
import { TARGET_METHODS } from "./methods.js";
import { run } from "./trampoline.js";
import { countWork, hooks } from "./testing.js";

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
 * @param {{isMark(code: number): boolean, changesInDocument?(code:number):boolean, isEmojiName?(name:string):boolean, canonicalTag(name:string):string|null}} unicode
 *   the configured category table for diagnostic strings
 * @param {(token:Token, path:boolean)=>string} decodeString
 * @param {boolean} [deferEmission] slot checks precede absent-carrier pruning
 * @returns {GrammarDom}
 */
export function treeToDom(tree, tokens, positionOf, path, unicode, decodeString, deferEmission = false) {
  void deferEmission;
  /** @type {(node: ResultNode) => Position} */
  const at = (node) => {
    const index = firstToken(node);
    const found = tokens[index];
    if (found) return positionOf(found);
    const last = tokens[tokens.length - 1];
    const end = last?.source[1] ?? 0;
    return positionOf(/** @type {Token} */ ({...last, source:[end,end]}));
  };
  /** @type {(message: string, position: Position) => never} */
  const failAt = (message, [line, column]) => {
    throw new GencmuError("grammar", `${path}:${line}:${column}: ${message}`, { document: path, line, column });
  };

  /** @type {(message: string, node: ResultNode) => never} */
  const fail = (message, node) => failAt(message, at(node));

  // A rule node's children, with transparent rules read in their place,
  // in the order written, with an explicit stack.
  /** @type {WeakMap<ResultNode, ResultNode[]>} */
  const partsCache = new WeakMap();
  /** @type {(node: ResultNode) => ResultNode[]} */
  const parts = (node) => {
    const cached = partsCache.get(node);
    if (cached) return cached;
    /** @type {ResultNode[]} */
    const result = [];
    partsCache.set(node, result);
    if (node.kind !== "rule") return result;
    /** @type {ResultNode[]} */
    const stack = node.children.slice().reverse();
    while (stack.length > 0) {
      if (hooks.work) countWork(hooks.work, "walkSteps");
      const child = /** @type {ResultNode} */ (stack.pop());
      if (child.kind === "rule" && !NAMED.has(child.rule)) for (let index = child.children.length - 1; index >= 0; index--) stack.push(child.children[index]);
      else if (child.kind !== "elided") result.push(child);
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
  /** First written occurrence, including nested body nodes (engine §9).
   * @param {ResultNode} node @param {string} name @returns {RuleNode|undefined} */
  const descendant = (node,name) => {
    const pending=[node];
    while(pending.length){
      if(hooks.work)countWork(hooks.work,"walkSteps");
      const current=/** @type {ResultNode} */(pending.pop());
      if(current.kind!=="rule")continue;
      if(current.rule===name)return current;
      for(let index=current.children.length-1;index>=0;index--)pending.push(current.children[index]);
    }
    return undefined;
  };
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
  // The first part, a token or a range.
  /** @type {(node: ResultNode) => ResultNode} */
  const symbolPart = (node) => {
    const first = parts(node)[0];
    if (first && (first.kind === "token" || ruleOf(first) === "range")) return first;
    return lacks(node, "token or range");
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
  /** @type {(node: ResultNode) => RuleNode | undefined} */
  const testBase = (node) => {
    const wrapper = one(node, "primary");
    if (wrapper) return knownOf(wrapper, PRIMARIES);
    for (const child of parts(node)) if (child.kind === "rule" && child.rule !== "tested-primary" && PRIMARIES.has(child.rule)) return child;
    return undefined;
  };
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
  let recipeContext = false;
  /** @type {RuleNode|undefined} */
  let defaultHead;
  /** @type {Term|undefined} */
  let headDefault;
  for (const item of parts(tree)) {
    if (item.kind === "rule" && !ITEMS.has(item.rule)) fail(`the notation gives a ${item.rule} where an item stands`, item);
    if (ruleOf(item) === "ranking-directive") {
      const nodes = some(item, "ranking-step");
      const steps = [];
      for (const step of nodes) {
        const name = valueOf(token(step));
        const operand = parts(step).find(child => ["pattern-literal", "constant-reference"].includes(ruleOf(child)));
        if (operand ? !KEY_STEPS.has(name) : !LEANS.has(name) || step !== nodes.at(-1)) {
          fail("%ambiguity-resolution requires a pattern for each key step and no operand on a final lean", item);
        }
        if (operand) {
          const value = run(readTerm(operand));
          steps.push(hideAt({step:name, pattern:"pattern" in value ? value.pattern : value}, at(operand)));
        } else steps.push({step:name});
      }
      directives.push(/** @type {import("./types.js").DomDirective} */ ({ name: "ambiguity-resolution", steps, at: at(item) }));
    } else if (ruleOf(item) === "directive") {
      const name = valueOf(token(item)).slice(1);
      const operands = parts(item).filter((child) => ruleOf(child) === "directive-identifier" || ruleOf(child) === "directive-string" || ruleOf(child) === "directive-terminal" || ruleOf(child) === "directive-term");
      const problem = operandProblem(name, operands.map((child) => operandKind(child)));
      if (problem) fail(problem, item);
      const args = operands.map((child) => {
          if (ruleOf(child) === "directive-identifier") return valueOf(token(child));
          const part = /** @type {import("./types.js").TokenNode} */ (token(child));
          return decodeString(tokens[part.token], true);
        });
      const clause = one(item, "conditions-clause");
      const conditions = clause ? some(clause, "condition").map(condition => run(readImplication(condition))) : undefined;
      directives.push({
        name,
        args,
        at: at(item),
        ...(conditions ? { conditions } : {}),
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
    return hideAt({ name, entries: ofRule(node, "classifier-entry").map(readEntry), at: at(node) }, at(nameNode), "nameAt");
  }

  /**
   * An entry of a classifier: gates, canonical keys, `∈` or `∉`, and a class
   * (engine §2, §9).
   * @param {ResultNode} node
   * @returns {DomEntry}
   */
  function readEntry(node) {
    const gates = ofRule(node, "feature-gate").map(readGate);
    const keys = some(node, "classifier-key").map((keyNode) => run(readTerm(knownOf(keyNode, new Set(["string", "constant-reference"])))));
    const op = /** @type {"∈" | "∉"} */ (operator(token(only(node, "classifier-operator"))));
    const classNode = only(node, "classifier-class");
    const name = valueOf(token(classNode));
    return hideAt({ gates, keys, op, class: name, at: at(node) }, at(classNode), "classAt");
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
      const term = yield readTerm(side);
      if (term && typeof term === "object" && !Object.prototype.propertyIsEnumerable.call(term, "at")) hideAt(term, at(side));
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
    const keyword = valueOf(token(only(node, "constant-keyword")));
    const nameNode = only(node, "constant-name");
    const name = valueOf(token(nameNode)).slice(1);
    const valueNode = only(node, "term");
    const value = /** @type {Term} */ (yield readTerm(valueNode));
    const op = keyword === "%redefine-const" ? "redefine" : "define";
    return hideAt({ name, op, value, at: at(node) }, at(nameNode), "nameAt");
  }

  /**
   * @param {ResultNode} node
   * @returns {Generator<Step, DomRule, any>}
   */
  function* readRule(node) {
    const keyword = valueOf(token(only(node, "rule-keyword")));
    const headCall = one(node, "rule-name") ? undefined : one(node, "call");
    const head = headCall ? yield readCall(headCall) : null;
    const nameToken = headCall ? token(headCall) : token(only(node, "rule-name"));
    const allParams = head && head.args.every((/** @type {any} */ arg) => arg.param);
    /** @type {any} */
    const rule = {
      name: head ? head.call : valueOf(nameToken),
      ...(head ? (allParams ? { params: head.args.map((/** @type {any} */ arg) => arg.param) } : { args: head.args }) : {}),
      op: keyword === "%extend-rule" ? "extend" : keyword === "%redefine-rule" ? "redefine" : "define",
    };
    hideAt(rule, at(nameToken), "nameAt");
    if (allParams) hideAt(rule, head.args.map((/** @type {any} */ arg) => arg.at), "paramAts");
    if (parts(node).some(child => tokenValue(child) === "=")) {
      const instance = yield readCall(only(node, "call"));
      const bound = { ...rule, instance, conditions: [], at: at(node) };
      hideAt(bound, at(nameToken), "nameAt");
      if (head) hideAt(bound, /** @type {any} */ (true), "hasHead");
      return bound;
    }
    const tagsClause = one(node, "header-tags");
    const tags = tagsClause ? /** @type {Term} */ (yield readConstituentTags(tagsClause)) : undefined;
    const channels = yield readChannels(node);
    /** @type {DomAlternative[]} */
    const alternatives = [];
    const body = one(node, "body") || only(node, "headed-body");
    const ranked = one(body, "ranked-body");
    for (const alternative of ranked ? [ranked] : some(body, "alternative")) alternatives.push(yield readAlternative(alternative));
    // Each condition of the list is one condition, applying where its
    // captures are (engine §3.6).
    const conditionsClause = one(node, "conditions-clause");
    /** @type {Condition[]} */
    const conditions = [];
    if (conditionsClause) {
      for (const condition of some(conditionsClause, "condition")) conditions.push(yield readImplication(condition));
    }
    for (const kind of ["error", "warning"]) {
      const diagnostic = one(node, `${kind}-clause`);
      if (diagnostic) {
        const recipe = yield readRecipe(only(diagnostic, "recipe"));
        hideAt(recipe, at(diagnostic), "clauseAt");
        rule[kind] = recipe;
      }
    }
    const suppression = one(node, "suppress-warnings-clause");
    if (suppression) {
      rule.suppressWarnings = parts(suppression).some(child => tokenValue(child) === "_") ? ["_"]
        : some(suppression, "suppression-code").map(code => valueOf(token(code)));
    }
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
    return /** @type {DomRule} */ (rule);
  }

  /** @param {ResultNode} node @returns {any} */
  function readParameter(node) {
    const param = valueOf(token(node)).slice(1);
    return { param, at: at(node) };
  }

  /** @param {ResultNode} node @returns {Generator<Step, any, any>} */
  function* readCall(node) {
    const name = valueOf(token(node));
    const args = [];
    for (const argument of some(node, "call-argument")) {
      const part = knownOf(argument, new Set(["requirement-argument", "target-argument", "body-argument", "symbol-argument", "term"]));
      let value;
      if (ruleOf(part) === "requirement-argument") {
        value = { requirements: (yield readTest({ ...part, rule: "tag-test" })).requirements };
      } else if (ruleOf(part) === "target-argument") {
        const targets = [];
        for (const target of parts(part).filter(child => child.kind === "rule")) {
          if (ruleOf(target) === "rule-reference") targets.push(hideAt({ rule: valueOf(token(target)) }, at(target)));
          else if (ruleOf(target) === "tag") targets.push(hideAt({ terminal: tagOf(token(target)) }, at(target)));
          else targets.push(ruleOf(target) === "call" ? yield readCall(target) : readParameter(target));
        }
        value = { targets };
      } else if (["body-argument", "symbol-argument"].includes(ruleOf(part))) {
        const expr = yield readPrimary(knownOf(part, PRIMARIES), true);
        value = argumentOfExpression(expr);
      } else value = yield readTerm(part, true);
      if (value && typeof value === "object" && !value.at) hideAt(value, at(argument));
      args.push(value);
    }
    return { call: name, args, at: at(node) };
  }

  /** @param {ResultNode} node @returns {import("./types.js").Gate} */
  function readGate(node) {
    const spelled = valueOf(token(node));
    const found = /^(¬?)(?!.*--)([A-Za-z][A-Za-z0-9-]*)(\?)$/.exec(spelled);
    if (!found) fail("invalid feature guard", node);
    return hideAt({ feature: found[2], kind: /** @type {"gate"} */ ("gate"), negated: found[1] === "¬" }, at(node));
  }

  /**
   * @param {ResultNode} node
   * @returns {Generator<Step, DomAlternative, any>}
   */
  function* readAlternative(node) {
    const gates = ofRule(node, "feature-gate").map(readGate);
    /** @type {DomAlternative} */
    const alternative = { gates, expr: /** @type {Expr} */ (yield readExpression(only(node, ruleOf(node) === "ranked-body" ? "ranked-choice" : "some-of"), true)) };
    const tags = one(node, "alternative-tags");
    if (tags) alternative.tags = yield readConstituentTags(tags);
    Object.assign(alternative, yield readChannels(node));
    return hideAt(alternative, at(node));
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
        const found = some(node, "some-of");
        /** @type {Expr[]} */
        const items = [];
        for (const item of found) items.push(yield readExpression(item));
        return items.length === 1 ? items[0] : { choice: items, at: at(node) };
      }
      case "ranked-choice": {
        const found = some(node, "some-of", 2);
        /** @type {Expr[]} */
        const items = [];
        for (const item of found) items.push(yield readExpression(item));
        const separator = parts(node).find(child => child.kind === "token" && valueOf(child) === "≻");
        return { ranked: items, at: at(separator ?? node) };
      }
      case "some-of": {
        const found = some(node, "sequence");
        /** @type {Expr[]} */
        const items = [];
        for (const item of found) items.push(yield readExpression(item, whole && found.length === 1));
        return items.length === 1 ? items[0] : { and: items, at: at(node) };
      }
      case "sequence": {
        const found = some(node, "primary");
        /** @type {Expr[]} */
        const items = [];
        for (const item of found) items.push(yield readPrimary(knownOf(item, PRIMARIES), whole && found.length === 1));
        return items.length === 1 ? items[0] : { seq: items, at: at(node) };
      }
      default:
        return fail(`unexpected ${ruleOf(node)}`, node);
    }
  }

  /**
   * An optional, and with a marker `+` among its parts an elidable
   * one (engine §3.8, §9).
   * @param {RuleNode} node
   * @returns {Generator<Step, Expr, any>}
   */
  function* readOptional(node) {
    const captured = one(node, "captured-terminator");
    if (captured) return yield readCapturedOptional(node, captured);
    // Its required part first, then its markers (engine §9).
    const choice = only(node, "choice");
    const found = parts(node);
    const markers = found.filter((child) => tokenValue(child) === "+");
    if (markers.length >= 2) fail("an optional has one marker + at most", markers[1]);
    if (markers.length === 0) return { optional: yield readExpression(choice), at: at(node) };
    const conjunctions = ofRule(choice, "some-of");
    const leading = parts(choice).some((child) => tokenValue(child) === "|") ||
      (conjunctions.length === 1 && parts(conjunctions[0]).some((child) => tokenValue(child) === "&"));
    const sequences = conjunctions.length === 1 && !leading ? ofRule(conjunctions[0], "sequence") : [];
    const primary = sequences.length === 1 ? ofRule(sequences[0], "primary")[0] : undefined;
    const head = primary ? knownOf(primary, PRIMARIES) : undefined;
    const previousHead = defaultHead;
    const previousDefault = headDefault;
    defaultHead = head;
    headDefault = undefined;
    const expr = /** @type {Expr} */ (yield readExpression(choice));
    if (leading || "capture" in expr) hideAt(expr, /** @type {any} */ (true), "grouped");
    const result = { optional: expr, elidable: /** @type {true} */ (true), ...(headDefault === undefined ? {} : { default: headDefault }), at: at(node) };
    defaultHead = previousHead;
    headDefault = previousDefault;
    return result;
  }

  /** @param {ResultNode} optional @param {ResultNode} node @returns {Generator<Step,Expr,any>} */
  function* readCapturedOptional(optional, node) {
    const markers = [...parts(optional), ...parts(node)].filter(child => tokenValue(child) === "+").sort((a, b) => firstToken(a) - firstToken(b));
    if (markers.length > 1) fail("an optional has one marker + at most", markers[1]);
    if (!markers.length || one(optional, "choice")) fail("a captured elidable optional holds only its terminator", optional);
    const primary = only(node, "primary");
    const head = knownOf(primary, PRIMARIES);
    const previousHead = defaultHead, previousDefault = headDefault;
    defaultHead = head;
    headDefault = undefined;
    const expr = yield readPrimary(node);
    const result = { optional: expr, elidable: /** @type {true} */ (true), ...(headDefault === undefined ? {} : { default: headDefault }), at: at(optional) };
    defaultHead = previousHead;
    headDefault = previousDefault;
    return result;
  }

  /**
   * Braces: the item, its separator if a `/` has one, and a chain's
   * direction from its marker, a `...` among the parts (engine §9).
   * @param {RuleNode} node
   * @returns {Generator<Step, Expr, any>}
   */
  function* readRepetition(node) {
    const found = parts(node);
    const choices = some(node, "choice");
    const markers = found.flatMap((child, index) => (tokenValue(child) === "..." ? [index] : []));
    // Repeated markers fail before separator placement is inspected.
    // A sole marker after the separator fails at that marker (engine §9).
    if (markers.length >= 2) fail("braces have one chain marker ... at most", found[markers[1]]);
    const second = choices.length >= 2 ? found.indexOf(choices[1]) : found.length;
    if (markers.length === 1 && markers[0] > second) fail("a separator has no chain marker: ... stands after { or after the item", found[markers[0]]);
    const chain = markers.length === 0 ? null : markers[0] < found.indexOf(choices[0]) ? "left" : "right";
    /** @type {Record<string, any>} */
    const result = { repeat: yield readExpression(choices[0]) };
    if (choices.length >= 2) result.separator = yield readExpression(choices[1]);
    if (chain) result.chain = chain;
    return /** @type {Expr} */ ({ ...result, at: at(node) });
  }

  /**
   * @param {ResultNode} node
   * @param {boolean} [whole] whether a chain may stand here
   * @returns {Generator<Step, Expr, any>}
   */
  function* readPrimary(node, whole = false) {
    void whole;
    switch (ruleOf(node)) {
      case "splice": {
        const target = knownOf(node, new Set(["rule-reference", "call"]));
        return { splice: /** @type {any} */ (yield readPrimary(target)), at: at(node) };
      }
      case "call": return yield readCall(node);
      case "parameter": return readParameter(node);
      case "rule-reference": return { ref: valueOf(token(node)), at: at(node) };
      case "tag": return { ref: tagOf(token(node)), at: at(node) };
      case "string-terminal": return { literal: yield readTerm(knownOf(node, new Set(["string", "constant-reference"]))), at: at(node) };
      case "constant-reference": return { literal: /** @type {any} */ (yield readTerm(node)), at: at(node) };
      case "wildcard": token(node); return { wildcard: true, at: at(node) };
      case "range": return { range: yield readRange(node), at: at(node) };
      case "tested-primary": {
        const tests = parts(node).filter(child => ["tag-test", "value-test", "default-value"].includes(ruleOf(child)));
        if (!tests.length) lacks(node, "test");
        const symbol = testBase(node) || lacks(node, "primary");
        // Convert the base before test operands (engine §9.3).
        let expr = yield readPrimary(symbol);
        for (const test of tests) {
          if (ruleOf(test) === "default-value") {
            if (node !== defaultHead) fail("a default stands only on an elidable optional head", test);
            if (headDefault !== undefined) fail("an elidable head has one default at most", test);
            const operand = only(test, "test-operand");
            const inner = knownOf(operand, ATOMS);
            if (!["string", "constant-reference", "parameter"].includes(ruleOf(inner))) fail("a default requires one string", operand);
            headDefault = yield readTerm(inner);
            hideAt(/** @type {Term} */ (headDefault), at(test), "defaultAt");
          } else expr = { ...(yield readTest(test)), expr, at: at(test) };
        }
        return expr;
      }
      case "capture":
      case "captured-terminator": {
        const captureToken = token(node);
        const inner = only(node, "primary");
        const wrapped = knownOf(inner, PRIMARIES);
        const name = valueOf(captureToken).slice(1);
        const expr = /** @type {Expr} */ (yield readPrimary(wrapped));
        return { capture: name, expr, at: at(node) };
      }
      case "group": return hideAt(yield readExpression(only(node, "choice")), /** @type {any} */ (true), "grouped");
      case "optional": return yield readOptional(/** @type {RuleNode} */ (node));
      case "repetition": return yield readRepetition(/** @type {RuleNode} */ (node));
      case "empty": return { empty: true, at: at(node) };
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
      hideAt(item, at(node));
      return hideAt({ items: [item] }, at(node));
    }
    const items = [];
    for (const itemNode of itemNodes) {
      const targetNode = only(itemNode, "emit-target");
      const target = symbolPart(targetNode);
      const written = target.kind === "token" ? valueOf(target) : "";
      if (written !== "ε" && !written.startsWith("$")) fail("an emission target is a capture or ε", targetNode);
      /** @type {any} */
      const item = written === "ε" ? { insert: true } : { capture: written.slice(1) };
      const before = ofRule(itemNode, "attachment-before").flatMap(readAttachment);
      const after = ofRule(itemNode, "attachment-after").flatMap(readAttachment);
      const tags = one(itemNode, "emit-tags");
      if (tags) item.tags = yield readTagTerm(only(tags, "term"));
      Object.assign(item, yield readChannels(itemNode));
      if (before.length) item.before = before;
      if (after.length) item.after = after;
      items.push(hideAt(item, at(itemNode)));
    }
    return hideAt({ items }, at(node));
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
    for (const atom of some(node, "recipe-term")) {
      if (!Number.isSafeInteger(atom.span[0]) || !Number.isSafeInteger(atom.span[1]) || atom.span[0] < 0 || atom.span[1] < atom.span[0] || atom.span[1] > tokens.length) lacks(atom, "valid token span");
      if (concat.length) fail("juxtaposed recipe strings require ++. Use ++ between string atoms", atom);
      if (tokens.slice(atom.span[0], atom.span[1]).some(token => ["(", ")"].includes(token.value))) fail("a recipe atom has no grouping or arguments", atom);
      if (tokens.slice(atom.span[0], atom.span[1]).some(token => ["∪", "∩", "∖", "⟹"].includes(token.value))) fail("a recipe atom has no set operator", atom);
      recipeContext = true;
      const term = yield readTerm(only(atom, "term"));
      recipeContext = false;
      const items = "concat" in term ? term.concat : [term];
      if (items.some((/** @type {Term} */ item) => "union" in item)) fail("juxtaposed recipe strings require ++. Use ++ between string atoms", atom);
      for (const item of items) {
        if (!item.at) hideAt(item, at(atom));
        concat.push(item);
      }
    }
    return hideAt({ concat }, at(node));
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
  function* readTest(node, pattern = false) {
    if (ruleOf(node) === "tag-test") {
      const requirements = [];
      for (const requirement of ofRule(node, "tag-requirement")) {
        const operand = only(requirement, "test-operand");
        const inner = knownOf(operand, ATOMS);
        const value = pattern && ruleOf(inner) === "tag" && valueOf(token(inner)) === "_Elided" ? hideAt({ tag: "_Elided" }, at(token(inner))) : yield readTerm(inner);
        if (["term", "term-atom"].includes(ruleOf(inner))) {
          hideAt(value, /** @type {any} */ (true), "grouped");
          hideAt(value, at(operand));
        }
        requirements.push(hideAt({ negated: parts(requirement).some(child => tokenValue(child) === "¬"), value }, at(operand)));
      }
      return { test: "tags", requirements };
    }
    const comparator = operator(token(only(node, "value-comparator")));
    const operand = only(node, "test-operand");
    const inner = knownOf(operand, ATOMS);
    const value = yield readTerm(inner);
    if (["term", "term-atom"].includes(ruleOf(inner))) {
      hideAt(value, /** @type {any} */ (true), "grouped");
      hideAt(value, at(operand));
    }
    return { test: comparator, value };
  }

  /**
   * A constituent's tag term (engine §9).
   * @param {ResultNode} node
   * @returns {Generator<Step, Term, any>}
   */
  function* readConstituentTags(node) {
    const term = /** @type {Term} */ (yield readTagTerm(only(node, "term")));
    return hideAt(term, at(node), "clauseAt");
  }

  /**
   * @param {ResultNode} node
   * @returns {Generator<Step, Term, any>}
   */
  function* readTagTerm(node) {
    const term = /** @type {Term} */ (yield readTerm(node));
    return hideAt(term, at(node), "tagTermAt");
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
    const consequent = one(node, "condition");
    if (consequent) items.push(yield readImplication(consequent));
    let result = /** @type {Condition} */ (items.pop());
    while (items.length > 0) {
      const left = /** @type {Condition} */ (items.pop());
      result = hideAt({ if: left, then: result }, /** @type {any} */ (left).at ?? at(node));
    }
    return result;
  }

  /**
   * Conditions joined by ∨, each several joined by ∧; a parenthesized group
   * of the same connective is part of the one around it (engine §9).
   * @param {ResultNode} node
   * @returns {Generator<Step, Condition, any>}
   */
  function* readAnyOf(node) {
    /** @type {Condition[]} */
    const items = [];
    for (const allNode of some(node, "all-of")) {
      /** @type {Condition[]} */
      const all = [];
      for (const conditionNode of some(allNode, "condition-primary")) all.push(yield readCondition(conditionNode));
      items.push(all.length === 1 ? all[0] : hideAt({ all }, at(allNode)));
    }
    return items.length === 1 ? items[0] : hideAt({ any: items }, at(node));
  }

  /**
   * @param {ResultNode} node
   * @returns {Generator<Step, Condition, any>}
   */
  function* readCondition(node) {
    const inner = knownOf(node, CONDITIONS);
    switch (ruleOf(inner)) {
      case "condition":
        return yield readImplication(inner);
      case "presence":
        return hideAt({ captured: valueOf(token(inner)).slice(1) }, at(inner));
      case "tree-comparison": {
        const left = hideAt({ capture: valueOf(token(only(inner, "capture-reference"))).slice(1) }, at(only(inner, "capture-reference")));
        const op = /** @type {Comparator} */ (operator(token(only(inner, "tree-comparator"))));
        const rightNode = only(inner, "union");
        const leaf = firstOfRule(rightNode, "rule-or-classifier-name") ?? firstOfRule(rightNode, "tag");
        // A bare name gets this error before capital-initial tag typing.
        if (leaf && tokens.slice(rightNode.span[0], rightNode.span[1]).length === 1) {
          const name = valueOf(token(leaf));
          fail(`tree comparison requires a pattern; write #${name}, not ${name}`, leaf);
        }
        const right = /** @type {Term} */ (yield readTerm(rightNode));
        return hideAt({ op, left, right }, at(inner));
      }
      case "comparison": {
        const op = /** @type {Comparator} */ (operator(token(only(inner, "comparator"))));
        const [left, right] = some(inner, "union", 2);
        return hideAt({ op, left: /** @type {Term} */ (yield readTerm(left)), right: /** @type {Term} */ (yield readTerm(right)) }, at(inner));
      }
      case "negation":
        return hideAt({ not: yield readCondition(only(inner, "condition-primary")) }, at(inner));
      case "set-condition": {
        const operation = knownOf(inner, new Set(["union-operation", "intersection-operation", "set-atom"]));
        if (ruleOf(operation) === "set-atom") {
          const atom = parts(operation).find((child) => child.kind === "rule");
          if (!atom) return fail("a set atom", operation);
          return /** @type {Condition} */ (/** @type {unknown} */ (hideAt({ nonempty: yield readTerm(atom) }, at(inner))));
        }
        if (ruleOf(operation) === "intersection-operation") {
          /** @type {Term[]} */
          const items = [];
          for (const item of some(operation, "concatenation")) items.push(yield readTerm(item));
          if (items.length === 1) return /** @type {Condition} */ (/** @type {unknown} */ (hideAt({ nonempty: items[0] }, at(inner))));
          return /** @type {Condition} */ (/** @type {unknown} */ (hideAt({ nonempty: hideAt({ intersection: items }, at(operation)) }, at(inner))));
        }
        const found = some(operation, "intersection");
        const operators = parts(operation).flatMap((child) => {
          const written = tokenValue(child);
          return written === "∪" || written === "∖" ? [written] : [];
        });
        // A leading ∪ is a separator, not an operator.
        operators.splice(0, Math.max(0, operators.length - found.length + 1));
        /** @type {Term[]} */
        const items = [];
        for (const item of found) items.push(yield readTerm(item));
        /** @type {Term} */
        let result = items[0];
        let open = false;
        operators.forEach((operator, index) => {
          const next = items[index + 1];
          if (operator === "∖") {
            result = hideAt({ difference: [result, next] }, at(operation));
            open = false;
          } else if (open && "union" in result) {
            result.union.push(next);
          } else {
            result = hideAt({ union: [result, next] }, at(operation));
            open = true;
          }
        });
        return /** @type {Condition} */ (/** @type {unknown} */ (hideAt({ nonempty: result }, at(inner))));
      }
      case "method-chain": {
        const method = yield readMethod(inner);
        // A set-valued method in a Boolean position tests that its set is
        // not empty, through the wrapper of engine §9.2.
        if (["tags", "classes", "split", "ngrams", "classify"].includes(method.method)) return /** @type {Condition} */ (/** @type {unknown} */ (hideAt({ nonempty: method }, at(inner))));
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
      const guards = some(node, "any-of");
      /** @type {Condition[]} */
      const conditions = [];
      for (const guard of guards) conditions.push(yield readAnyOf(guard));
      const last = one(node, "union") || only(node, "term");
      /** @type {Term} */
      let guarded = yield readTerm(last);
      for (let index = conditions.length - 1; index >= 0; index--) guarded = hideAt({ if: conditions[index], then: guarded }, at(guards[index]));
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
      operators.splice(0, Math.max(0, operators.length - found.length + 1));
      /** @type {Term[]} */
      const items = [];
      for (const item of found) items.push(yield readTerm(item));
      if (operators.length < found.length - 1) lacks(node, "operator");
      /** @type {Term} */
      let result = items[0];
      let open = false;
      operators.forEach((operator, index) => {
        const next = items[index + 1];
        if (operator === "∖") {
          result = hideAt({ difference: [result, next] }, at(node));
          open = false;
        } else if (open && "union" in result) {
          result.union.push(next);
        } else {
          result = hideAt({ union: [result, next] }, at(node));
          open = true;
        }
      });
      return result;
    }
    if (ruleOf(node) === "concatenation") {
      const nodes = some(node, "term-atom");
      const items = [];
      for (const part of nodes) {
        items.push(yield readTerm(part, argument && nodes.length === 1));
      }
      if (nodes.length === 1) return items[0];
      return hideAt({ concat: items }, at(node));
    }
    if (ruleOf(node) === "intersection") {
      const found = some(node, "concatenation");
      /** @type {Term[]} */
      const items = [];
      for (const item of found) items.push(yield readTerm(item, argument && found.length === 1));
      if (items.length === 1) return items[0];
      return hideAt({ intersection: items }, at(node));
    }
    if (ruleOf(node) === "term-atom" || ruleOf(node) === "plain-term-atom" || ruleOf(node) === "test-operand") {
      const inner = knownOf(node, ATOMS);
      if (ruleOf(inner) === "method-chain") return yield readMethod(inner);
      return yield readTerm(inner, argument);
    }
    switch (ruleOf(node)) {
      case "call": return yield readCall(node);
      case "parameter": return readParameter(node);
      case "pattern-literal": {
        const pattern = yield readLayeredPattern(only(node, "pattern-primary"));
        if (!pattern.at) hideAt(pattern, at(node));
        return hideAt({ pattern }, at(node));
      }
      case "string": return hideAt(decode(token(node)), at(node));
      case "tag": return hideAt({ tag: tagOf(token(node)) }, at(node));
      case "string-run":
      case "tag-run": {
        if (recipeContext && ruleOf(node) === "string-run") fail("juxtaposed recipe strings require ++. Use ++ between string atoms", node);
        const start = node.span[0];
        const end = node.span[1];
        if (["∩", "∖"].includes(tokens[start - 1]?.value) || ["∩", "∖"].includes(tokens[end]?.value)) fail(`a ${ruleOf(node) === "string-run" ? "string" : "tag"} run beside intersection or difference requires parentheses`, node);
        const union = [];
        for (const tag of some(node, ruleOf(node) === "string-run" ? "string" : "tag", 2)) union.push(yield readTerm(tag));
        return hideAt({ union }, at(node));
      }
      case "range": return fail("a range is a terminal, not a term", node);
      case "rule-or-classifier-name": {
        // A bare name is a tag literal if it begins with a capital, and
        // otherwise a rule, which only a function's argument names.
        const name = valueOf(token(node));
        if (isCapital(name)) return hideAt({ tag: name }, at(node));
        if (argument) return /** @type {Term} */ (/** @type {unknown} */ (hideAt({ rule: name }, at(node))));
        return fail(`${name} names a rule, which is not a value`, node);
      }
      case "empty-set": return hideAt({ emptySet: true }, at(node));
      case "method-chain": return yield readMethod(node);
      case "constant-reference": {
        const name = valueOf(token(node)).slice(1);
        return { const: name, at: at(node) };
      }
      case "capture-reference": {
        const capture = valueOf(token(node)).slice(1);
        return hideAt({ capture }, at(node));
      }
      default: return fail(`unexpected ${ruleOf(node)}`, node);
    }
  }

  // Pattern constructors follow the layered syntax of engine section 9.
  /** @param {any[]} items @param {ResultNode} node @returns {any} */
  function childPredicate(items, node) {
    while (items.length === 1 && items[0].sequence) items = items[0].sequence;
    if (items.length !== 1 || !('child' in items[0])) fail("a pattern path or set requires one whole pattern", node);
    return items[0].child;
  }
  /** @param {ResultNode} node @returns {Generator<Step, any, any>} */
  function* readLayeredPattern(node) {
    const kind = ruleOf(node);
    if (kind === 'pattern-primary') {
      return yield readLayeredPattern(knownOf(node, new Set(['pattern-node', 'bare-child-list', 'pattern-union'])));
    }
    if (kind === 'pattern-node' || kind === 'bare-child-list') {
      const atom = kind === 'pattern-node' ? (yield readPattern(only(node, 'pattern-atom'))).node : { any: true };
      const list = one(node, 'child-list');
      const hasEnumerableAt = Object.prototype.propertyIsEnumerable.call(atom, 'at');
      const { at: position, ...fields } = atom;
      const exact = parts(node).some(part => tokenValue(part) === '·');
      const built = { ...fields, ...(exact ? { exact: true } : {}), ...(list ? { children: yield readLayeredPattern(list) } : {}), ...(hasEnumerableAt && position ? { at: position } : {}) };
      if (!hasEnumerableAt) hideAt(built, position ?? at(node));
      if (list) hideAt(built, at(list), 'listAt');
      return built;
    }
    if (kind === 'pattern-union' || kind === 'pattern-intersection' || kind === 'child-set-operation' || kind === 'child-intersection') {
      /** @type {ResultNode[]} */
      let operands;
      if (kind === 'pattern-union') operands = some(node, 'pattern-intersection');
      else if (kind === 'pattern-intersection') operands = some(node, 'pattern-path');
      else if (kind === 'child-intersection') operands = some(node, 'child-path');
      else operands = parts(node).filter(part => ['child-intersection', 'child-path'].includes(ruleOf(part)));
      if (!operands.length) return lacks(node, 'pattern operands');
      const values = [];
      for (const operand of operands) {
        const value = yield readLayeredPattern(operand);
        values.push(ruleOf(operand) === 'child-path' ? childPredicate(value, operand) : value);
      }
      const operators = parts(node).filter(part => part.kind === 'token').map(valueOf).filter(op => op === '∪' || op === '∖' || kind !== 'pattern-union' && op === '∩');
      if (['pattern-union', 'child-set-operation'].includes(kind)) {
        if (operators.length < Math.max(kind === 'child-set-operation' ? 1 : 0, values.length - 1)) return lacks(node, 'operator');
      }
      let result = values[0];
      for (let index = 1; index < values.length; index++) {
        const key = kind.endsWith('intersection') || operators[index - 1] === '∩' ? 'intersection' : operators[index - 1] === '∖' ? 'difference' : 'union';
        result = hideAt({ [key]: [result, values[index]] }, at(node));
      }
      return result;
    }
    if (kind === 'pattern-path' || kind === 'child-path') {
      const primary = only(node, kind === 'pattern-path' ? 'pattern-primary' : 'child-primary');
      const value = yield readLayeredPattern(primary);
      const axis = parts(node).find(part => part.kind === 'token');
      if (!axis) return value;
      const op = valueOf(axis);
      if (!['⋮', '⋱', '⋰'].includes(op)) fail('a malformed pattern path', axis);
      const pattern = kind === 'child-path' ? childPredicate(value, primary) : value;
      const result = hideAt({ path: op === '⋮' ? 'descendant' : op === '⋱' ? 'last' : 'first', pattern }, at(node));
      return kind === 'child-path' ? [hideAt({ child: result }, at(node))] : result;
    }
    if (kind === 'child-list') {
      const choice = one(node, 'child-choice');
      return choice ? yield readLayeredPattern(choice) : [];
    }
    if (kind === 'child-choice') {
      const arms = [];
      for (const alternative of some(node, 'child-alternative')) {
        const items = yield readLayeredPattern(alternative);
        arms.push(items);
      }
      return arms.length === 1 ? arms[0] : [hideAt({ choice: arms }, at(node))];
    }
    if (kind === 'child-alternative') {
      const sequence = one(node, 'child-sequence');
      return sequence ? yield readLayeredPattern(sequence) : [hideAt({ child: yield readLayeredPattern(only(node, 'child-set-operation')) }, at(node))];
    }
    if (kind === 'child-sequence') {
      const result = [];
      for (const item of some(node, 'child-item')) result.push({ sequence: yield readLayeredPattern(item) });
      return [{ sequence: result }];
    }
    if (kind === 'child-item') {
      const child = parts(node)[0];
      if (!child) return lacks(node, 'child item');
      return tokenValue(child) === '⋯' ? [hideAt({ siblings: true }, at(node))] : yield readLayeredPattern(child);
    }
    if (kind === 'child-primary') {
      const choice = one(node, 'child-choice');
      return choice ? yield readLayeredPattern(choice) : [hideAt({ child: yield readLayeredPattern(knownOf(node, new Set(['pattern-node', 'bare-child-list']))) }, at(node))];
    }
    if (kind === 'child-optional') return [hideAt({ optional: yield readLayeredPattern(only(node, 'child-choice')) }, at(node))];
    if (kind === 'child-repetition') {
      const choices = some(node, 'child-choice');
      const repeat = yield readLayeredPattern(choices[0]);
      return [hideAt({ repeat, ...(choices.length >= 2 ? { separator: yield readLayeredPattern(choices[1]) } : {}) }, at(node))];
    }
    return fail(`unexpected ${kind} in layered pattern`, node);
  }

  /** @param {ResultNode} node @returns {Generator<Step, any, any>} */
  function* readPattern(node) {
    const kind = ruleOf(node);
    if (kind === "pattern-atom") {
      const inner = parts(node);
      const defaultNode = inner.find(child => ruleOf(child) === "default-value");
      if (defaultNode) fail("a default stands only on an elidable optional head", defaultNode);
      const first = inner[0];
      if (!first) return lacks(node, "pattern atom");
      const named = ["rule-or-classifier-name", "rule-reference"].includes(ruleOf(first)) ||
        first.kind === "token" && ["Lowercase-Name", "Emoji-Name"].includes(first.terminal);
      const tests = inner.filter(child => ["tag-test", "value-test"].includes(ruleOf(child)));
      const testsOnly = ["tag-test", "value-test"].includes(ruleOf(first));
      checkTestOrder(tests, true);
      if (testsOnly) fail("a pattern test requires an atom", first);
      if (["call", "parameter"].includes(ruleOf(first))) {
        let expr = ruleOf(first) === "call" ? yield readCall(first) : readParameter(first);
        for (const test of tests) expr = hideAt({ ...(yield readTest(test, true)), expr }, at(test));
        return { node: expr };
      }
      if (named) {
        const nameToken = first.kind === "token" ? first : token(first);
        const name = valueOf(nameToken);
        let expr = { name, at: at(nameToken) };
        for (const test of tests) expr = hideAt({ ...(yield readTest(test, true)), expr }, at(test));
        return { node: expr };
      }
      let expr;
      if (first.kind === "token") {
        const name = valueOf(first);
        if (isCapital(name) || name.startsWith("_")) expr = { terminal: tagOf(first), at: at(first) };
        else expr = { name, at: at(first) };
      } else if (ruleOf(first) === "tag") expr = { terminal: tagOf(token(first)), at: at(first) };
      else if (ruleOf(first) === "string") expr = { literal: decode(token(first)), at: at(first) };
      else if (ruleOf(first) === "string-terminal") expr = { literal: yield readTerm(knownOf(first, new Set(["string", "constant-reference"]))), at: at(first) };
      else if (ruleOf(first) === "range") expr = { range: yield readRange(first), at: at(first) };
      else if (ruleOf(first) === "wildcard") { token(first); expr = { wildcard: true, at: at(first) }; }
      else if (ruleOf(first) === "constant-reference") {
        const value = yield readTerm(first);
        expr = { constant: value.const, at: at(first) };
      } else return lacks(node, "pattern atom");
      if (expr.literal?.const) { expr.constant = expr.literal.const; delete expr.literal; }
      for (const test of tests) expr = hideAt({ ...(yield readTest(test, true)), expr }, at(test));
      return { node: expr };
    }
    return fail(`unexpected ${kind} in pattern`, node);
  }

  /**
   * @param {ResultNode} node
   * @returns {Generator<Step, {method: string, receiver:Term, args: Argument[]}, any>}
   */
  function* readMethod(node) {
    let receiver = yield readTerm(only(only(node, "method-receiver"), "plain-term-atom"), true);
    for (const selector of some(node, "method-selector")) {
      const parsed = one(selector, "parse-selector");
      const name = parsed ? "parse" : valueOf(token(only(selector, "method-name")));
      /** @type {any[]} */
      const args = [];
      const argumentsNode = one(selector, "method-arguments");
      if (parsed) {
        const argument = only(parsed, "parse-argument");
        let body = yield readExpression(only(argument, "choice"));
        const markers = parts(argument).filter(child => child.kind === "token" && valueOf(child) === "…");
        if (markers.length) {
          const sequence = [];
          for (const child of parts(argument)) {
            if (child.kind === "token" && valueOf(child) === "…") sequence.push(hideAt({ remainder: true }, at(child)));
            else if (ruleOf(child) === "choice") sequence.push(body);
          }
          if (!sequence.some(part => part === body)) sequence.push(body);
          body = { seq: sequence, at: at(argument) };
        }
        args.push(hideAt({ body }, at(argument)));
      }
      if (argumentsNode) for (const argument of some(argumentsNode, "method-argument")) {
        const integer = one(argument, "integer");
        if (integer) {
          const digits = valueOf(token(integer));
          args.push(hideAt({ integer: digits }, at(integer)));
        } else {
          const term = yield readTerm(only(argument, "term"), true);
          args.push(term && typeof term === "object" && term.at && !term.rule ? term : hideAt(term, at(argument)));
        }
      }
      if (argumentsNode) {
        const separators = parts(argumentsNode).filter(child => child.kind === "token").map(valueOf);
        if (separators.some(separator => separator !== (TARGET_METHODS.has(name) ? "|" : ","))) fail("invalid method argument separator", argumentsNode);
      }
      if (name === "classify" && args.length === 1 && args[0].rule && CLASSIFIER_NAME.test(args[0].rule)) args[0] = hideAt({ classifier: args[0].rule }, args[0].at);
      if (TARGET_METHODS.has(name)) {
        for (let index = 0; index < args.length; index++) if (args[index].tag && !args[index].tag.startsWith("_")) args[index] = hideAt({ terminal: args[index].tag }, args[index].at);
      }
      receiver = hideAt({ method: name, receiver, args }, at(node));
    }
    return receiver;
  }

  /** @param {ResultNode} tokenNode @returns {any} */
  function decode(tokenNode) {
    const part = /** @type {import("./types.js").TokenNode} */ (tokenNode);
    return { string: decodeString(tokens[part.token], false) };
  }

  /** @param {ResultNode} tokenNode @returns {string} */
  function tagOf(tokenNode) {
    const name = valueOf(tokenNode);
    if (name.startsWith("_")) {
      const canonical = unicode.canonicalTag(name);
      if (!canonical) fail(`unknown engine tag ${name}; every _ tag is a Unicode property`, tokenNode);
      return canonical;
    }
    return name;
  }

  /** @param {ResultNode} node @returns {Generator<Step, any, any>} */
  function* readRange(node) {
    const found = parts(node).filter(child => ["string", "constant-reference", "parameter"].includes(ruleOf(child)));
    if (found.length < 2) lacks(node, "two string operands");
    const range = [];
    for (const end of found.slice(0, 2)) range.push(yield readTerm(end));
    return range;
  }

  /**
   * The kind of a directive's operand (engine §9).
   * @param {ResultNode} node
   * @returns {OperandKind}
   */
  function operandKind(node) {
    if (ruleOf(node) === "directive-string") return "string";
    if (ruleOf(node) === "directive-identifier") return isCapital(valueOf(token(node))) ? "class" : "name";
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
  // Source-only sequence wrappers retain grouped child arrays until this walk.
  /** @param {any[]} items @returns {any[]} */
  const gatherItems = items => {
    const joined = [];
    const pending = items.slice().reverse();
    while (pending.length) {
      if (hooks.work) countWork(hooks.work, "walkSteps");
      const item = pending.pop();
      if (Array.isArray(item.sequence) && item.sequence.length) for (let index = item.sequence.length - 1; index >= 0; index--) pending.push(item.sequence[index]);
      else joined.push(item);
    }
    return joined;
  };
  /** @type {unknown[]} */
  const stack = [{value:root,pattern:false}];
  while (stack.length > 0) {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    const {value:current,pattern} = /** @type {{value:unknown,pattern:boolean}} */ (stack.pop());
    if (Array.isArray(current)) {
      for (const item of current) stack.push({value:item,pattern});
      continue;
    }
    if (current === null || typeof current !== "object") continue;
    const node = /** @type {Record<string, unknown>} */ (current);
    if (pattern) {
      for (const key of ["children", "optional", "repeat", "separator"]) if (Array.isArray(node[key])) node[key] = gatherItems(node[key]);
      if (Array.isArray(node.choice)) {
        const arms = [];
        const pending = node.choice.slice().reverse();
        while (pending.length) {
          const arm = gatherItems(/** @type {any[]} */ (pending.pop()));
          if (arm.length === 1 && arm[0].choice) {
            for (let index = arm[0].choice.length - 1; index >= 0; index--) pending.push(arm[0].choice[index]);
          } else arms.push(arm);
        }
        node.choice = arms;
      }
    }
    for (const key of ["any", "all", "union", "concat", ...(pattern ? ["intersection"] : [])]) {
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
    for (const [key,value] of Object.entries(node)) if (value !== null && typeof value === "object") {
      // Test and call operands leave the pattern context.
      const childPattern = key === "pattern" || pattern && !["literal", "range", "value", "requirements", "args"].includes(key);
      stack.push({value,pattern:childPattern});
    }
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
 * @typedef {"name" | "class" | "string" | "tag"} OperandKind
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
  if (name === "include" || name === "names") return kinds.length === 1 && kinds[0] === "string" ? null : `%${name} takes one string`;
  if (name === "features") return kinds.length > 0 && names ? null : "%features takes one or more names";
  if (name === "elision-only") return kinds.length === 0 ? null : "%elision-only takes no operand";
  return names ? null : `%${name} takes names only`;
}

// What a primary, a condition, a term and a term atom hold: the one rule
// among their parts is one of these (engine §9).
const PRIMARIES = new Set(["captured-terminator","splice", "constant-reference", "call", "parameter", "rule-reference", "tag", "string-terminal", "wildcard", "range", "tested-primary", "capture", "group", "optional", "repetition", "empty"]);
const CONDITIONS = new Set(["tree-comparison", "comparison", "method-chain", "negation", "presence", "condition", "set-condition"]);
const TERMS = new Set(["union", "guarded-term"]);
const ATOMS = new Set(["call", "parameter", "pattern-literal", "string", "tag", "tag-run", "string-run", "range", "rule-or-classifier-name", "empty-set", "term", "guarded-term", "union", "term-atom", "plain-term-atom", "method-chain", "capture-reference", "constant-reference"]);
const ITEMS = new Set(["directive", "ranking-directive", "rule", "constant-definition", "classifier", "implication-declaration"]);
const NAMED = new Set([
  "call-argument", "requirement-argument", "target-argument", "body-argument", "symbol-argument",
  ...ITEMS, ...PRIMARIES, ...CONDITIONS, ...TERMS, ...ATOMS,
  "directive-identifier", "directive-string", "directive-terminal", "directive-term", "classifier-name", "classifier-class", "classifier-key", "classifier-operator", "classifier-entry",
  "constant-keyword", "constant-name", "rule-keyword", "rule-name", "ranking-directive", "ranking-step", "body", "headed-body", "alternative", "ranked-body", "feature-gate", "ranked-choice", "choice", "some-of", "sequence", "primary",
  "tag-test", "tag-requirement", "value-test", "default-value", "value-comparator", "test-operand", "header-tags", "alternative-tags", "emit-tags", "value-clause", "image-clause", "conditions-clause", "error-clause", "warning-clause", "suppress-warnings-clause", "suppression-code", "emits-clause", "erased-clause",
  "emit-item", "emit-target", "attachment-before", "attachment-after", "recipe", "recipe-term", "method-receiver", "method-selector", "parse-selector", "parse-argument", "method-name", "method-arguments", "method-argument", "integer", "intersection", "concatenation", "any-of", "all-of", "condition-primary", "comparator", "tree-comparator", "union-operation", "intersection-operation", "set-atom",
  "pattern-primary", "pattern-node", "bare-child-list", "child-list", "child-choice", "child-alternative", "child-set-operation", "child-intersection", "child-sequence", "child-item", "child-path", "child-primary",
  "pattern-literal", "pattern-union", "pattern-intersection", "pattern-atom", "child-optional", "child-repetition", "pattern-path",
]);

/**
 * @param {ResultNode} node
 * @returns {number}
 */
function firstToken(node) {
  const pending = [node];
  while (pending.length) {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    const current = /** @type {ResultNode} */ (pending.pop());
    if (current.kind === "token") return current.token;
    if (current.kind === "rule") for (let index = current.children.length - 1; index >= 0; index--) pending.push(current.children[index]);
  }
  return node.span[0];
}
