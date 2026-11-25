// Evaluates format 50 expressions on a chosen tree (engine §10). The
// recognizer evaluates the conditions that recognition needs. This module
// evaluates what runs after the choice: bag terms, the defaults function,
// emission terms and messages.

import { GencmuError } from "../errors.js";
import { compareCodePoints } from "../tags.js";
import { BARE, Bag, CLASS_KEY, Deferred, keySet, valued } from "./bag.js";


/** A function value: one parameter and a body, closed over its scope. */
export class Fn {
  /**
   * @param {any} param
   * @param {any} body
   * @param {any} scope
   */
  constructor(param, body, scope) {
    this.param = param;
    this.body = body;
    this.scope = scope;
  }
}

/**
 * The forest of a query after the choice of a parse. The stage answers its
 * tests on the chosen derivation through the recognizer's evaluator.
 */
export class Forest {
  /**
   * @param {any} node the query record
   * @param {any} scope the scope of its evaluation
   */
  constructor(node, scope) {
    this.node = node;
    this.scope = scope;
  }
}

const QUERIES = new Set(["parse", "error-free", "followed-by", "preceded-by"]);

/** A half-open window on the input of a stage. */
export class Span {
  /**
   * @param {StageData} stage
   * @param {number} start
   * @param {number} end
   */
  constructor(stage, start, end) {
    this.stage = stage;
    this.start = start;
    this.end = end;
  }
}

/**
 * What an expression can read of its stage.
 * @typedef {object} StageData
 * @property {any[]} tokens the input tokens of the stage, as format 50 tokens
 * @property {string[]} sourceText the original text as code points
 * @property {(token: any, index: number) => any} leaf the input leaf of a token
 * @property {Set<string>} features the features that are on
 * @property {Map<string, any[]>} constants the versions of each constant
 * @property {(kind: string, node: any, scope: any) => any} [lateQuery] runs a query after the choice of a parse
 */

/**
 * @param {any} description
 * @param {any} at
 * @param {any} document
 */
export function evaluationError(description, at, document) {
  return new GencmuError("grammar", description, { ...(document ? { document } : {}), ...(at ? { line: at[0], column: at[1] } : {}) });
}

/**
 * Joins strings with `+`, so that the engine shares the parts and does not
 * copy them. A run of one rule joins the value of its child at each level,
 * and a copy at each level costs the square of the run (part 2 §10).
 * @param {string[]} parts
 * @param {string} separator
 */
function concatenate(parts, separator) {
  let text = "";
  for (const [index, part] of parts.entries()) text = index ? text + separator + part : part;
  return text;
}

/**
 * Whether an expression is a set of patterns with at least one operator,
 * such as `#A ∖ ∅` (part 1 §9).
 * @param {any} node
 */
export function isPatternSet(node) {
  const operands = node.union ?? node.intersection ?? node.difference;
  if (!operands) return false;
  const operand = (/** @type {any} */ item) => item.pattern !== undefined || item.emptySet || isPatternSet(item);
  return operands.every(operand);
}

export class Evaluator {
  /** @param {StageData} stage */
  constructor(stage) {
    this.stage = stage;
    /** @type {Map<any, any>} */
    this.constantValues = new Map();
    /** @type {() => Bag} the bag of the input keys of the stage */
    this.inputs = () => new Bag();
  }

  /**
   * @param {any} description
   * @param {any} node
   * @param {any} scope
   * @returns {never}
   */
  fail(description, node, scope) {
    throw evaluationError(description, node?.at, scope?.document);
  }

  /**
   * The value of a constant version.
   * @param {string} name
   * @param {number} index
   * @param {any} node
   * @param {any} scope
   * @returns {any}
   */
  constant(name, index, node, scope) {
    const versions = this.stage.constants.get(name);
    if (!versions || index < 0) this.fail(`the constant $${name} is not defined`, node, scope);
    const version = versions[Math.min(index, versions.length - 1)];
    if (this.constantValues.has(version)) return this.constantValues.get(version);
    const own = { name, index: versions.indexOf(version) };
    const constantScope = { constant: own, items: [], names: new Map(), document: version.document };
    /** @type {any} */
    const value = version.record.value.lambda !== undefined
      ? new Fn(version.record.value.lambda, version.record.value.body, constantScope)
      : this.evaluate(version.record.value, constantScope);
    this.constantValues.set(version, value);
    return value;
  }

  /**
   * @param {any} name
   * @param {any} node
   * @param {any} scope
   * @returns {any}
   */
  constantReference(name, node, scope) {
    const self = scope.constant;
    const versions = this.stage.constants.get(name);
    const index = self && self.name === name ? self.index - 1 : (versions ? versions.length - 1 : -1);
    return this.constant(name, index, node, scope);
  }

  /**
   * Applies a function value to one argument.
   * @param {any} fn
   * @param {any} argument
   * @param {any} node
   * @returns {any}
   */
  applyFunction(fn, argument, node) {
    if (!(fn instanceof Fn)) this.fail("only a function can take an argument", node, fn?.scope);
    const names = new Map(fn.scope.names);
    if (fn.param) names.set(fn.param, argument);
    return this.evaluate(fn.body, { ...fn.scope, names, items: [...fn.scope.items, argument] });
  }

  /**
   * @param {any} node
   * @param {any} scope
   * @returns {any}
   */
  predicate(node, scope) {
    if (node.lambda !== undefined) return new Fn(node.lambda, node.body, scope);
    /** @type {any} */
    const value = this.evaluate(node, scope);
    if (!(value instanceof Fn)) this.fail("a predicate needs a function", node, scope);
    return value;
  }

  /**
   * @param {any} node
   * @param {any} scope
   * @returns {any}
   */
  truth(node, scope) {
    return this.toTruth(this.evaluate(node, scope, true), node, scope);
  }

  /**
   * @param {any} value
   * @param {any} node
   * @param {any} scope
   */
  toTruth(value, node, scope) {
    if (typeof value === "boolean") return value;
    if (value instanceof Occurrence) return true;
    if (Array.isArray(value)) return value.length > 0;
    if (value instanceof Bag) return value.size > 0;
    if (value instanceof Span) return value.end > value.start;
    if (value instanceof Forest) return /** @type {NonNullable<StageData["lateQuery"]>} */ (this.stage.lateQuery)("truth", value.node, value.scope);
    if (value === undefined) return false;
    return this.fail(`${describe(value)} cannot serve as a truth value`, node, scope);
  }

  /**
   * Evaluates an expression record.
   * @param {any} node
   * @param {any} scope
   * @param {boolean} [truthPosition] whether a missing capture gives false
   * @returns {any}
   */
  evaluate(node, scope, truthPosition = false) {
    if (node.string !== undefined) return node.string;
    if (node.inputs) return this.inputs();
    if (node.integer !== undefined) return Number(node.integer);
    if (node.capture !== undefined) return this.capture(node, scope, truthPosition);
    if (node.const !== undefined) return this.constantReference(node.const, node, scope);
    if (node.apply !== undefined) {
      const fn = this.constantReference(node.apply, node, scope);
      return this.applyFunction(fn, this.evaluate(node.arg, scope), node);
    }
    if (node.item) {
      if (!scope.items.length) this.fail("no item is bound here", node, scope);
      return scope.items.at(-1);
    }
    if (node.lambda !== undefined) return new Fn(node.lambda, node.body, scope);
    if (node.bag) return this.bag(node.bag, scope);
    if (node.list) return this.list(node.list, scope);
    if (node.not !== undefined) return !this.truth(node.not, scope);
    if (node.all) return node.all.every((/** @type {any} */ item) => this.truth(item, scope));
    if (node.any) return node.any.some((/** @type {any} */ item) => this.truth(item, scope));
    if (node.if !== undefined) {
      const test = this.truth(node.if, scope);
      if (node.else === undefined) return !test || this.truth(node.then, scope);
      return test ? this.evaluate(node.then, scope, truthPosition) : this.evaluate(node.else, scope, truthPosition);
    }
    if (node.op !== undefined) return this.comparison(node, scope);
    if (node.concat) return concatenate(node.concat.map((/** @type {any} */ item) => this.string(item, scope)), "");
    if (node.union) return this.setOperation("union", node.union, scope, node);
    if (node.intersection) return this.setOperation("intersection", node.intersection, scope, node);
    if (node.difference) return this.difference(node, scope);
    if (node.property !== undefined) {
      /** @type {any} */
      const receiver = node.receiver ? this.evaluate(node.receiver, scope) : this.item(node, scope);
      return this.property(receiver, node.property, node, scope);
    }
    // A query runs on the chosen derivation, through the recognizer.
    if (node.method !== undefined && QUERIES.has(node.method)) {
      if (!this.stage.lateQuery) this.fail(`.${node.method} cannot run here`, node, scope);
      return node.method === "followed-by" || node.method === "preceded-by"
        ? /** @type {NonNullable<StageData["lateQuery"]>} */ (this.stage.lateQuery)("truth", node, scope)
        : new Forest(node, scope);
    }
    if (node.method !== undefined && node.receiver && (node.method === "flags" || node.method === "any" || node.method === "all")) {
      /** @type {any} */
      const receiver = this.evaluate(node.receiver, scope);
      if (receiver instanceof Forest) {
        /** @type {any} */
        const query = { ...node, receiver: receiver.node };
        return node.method === "flags" ? /** @type {NonNullable<StageData["lateQuery"]>} */ (this.stage.lateQuery)("keys", query, receiver.scope) : /** @type {NonNullable<StageData["lateQuery"]>} */ (this.stage.lateQuery)("truth", query, receiver.scope);
      }
    }
    if (node.method !== undefined) {
      // In a shared term, .present on a capture of another alternative is
      // false, as the bare capture is in a truth position.
      if (node.method === "present" && node.receiver?.capture && !scope.names.has(node.receiver.capture) &&
          !scope.captures?.has(node.receiver.capture) && scope.shared) return false;
      /** @type {any} */
      const receiver = node.receiver ? this.evaluate(node.receiver, scope) : this.item(node, scope);
      return this.method(receiver, node, scope);
    }
    if (node.map !== undefined) return this.map(node, scope);
    if (node.flatten !== undefined) {
      /** @type {any} */
      const list = this.evaluate(node.flatten, scope);
      if (!Array.isArray(list) || !list.every(Array.isArray)) this.fail("↓ needs a list of lists", node, scope);
      return list.flat(1);
    }
    if (node.param !== undefined) this.fail(`the parameter @${node.param} has no argument`, node, scope);
    return this.fail("this expression cannot run after the choice of a parse", node, scope);
  }

  /**
   * @param {any} node
   * @param {any} scope
   */
  item(node, scope) {
    if (!scope.items.length) this.fail("no item is bound here", node, scope);
    return scope.items.at(-1);
  }

  /**
   * @param {any} node
   * @param {any} scope
   * @param {any} truthPosition
   */
  capture(node, scope, truthPosition) {
    const name = node.capture;
    if (name === "") {
      if (!scope.node) this.fail("$ has no occurrence here", node, scope);
      return scope.node;
    }
    if (scope.names.has(name)) return scope.names.get(name);
    if (scope.captures?.has(name)) return scope.captures.get(name);
    if (truthPosition && scope.declared?.has(name)) return false;
    if (truthPosition && scope.shared) return false;
    return this.fail(`the capture $${name} is not bound here`, node, scope);
  }

  /**
   * @param {any} entries
   * @param {any} scope
   */
  bag(entries, scope, bag = new Bag()) {
    for (const entry of entries) {
      if (!entry.gates.every((/** @type {any} */ gate) => this.stage.features.has(gate.feature) !== gate.negated)) continue;
      const guard = entry.guard ? () => this.truth(entry.guard, scope) : null;
      switch (entry.kind) {
        case "bare":
          bag.write([entry.key], BARE, guard);
          break;
        case "write":
          bag.write(entry.keys, valued(new Deferred(() => this.payload(entry.value, scope))), guard);
          break;
        case "copy":
          bag.copy(entry.key, () => this.bagOf(this.evaluate(entry.source, scope), entry, scope), guard);
          break;
        case "splat":
          bag.splat(() => this.bagOf(this.evaluate(entry.value, scope), entry, scope), guard);
          break;
        case "delete":
          bag.delete(entry.key, guard);
          break;
        default:
          this.fail(`unknown entry ${entry.kind}`, entry, scope);
      }
    }
    return bag;
  }

  /**
   * @param {any} node
   * @param {any} scope
   */
  payload(node, scope) {
    const value = this.evaluate(node, scope);
    if (!isPayload(value)) this.fail(`${describe(value)} cannot be the value of a key`, node, scope);
    return value;
  }

  /**
   * @param {any} value
   * @param {any} node
   * @param {any} scope
   */
  bagOf(value, node, scope) {
    if (value instanceof Bag) return value;
    if (value instanceof Occurrence) return value.bag();
    return this.fail(`${describe(value)} has no entries to copy`, node, scope);
  }

  /**
   * @param {any} items
   * @param {any} scope
   * @returns {any}
   */
  list(items, scope) {
    const list = [];
    for (const item of items) {
      if (!item.gates.every((/** @type {any} */ gate) => this.stage.features.has(gate.feature) !== gate.negated)) continue;
      if (item.guard && !this.truth(item.guard, scope)) continue;
      /** @type {any} */
      const value = this.evaluate(item.value, scope);
      if (item.kind === "splat") {
        if (!Array.isArray(value)) this.fail("only a list can be spread in a list", item, scope);
        for (const element of value) list.push(element);
      } else list.push(value);
    }
    return list;
  }

  /**
   * @param {any} node
   * @param {any} scope
   * @returns {any}
   */
  string(node, scope) {
    /** @type {any} */
    const value = this.evaluate(node, scope);
    if (typeof value !== "string") this.fail(`${describe(value)} is not a string`, node, scope);
    return value;
  }

  /**
   * @param {any} node
   * @param {any} scope
   * @returns {any}
   */
  comparison(node, scope) {
    // A structural comparison of two captured nodes runs on the chosen
    // derivation, through the recognizer, which compares their trees.
    if (node.op === "≅" || node.op === "≇") {
      // No node is like the empty set of patterns.
      if (node.right.emptySet) return node.op === "≇";
      if (this.stage.lateQuery && node.left.capture !== undefined &&
        (node.right.capture !== undefined || node.right.pattern !== undefined || node.right.const !== undefined || isPatternSet(node.right))) {
        return this.stage.lateQuery("compare", node, scope);
      }
      this.fail(`the format 50 engine cannot yet compare with ${node.op} and a pattern after the choice of a parse`, node, scope);
    }
    /** @type {any} */
    const left = this.evaluate(node.left, scope);
    /** @type {any} */
    const right = this.evaluate(node.right, scope);
    switch (node.op) {
      case "=": return equal(left, right);
      case "≠": return !equal(left, right);
      case "<": return left < right;
      case "≤": return left <= right;
      case ">": return left > right;
      case "≥": return left >= right;
      case "∈": return Array.isArray(right) ? right.some(item => equal(left, item)) : this.fail("∈ needs a list", node, scope);
      case "∉": return Array.isArray(right) ? !right.some(item => equal(left, item)) : this.fail("∉ needs a list", node, scope);
      case "⊆": return this.keys(left, node, scope).every((/** @type {any} */ key) => right.has(key));
      case "⊈": return !this.keys(left, node, scope).every((/** @type {any} */ key) => right.has(key));
      case "+": return left + right;
      default: return this.fail(`the comparison ${node.op} cannot run after the choice of a parse`, node, scope);
    }
  }

  /**
   * @param {any} value
   * @param {any} node
   * @param {any} scope
   */
  keys(value, node, scope) {
    if (!(value instanceof Bag)) this.fail(`${describe(value)} is not a key set`, node, scope);
    return value.keys();
  }

  /**
   * @param {any} kind
   * @param {any} operands
   * @param {any} scope
   * @param {any} node
   */
  setOperation(kind, operands, scope, node) {
    const sets = operands.map((/** @type {any} */ item) => this.keys(this.evaluate(item, scope), node, scope));
    if (kind === "union") return keySet(sets.flat());
    return keySet(sets[0].filter((/** @type {any} */ key) => sets.slice(1).every((/** @type {any} */ set) => set.includes(key))));
  }

  /**
   * @param {any} node
   * @param {any} scope
   * @returns {any}
   */
  difference(node, scope) {
    const [leftNode, rightNode] = node.difference;
    /** @type {any} */
    const left = this.evaluate(leftNode, scope);
    /** @type {any} */
    const right = this.evaluate(rightNode, scope);
    if (Array.isArray(left)) {
      /** @type {any} */
      const exclusions = Array.isArray(right) ? right : [right];
      return left.filter(item => !exclusions.some((/** @type {any} */ other) => equal(item, other)));
    }
    const remove = new Set(this.keys(right, node, scope));
    return keySet(this.keys(left, node, scope).filter((/** @type {any} */ key) => !remove.has(key)));
  }

  /**
   * @param {any} receiver
   * @param {any} key
   * @param {any} node
   * @param {any} scope
   */
  property(receiver, key, node, scope) {
    const bag = receiver instanceof Occurrence ? receiver.bag() : receiver;
    if (!(bag instanceof Bag)) this.fail(`${describe(receiver)} has no key '${key}`, node, scope);
    const entry = bag.entry(key);
    if (entry === null) return false;
    if (entry === BARE) return true;
    return entry.deferred.force();
  }

  /**
   * @param {any} node
   * @param {any} scope
   * @returns {any}
   */
  map(node, scope) {
    /** @type {any} */
    const list = this.evaluate(node.map, scope);
    if (!Array.isArray(list)) this.fail(`${describe(list)} is not a list to map`, node, scope);
    const by = node.by;
    if (by.property !== undefined && by.receiver === undefined) return list.map((/** @type {any} */ item) => this.property(item, by.property, by, scope));
    if (by.method !== undefined && by.receiver === undefined) return list.map((/** @type {any} */ item) => this.method(item, by, scope));
    const fn = this.predicate(by, scope);
    return list.map((/** @type {any} */ item) => this.applyFunction(fn, item, node));
  }

  /**
   * @param {any} receiver
   * @param {any} node
   * @param {any} scope
   * @returns {any}
   */
  method(receiver, node, scope) {
    const name = node.method;
    const args = node.args;
    if (receiver instanceof Occurrence) {
      switch (name) {
        case "span": return new Span(this.stage, receiver.span[0], receiver.span[1]);
        case "children": return receiver.workingChildren();
        case "present": return true;
        case "keys": case "flags": case "classes": case "select": case "has": case "has-value":
          return this.bagMethod(receiver.bag(), node, scope);
        default:
          return this.spanMethod(new Span(this.stage, receiver.span[0], receiver.span[1]), node, scope);
      }
    }
    if (receiver instanceof Span) return this.spanMethod(receiver, node, scope);
    if (receiver instanceof Bag) return this.bagMethod(receiver, node, scope);
    if (Array.isArray(receiver)) {
      switch (name) {
        case "present": return receiver.length > 0;
        case "all": {
          /** @type {any} */
          const fn = this.predicate(args[0], scope);
          return receiver.every(item => this.toTruth(this.applyFunction(fn, item, node), node, scope));
        }
        case "any": {
          if (!args.length) return receiver.length > 0;
          /** @type {any} */
          const fn = this.predicate(args[0], scope);
          return receiver.some(/** @returns {any} */ item => this.toTruth(this.applyFunction(fn, item, node), node, scope));
        }
        case "join": {
          /** @type {any} */
          const separator = args.length ? this.string(args[0], scope) : "";
          if (!receiver.every(item => typeof item === "string")) this.fail(".join() needs a list of strings", node, scope);
          return concatenate(receiver, separator);
        }
        case "union": return keySet(receiver.flatMap(item => this.keys(item, node, scope)));
        default: break;
      }
    }
    if (typeof receiver === "string") {
      if (name === "split") {
        /** @type {any} */
        const delimiter = this.string(args[0], scope);
        if (delimiter === "") this.fail(".split() has an empty delimiter", node, scope);
        return receiver.split(delimiter).filter(piece => piece !== "");
      }
      if (name === "ngrams") {
        const width = Number(args[0].integer);
        const scalars = [...receiver];
        const result = [];
        for (let index = 0; index + width <= scalars.length; index++) result.push(scalars.slice(index, index + width).join(""));
        return result;
      }
    }
    if (typeof receiver === "number" && name === "at-most") return Math.min(receiver, Number(args[0].integer));
    return this.fail(`${describe(receiver)} has no method .${name}`, node, scope);
  }

  /**
   * @param {any} bag
   * @param {any} node
   * @param {any} scope
   * @returns {any}
   */
  bagMethod(bag, node, scope) {
    const name = node.method;
    switch (name) {
      case "keys": return keySet(bag.keys());
      case "flags": return keySet(bag.keys().filter((/** @type {any} */ key) => /^[A-Z_]/.test(key)));
      case "classes": return keySet(bag.keys().filter((/** @type {any} */ key) => CLASS_KEY.test(key)));
      case "has": return bag.has(node.args[0].key);
      case "has-value": return bag.hasValue(node.args[0].key);
      case "select": {
        const mask = new Set(this.keys(this.evaluate(node.args[0], scope), node, scope));
        return Bag.from(bag.keys().filter((/** @type {any} */ key) => mask.has(key)).map((/** @type {any} */ key) => [key, bag.entry(key)]));
      }
      case "overlaps": {
        const other = this.evaluate(node.args[0], scope);
        return bag.keys().some((/** @type {any} */ key) => other.has(key));
      }
      case "classify": return classify(bag, this.string(node.args[0], scope));
      default: return this.fail(`a bag has no method .${name}`, node, scope);
    }
  }

  /**
   * @param {any} span
   * @param {any} node
   * @param {any} scope
   */
  spanMethod(span, node, scope) {
    const stage = this.stage;
    const count = stage.tokens.length;
    const name = node.method;
    switch (name) {
      case "tokens": {
        const leaves = [];
        for (let index = span.start; index < span.end; index++) leaves.push(stage.leaf(stage.tokens[index], index));
        return leaves;
      }
      case "flags": case "classes": {
        const keys = [];
        for (let index = span.start; index < span.end; index++) for (const key of stage.leaf(stage.tokens[index], index).bag().keys()) keys.push(key);
        const pattern = name === "flags" ? /^[A-Z_]/ : CLASS_KEY;
        return keySet(keys.filter(key => pattern.test(key)));
      }
      case "first-token": return new Span(stage, span.start, Math.min(span.end, span.start + 1));
      case "last-token": return new Span(stage, Math.max(span.start, span.end - 1), span.end);
      case "tokens-after-first": return new Span(stage, Math.min(span.end, span.start + 1), span.end);
      case "onward": return new Span(stage, span.start, count);
      case "following-tokens": return new Span(stage, span.end, count);
      case "preceding-tokens": return new Span(stage, 0, span.start);
      case "starts-input": return span.start === 0;
      case "ends-input": return span.end === count;
      case "source-text": case "verbatim-text": return sourceText(stage, span);
      case "decomposed-source-text": return sourceText(stage, span).normalize("NFD");
      default: return this.fail(`.${name} cannot run after the choice of a parse`, node, scope);
    }
  }
}

/**
 * @param {any} stage
 * @param {any} span
 */
function sourceText(stage, span) {
  if (span.start >= span.end) return "";
  let start = Infinity;
  let end = -Infinity;
  for (let index = span.start; index < span.end; index++) {
    const [from, to] = stage.tokens[index].source;
    start = Math.min(start, from);
    end = Math.max(end, to);
  }
  return stage.sourceText.slice(start, end).join("");
}

/**
 * The classes of a lexicon that hold a string (engine §2): the keys whose
 * string or list holds it, and the keys whose key set names a class found.
 * @param {Bag} lexicon
 * @param {string} spelling
 */
export function classify(lexicon, spelling) {
  const found = new Set();
  const referrers = new Map();
  for (const key of lexicon.keys()) {
    const value = lexicon.value(key);
    if (value === undefined) throw new GencmuError("grammar", `the class ${key} has no value`);
    if (typeof value === "string") {
      if (value === spelling) found.add(key);
    } else if (Array.isArray(value)) {
      if (value.includes(spelling)) found.add(key);
    } else if (value instanceof Bag) {
      for (const target of value.keys()) {
        if (!referrers.has(target)) referrers.set(target, []);
        referrers.get(target).push(key);
      }
    }
  }
  const pending = [...found];
  while (pending.length) {
    const key = pending.pop();
    for (const referrer of referrers.get(key) ?? []) {
      if (found.has(referrer)) continue;
      found.add(referrer);
      pending.push(referrer);
    }
  }
  return keySet([...found].sort(compareCodePoints));
}

/** @param {any} value */
export function isPayload(value) {
  if (typeof value === "string") return true;
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 && value <= 255;
  if (value instanceof Bag) return true;
  return Array.isArray(value) && value.every(isPayload);
}

/**
 * Equality of strings, numbers, truths, key sets and lists of those.
 * @param {any} left
 * @param {any} right
 * @returns {any}
 */
export function equal(left, right) {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => equal(item, right[index]));
  }
  if (left instanceof Bag && right instanceof Bag) {
    const a = left.keys();
    const b = right.keys();
    return a.length === b.length && a.every((key, index) => key === b[index]);
  }
  return left === right;
}

/** @param {any} value */
export function describe(value) {
  if (typeof value === "string") return "a string";
  if (typeof value === "number") return "a number";
  if (typeof value === "boolean") return "a truth value";
  if (value instanceof Fn) return "a function";
  if (value instanceof Span) return "a span";
  if (value instanceof Bag) return "a bag";
  if (value instanceof Occurrence) return "a node";
  if (Array.isArray(value)) return "a list";
  return "a value";
}

/**
 * One occurrence of a chosen tree, a projection or an insertion (engine §1).
 */
export class Occurrence {
  /**
   * @param {any} kind
   * @param {any} fields
   */
  constructor(kind, fields) {
    this.kind = kind;
    // The fields of each kind of node (engine §1). A kind leaves out the
    // fields that it does not have.
    /** @type {any} */ this.rule = undefined;
    /** @type {any} */ this.origin = undefined;
    /** @type {any} */ this.derivation = undefined;
    /** @type {any} */ this.span = undefined;
    /** @type {any} */ this.source = undefined;
    /** @type {any} */ this.terminal = undefined;
    /** @type {any} */ this.token = undefined;
    /** @type {any} */ this.input = undefined;
    /** @type {any} */ this.erased = undefined;
    /** @type {any} */ this.producer = undefined;
    /** @type {any} */ this.part = undefined;
    /** @type {any} */ this.item = undefined;
    /** @type {any} the chosen reading that holds a rule node */ this.reading = undefined;
    /** @type {Map<string, any> | undefined} */ this.captures = undefined;
    /** @type {Occurrence | null | undefined} */ this.primary = undefined;
    /** @type {() => Bag} */ this.makeBag = () => { throw new Error(`a node of kind ${kind} has no bag`); };
    this.computing = false;
    /** @type {Occurrence[]} */ this.children = [];
    Object.assign(this, fields);
    this.children ??= [];
    this.bagCache = null;
  }

  /** @returns {Bag} */
  bag() {
    if (this.bagCache === null) {
      if (this.computing) throw new GencmuError("grammar", `the bag of ${this.rule ?? "a node"} reads itself`);
      this.computing = true;
      try {
        this.bagCache = this.makeBag();
      } finally {
        this.computing = false;
      }
    }
    return this.bagCache;
  }

  /** The children that a term reads through `.children`. */
  workingChildren() {
    return this.children;
  }
}
