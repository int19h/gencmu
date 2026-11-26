import { GencmuError } from "../errors.js";
import { KEY_STEPS, validSteps } from "../dom.js";
import { recordKind50 } from "./records.js";
import { methods50 } from "./signatures.js";
import { documentFault50, elidableForm50, isBodySymbol50, validateDeclarationShape50,
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

/** @param {any} node */
function containsCapture(node) {
  return ["capture", "captured-terminator"].includes(node.rule) || rules(node).some(containsCapture);
}

// Conversion yields one record at a time in written order. A failed shape
// check exposes the prefix through that declaration to the test observer.
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
  for (const [category, record] of declarations) {
    dom[category].push(record);
    const names = category === "directives" && record.name === "names";
    try {
      if (names && !preamble) fail(record, "%names must precede all other declarations");
      validateDeclarationShape50(category, record, fail, configuration.unicode, emptyDelimiters);
    } catch (error) {
      storeDom?.(dom, "prefix");
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
    const [line, column] = this.at(node);
    throw new GencmuError("grammar", description, { document: this.document, line, column });
  }

  /**
   * @param {any} tree
   * @param {any} [storeDom]
   */
  build(tree, storeDom) {
    return inspectConverted50(this.declarations(tree), { document: this.document, unicode: this.unicode }, storeDom);
  }

  /** @param {any} tree */
  *declarations(tree) {
    for (const statement of parts(tree, "statement")) {
      const node = rules(statement)[0];
      let category, record;
      switch (node.rule) {
        case "rule":
          category = "rules";
          record = this.rule(node);
          break;
        case "constant-definition":
          {
            const name = this.value(part(node, "constant-name")).slice(1);
            if (name === "INPUTS") this.fail(node, "$INPUTS is supplied by the engine");
            category = "constants";
            record = { name, op: operation(this.value(node)), value: this.expression(part(node, "expr")), at: this.at(node) };
          }
          break;
        case "directive":
          category = "directives";
          record = this.directive(node);
          break;
        case "ranking-directive":
          category = "directives";
          record = this.ranking(node);
          break;
        default:
          this.fail(node, "expected a declaration");
      }
      yield [category, record];
    }
  }

  /** @param {any} node */
  directive(node) {
    const name = this.value(node).slice(1);
    const operands = parts(node, "directive-argument").map((/** @type {any} */ argument) => rules(argument)[0]);
    const clauses = part(node, "conditions-clause");
    let args;
    if (name === "include" || name === "names") {
      if (clauses || operands.length !== 1 || this.token(operands[0]).props.has("Resource-Path") === false) {
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
    return { name, args, at: this.at(node), ...(clauses && { conditions: this.conditions(clauses) }) };
  }

  /** @param {any} node */
  ranking(node) {
    const steps = parts(node, "ranking-step").map((/** @type {any} */ stepNode) => {
      const step = this.value(stepNode);
      const patternNode = rules(stepNode)[0];
      if (Boolean(patternNode) !== KEY_STEPS.has(step)) this.fail(node, "invalid resolution step operand");
      if (!patternNode) return { step };
      const pattern = patternNode.rule === "constant-reference" ?
        this.expression(patternNode) : this.pattern(patternNode);
      return { step, pattern };
    });
    if (!validSteps(steps)) this.fail(node, "invalid resolution policy");
    return { name: "ambiguity-resolution", steps, at: this.at(node) };
  }

  /** @param {any} node */
  rule(node) {
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
      return { name, op, instance: this.call(call), conditions: [], at };
    }
    /** @type {{params?: any[], args?: any[]}} */
    let category = {};
    if (!plain) {
      const { args } = this.call(head);
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
    const term = termNode && this.expression(part(termNode, "bag"));
    const body = rules(part(node, "body") ?? part(node, "headed-body"))[0];
    const owner = { at };
    const alternatives = body.rule === "ranked-body" ?
      [this.alternative(body, "ranked-choice", owner)] : rules(body).map((/** @type {any} */ alt) => this.alternative(alt, "some-of", owner));
    const conditions = this.conditions(part(node, "conditions-clause"));
    const diagnostic = part(node, "diagnostic-clause");
    const diagnosticNode = diagnostic && rules(diagnostic)[0];
    if (diagnostic && category.params) this.domFault({ at }, "a template cannot declare an error or warning");
    const key = diagnosticNode?.rule.split("-")[0];
    const message = diagnosticNode && this.expression(part(diagnosticNode, "expr"));
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
    const emit = outputNode && !erased && { items: parts(outputNode, "output").map((/** @type {any} */ item) => this.entry(item)) };
    return { name, ...category, op, ...(term && { term }), alternatives, ...(emit && { emit }), conditions,
      ...(key && { [key]: message }), ...(suppressWarnings && { suppressWarnings }), ...(erased && { erased }), at };
  }

  /** @param {any} node */
  conditions(node) {
    return node ? parts(node, "expr").map((/** @type {any} */ item) => this.expression(item)) : [];
  }

  /**
   * @param {any} node
   * @param {any} kind
   * @param {any} owner
   */
  alternative(node, kind, owner) {
    const gates = parts(node, "feature-gate").map((/** @type {any} */ gate) => this.gate(gate));
    const source = part(node, kind);
    const expr = this.ownedBody(source, owner, true);
    const term = part(node, "alternative-term");
    return { gates, expr, ...(term && { term: this.expression(part(term, "bag")) }) };
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
   * @returns {any}
   */
  ownedBody(node, owner, whole = false) {
    /** @type {any} */
    const previous = this.bodyOwner;
    this.bodyOwner = owner;
    try {
      return this.body(node, whole);
    } finally {
      this.bodyOwner = previous;
    }
  }

  /**
   * @param {any} node
   * @returns {any}
   */
  body(node, whole = false, elidable = false) {
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
      let result = this.body(node);
      for (let i = 0; i < optionals; i++) result = { optional: result };
      return result;
    }
    const first = children[0];
    const expr = (child = first, top = whole, isElidable = elidable) =>
      this.body(child, top, isElidable);
    switch (node.rule) {
      case "choice":
        return { choice: children.map((/** @type {any} */ child) => expr(child, false, elidable)) };
      case "ranked-choice":
        return { ranked: children.map((/** @type {any} */ child) => expr(child, false, false)) };
      case "some-of":
        validateSubsetSize50(children.length, this.bodyOwner, this.domFault);
        return { and: children.map((/** @type {any} */ child) => expr(child, false, elidable)) };
      case "sequence":
        return { seq: children.map((/** @type {any} */ child, /** @type {any} */ index) => expr(child, false, elidable && index === 0)) };
      case "optional":
        return this.optional(node, first);
      case "repetition": {
        const marks = leaves(node).filter((/** @type {any} */ leaf) => this.value(leaf) === "...");
        if (marks.length > 1) this.fail(marks[1], "a chain can have only one marker");
        if (marks.length && grouped) this.fail(node, "a chain must occupy a whole alternative");
        const separatorMark = children[1] && leaves(children[1]).find((/** @type {any} */ leaf) => this.value(leaf) === "...");
        if (separatorMark) this.fail(separatorMark, "a chain marker cannot label a separator");
        return { repeat: expr(first, false, false),
          ...(children[1] && { separator: expr(children[1], false, false) }),
          ...(marks.length && { chain: marks[0].span[0] < first.span[0] ? "left" : "right" }) };
      }
      case "capture":
      case "captured-terminator": {
        const capture = this.binder(first);
        if (GROUPS.has(baseFactor(children[1]).rule)) this.fail(first, "a capture wraps one symbol");
        const target = expr(children[1], false, elidable);
        if (!isBodySymbol50(target)) this.fail(first, "a capture wraps one symbol");
        return { capture, expr: target };
      }
      case "marked-factor": {
        const atom = baseFactor(first.rule === "capture" ? rules(first)[1] : first);
        if (GROUPS.has(atom.rule)) this.fail(node, "a primary marks one ungrouped symbol or capture that is not a splice");
        const target = expr(first, false, elidable);
        return { primary: target };
      }
      case "tested-factor": {
        if (GROUPS.has(baseFactor(first).rule)) this.fail(children[1], "a test applies to one symbol");
        const tests = this.testOrder(children.slice(1), elidable);
        const base = expr();
        if (!isBodySymbol50(base)) this.fail(children[1], "a test applies to one symbol");
        return this.tests(base, tests);
      }
      case "ref":
      case "rule-reference":
        return { ref: this.value(node) };
      case "tag":
        return { ref: this.name(node) };
      case "range":
        return { range: children.map((/** @type {any} */ child) => this.stringOperand(rules(child)[0])) };
      case "string-terminal":
        return { literal: this.stringOperand(first) };
      case "wildcard":
        return { wildcard: true };
      case "empty":
        return { empty: true };
      case "splice":
        return { splice: expr() };
      case "parameter":
        return this.parameter(node);
      case "call":
        return this.call(node);
      default:
        this.fail(node, `unexpected body part ${node.rule}`);
    }
  }

  /**
   * @param {any} node
   * @param {any} route
   * @returns {any}
   */
  optional(node, route) {
    const captured = route.rule === "captured-terminator";
    const elidable = captured || leaves(node).some((/** @type {any} */ leaf) => this.value(leaf) === "+");
    if (!elidable) return { optional: this.body(route) };
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
    const optional = this.body(route, false, true);
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
   */
  tests(base, tests) {
    let result = base;
    for (const test of tests) {
      const at = this.at(test);
      if (test.rule === "tag-test") {
        const requirements = this.requirements(test);
        result = { test: "tags", requirements, expr: result, at };
      } else {
        const value = this.stringOperand(rules(test)[0], true);
        if (test.rule === "value-test") result = { test: this.value(test), value, expr: result, at };
        else {
          this.defaults ??= new WeakMap();
          this.defaults.set(result, value);
        }
      }
    }
    return result;
  }

  /** @param {any} node */
  requirements(node) {
    return parts(node, "tag-requirement").map((/** @type {any} */ requirement) => {
      const operand = rules(rules(requirement)[0])[0];
      const negated = this.value(requirement) === "¬";
      if (operand.rule === "tag") return { negated, value: { tag: this.name(operand) } };
      const value = this.stringOperand(operand, true, "a key requirement needs a tag, key-set constant or parameter");
      if (value.string !== undefined) this.fail(operand, "a key requirement needs a tag, key-set constant or parameter");
      return { negated, value };
    });
  }

  /**
   * @param {any} node
   * @returns {any}
   */
  stringOperand(node, test = false, message = "a string operand needs a literal, constant or parameter") {
    if (test && node.rule === "test-operand") node = rules(node)[0];
    if (test && node.rule === "post" && rules(node).length === 1) node = rules(rules(node)[0])[0] ?? node;
    if (!["string", "constant-reference", "parameter"].includes(node.rule)) this.fail(node, message);
    return this.expression(node);
  }

  /** @param {any} node */
  parameter(node) {
    return { param: this.value(node).slice(1), at: this.at(node) };
  }

  /** @param {any} node */
  call(node) {
    return { call: this.value(node), args: parts(node, "call-argument").map((/** @type {any} */ arg) => this.argument(arg)), at: this.at(node) };
  }

  /**
   * @param {any} node
   * @returns {any}
   */
  target(node) {
    const first = rules(node)[0];
    if (node.rule === "neighbor-target" || node.rule === "target-option") return this.target(first);
    if (node.rule === "call") return this.call(node);
    if (node.rule === "parameter") return this.parameter(node);
    if (node.rule === "tag") return { terminal: this.name(node) };
    return { rule: this.value(node) };
  }

  /** @param {any} node */
  argument(node) {
    const first = rules(node)[0];
    const at = this.at(first);
    let result;
    if (first.rule === "expr") result = { expression: this.expression(first), at };
    else if (first.rule === "requirement-argument") result = { requirements: this.requirements(first), at };
    else if (first.rule === "target-argument") result = { targets: rules(first).map((/** @type {any} */ target) => this.target(target)), at };
    else {
      const body = this.ownedBody(first, { at });
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
   * @returns {any}
   */
  expression(node) {
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
        return children.length === 1 ? expr(first) :
          { if: expr(first), then: expr(children[1]), at: this.at(operators[0]) };
      case "function":
        return { lambda: this.binder(operators[0]), body: expr(first), at: this.at(operators[0]) };
      case "disj":
      case "conj": {
        const key = node.rule === "disj" ? "any" : "all";
        const values = children.map(expr);
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
        return positions.reduceRight((not, at) => ({ not, at }), expr(node));
      }
      case "comparison": {
        if (children.length === 1) return expr(first);
        const op = this.value(children[1]);
        const left = expr(first);
        const right = expr(children[2]);
        return { op, left, right, at: this.at(children[1]) };
      }
      case "union":
      case "inter":
      case "sum":
        return this.binary(node, (/** @type {any} */ child) => expr(child), false);
      case "post": {
        let value = expr(first);
        for (const selector of children.slice(1)) {
          const at = this.at(selector);
          switch (selector.rule) {
            case "prop":
              value = { property: this.name(part(selector, "key")), receiver: value, at };
              break;
            case "method":
              value = this.method(selector, value);
              break;
            case "map": {
              const [map] = rules(selector);
              const by = map.rule === "method" ? this.method(map) : map.rule === "prop" ?
                { property: this.name(part(map, "key")), at: this.at(map) } : this.predicate(map);
              value = { map: value, by, at };
              break;
            }
            case "flatten":
              value = { flatten: value, at };
              break;
          }
        }
        return value;
      }
      case "atom":
        if (first) return expr(first);
        if (this.value(node) === "∅") return { emptySet: true };
        return { capture: this.value(node) === "$" ? "" : this.binder(node) };
      case "grouped-expr":
        return children.length === 1 ? expr(first) :
          { if: expr(first), then: expr(children[1]), else: expr(children[2]), at: this.at(operators[1]) };
      case "item-reference":
        return first ? { property: this.name(first), receiver: { item: true }, at: this.at(node) } : { item: true };
      case "method":
        return this.method(node, { item: true });
      case "string":
        return { string: this.strings.decode(this.token(node)) };
      case "integer":
        return { integer: this.value(node) };
      case "constant-reference":
        return { const: this.value(node).slice(1), at: this.at(node) };
      case "application":
        return { apply: this.value(node).slice(1), arg: expr(first), at: this.at(node) };
      case "parameter":
        return this.parameter(node);
      case "pattern-literal":
        return { pattern: this.pattern(node) };
      case "bag": {
        const entries = children.map((/** @type {any} */ child) => this.entry(child));
        return { bag: entries };
      }
      case "list":
        return { list: children.map((/** @type {any} */ child) => this.entry(child)) };
      default:
        this.fail(node, `unexpected expression part ${node.rule}`);
    }
  }

  /**
   * @param {any} node
   * @param {any} convert
   * @param {any} pattern
   */
  binary(node, convert, pattern) {
    const children = rules(node);
    const operators = leaves(node);
    let left = convert(children[0]);
    /** @type {Record<string, string>} */
    const names = { "∪": "union", "∖": "difference", "∩": "intersection", "++": "concat" };
    for (const [index, operator] of operators.entries()) {
      const right = convert(children[index + 1]);
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
   * @returns {any}
   */
  method(node, receiver) {
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
        for (const arg of parts(selector, "expr")) args.push(this.expression(arg));
        break;
      case "key-selector":
        args.push({ key: this.name(part(selector, "key")) });
        break;
      case "width-selector": {
        const at = part(selector, "integer");
        /** @type {any} */
        const integer = this.expression(at).integer;
        args.push({ integer });
        break;
      }
      case "predicate-selector": {
        const predicate = part(selector, "predicate");
        if (predicate) args.push(this.predicate(predicate));
        break;
      }
      case "neighbor-selector":
        for (const arg of parts(selector, "neighbor-target")) args.push(this.target(arg));
        break;
      case "family-selector":
        args.push(this.target(rules(selector)[0]));
        break;
      case "parse-selector": {
        const query = part(selector, "query-body");
        const choice = part(query, "choice");
        /** @type {any} */
        const body = this.ownedBody(choice, { at: this.at(node) });
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
   * @returns {any}
   */
  predicate(node) {
    const expr = part(node, "expr");
    /** @type {any} */
    const value = this.expression(expr);
    const first = expr.span[0];
    if (recordKind50(value, "expression") === "lambda" ||
        expr.span[1] === first + 1 && (value.const || value.capture || value.param)) {
      return value;
    }
    const index = this.tokens[first].value === "¬" ? first + 1 : first;
    if (!["'", "."].includes(this.tokens[index].value)) this.fail(node, "a predicate requires an explicit binder");
    return { lambda: "", body: value, at: this.at(node) };
  }

  /** @param {any} node */
  entry(node) {
    const prefix = part(node, "prefix");
    const gates = parts(prefix, "feature-gate").map((/** @type {any} */ gate) => this.gate(gate));
    const guard = part(prefix, "guard");
    const suffix = { gates, ...(guard && { guard: this.expression(part(guard, "expr")) }), at: this.at(node) };
    if (node.rule === "item") {
      const kind = leaves(node).length ? "splat" : "item";
      return { kind, value: this.expression(part(node, "expr")), ...suffix };
    }
    if (node.rule === "output") {
      const selector = leaves(node)[0];
      const bag = part(node, "bag");
      const term = bag && this.expression(bag);
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
      case "write-entry":
        return { kind: "write", keys: parts(body, "key").map((/** @type {any} */ key) => this.name(key)),
          value: this.expression(part(body, "expr")), ...suffix };
      case "delete-entry":
        return { kind: "delete", key: this.name(part(body, "key")), ...suffix };
      case "splat-entry":
        return { kind: "splat", value: this.expression(part(body, "expr")), ...suffix };
      case "copy-entry": {
        const post = part(body, "post");
        const last = rules(post).at(-1);
        const itemProperty = last?.rule === "atom" && rules(last)[0]?.rule === "item-reference" &&
          !!part(rules(last)[0], "key");
        if (last?.rule !== "prop" && !itemProperty) this.fail(body, "a copy ends with a property selector");
        const source = this.expression(post);
        return { kind: "copy", source: source.receiver, key: source.property, ...suffix };
      }
    }
  }

  /**
   * @param {any} node
   * @returns {any}
   */
  pattern(node) {
    let children = rules(node);
    const paths = [];
    while (children.length === 1 && PATTERN_WRAPPERS.has(node.rule)) {
      if (node.rule === "pattern-path") paths.push(node);
      node = children[0];
      children = rules(node);
    }
    if (paths.length) {
      return paths.reduceRight((pattern, path) => this.patternPath(path, pattern), this.pattern(node));
    }
    const first = children[0];
    const operators = leaves(node);
    switch (node.rule) {
      case "pattern-union":
      case "pattern-intersection":
        return this.binary(node, (/** @type {any} */ child) => this.pattern(child), true);
      case "bare-child-list":
        return { any: true, ...(operators.length && { exact: true }), children: this.items(first) };
      case "pattern-node": {
        /** @type {any} */
        const { at, ...atom } = this.pattern(first);
        return { ...atom, ...(operators.length && { exact: true }),
          ...(children[1] && { children: this.items(children[1]) }), at };
      }
      case "pattern-atom": {
        const tests = this.testOrder(children.slice(1));
        const at = this.at(first);
        let atom;
        switch (first.rule) {
          case "pattern-rule":
            atom = rules(first).length ? this.pattern(rules(first)[0]) : { name: this.value(first), at };
            break;
          case "call":
            atom = this.call(first);
            break;
          case "parameter":
            atom = this.parameter(first);
            break;
          case "tag":
            atom = { terminal: this.name(first), at };
            break;
          case "string":
            atom = { literal: this.expression(first), at };
            break;
          case "range":
            atom = { ...this.body(first), at };
            break;
          case "wildcard":
            atom = { wildcard: true, at };
            break;
          case "constant-reference":
            atom = { constant: this.value(first).slice(1), at };
            break;
        }
        return this.tests(atom, tests);
      }
      case "parameter":
        return this.parameter(node);
      case "call":
        return this.call(node);
      case "child-set-operation":
      case "child-intersection":
        return this.binary(node, (/** @type {any} */ child) => this.singlePattern(child), true);
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
   * @returns {any}
   */
  singlePattern(node) {
    /** @type {any} */
    const items = this.items(node);
    if (items.length !== 1 || !items[0].child) this.fail(node, "an operator needs one whole pattern");
    return items[0].child;
  }

  /**
   * @param {any} node
   * @returns {any}
   */
  items(node) {
    const children = rules(node);
    const first = children[0];
    switch (node.rule) {
      case "child-list":
        return first ? this.items(first) : [];
      case "child-choice": {
        const choices = children.map((/** @type {any} */ alt) => this.items(alt));
        if (choices.length === 1) return choices[0];
        return [{ choice: choices.flatMap((/** @type {any} */ items) => items.length === 1 && items[0].choice ? items[0].choice : [items]) }];
      }
      case "child-alternative":
      case "child-item":
        return first ? this.items(first) : [{ siblings: true }];
      case "child-primary":
        return first.rule === "child-choice" ? this.items(first) : [{ child: this.pattern(first) }];
      case "child-sequence":
        return children.flatMap((/** @type {any} */ item) => this.items(item));
      case "child-path":
        return leaves(node).length ? [{ child: this.patternPath(node, this.singlePattern(first)) }] : this.items(first);
      case "child-set-operation":
      case "child-intersection":
        return [{ child: this.pattern(node) }];
      case "child-optional":
        return [{ optional: this.items(first) }];
      case "child-repetition":
        return [{ repeat: this.items(first), ...(children[1] && { separator: this.items(children[1]) }) }];
      default:
        this.fail(node, `unexpected child part ${node.rule}`);
    }
  }
}
