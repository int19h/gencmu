import { GencmuError } from "../errors.js";
import { KEY_STEPS, validSteps } from "../dom.js";
import { recordKind50 } from "./records.js";
import { methods50 } from "./signatures.js";
import { run } from "../trampoline.js";
import { BEFORE, FAULT, captureTargetFault50, documentFault50, elidableForm50, faulty, isBodySymbol50, validateDeclarationShape50,
  validateDocumentDefinitions50, validateDocumentDepth50, validateSubsetSize50 } from "./validate.js";

const EXPRESSION_WRAPPERS = new Set([
  "expr", "disj", "conj", "comparison", "union", "inter", "sum", "post", "atom", "grouped-expr",
]);
const BODY_WRAPPERS = new Set([
  "factor", "untested-factor", "splice-target", "chain-separator", "body-argument",
  "symbol-argument", "group", "choice", "some-of", "sequence",
]);
const PATTERN_WRAPPERS = new Set([
  "pattern-literal", "pattern-primary", "pattern-union", "pattern-intersection", "pattern-path",
]);
const RULE_NAME = /^[a-z][A-Za-z0-9_-]*$/;
const FEATURE_NAME50 = /^[a-zA-Z][a-zA-Z0-9-]*$/;
const OPS = new Map([
  ["≠", "≠"], ["∉", "∉"], ["⊈", "⊈"], ["≇", "≇"],
]);
/** @param {any} keyword */
const operation = keyword => keyword.startsWith("%redefine-") ? "redefine" :
  keyword.startsWith("%extend-") ? "extend" : "define";
/** @param {any} node */
const rules = node => node.children.filter((/** @type {any} */ child) => child.kind === "rule");
/**
 * @param {any} node
 * @param {any} name
 */
const parts = (node, name) => rules(node).filter((/** @type {any} */ child) => child.rule === name);
/**
 * @param {any} node
 * @param {any} name
 */
const part = (node, name) => parts(node, name)[0];
// A token of the format 50 reader holds its keys in props, and a token of
// the transition compiler, which reads with format 49, holds them in tags.
/** @param {any} token @param {string} key */
const tokenHas = (token, key) => (token.props ?? token.tags).has(key);
/** @param {any} node */
const leaves = node => node.children.filter((/** @type {any} */ child) => child.kind === "token");
/**
 * @param {any} kind
 * @param {any} items
 */
const collapse = (kind, items) => items.length === 1 ? items[0] : { [kind]: items };
const GROUPS = new Set(["group", "optional", "repetition", "empty"]);
/** @param {any} node */
function baseFactor(node) {
  while (["factor", "tested-factor", "untested-factor", "symbol-argument"].includes(node.rule)) node = rules(node)[0];
  return node;
}

/** @typedef {import("../trampoline.js").Step} Step */

// An explicit stack, since a tree can nest deeper than the call stack.
/** @param {any} node */
function containsCapture(node) {
  const pending = [node];
  while (pending.length) {
    const next = pending.pop();
    if (["capture", "captured-terminator"].includes(next.rule)) return true;
    for (const child of rules(next)) pending.push(child);
  }
  return false;
}

// Conversion yields one record at a time in written order, with the
// conversion faults that wait in it. A failed shape check exposes the prefix
// through that declaration to the test observer. A declaration that
// conversion could not finish exposes no prefix.
/**
 * @param {any} declarations
 * @param {any} configuration
 * @param {any} storeDom
 */
export function inspectConverted50(declarations, configuration, storeDom) {
  /** @type {any} */
  const dom = { format: 50, rules: [], directives: [], constants: [] };
  const fail = documentFault50(configuration.document);
  /** @type {any[]} */
  const emptyDelimiters = [];
  let preamble = true;
  for (const [category, record, faults = []] of declarations) {
    dom[category].push(record);
    const names = category === "directives" && record.name === "names";
    try {
      if (names && !preamble) fail(record, "%names must precede all other declarations");
      validateDeclarationShape50(category, record, fail, configuration.unicode, emptyDelimiters);
      // The shape walk reaches every fault that waits in the record. This
      // keeps a fault that a converted parent dropped from passing.
      if (faults.length) throw faults[0];
    } catch (error) {
      if (!faults.length) storeDom?.(dom, "prefix");
      throw error;
    }
    preamble &&= names;
  }
  storeDom?.(dom, "complete");
  if (emptyDelimiters.length) fail(emptyDelimiters[0], "a split delimiter cannot be empty");
  validateDocumentDefinitions50(dom, configuration);
  validateDocumentDepth50(dom, configuration);
  return dom;
}

export class DomBuilder {
  /**
   * @param {any} tokens
   * @param {any} position
   * @param {any} document
   * @param {any} unicode
   * @param {any} strings
   */
  constructor(tokens, position, document, unicode, strings) {
    this.tokens = tokens;
    this.position = position;
    this.document = document;
    this.unicode = unicode;
    this.strings = strings;
    this.domFault = documentFault50(document);
    /** @type {WeakMap<object, any> | undefined} the default of each elided head */
    this.defaults = undefined;
    /** @type {GencmuError[]} the conversion faults of the current declaration */
    this.faults = [];
  }

  /** @param {any} node */
  token(node) {
    return this.tokens[node.span[0]];
  }

  /** @param {any} node */
  at(node) {
    return this.position(this.token(node)?.source[0]);
  }

  /** @param {any} node */
  value(node) {
    const value = this.token(node).value;
    return OPS.get(value) ?? value;
  }

  /**
   * @param {any} node
   * @param {any} description
   */
  fail(node, description) {
    throw this.error(node, description);
  }

  /**
   * @param {any} node
   * @param {any} description
   */
  error(node, description) {
    const [line, column] = this.at(node);
    return new GencmuError("grammar", description, { document: this.document, line, column });
  }

  // A conversion fault waits in the record tree in place of the record that
  // it stops, so that the shape walk reports it in the order of engine §9.3.
  // The operands in `before` precede the fault in that order.
  /**
   * @param {Step} step
   * @param {[any, string][]} [before]
   * @returns {Step}
   */
  *deferred(step, before) {
    try {
      return yield step;
    } catch (error) {
      if (!(error instanceof GencmuError)) throw error;
      this.faults.push(error);
      return this.waiting(error, before);
    }
  }

  // A fault that waits at a place of the record tree, such as the target of a
  // capture.
  /**
   * @param {any} node
   * @param {any} description
   */
  waitingFault(node, description) {
    const error = this.error(node, description);
    this.faults.push(error);
    return this.waiting(error);
  }

  /**
   * @param {GencmuError} error
   * @param {[any, string][]} [before]
   */
  waiting(error, before = []) {
    return { [FAULT]: error, [BEFORE]: before.filter(([node]) => node !== undefined) };
  }

  // Converts each item in order.
  /**
   * @param {any[]} items
   * @param {(item: any, index: number) => Step} convert
   * @returns {Step}
   */
  *each(items, convert) {
    const results = [];
    for (const [index, item] of items.entries()) results.push(yield convert(item, index));
    return results;
  }

  /**
   * @param {any} tree
   * @param {any} [storeDom]
   */
  build(tree, storeDom) {
    return inspectConverted50(this.declarations(tree), { document: this.document, unicode: this.unicode }, storeDom);
  }

  // Each declaration converts on the trampoline, so the nesting of a
  // document cannot exhaust the call stack.
  /** @param {any} tree */
  *declarations(tree) {
    let preamble = true;
    for (const statement of parts(tree, "statement")) {
      const node = rules(statement)[0];
      this.faults = [];
      const names = node.rule === "directive" && this.value(node) === "%names";
      const misplaced = names && !preamble;
      preamble &&= names;
      let category, record;
      switch (node.rule) {
        case "rule":
          category = "rules";
          record = run(this.rule(node));
          break;
        case "constant-definition":
          {
            const name = this.value(part(node, "constant-name")).slice(1);
            if (name === "INPUTS") this.fail(node, "$INPUTS is supplied by the engine");
            category = "constants";
            record = { name, op: operation(this.value(node)), value: run(this.expression(part(node, "expr"))), at: this.at(node) };
          }
          break;
        case "directive":
          category = "directives";
          record = run(misplaced ? this.misplacedNames(node) : this.directive(node));
          break;
        case "ranking-directive":
          category = "directives";
          record = run(this.ranking(node));
          break;
        default:
          this.fail(node, "expected a declaration");
      }
      yield [category, record, this.faults];
    }
  }

  // A misplaced %names fails at its placement before its operands (engine
  // §9.3). Where its operands convert, the record goes to the shape check,
  // which reports the placement with the prefix that holds the record.
  /**
   * @param {any} node
   * @returns {Step}
   */
  *misplacedNames(node) {
    const record = yield this.deferred(this.directive(node));
    if (faulty(record)) this.fail(node, "%names must precede all other declarations");
    return record;
  }

  /**
   * @param {any} node
   * @returns {Step}
   */
  *directive(node) {
    const name = this.value(node).slice(1);
    const operands = parts(node, "directive-argument").map((/** @type {any} */ argument) => rules(argument)[0]);
    const clauses = part(node, "conditions-clause");
    let args;
    if (name === "include" || name === "names") {
      if (clauses || operands.length !== 1 || tokenHas(this.token(operands[0]), "Resource-Path") === false) {
        this.fail(node, `%${name} takes one quoted path`);
      }
      args = [this.strings.decode(this.token(operands[0]), true)];
    } else if (name === "features") {
      if (!operands.length || operands.some((/** @type {any} */ operand) =>
        operand.rule !== "directive-identifier" || !FEATURE_NAME50.test(this.value(operand)))) {
        this.fail(node, "%features takes feature names");
      }
      args = operands.map((/** @type {any} */ operand) => this.value(operand));
    } else if (name === "elision-only") {
      if (clauses || operands.length) this.fail(node, "%elision-only takes no operands");
      args = [];
    } else {
      if (clauses || operands.length !== 1 || operands[0].rule !== "directive-identifier" ||
          !RULE_NAME.test(this.value(operands[0]))) this.fail(node, `%${name} takes one stage name`);
      args = [this.value(operands[0])];
    }
    const at = this.at(node);
    return { name, args, at, ...(clauses && { conditions: yield this.conditions(clauses) }) };
  }

  /**
   * @param {any} node
   * @returns {Step}
   */
  *ranking(node) {
    const steps = [];
    for (const stepNode of parts(node, "ranking-step")) {
      const step = this.value(stepNode);
      const patternNode = rules(stepNode)[0];
      if (Boolean(patternNode) !== KEY_STEPS.has(step)) this.fail(node, "invalid resolution step operand");
      if (!patternNode) {
        steps.push({ step });
        continue;
      }
      const pattern = yield patternNode.rule === "constant-reference" ?
        this.expression(patternNode) : this.pattern(patternNode);
      steps.push({ step, pattern });
    }
    if (!validSteps(steps)) this.fail(node, "invalid resolution policy");
    return { name: "ambiguity-resolution", steps, at: this.at(node) };
  }

  /**
   * @param {any} node
   * @returns {Step}
   */
  *rule(node) {
    const op = operation(this.value(node));
    const plain = part(node, "rule-name");
    const call = part(node, "call");
    const head = plain ?? call;
    const name = this.value(head);
    const at = this.at(node);
    if (plain && !RULE_NAME.test(name) && !this.unicode.isEmojiName(name)) {
      this.domFault({ at }, "a rule name must begin with a lowercase letter or be an emoji name");
    }
    if (leaves(node).some((/** @type {any} */ token) => this.value(token) === "=")) {
      if (!plain) this.fail(head, "an instance binding needs a plain rule name");
      if (op === "extend") this.fail(node, "an instance binding cannot extend a rule");
      return { name, op, instance: yield this.call(call), conditions: [], at };
    }
    /** @type {{params?: any[], args?: any[]}} */
    let category = {};
    if (!plain) {
      const { args } = yield this.call(head);
      if (args.every((/** @type {any} */ arg) => Object.hasOwn(arg, "param"))) {
        /** @type {any[]} */
        const params = [];
        for (const arg of args) {
          if (params.includes(arg.param)) this.domFault({ at }, `duplicate parameter @${arg.param}`);
          params.push(arg.param);
        }
        category = { params };
      } else {
        if (op === "define" || args.some((/** @type {any} */ arg) => Object.hasOwn(arg, "param"))) {
          this.domFault({ at }, "a rule head needs all parameters or an exact instance edit");
        }
        category = { args };
      }
    }
    const termNode = part(node, "statement-term");
    const term = termNode && (yield this.expression(part(termNode, "bag")));
    const body = rules(part(node, "body") ?? part(node, "headed-body"))[0];
    const owner = { at };
    const alternatives = body.rule === "ranked-body" ? [yield this.alternative(body, "ranked-choice", owner)] :
      yield this.each(rules(body), (/** @type {any} */ alt) => this.alternative(alt, "some-of", owner));
    const conditions = yield this.conditions(part(node, "conditions-clause"));
    const diagnostic = part(node, "diagnostic-clause");
    const diagnosticNode = diagnostic && rules(diagnostic)[0];
    if (diagnostic && category.params) this.domFault({ at }, "a template cannot declare an error or warning");
    const key = diagnosticNode?.rule.split("-")[0];
    const message = diagnosticNode && (yield this.expression(part(diagnosticNode, "expr")));
    const suppression = part(node, "suppress-warnings-clause");
    const suppressWarnings = suppression && (parts(suppression, "suppression-code").length ?
      parts(suppression, "suppression-code").map((/** @type {any} */ code) => {
        const name = this.value(code);
        if (!FEATURE_NAME50.test(name)) this.domFault({ at }, "invalid warning code");
        return name;
      }) : ["_"]);
    const output = part(node, "output-clause");
    const outputNode = output && rules(output)[0];
    const erased = outputNode?.rule === "erased-clause";
    const emit = outputNode && !erased &&
      { items: yield this.each(parts(outputNode, "output"), (/** @type {any} */ item) => this.entry(item)) };
    return { name, ...category, op, ...(term && { term }), alternatives, ...(emit && { emit }), conditions,
      ...(key && { [key]: message }), ...(suppressWarnings && { suppressWarnings }), ...(erased && { erased }), at };
  }

  /**
   * @param {any} node
   * @returns {Step}
   */
  *conditions(node) {
    return node ? yield this.each(parts(node, "expr"), (/** @type {any} */ item) => this.expression(item)) : [];
  }

  /**
   * @param {any} node
   * @param {any} kind
   * @param {any} owner
   * @returns {Step}
   */
  *alternative(node, kind, owner) {
    const gates = parts(node, "feature-gate").map((/** @type {any} */ gate) => this.gate(gate));
    const source = part(node, kind);
    const expr = yield this.ownedBody(source, owner, true);
    const term = part(node, "alternative-term");
    return { gates, expr, ...(term && { term: yield this.expression(part(term, "bag")) }) };
  }

  /** @param {any} node */
  name(node) {
    const name = this.value(node);
    if (!name.startsWith("_")) return name;
    if (name === "_Elided") return name;
    const canonical = this.unicode.canonicalTag(name);
    if (!canonical || canonical === "_Elided") this.fail(node, `unknown or forbidden engine key ${name}`);
    return canonical;
  }

  /** @param {any} node */
  binder(node) {
    return this.value(node).slice(1);
  }

  /** @param {any} node */
  gate(node) {
    const negated = this.value(node) === "¬";
    const feature = this.value(leaves(node)[Number(negated)]);
    return { feature, kind: "gate", negated };
  }

  /**
   * @param {any} node
   * @param {any} owner
   * @returns {Step}
   */
  *ownedBody(node, owner, whole = false) {
    /** @type {any} */
    const previous = this.bodyOwner;
    this.bodyOwner = owner;
    try {
      return yield this.body(node, whole);
    } finally {
      this.bodyOwner = previous;
    }
  }

  /**
   * @param {any} node
   * @returns {Step}
   */
  body(node, whole = false, elidable = false) {
    return this.deferred(this.bodyRecord(node, whole, elidable));
  }

  /**
   * @param {any} node
   * @returns {Step}
   */
  *bodyRecord(node, whole = false, elidable = false) {
    let children = rules(node);
    let optionals = 0;
    let grouped = false;
    while (children.length === 1 && (BODY_WRAPPERS.has(node.rule) || node.rule === "optional" &&
        children[0].rule !== "captured-terminator" && leaves(node).every((/** @type {any} */ leaf) => this.value(leaf) !== "+"))) {
      if (node.rule === "group" && whole) grouped = true;
      if (node.rule === "optional") optionals++;
      node = children[0];
      children = rules(node);
    }
    if (optionals) {
      /** @type {any} */
      let result = yield this.body(node);
      for (let i = 0; i < optionals; i++) result = { optional: result };
      return result;
    }
    const first = children[0];
    const expr = (child = first, top = whole, isElidable = elidable) =>
      this.body(child, top, isElidable);
    switch (node.rule) {
      case "choice":
        return { choice: yield this.each(children, (/** @type {any} */ child) => expr(child, false, elidable)) };
      case "ranked-choice":
        return { ranked: yield this.each(children, (/** @type {any} */ child) => expr(child, false, false)) };
      case "some-of":
        validateSubsetSize50(children.length, this.bodyOwner, this.domFault);
        return { and: yield this.each(children, (/** @type {any} */ child) => expr(child, false, elidable)) };
      case "sequence":
        return { seq: yield this.each(children, (/** @type {any} */ child, /** @type {number} */ index) =>
          expr(child, false, elidable && index === 0)) };
      case "optional":
        return yield this.optional(node, first);
      case "repetition": {
        const marks = leaves(node).filter((/** @type {any} */ leaf) => this.value(leaf) === "...");
        if (marks.length > 1) this.fail(marks[1], "a chain can have only one marker");
        if (marks.length && grouped) this.fail(node, "a chain must occupy a whole alternative");
        const separatorMark = children[1] && leaves(children[1]).find((/** @type {any} */ leaf) => this.value(leaf) === "...");
        if (separatorMark) this.fail(separatorMark, "a chain marker cannot label a separator");
        const repeat = yield expr(first, false, false);
        const separator = children[1] && (yield expr(children[1], false, false));
        return { repeat, ...(children[1] && { separator }),
          ...(marks.length && { chain: marks[0].span[0] < first.span[0] ? "left" : "right" }) };
      }
      case "capture":
      case "captured-terminator": {
        const capture = this.binder(first);
        // The placement and binder of a capture precede its target kind, so
        // a fault of the target kind waits at the target. Parentheses around
        // one symbol drop, so $x:(A) binds A. A label on an optional, a flat
        // repetition or a group binds the compound operand (erratum M-60).
        const target = yield expr(children[1], false, elidable);
        const fault = node.rule === "capture" && !faulty(target) ? captureTargetFault50(target) : undefined;
        if (node.rule === "captured-terminator" && !faulty(target) && !isBodySymbol50(target)) {
          return { capture, expr: this.waitingFault(first, "a capture wraps one symbol") };
        }
        return { capture, expr: fault ? this.waitingFault(first, fault) : target };
      }
      case "marked-factor": {
        // A label on parentheses around one symbol binds that symbol
        // (erratum M-60), so the mark can stand before it. A compound
        // capture cannot carry the mark.
        const captured = first.rule === "capture";
        const atom = baseFactor(captured ? rules(first)[1] : first);
        if (!captured && GROUPS.has(atom.rule)) this.fail(node, "a primary marks one ungrouped symbol or capture that is not a splice");
        const target = yield expr(first, false, elidable);
        if (captured && !faulty(target) && target.expr && !faulty(target.expr) && !isBodySymbol50(target.expr)) {
          this.fail(node, "a primary marks one ungrouped symbol or capture that is not a splice");
        }
        return { primary: target };
      }
      case "tested-factor": {
        if (GROUPS.has(baseFactor(first).rule)) this.fail(children[1], "a test applies to one symbol");
        const tests = this.testOrder(children.slice(1), elidable);
        const base = yield expr();
        if (!faulty(base) && !isBodySymbol50(base)) this.fail(children[1], "a test applies to one symbol");
        return yield this.tests(base, tests);
      }
      case "ref":
      case "rule-reference":
        return { ref: this.value(node) };
      case "tag":
        return { ref: this.name(node) };
      case "range":
        return { range: yield this.each(children, (/** @type {any} */ child) => this.stringOperand(rules(child)[0])) };
      case "string-terminal":
        return { literal: yield this.stringOperand(first) };
      case "wildcard":
        return { wildcard: true };
      case "empty":
        return { empty: true };
      case "splice":
        return { splice: yield expr() };
      case "parameter":
        return this.parameter(node);
      case "call":
        return yield this.call(node);
      default:
        this.fail(node, `unexpected body part ${node.rule}`);
    }
  }

  /**
   * @param {any} node
   * @param {any} route
   * @returns {Step}
   */
  *optional(node, route) {
    const captured = route.rule === "captured-terminator";
    const elidable = captured || leaves(node).some((/** @type {any} */ leaf) => this.value(leaf) === "+");
    if (!elidable) return { optional: yield this.body(route) };
    const parts = rules(route);
    const sequence = captured ? parts.slice(1) : rules(rules(parts[0])[0]);
    const head = sequence[0] && baseFactor(sequence[0]);
    if (head?.rule === "group" ||
        !captured && (parts.length !== 1 || parts[0].rule !== "some-of" || rules(parts[0]).length !== 1 ||
          !sequence[0] || this.value(route) !== this.value(sequence[0]) ||
          sequence.length === 1 && head.rule === "capture")) {
      this.fail(route, elidableForm50);
    }
    if (!head || !["tag", "parameter"].includes(head.rule) || head.rule === "tag" && !/^[A-Z]/.test(this.value(head)) ||
        sequence.slice(1).some(containsCapture)) this.domFault(this.bodyOwner, elidableForm50);
    /** @type {any} */
    const optional = yield this.body(route, false, true);
    const symbol = captured ? optional.expr : optional.seq?.[0] ?? optional;
    const value = this.defaults?.get(symbol);
    return { optional, elidable: true, ...(value && { default: value }) };
  }

  /** @param {any} testNodes */
  testOrder(testNodes, elidable = false) {
    const kinds = ["tag-test", "value-test", "default-value"];
    const tests = testNodes.map((/** @type {any} */ wrapper) => rules(wrapper)[0]);
    let previous = -1;
    for (const test of tests) {
      const index = kinds.indexOf(test.rule);
      if (index <= previous) this.fail(test, "a filter, value test and default must occur once in that order");
      if (index === 2 && !elidable) this.fail(test, "only an elidable head takes a default value");
      previous = index;
    }
    return tests;
  }

  /**
   * @param {any} base
   * @param {any} tests
   * @returns {Step}
   */
  *tests(base, tests) {
    let result = base;
    for (const test of tests) {
      const at = this.at(test);
      if (test.rule === "tag-test") {
        const requirements = yield this.requirements(test);
        result = { test: "tags", requirements, expr: result, at };
      } else {
        const value = yield this.stringOperand(rules(test)[0], true);
        if (test.rule === "value-test") result = { test: this.value(test), value, expr: result, at };
        else {
          this.defaults ??= new WeakMap();
          this.defaults.set(result, value);
        }
      }
    }
    return result;
  }

  /**
   * @param {any} node
   * @returns {Step}
   */
  requirements(node) {
    return this.each(parts(node, "tag-requirement"), (/** @type {any} */ requirement) => this.deferred(this.requirement(requirement)));
  }

  /**
   * @param {any} requirement
   * @returns {Step}
   */
  *requirement(requirement) {
    const operand = rules(rules(requirement)[0])[0];
    const negated = this.value(requirement) === "¬";
    if (operand.rule === "tag") return { negated, value: { tag: this.name(operand) } };
    const value = yield this.stringOperand(operand, true, "a key requirement needs a tag, key-set constant or parameter");
    if (value.string !== undefined) this.fail(operand, "a key requirement needs a tag, key-set constant or parameter");
    return { negated, value };
  }

  /**
   * @param {any} node
   * @returns {Step}
   */
  stringOperand(node, test = false, message = "a string operand needs a literal, constant or parameter") {
    return this.deferred(this.stringRecord(node, test, message));
  }

  /**
   * @param {any} node
   * @param {boolean} test
   * @param {string} message
   * @returns {Step}
   */
  *stringRecord(node, test, message) {
    if (test && node.rule === "test-operand") node = rules(node)[0];
    if (test && node.rule === "post" && rules(node).length === 1) node = rules(rules(node)[0])[0] ?? node;
    if (!["string", "constant-reference", "parameter"].includes(node.rule)) this.fail(node, message);
    return yield this.expression(node);
  }

  /** @param {any} node */
  parameter(node) {
    return { param: this.value(node).slice(1), at: this.at(node) };
  }

  /**
   * @param {any} node
   * @returns {Step}
   */
  *call(node) {
    const call = this.value(node);
    const args = yield this.each(parts(node, "call-argument"), (/** @type {any} */ arg) => this.argument(arg));
    return { call, args, at: this.at(node) };
  }

  /**
   * @param {any} node
   * @returns {Step}
   */
  target(node) {
    return this.deferred(this.targetRecord(node));
  }

  /**
   * @param {any} node
   * @returns {Step}
   */
  *targetRecord(node) {
    const first = rules(node)[0];
    if (node.rule === "neighbor-target" || node.rule === "target-option") return yield this.target(first);
    if (node.rule === "call") return yield this.call(node);
    if (node.rule === "parameter") return this.parameter(node);
    if (node.rule === "tag") return { terminal: this.name(node) };
    return { rule: this.value(node) };
  }

  /**
   * @param {any} node
   * @returns {Step}
   */
  *argument(node) {
    const first = rules(node)[0];
    const at = this.at(first);
    let result;
    if (first.rule === "expr") result = { expression: yield this.expression(first), at };
    else if (first.rule === "requirement-argument") result = { requirements: yield this.requirements(first), at };
    else if (first.rule === "target-argument") {
      result = { targets: yield this.each(rules(first), (/** @type {any} */ target) => this.target(target)), at };
    } else {
      const body = yield this.ownedBody(first, { at });
      if (recordKind50(body, "body") === "reference") {
        const key = /^[A-Z_]/.test(body.ref) ? "tag" : "rule";
        result = { [key]: body.ref, at };
      } else if (isBodySymbol50(body)) result = { ...body, at: body.at ?? at };
      else result = { body, at };
    }
    return result;
  }

  /**
   * @param {any} node
   * @returns {Step}
   */
  expression(node) {
    return this.deferred(this.expressionRecord(node));
  }

  /**
   * @param {any} node
   * @returns {Step}
   */
  *expressionRecord(node) {
    let children = rules(node);
    // A long run of parentheses or precedence wrappers adds no DOM depth.
    while (children.length === 1 && (EXPRESSION_WRAPPERS.has(node.rule) ||
      node.rule === "neg" && node.children.length === 1)) {
      node = children[0];
      children = rules(node);
    }
    const first = children[0];
    const operators = leaves(node);
    /** @param {any} child */
    const expr = child => this.expression(child);
    switch (node.rule) {
      case "expr":
        if (children.length === 1) return yield expr(first);
        return { if: yield expr(first), then: yield expr(children[1]), at: this.at(operators[0]) };
      case "function":
        return { lambda: this.binder(operators[0]), body: yield expr(first), at: this.at(operators[0]) };
      case "disj":
      case "conj": {
        const key = node.rule === "disj" ? "any" : "all";
        const values = yield this.each(children, expr);
        return values.length === 1 ? values[0] : { [key]: values,
          at: this.at(operators.find((/** @type {any} */ operator) => operator.span[0] >= first.span[1])) };
      }
      case "neg": {
        const positions = [];
        while (node.rule === "neg") {
          const operator = leaves(node)[0];
          if (operator) positions.push(this.at(operator));
          node = rules(node)[0];
        }
        const operand = yield expr(node);
        return positions.reduceRight((not, at) => ({ not, at }), operand);
      }
      case "comparison": {
        if (children.length === 1) return yield expr(first);
        const op = this.value(children[1]);
        const left = yield expr(first);
        const right = yield expr(children[2]);
        return { op, left, right, at: this.at(children[1]) };
      }
      case "union":
      case "inter":
      case "sum":
        return yield this.binary(node, expr, false);
      case "post": {
        let value = yield expr(first);
        // A selector that fails waits after its receiver.
        for (const selector of children.slice(1)) {
          const receiver = value;
          value = yield this.deferred(this.selector(selector, receiver), [[receiver, "expression"]]);
        }
        return value;
      }
      case "atom":
        if (first) return yield expr(first);
        if (this.value(node) === "∅") return { emptySet: true };
        return { capture: this.value(node) === "$" ? "" : this.binder(node) };
      case "grouped-expr":
        if (children.length === 1) return yield expr(first);
        return { if: yield expr(first), then: yield expr(children[1]), else: yield expr(children[2]), at: this.at(operators[1]) };
      case "item-reference":
        return first ? { property: this.name(first), receiver: { item: true }, at: this.at(node) } : { item: true };
      case "method":
        return yield this.method(node, { item: true });
      case "string":
        return { string: this.strings.decode(this.token(node)) };
      case "integer":
        return { integer: this.value(node) };
      case "constant-reference":
        return { const: this.value(node).slice(1), at: this.at(node) };
      case "application":
        return { apply: this.value(node).slice(1), arg: yield expr(first), at: this.at(node) };
      case "parameter":
        return this.parameter(node);
      case "pattern-literal":
        return { pattern: yield this.pattern(node) };
      case "bag":
        return { bag: yield this.each(children, (/** @type {any} */ child) => this.entry(child)) };
      case "list":
        return { list: yield this.each(children, (/** @type {any} */ child) => this.entry(child)) };
      default:
        this.fail(node, `unexpected expression part ${node.rule}`);
    }
  }

  /**
   * @param {any} selector
   * @param {any} value
   * @returns {Step}
   */
  *selector(selector, value) {
    const at = this.at(selector);
    switch (selector.rule) {
      case "prop":
        return { property: this.name(part(selector, "key")), receiver: value, at };
      case "method":
        return yield this.method(selector, value);
      case "map": {
        const [map] = rules(selector);
        const by = yield this.deferred(map.rule === "method" ? this.method(map) : map.rule === "prop" ?
          this.mapProperty(map) : this.predicate(map));
        return { map: value, by, at };
      }
      case "flatten":
        return { flatten: value, at };
    }
    return value;
  }

  /**
   * @param {any} map
   * @returns {Step}
   */
  *mapProperty(map) {
    return { property: this.name(part(map, "key")), at: this.at(map) };
  }

  /**
   * @param {any} node
   * @param {(child: any) => Step} convert
   * @param {any} pattern
   * @returns {Step}
   */
  *binary(node, convert, pattern) {
    const children = rules(node);
    const operators = leaves(node);
    let left = yield convert(children[0]);
    /** @type {Record<string, string>} */
    const names = { "∪": "union", "∖": "difference", "∩": "intersection", "++": "concat" };
    for (const [index, operator] of operators.entries()) {
      const right = yield convert(children[index + 1]);
      const symbol = this.value(operator);
      const kind = names[symbol];
      const at = this.at(operator);
      if (!kind) left = { op: symbol, left, right, at };
      else if (kind === "union" || kind === "concat" || pattern && kind === "intersection") {
        left = { [kind]: [...(left[kind] ?? [left]), ...(right[kind] ?? [right])], at: left[kind] ? left.at : at };
      } else left = { [kind]: [left, right], at };
    }
    return left;
  }

  /**
   * @param {any} node
   * @param {any} [receiver]
   * @returns {Step}
   */
  *method(node, receiver) {
    const [selector] = rules(part(node, "selector"));
    const method = this.value(selector);
    const signature = methods50.get(method);
    const parentheses = leaves(selector).some((/** @type {any} */ token) => this.value(token) === "(");
    if (signature && parentheses !== (signature.max !== 0)) {
      this.fail(node, `method .${method} ${signature.max ? "requires" : "omits"} parentheses`);
    }
    const args = [];
    switch (selector.rule) {
      case "named-selector":
        for (const arg of parts(selector, "expr")) args.push(yield this.expression(arg));
        break;
      case "key-selector":
        args.push({ key: this.name(part(selector, "key")) });
        break;
      case "width-selector": {
        const at = part(selector, "integer");
        /** @type {any} */
        const integer = (yield this.expression(at)).integer;
        args.push({ integer });
        break;
      }
      case "predicate-selector": {
        const predicate = part(selector, "predicate");
        if (predicate) args.push(yield this.predicate(predicate));
        break;
      }
      case "neighbor-selector":
        for (const arg of parts(selector, "neighbor-target")) args.push(yield this.target(arg));
        break;
      case "family-selector":
        args.push(yield this.target(rules(selector)[0]));
        break;
      case "parse-selector": {
        const query = part(selector, "query-body");
        const choice = part(query, "choice");
        /** @type {any} */
        const body = yield this.ownedBody(choice, { at: this.at(node) });
        const sequence = [];
        if (this.value(query) === "…") sequence.push({ remainder: true });
        for (const operand of body.seq ?? [body]) sequence.push(operand);
        if (leaves(query).some((/** @type {any} */ leaf) => leaf.span[0] >= choice.span[1])) sequence.push({ remainder: true });
        args.push({ body: collapse("seq", sequence) });
        break;
      }
    }
    /** @type {any} */
    const result = { method, ...(receiver !== undefined && { receiver }), args, at: this.at(node) };
    return result;
  }

  /**
   * @param {any} node
   * @returns {Step}
   */
  *predicate(node) {
    const expr = part(node, "expr");
    /** @type {any} */
    const value = yield this.expression(expr);
    const first = expr.span[0];
    if (recordKind50(value, "expression") === "lambda" ||
        expr.span[1] === first + 1 && (value.const || value.capture || value.param)) {
      return value;
    }
    const index = this.tokens[first].value === "¬" ? first + 1 : first;
    if (!["'", "."].includes(this.tokens[index].value)) this.fail(node, "a predicate requires an explicit binder");
    return { lambda: "", body: value, at: this.at(node) };
  }

  /**
   * @param {any} node
   * @returns {Step}
   */
  *entry(node) {
    const prefix = part(node, "prefix");
    const gates = parts(prefix, "feature-gate").map((/** @type {any} */ gate) => this.gate(gate));
    const guard = part(prefix, "guard");
    const suffix = { gates, ...(guard && { guard: yield this.expression(part(guard, "expr")) }), at: this.at(node) };
    /** @type {[any, string][]} */
    const before = [[suffix.gates, "gate[]"], [suffix.guard, "expression"]];
    return yield this.deferred(this.entryForm(node, suffix, before), before);
  }

  /**
   * @param {any} node
   * @param {any} suffix
   * @param {[any, string][]} before
   * @returns {Step}
   */
  *entryForm(node, suffix, before) {
    if (node.rule === "item") {
      const kind = leaves(node).length ? "splat" : "item";
      return { kind, value: yield this.expression(part(node, "expr")), ...suffix };
    }
    if (node.rule === "output") {
      const selector = leaves(node)[0];
      const bag = part(node, "bag");
      const term = bag && (yield this.expression(bag));
      const value = this.value(selector);
      if (value === "ε") return { insert: true, term, ...suffix };
      if (value === "$" && !bag) this.domFault(suffix, "only a braced item can select the whole rule");
      const capture = value === "$" ? "" : this.binder(selector);
      return { capture, ...(term && { term }), ...suffix };
    }
    const body = rules(node)[1];
    switch (body.rule) {
      case "bare-entry":
        return { kind: "bare", key: this.name(part(body, "key")), ...suffix };
      case "write-entry": {
        const keys = parts(body, "key").map((/** @type {any} */ key) => this.name(key));
        return { kind: "write", keys, value: yield this.expression(part(body, "expr")), ...suffix };
      }
      case "delete-entry":
        return { kind: "delete", key: this.name(part(body, "key")), ...suffix };
      case "splat-entry":
        return { kind: "splat", value: yield this.expression(part(body, "expr")), ...suffix };
      case "copy-entry": {
        const post = part(body, "post");
        const last = rules(post).at(-1);
        const itemProperty = last?.rule === "atom" && rules(last)[0]?.rule === "item-reference" &&
          !!part(rules(last)[0], "key");
        if (last?.rule !== "prop" && !itemProperty) this.fail(body, "a copy ends with a property selector");
        const source = yield this.expression(post);
        // A copy splits its source, so a fault there stands for the entry.
        if (faulty(source)) return this.waiting(source[FAULT], [...before, ...source[BEFORE]]);
        return { kind: "copy", source: source.receiver, key: source.property, ...suffix };
      }
    }
  }

  /**
   * @param {any} node
   * @returns {Step}
   */
  pattern(node) {
    return this.deferred(this.patternRecord(node));
  }

  /**
   * @param {any} node
   * @returns {Step}
   */
  *patternRecord(node) {
    let children = rules(node);
    const paths = [];
    while (children.length === 1 && PATTERN_WRAPPERS.has(node.rule)) {
      if (node.rule === "pattern-path") paths.push(node);
      node = children[0];
      children = rules(node);
    }
    if (paths.length) {
      const inner = yield this.pattern(node);
      return paths.reduceRight((pattern, path) => this.patternPath(path, pattern), inner);
    }
    const first = children[0];
    const operators = leaves(node);
    switch (node.rule) {
      case "pattern-union":
      case "pattern-intersection":
        return yield this.binary(node, (/** @type {any} */ child) => this.pattern(child), true);
      case "bare-child-list":
        return { any: true, ...(operators.length && { exact: true }), children: yield this.items(first) };
      case "pattern-node": {
        /** @type {any} */
        const { at, ...atom } = yield this.pattern(first);
        const items = children[1] && (yield this.items(children[1]));
        return { ...atom, ...(operators.length && { exact: true }), ...(children[1] && { children: items }), at };
      }
      case "pattern-atom": {
        const tests = this.testOrder(children.slice(1));
        const at = this.at(first);
        let atom;
        switch (first.rule) {
          case "pattern-rule":
            atom = rules(first).length ? yield this.pattern(rules(first)[0]) : { name: this.value(first), at };
            break;
          case "call":
            atom = yield this.call(first);
            break;
          case "parameter":
            atom = this.parameter(first);
            break;
          case "tag":
            atom = { terminal: this.name(first), at };
            break;
          case "string":
            atom = { literal: yield this.expression(first), at };
            break;
          case "range":
            atom = { ...(yield this.body(first)), at };
            break;
          case "wildcard":
            atom = { wildcard: true, at };
            break;
          case "constant-reference":
            atom = { constant: this.value(first).slice(1), at };
            break;
        }
        return yield this.tests(atom, tests);
      }
      case "parameter":
        return this.parameter(node);
      case "call":
        return yield this.call(node);
      case "child-set-operation":
      case "child-intersection":
        return yield this.binary(node, (/** @type {any} */ child) => this.singlePattern(child), true);
      default:
        this.fail(node, `unexpected pattern part ${node.rule}`);
    }
  }

  /**
   * @param {any} node
   * @param {any} pattern
   */
  patternPath(node, pattern) {
    const mark = leaves(node)[0];
    /** @type {Record<string, string>} */
    const names = { "⋮": "descendant", "⋱": "last", "⋰": "first" };
    return mark ? { path: names[this.value(mark)], pattern } : pattern;
  }

  /**
   * @param {any} node
   * @returns {Step}
   */
  singlePattern(node) {
    return this.deferred(this.singlePatternRecord(node));
  }

  /**
   * @param {any} node
   * @returns {Step}
   */
  *singlePatternRecord(node) {
    /** @type {any} */
    const items = yield this.items(node);
    if (items.length !== 1 || !items[0].child) this.fail(node, "an operator needs one whole pattern");
    return items[0].child;
  }

  /**
   * @param {any} node
   * @returns {Step}
   */
  *items(node) {
    const children = rules(node);
    const first = children[0];
    switch (node.rule) {
      case "child-list":
        return first ? yield this.items(first) : [];
      case "child-choice": {
        /** @type {any[][]} */
        const choices = yield this.each(children, (/** @type {any} */ alt) => this.items(alt));
        if (choices.length === 1) return choices[0];
        return [{ choice: choices.flatMap(items => items.length === 1 && items[0].choice ? items[0].choice : [items]) }];
      }
      case "child-alternative":
      case "child-item":
        return first ? yield this.items(first) : [{ siblings: true }];
      case "child-primary":
        return first.rule === "child-choice" ? yield this.items(first) : [{ child: yield this.pattern(first) }];
      case "child-sequence":
        return (yield this.each(children, (/** @type {any} */ item) => this.items(item))).flat();
      case "child-path":
        return leaves(node).length ? [{ child: this.patternPath(node, yield this.singlePattern(first)) }] : yield this.items(first);
      case "child-set-operation":
      case "child-intersection":
        return [{ child: yield this.pattern(node) }];
      case "child-optional":
        return [{ optional: yield this.items(first) }];
      case "child-repetition": {
        const repeat = yield this.items(first);
        const separator = children[1] && (yield this.items(children[1]));
        return [{ repeat, ...(children[1] && { separator }) }];
      }
      default:
        this.fail(node, `unexpected child part ${node.rule}`);
    }
  }
}
