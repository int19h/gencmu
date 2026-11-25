import { GencmuError } from "../../lib/js/src/errors.js";
import { CAPTURE_NAME, DOM_MAX_DEPTH, KEY_STEPS, validSteps } from "../../lib/js/src/dom.js";

const EXPRESSION_WRAPPERS = new Set([
  "expr", "disj", "conj", "comparison", "union", "inter", "sum", "post", "atom", "grouped-expr",
]);
const RULE_NAME = /^[a-z][A-Za-z0-9_-]*$/;
const FEATURE_NAME = /^[a-zA-Z][a-zA-Z0-9-]*$/;
const OPS = new Map([
  ["≠", "≠"], ["∉", "∉"], ["⊈", "⊈"], ["≇", "≇"],
]);
const operation = keyword => keyword.startsWith("%redefine-") ? "redefine" :
  keyword.startsWith("%extend-") ? "extend" : "define";
const rules = node => node.children.filter(child => child.kind === "rule");
const parts = (node, name) => rules(node).filter(child => child.rule === name);
const part = (node, name) => parts(node, name)[0];
const leaves = node => node.children.filter(child => child.kind === "token");
const collapse = (kind, items) => items.length === 1 ? items[0] : { [kind]: items };
const isSymbol = body => ["ref", "call", "param", "literal", "range", "wildcard", "splice", "test"]
  .some(key => Object.hasOwn(body, key));

export class DomBuilder {
  constructor(tokens, position, document, unicode, strings) {
    this.tokens = tokens;
    this.position = position;
    this.document = document;
    this.unicode = unicode;
    this.strings = strings;
    this.origins = new WeakMap();
  }

  token(node) {
    return this.tokens[node.span[0]];
  }

  at(node) {
    return this.position(this.token(node)?.source[0]);
  }

  value(node) {
    const value = this.token(node).value;
    return OPS.get(value) ?? value;
  }

  fail(node, description) {
    const [line, column] = this.at(node);
    throw new GencmuError("grammar", description, { document: this.document, line, column });
  }

  remember(record, node) {
    this.origins.set(record, node);
    return record;
  }

  build(tree) {
    const dom = { format: 50, rules: [], directives: [], constants: [] };
    let preamble = true;
    const declarations = [];
    for (const statement of parts(tree, "statement")) {
      const node = rules(statement)[0];
      switch (node.rule) {
        case "rule":
          dom.rules.push(this.rule(node));
          break;
        case "constant-definition":
          dom.constants.push({ name: this.value(part(node, "constant-name")).slice(1),
            op: operation(this.value(node)), value: this.expression(part(node, "expr")), at: this.at(node) });
          break;
        case "directive":
          if (this.value(node) === "%names" && !preamble) this.fail(node, "%names must precede all other declarations");
          dom.directives.push(this.directive(node));
          break;
        case "ranking-directive":
          dom.directives.push(this.ranking(node));
          break;
        default:
          this.fail(node, "expected a declaration");
      }
      preamble &&= this.value(node) === "%names";
      const items = node.rule === "rule" ? dom.rules : node.rule === "constant-definition" ? dom.constants : dom.directives;
      declarations.push([node, items.at(-1)]);
    }
    for (const [statement, declaration] of declarations) {
      if (tooDeep(declaration)) this.fail(statement, `an expression, term or condition is nested more than ${DOM_MAX_DEPTH} deep`);
    }
    return dom;
  }

  directive(node) {
    const name = this.value(node).slice(1);
    const operands = parts(node, "directive-argument").map(argument => rules(argument)[0]);
    const clauses = part(node, "conditions-clause");
    let args;
    if (name === "include" || name === "names") {
      if (clauses || operands.length !== 1 || this.token(operands[0]).tags.has("Resource-Path") === false) {
        this.fail(node, `%${name} takes one quoted path`);
      }
      args = [this.strings.decode(this.token(operands[0]), true)];
    } else if (name === "features") {
      if (!operands.length || operands.some(operand =>
        operand.rule !== "directive-identifier" || !FEATURE_NAME.test(this.value(operand)))) {
        this.fail(node, "%features takes feature names");
      }
      args = operands.map(operand => this.value(operand));
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

  ranking(node) {
    const steps = parts(node, "ranking-step").map(stepNode => {
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

  rule(node) {
    const op = operation(this.value(node));
    const plain = part(node, "rule-name");
    const call = part(node, "call");
    const head = plain ?? call;
    const name = this.value(head);
    if (plain && !RULE_NAME.test(name) && !this.token(plain).tags.has("Emoji-Name")) {
      this.fail(plain, "a rule name must begin with a lowercase letter or be an emoji name");
    }
    const at = this.at(node);
    if (leaves(node).some(token => this.value(token) === "=")) {
      if (op === "extend") this.fail(node, "an instance binding cannot extend a rule");
      return { name, op, instance: this.call(call), conditions: [], at };
    }
    let category = {};
    if (!plain) {
      const { args } = this.call(head);
      if (args.every(arg => Object.hasOwn(arg, "param"))) {
        const params = [];
        for (const arg of args) {
          if (params.includes(arg.param)) this.fail(this.origins.get(arg), `duplicate parameter @${arg.param}`);
          params.push(arg.param);
        }
        category = { params };
      } else {
        if (op === "define" || args.some(arg => Object.hasOwn(arg, "param"))) {
          this.fail(head, "a rule head needs all parameters or an exact instance edit");
        }
        category = { args };
      }
    }
    const termNode = part(node, "statement-term");
    const term = termNode && this.expression(part(termNode, "bag"));
    const body = rules(part(node, "body"))[0];
    const alternatives = body.rule === "ranked-body" ?
      [this.alternative(body, "ranked-choice")] : rules(body).map(alt => this.alternative(alt, "some-of"));
    const conditions = this.conditions(part(node, "conditions-clause"));
    const diagnostic = part(node, "diagnostic-clause");
    const diagnosticNode = diagnostic && rules(diagnostic)[0];
    if (diagnostic && category.params) this.fail(diagnosticNode, "a template cannot declare an error or warning");
    const key = diagnosticNode?.rule.split("-")[0];
    const message = diagnosticNode && this.expression(part(diagnosticNode, "expr"));
    const suppression = part(node, "suppress-warnings-clause");
    const suppressWarnings = suppression && (parts(suppression, "suppression-code").length ?
      parts(suppression, "suppression-code").map(code => this.value(code)) : ["_"]);
    const output = part(node, "output-clause");
    const outputNode = output && rules(output)[0];
    const erased = outputNode?.rule === "erased-clause";
    const emit = outputNode && !erased && { items: parts(outputNode, "output").map(item => this.entry(item)) };
    return { name, ...category, op, ...(term && { term }), alternatives, ...(emit && { emit }), conditions,
      ...(key && { [key]: message }), ...(suppressWarnings && { suppressWarnings }), ...(erased && { erased }), at };
  }

  conditions(node) {
    return node ? parts(node, "expr").map(item => this.expression(item)) : [];
  }

  alternative(node, kind) {
    const gates = parts(node, "feature-gate").map(gate => this.gate(gate));
    const expr = this.body(part(node, kind), true);
    const term = part(node, "alternative-term");
    return { gates, expr, ...(term && { term: this.expression(part(term, "bag")) }) };
  }

  name(node, origin = false) {
    const name = this.value(node);
    if (!name.startsWith("_")) return name;
    if (origin && name === "_Elided") return name;
    const canonical = this.unicode.canonicalTag(name);
    if (!canonical || canonical === "_Elided") this.fail(node, `unknown or forbidden engine key ${name}`);
    return canonical;
  }

  binder(node) {
    const name = this.value(node).slice(1);
    if (!CAPTURE_NAME.test(name)) this.fail(node, "a capture name must use lowercase letters, digits, hyphens or underscores");
    return name;
  }

  gate(node) {
    const negated = this.value(node) === "¬";
    const feature = this.value(leaves(node)[Number(negated)]);
    if (!FEATURE_NAME.test(feature)) this.fail(node, "invalid feature name");
    return { feature, kind: "gate", negated };
  }

  body(node, whole = false, elidable = false) {
    const children = rules(node);
    const first = children[0];
    const expr = (child = first, top = whole, isElidable = elidable) => this.body(child, top, isElidable);
    switch (node.rule) {
      case "factor":
      case "untested-factor":
      case "splice-target":
      case "body-argument":
      case "symbol-argument":
      case "group":
        return expr();
      case "choice":
        return first.rule === "ranked-choice" ? expr() :
          collapse("choice", children.map(child => expr(child, whole && children.length === 1, elidable)));
      case "ranked-choice":
        return { ranked: children.map(child => expr(child, false, false)) };
      case "some-of":
        if (children.length > 16) this.fail(first, "an ordered subset takes at most sixteen operands");
        return collapse("and", children.map(child => expr(child, whole && children.length === 1, elidable)));
      case "sequence":
        return collapse("seq", children.map((child, index) =>
          expr(child, whole && children.length === 1, elidable && index === 0)));
      case "optional":
        return this.optional(node, first);
      case "repetition": {
        const marks = leaves(node).filter(leaf => this.value(leaf) === "...");
        if (marks.length && !whole) this.fail(node, "a chain must occupy a whole alternative");
        return { repeat: expr(first, false, false),
          ...(children[1] && { separator: expr(children[1], false, false) }),
          ...(marks.length && { chain: marks[0].span[0] < first.span[0] ? "left" : "right" }) };
      }
      case "capture":
      case "captured-terminator": {
        const capture = this.binder(first);
        const target = expr(children[1], false, elidable);
        if (!isSymbol(target)) this.fail(first, "a capture wraps one symbol");
        return this.remember({ capture, expr: target }, first);
      }
      case "marked-factor": {
        const target = expr(first, false, elidable);
        if (!isSymbol(target) && !Object.hasOwn(target, "capture")) this.fail(node, "a primary marks one symbol or capture");
        return { primary: target };
      }
      case "tested-factor": {
        const base = expr();
        if (!isSymbol(base)) this.fail(children[1], "a test applies to one symbol");
        return this.tests(base, children.slice(1), false, elidable);
      }
      case "ref":
      case "rule-reference":
        return { ref: this.value(node) };
      case "tag":
        return { ref: this.name(node) };
      case "range":
        return { range: children.map(child => this.stringOperand(rules(child)[0])) };
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

  optional(node, route) {
    const elidable = route.rule === "captured-terminator" || leaves(node).some(leaf => this.value(leaf) === "+");
    let optional = this.body(route, false, elidable);
    if (!elidable) return { optional };
    const symbol = optional.capture !== undefined ? optional.expr : optional.seq?.[0] ?? optional;
    const base = symbol.expr ?? symbol;
    const target = base.expr ?? base;
    if (!target.param && !/^[A-Z]/.test(target.ref ?? "")) {
      this.fail(route, "an elidable optional starts with an ungrouped user terminal or parameter");
    }
    const value = this.defaults?.get(symbol);
    if (value && optional.capture === undefined && optional.seq === undefined) optional = symbol;
    return { optional, elidable: true, ...(value && { default: value }) };
  }

  tests(base, testNodes, pattern, elidable = false) {
    const kinds = ["tag-test", "value-test", "default-value"];
    const tests = testNodes.map(wrapper => rules(wrapper)[0]);
    let previous = -1;
    for (const test of tests) {
      const index = kinds.indexOf(test.rule);
      if (index <= previous) this.fail(test, "a filter, value test and default must occur once in that order");
      if (index === 2 && !elidable) this.fail(test, "only an elidable head takes a default value");
      previous = index;
    }
    let result = base;
    for (const test of tests) {
      const at = this.at(test);
      if (test.rule === "tag-test") {
        const requirements = this.requirements(test);
        if (requirements.some(req => req.value.tag === "_Elided" && (!pattern || !req.negated))) {
          const targetIsRule = base.call || base.splice || base.name || /^[a-z]/.test(base.ref ?? "") ||
            base.ref && [...base.ref].length === 1 && this.unicode.canonicalTag(base.ref) === null &&
            !/^[A-Z_]/.test(base.ref);
          if (targetIsRule) this.fail(test, "the _Elided origin test applies only to a terminal");
        }
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

  requirements(node) {
    return parts(node, "tag-requirement").map(requirement => {
      const operand = rules(rules(requirement)[0])[0];
      const negated = this.value(requirement) === "¬";
      if (operand.rule === "tag") return { negated, value: { tag: this.name(operand, true) } };
      const value = this.stringOperand(operand, true, "a key requirement needs a tag, key-set constant or parameter");
      if (value.string !== undefined) this.fail(operand, "a key requirement needs a tag, key-set constant or parameter");
      return { negated, value };
    });
  }

  stringOperand(node, test = false, message = "a string operand needs a literal, constant or parameter") {
    if (test && node.rule === "test-operand") node = rules(node)[0];
    if (test && node.rule === "post" && rules(node).length === 1) node = rules(rules(node)[0])[0] ?? node;
    if (!["string", "constant-reference", "parameter"].includes(node.rule)) this.fail(node, message);
    return this.expression(node);
  }

  parameter(node) {
    return { param: this.value(node).slice(1), at: this.at(node) };
  }

  call(node) {
    return { call: this.value(node), args: parts(node, "call-argument").map(arg => this.argument(arg)), at: this.at(node) };
  }

  target(node) {
    const first = rules(node)[0];
    if (node.rule === "neighbor-target" || node.rule === "target-option") return this.target(first);
    if (node.rule === "call") return this.call(node);
    if (node.rule === "parameter") return this.parameter(node);
    if (node.rule === "tag") return { terminal: this.name(node) };
    return { rule: this.value(node) };
  }

  argument(node) {
    const first = rules(node)[0];
    const at = this.at(first);
    let result;
    if (first.rule === "expr") result = { expression: this.expression(first), at };
    else if (first.rule === "requirement-argument") result = { requirements: this.requirements(first), at };
    else if (first.rule === "target-argument") result = { targets: rules(first).map(target => this.target(target)), at };
    else {
      const body = this.body(first);
      if (body.ref !== undefined) {
        const key = /^[A-Z_]/.test(body.ref) ? "tag" : "rule";
        result = { [key]: body.ref, at };
      } else if (isSymbol(body)) result = { ...body, at: body.at ?? at };
      else result = { body, at };
    }
    const stack = [result];
    while (stack.length) {
      const value = stack.pop();
      if (!value || typeof value !== "object") continue;
      if (value.capture !== undefined) this.fail(this.origins.get(value) ?? first, "an argument cannot read or declare captures");
      for (const child of Object.values(value)) stack.push(child);
    }
    return this.remember(result, first);
  }

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
          at: this.at(operators.find(operator => operator.span[0] >= first.span[1])) };
      }
      case "neg":
        return operators.length ? { not: expr(first), at: this.at(operators[0]) } : expr(first);
      case "comparison": {
        if (children.length === 1) return expr(first);
        const op = this.value(children[1]);
        const left = expr(first);
        const right = expr(children[2]);
        if ((op === "≅" || op === "≇") && left.capture === undefined && !left.item) {
          this.fail(children[1], "a structural comparison needs one capture or bound item on its left");
        }
        return { op, left, right, at: this.at(children[1]) };
      }
      case "union":
      case "inter":
      case "sum":
        return this.binary(node, child => expr(child), false);
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
        return this.remember({ capture: this.value(node) === "$" ? "" : this.binder(node) }, node);
      case "grouped-expr":
        return children.length === 1 ? expr(first) :
          { if: expr(first), then: expr(children[1]), else: expr(children[2]), at: this.at(operators[1]) };
      case "item-reference":
        return first ? { property: this.name(first), receiver: { item: true }, at: this.at(node) } : { item: true };
      case "method":
        return this.method(node, { item: true });
      case "string":
        return { string: this.strings.decode(this.token(node)) };
      case "integer": {
        const integer = this.value(node);
        if (!/^(?:0|[1-9][0-9]*)$/.test(integer)) this.fail(node, "an integer cannot start with a leading zero");
        return { integer };
      }
      case "constant-reference":
        return { const: this.value(node).slice(1), at: this.at(node) };
      case "application":
        return { apply: this.value(node).slice(1), arg: expr(first), at: this.at(node) };
      case "parameter":
        return this.parameter(node);
      case "pattern-literal":
        return { pattern: this.pattern(node) };
      case "bag":
        return { bag: children.map(child => this.entry(child)) };
      case "list":
        return { list: children.map(child => this.entry(child)) };
      default:
        this.fail(node, `unexpected expression part ${node.rule}`);
    }
  }

  binary(node, convert, pattern) {
    const children = rules(node);
    const operators = leaves(node);
    let left = convert(children[0]);
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

  method(node, receiver) {
    const [selector] = rules(part(node, "selector"));
    const method = this.value(selector);
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
        const integer = this.expression(at).integer;
        if (method === "ngrams" && integer === "0") this.fail(at, "a width must be positive");
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
        const body = this.body(choice);
        const stack = [body];
        while (stack.length) {
          const child = stack.pop();
          if (!child || typeof child !== "object") continue;
          if (child.capture !== undefined) this.fail(this.origins.get(child) ?? choice, "a query cannot declare captures");
          for (const value of Object.values(child)) stack.push(value);
        }
        const sequence = [];
        if (this.value(query) === "…") sequence.push({ remainder: true });
        for (const operand of body.seq ?? [body]) sequence.push(operand);
        if (leaves(query).some(leaf => leaf.span[0] >= choice.span[1])) sequence.push({ remainder: true });
        args.push({ body: collapse("seq", sequence) });
        break;
      }
    }
    return { method, ...(receiver !== undefined && { receiver }), args, at: this.at(node) };
  }

  predicate(node) {
    const expr = part(node, "expr");
    const value = this.expression(expr);
    if (value.lambda !== undefined || value.const !== undefined || value.capture !== undefined || value.param !== undefined) {
      return value;
    }
    const first = expr.span[0];
    const index = this.tokens[first].value === "¬" ? first + 1 : first;
    if (!["'", "."].includes(this.tokens[index].value)) this.fail(node, "a predicate requires an explicit binder");
    return { lambda: "", body: value, at: this.at(node) };
  }

  entry(node) {
    const prefix = part(node, "prefix");
    const gates = parts(prefix, "feature-gate").map(gate => this.gate(gate));
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
      if (value === "$" && !bag) this.fail(selector, "only a braced item can select the whole rule");
      const capture = value === "$" ? "" : this.binder(selector);
      return { capture, ...(term && { term }), ...suffix };
    }
    const body = rules(node)[1];
    switch (body.rule) {
      case "bare-entry":
        return { kind: "bare", key: this.name(part(body, "key")), ...suffix };
      case "write-entry":
        return { kind: "write", keys: parts(body, "key").map(key => this.name(key)),
          value: this.expression(part(body, "expr")), ...suffix };
      case "delete-entry":
        return { kind: "delete", key: this.name(part(body, "key")), ...suffix };
      case "splat-entry":
        return { kind: "splat", value: this.expression(part(body, "expr")), ...suffix };
      case "copy-entry": {
        const source = this.expression(part(body, "post"));
        if (source.property === undefined) this.fail(body, "a copy ends with a property selector");
        return { kind: "copy", source: source.receiver, key: source.property, ...suffix };
      }
    }
  }

  pattern(node) {
    const children = rules(node);
    const first = children[0];
    const operators = leaves(node);
    switch (node.rule) {
      case "pattern-literal":
      case "pattern-primary":
        return this.pattern(first);
      case "pattern-union":
      case "pattern-intersection":
        return this.binary(node, child => this.pattern(child), true);
      case "pattern-path":
        return this.patternPath(node, this.pattern(first));
      case "bare-child-list":
        return { any: true, ...(operators.length && { exact: true }), children: this.items(first) };
      case "pattern-node": {
        const { at, ...atom } = this.pattern(first);
        if (children[1] && !atom.name && !atom.call && !atom.param) {
          this.fail(children[1], "only a rule atom, call or parameter can have a child list");
        }
        return { ...atom, ...(operators.length && { exact: true }),
          ...(children[1] && { children: this.items(children[1]) }), at };
      }
      case "pattern-atom": {
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
        return this.tests(atom, children.slice(1), true);
      }
      case "parameter":
        return this.parameter(node);
      case "call":
        return this.call(node);
      case "child-set-operation":
      case "child-intersection":
        return this.binary(node, child => this.singlePattern(child), true);
      default:
        this.fail(node, `unexpected pattern part ${node.rule}`);
    }
  }

  patternPath(node, pattern) {
    const mark = leaves(node)[0];
    const names = { "⋮": "descendant", "⋱": "last", "⋰": "first" };
    return mark ? { path: names[this.value(mark)], pattern } : pattern;
  }

  singlePattern(node) {
    const items = this.items(node);
    if (items.length !== 1 || !items[0].child) this.fail(node, "an operator needs one whole pattern");
    return items[0].child;
  }

  items(node) {
    const children = rules(node);
    const first = children[0];
    switch (node.rule) {
      case "child-list":
        return first ? this.items(first) : [];
      case "child-choice": {
        const choices = children.map(alt => this.items(alt));
        if (choices.length === 1) return choices[0];
        return [{ choice: choices.flatMap(items => items.length === 1 && items[0].choice ? items[0].choice : [items]) }];
      }
      case "child-alternative":
      case "child-item":
        return first ? this.items(first) : [{ siblings: true }];
      case "child-primary":
        return first.rule === "child-choice" ? this.items(first) : [{ child: this.pattern(first) }];
      case "child-sequence":
        return children.flatMap(item => this.items(item));
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

function tooDeep(declaration) {
  const pending = [];
  const push = (value, depth) => {
    if (value && typeof value === "object") pending.push([value, depth]);
  };
  const entries = (items, depth) => {
    for (const item of items) for (const key of ["guard", "source", "value"]) push(item[key], depth);
  };
  push(declaration.term, 0);
  push(declaration.value, 0);
  push(declaration.error, 0);
  push(declaration.warning, 0);
  for (const condition of declaration.conditions ?? []) push(condition, 0);
  for (const alt of declaration.alternatives ?? []) {
    push(alt.expr, 0);
    push(alt.term, 0);
  }
  for (const item of declaration.emit?.items ?? []) {
    push(item.guard, 0);
    push(item.term, 0);
  }
  for (const step of declaration.steps ?? []) push(step.pattern, 0);
  if (declaration.instance) push(declaration.instance, 0);
  for (const arg of declaration.args ?? []) push(arg, 0);
  while (pending.length) {
    const [node, depth] = pending.pop();
    if (depth > DOM_MAX_DEPTH) return true;
    if (Array.isArray(node)) {
      for (const child of node) push(child, depth);
      continue;
    }
    if (node.primary || node.expression || node.kind) {
      push(node.primary ?? node.expression, depth);
      if (node.kind) entries([node], depth);
      continue;
    }
    if (node.bag || node.list) {
      entries(node.bag ?? node.list, depth + 1);
      continue;
    }
    if (node.map) {
      push(node.map, depth + 1);
      if (node.by.method) push(node.by.args, depth + 1);
      else if (!node.by.property) push(node.by, depth + 1);
      continue;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === "at") continue;
      push(child, key === "literal" || key === "range" || key === "requirements" ? depth : depth + 1);
    }
  }
  return false;
}
