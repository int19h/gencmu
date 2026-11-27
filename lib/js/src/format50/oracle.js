// A test mode of the format 50 stage. After the choice of a parse, it
// checks the chosen tree against the written format 50 records, on the real
// bags. For each rule occurrence, it matches the written body of its
// alternative against the working children of the occurrence. It checks the
// symbol tests of the body on the children, binds the captures itself, and
// evaluates each condition that applies. The recognizer accepted the tree,
// so some route of the body holds. Where no route holds, recognition and
// the stage disagree.
//
// The module reads nothing that the bridge lowered: no lowered production,
// no lowered test and no capture list of the recognizer. A query, a neighbor
// test and a structural comparison run only through the recognizer, so the
// oracle refuses them, and it counts each refusal. A thrown error on a
// condition or a test is a disagreement, unless it is an explicit refusal
// of the late path. It runs only where a test sets hooks.oracle50.
import { GencmuError } from "../errors.js";
import { Evaluator } from "./evaluate.js";
import { rankedOnlyNames } from "./validate.js";

/**
 * @typedef {{stage: string, kind: string, rule: string, document?: string,
 *   at?: any, answer: boolean | null, detail: string}} Disagreement
 */

// The most routes that the oracle follows for one occurrence.
const ROUTE_LIMIT = 512;

// The messages of an explicit refusal: of the late path, and of the reads
// that only the recognizer runs.
const REFUSAL = /cannot yet|cannot run after the choice of a parse|cannot run here|the oracle does not evaluate/;
const ORACLE_REFUSAL = "the oracle does not evaluate a query, a neighbor test or a structural comparison, which only the recognizer runs";

/**
 * Checks the chosen tree of one stage.
 * @param {any} root the occurrence of the chosen tree
 * @param {any} data the stage data, with its evaluator
 * @param {string} stage the name of the stage
 * @param {any} owner the stage, which makes compound bindings
 * @returns {{checked: number, refused: Disagreement[], undecided: Disagreement[], disagreements: Disagreement[], higher: {checked: number, unmatched: number}}}
 */
export function checkChosenTree(root, data, stage, owner) {
  const result = {
    checked: 0, refused: /** @type {Disagreement[]} */ ([]), undecided: /** @type {Disagreement[]} */ ([]),
    disagreements: /** @type {Disagreement[]} */ ([]), higher: { checked: 0, unmatched: 0 },
  };
  // The evaluator of the oracle refuses the reads that only the recognizer
  // runs, and it is the stage's evaluator in every other way.
  const evaluator = new Evaluator(Object.assign(Object.create(data), {
    lateQuery: () => { throw new GencmuError("grammar", ORACLE_REFUSAL); },
  }));
  evaluator.inputs = data.evaluator.inputs;
  const context = { data, evaluator, owner, stage, result };
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || (node.kind !== "rule" && node.kind !== "splice")) continue;
    for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]);
    checkOccurrence(node, context);
  }
  return result;
}

/**
 * @param {any} node a rule or splice occurrence
 * @param {any} context
 */
function checkOccurrence(node, context) {
  const { result, stage } = context;
  const origin = node.origin;
  const report = (/** @type {Disagreement[]} */ list, /** @type {string} */ kind, /** @type {string} */ detail, /** @type {any} */ at) =>
    list.push({ stage, kind, rule: node.rule, document: origin?.document, at, answer: null, detail });
  if (!origin) {
    report(result.undecided, "occurrence", "the occurrence has no written origin", undefined);
    return;
  }
  const expr = origin.alternative.expr;
  const kinds = captureKindsOf(expr);
  const matcher = new Matcher(node, context, kinds);
  let routes;
  try {
    routes = matcher.routes();
  } catch (error) {
    if (error instanceof OracleLimit) {
      report(result.undecided, "occurrence", error.message, origin.alternative.at);
      return;
    }
    throw error;
  }
  const conditions = applicableConditions(origin.rule.conditions ?? [], kinds, expr);
  /** @type {any} */
  let best = null;
  for (const route of routes) {
    const verdict = judge(route, conditions, node, context);
    if (verdict.state === "holds") {
      best = verdict;
      break;
    }
    if (!best || rank(verdict.state) < rank(best.state)) best = verdict;
  }
  if (!best) {
    report(result.disagreements, "body", "the recognizer accepted the occurrence, and no route of its written body matches its children", origin.alternative.at);
    return;
  }
  result.checked += best.checked;
  for (const item of best.refused) report(result.refused, item.kind, item.detail, item.at);
  if (best.state === "fails") {
    report(result.disagreements, best.failure.kind, best.failure.detail, best.failure.at);
    return;
  }
  if (best.state === "undecided") return;
  higherOptions(best.route, conditions, node, context);
}

/** @param {string} state */
function rank(state) {
  return state === "holds" ? 0 : state === "undecided" ? 1 : 2;
}

/**
 * The verdict of one route: its symbol tests, then each condition that
 * applies to it.
 * @param {any} route
 * @param {any[]} conditions
 * @param {any} node
 * @param {any} context
 */
function judge(route, conditions, node, context) {
  const verdict = { state: "holds", checked: 0, refused: /** @type {any[]} */ ([]), failure: /** @type {any} */ (null), route };
  /** @param {string} kind @param {string} detail @param {any} at */
  const fail = (kind, detail, at) => {
    if (verdict.state !== "fails") verdict.failure = { kind, detail, at };
    verdict.state = "fails";
  };
  for (const test of route.tests) {
    if (test.outcome === true) verdict.checked++;
    else if (test.outcome === "refused") {
      verdict.refused.push({ kind: "filter", detail: test.detail, at: test.at });
      if (verdict.state === "holds") verdict.state = "undecided";
    } else fail("filter", test.detail, test.at);
  }
  if (verdict.state === "fails") return verdict;
  const scope = routeScope(route, node, context);
  for (const { written, condition, names } of conditions) {
    if (!applies(names, route)) continue;
    let answer;
    try {
      answer = condition === false ? false : context.evaluator.truth(condition, scope);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof GencmuError && REFUSAL.test(message)) {
        verdict.refused.push({ kind: "condition", detail: message, at: written.at });
        if (verdict.state === "holds") verdict.state = "undecided";
        continue;
      }
      fail("condition", `the recognizer held the condition, and the stage fails on it: ${message}`, written.at);
      return verdict;
    }
    if (answer !== true) {
      fail("condition", "the recognizer held the condition, and the stage gives false", written.at);
      return verdict;
    }
    verdict.checked++;
  }
  return verdict;
}

/**
 * For each ranked group of the chosen route, each higher option that
 * matches the same children must fail: its symbol tests or the conditions
 * that read its own captures. Otherwise recognition rejected an option
 * that qualifies.
 * @param {any} route
 * @param {any[]} conditions
 * @param {any} node
 * @param {any} context
 */
function higherOptions(route, conditions, node, context) {
  const { result } = context;
  for (const choice of route.options) {
    for (let index = 0; index < choice.index; index++) {
      const option = choice.group.ranked[index];
      const matcher = new Matcher(node, context, route.kinds);
      let routes;
      try {
        routes = matcher.over(option, choice.start, choice.end, route);
      } catch (error) {
        if (error instanceof OracleLimit) continue;
        throw error;
      }
      if (!routes.length) {
        result.higher.unmatched++;
        continue;
      }
      result.higher.checked++;
      const own = rankedNames(option);
      const relevant = conditions.filter(({ names }) => [...names].some(name => own.has(name)));
      for (const other of routes) {
        const verdict = judge(other, relevant, node, context);
        if (verdict.state === "holds") {
          result.disagreements.push({ stage: context.stage, kind: "ranked", rule: node.rule, document: node.origin.document,
            at: choice.group.at, answer: null,
            detail: `the recognizer rejected option ${index + 1} of a ranked choice, and its tests and conditions hold on the children of option ${choice.index + 1}` });
          return;
        }
      }
    }
  }
}

/**
 * The scope of the conditions of a route: the occurrence and the captures
 * that the route binds.
 * @param {any} route
 * @param {any} node
 * @param {any} context
 */
function routeScope(route, node, context) {
  const captures = new Map();
  for (const [name, kind] of route.kinds) {
    const values = route.bindings.get(name) ?? [];
    if (kind === "list") captures.set(name, values.map((/** @type {any} */ value) => bindingNode(value, node, context)));
    else if (values.length) captures.set(name, bindingNode(values[0], node, context));
  }
  return { node, captures, declared: new Set(route.kinds.keys()), items: [], names: new Map(), document: node.origin.document, shared: true };
}

/**
 * The node of a binding: a child, or a compound binding over a run of the
 * children, which the stage makes as it does for the recognizer's bindings.
 * @param {any} value
 * @param {any} node
 * @param {any} context
 */
function bindingNode(value, node, context) {
  if (!value.compound) return value.node;
  if (value.made) return value.made;
  const span = value.start < value.end
    ? [node.children[value.start].span[0], node.children[value.end - 1].span[1]]
    : [value.point, value.point];
  const made = context.owner.compoundOccurrence({ name: value.name, start: value.start, end: value.end, span, compound: true },
    node.children, node.origin, context.data);
  made.primary = node.primary && made.children.includes(node.primary) ? node.primary : null;
  value.made = made;
  return made;
}

/**
 * The conditions of a statement, each simplified for the names that the
 * alternative declares, with the names that it reads.
 * @param {any[]} written
 * @param {Map<string, string>} kinds
 * @param {any} expr
 */
function applicableConditions(written, kinds, expr) {
  const declared = new Set(kinds.keys());
  const ranked = rankedOnlyNames(expr);
  const list = [];
  for (const item of written) {
    // The loader simplifies the presence tests of the names that this
    // alternative does not declare. The clause applies where the
    // alternative declares every name that remains (docs/notation.md,
    // "Conditions").
    const condition = simplified(item, declared);
    if (condition === true) continue;
    const names = capturesOf(condition === false ? item : condition);
    if (condition !== false && [...names].some(name => !declared.has(name))) continue;
    list.push({ written: item, condition, names, ranked: new Set([...names].filter(name => ranked.has(name))) });
  }
  return list;
}

/**
 * Whether a condition applies on a route: each name that only a ranked
 * option declares belongs to an option that the route took.
 * @param {Set<string>} names
 * @param {any} route
 */
function applies(names, route) {
  for (const name of names) if (route.privateNames.has(name) && !route.taken.has(name)) return false;
  return true;
}

/**
 * The capture names that the options of a ranked choice declare, each in
 * one option alone.
 * @param {any} option
 */
function rankedNames(option) {
  // A name that only a ranked choice nested in the option declares belongs
  // to that choice, whose own option the route records.
  const nested = rankedOnlyNames(option);
  return new Set([...captureKindsOf(option).keys()].filter(name => !nested.has(name)));
}

class OracleLimit extends Error {}

// A route of a body over the children of an occurrence: the next child,
// the bindings so far, the symbol tests with their outcomes, the ranked
// options taken, and the names that a taken option declares.
/**
 * @typedef {{at: number, bindings: Map<string, any[]>, tests: any[], options: any[], taken: Set<string>}} Route
 */

class Matcher {
  /**
   * @param {any} node
   * @param {any} context
   * @param {Map<string, string>} kinds
   */
  constructor(node, context, kinds) {
    this.node = node;
    this.children = node.children;
    this.context = context;
    this.kinds = kinds;
    this.count = 0;
    this.scope = { node, items: [], names: new Map(), document: node.origin?.document };
    this.privateNames = rankedOnlyNames(node.origin.alternative.expr);
  }

  /** The complete routes of the alternative over all the children. */
  routes() {
    const start = { at: 0, bindings: new Map(), tests: [], options: [], taken: new Set() };
    return this.match(this.node.origin.alternative.expr, [start], true)
      .filter(route => route.at === this.children.length)
      .map(route => this.finish(route));
  }

  /**
   * The complete routes of one ranked option over a run of the children,
   * with the bindings of the rest of a chosen route.
   * @param {any} option
   * @param {number} start
   * @param {number} end
   * @param {any} outer
   */
  over(option, start, end, outer) {
    const begin = { at: start, bindings: new Map(), tests: [], options: [], taken: new Set() };
    return this.match(option, [begin], false)
      .filter(route => route.at === end)
      .map(route => this.finish({ ...route, bindings: merged(outer.bindings, route.bindings),
        taken: new Set([...outer.taken, ...rankedNames(option), ...route.taken]) }));
  }

  /** @param {Route} route */
  finish(route) {
    return { ...route, kinds: this.kinds, privateNames: this.privateNames };
  }

  /**
   * Each route that continues the given routes over one body record.
   * @param {any} expr
   * @param {Route[]} routes
   * @param {boolean} top whether the record is the whole alternative
   * @returns {Route[]}
   */
  match(expr, routes, top = false) {
    if (!routes.length) return routes;
    this.count += routes.length;
    if (this.count > ROUTE_LIMIT * 64) throw new OracleLimit("the oracle stops at its limit of routes");
    if (!expr || typeof expr !== "object") return [];
    if (expr.seq) {
      let current = routes;
      for (const part of expr.seq) current = this.match(part, current);
      return current;
    }
    if (expr.choice) return expr.choice.flatMap((/** @type {any} */ part) => this.match(part, routes));
    if (expr.ranked) {
      return expr.ranked.flatMap((/** @type {any} */ part, /** @type {number} */ index) => routes.flatMap(route => {
        const names = rankedNames(part);
        return this.match(part, [route]).map(next => ({
          ...next, options: [...next.options, { group: expr, index, start: route.at, end: next.at }],
          taken: new Set([...next.taken, ...names]),
        }));
      }));
    }
    if (expr.and) return this.subsets(expr.and, routes);
    if (expr.empty) return routes;
    if (expr.primary) return this.match(expr.primary, routes);
    if (expr.optional) return this.optional(expr, routes);
    if (expr.repeat) {
      if (expr.chain) return top ? this.chain(expr, routes) : [];
      return this.repeat(expr.repeat, expr.separator, routes);
    }
    if (expr.capture !== undefined && expr.expr) return this.capture(expr, routes);
    if (expr.test !== undefined) return this.tested(expr, routes);
    if (expr.remainder || expr.param !== undefined) throw new OracleLimit(`the oracle cannot yet match the body form ${JSON.stringify(Object.keys(expr))}`);
    return routes.flatMap(route => {
      const child = this.children[route.at];
      return child && this.symbol(expr, child) ? [{ ...route, at: route.at + 1 }] : [];
    });
  }

  /**
   * An ordered subset: one operand or more, in their written order.
   * @param {any[]} parts
   * @param {Route[]} routes
   */
  subsets(parts, routes) {
    /** @type {Route[]} */
    const out = [];
    /** @type {[number, Route[], boolean][]} */
    const pending = [[0, routes, false]];
    while (pending.length) {
      const [index, current, some] = /** @type {[number, Route[], boolean]} */ (pending.pop());
      if (index === parts.length) {
        if (some) for (const route of current) out.push(route);
        continue;
      }
      pending.push([index + 1, current, some]);
      const taken = this.match(parts[index], current);
      if (taken.length) pending.push([index + 1, taken, true]);
    }
    return out;
  }

  /**
   * An optional: absent, written, or for an elidable optional, an omitted
   * head leaf.
   * @param {any} expr
   * @param {Route[]} routes
   */
  optional(expr, routes) {
    const written = this.match(expr.optional, routes);
    if (!expr.elidable) return [...routes, ...written];
    const head = headTerminal(expr.optional);
    const omitted = routes.flatMap(route => {
      const child = this.children[route.at];
      if (!child || child.kind !== "elided" || child.terminal !== head) return [];
      // An omitted head binds no capture, since a binder inside the
      // optional names a written terminal only.
      return [{ ...route, at: route.at + 1 }];
    });
    return [...routes, ...written, ...omitted];
  }

  /**
   * One item or more, with a separator between items.
   * @param {any} item
   * @param {any} separator
   * @param {Route[]} routes
   */
  repeat(item, separator, routes) {
    // An item reads one child at least, so each round moves on.
    const out = [];
    let frontier = this.match(item, routes);
    for (let round = 0; frontier.length && round <= this.children.length; round++) {
      for (const route of frontier) out.push(route);
      if (out.length > ROUTE_LIMIT) throw new OracleLimit("the oracle stops at its limit of routes");
      const next = separator ? this.match(separator, frontier) : frontier;
      frontier = this.match(item, next);
    }
    return out;
  }

  /**
   * A chain: its base level, or an inner level of the same rule with a
   * separator and an item.
   * @param {any} expr
   * @param {Route[]} routes
   */
  chain(expr, routes) {
    const base = this.match(expr.repeat, routes);
    const level = (/** @type {Route[]} */ current) => current.flatMap(route => {
      const child = this.children[route.at];
      return child && (child.kind === "rule" || child.kind === "splice") && child.rule === this.node.rule ? [{ ...route, at: route.at + 1 }] : [];
    });
    const sep = (/** @type {Route[]} */ current) => expr.separator ? this.match(expr.separator, current) : current;
    const inner = expr.chain === "left"
      ? this.match(expr.repeat, sep(level(routes)))
      : level(sep(this.match(expr.repeat, routes)));
    return [...base, ...inner];
  }

  /**
   * A capture binds a child, or a compound binding over the children of
   * one visit of its operand.
   * @param {any} expr
   * @param {Route[]} routes
   */
  capture(expr, routes) {
    const compound = isCompound(expr.expr);
    return routes.flatMap(route => this.match(expr.expr, [route]).map(next => {
      const value = compound
        ? { compound: true, name: expr.capture, start: route.at, end: next.at, point: this.point(route.at) }
        : { node: this.children[route.at] };
      const bindings = new Map(next.bindings);
      bindings.set(expr.capture, [...(bindings.get(expr.capture) ?? []), value]);
      return { ...next, bindings };
    }));
  }

  /**
   * The place of an empty compound binding: the end of the child before
   * it, or the start of the occurrence.
   * @param {number} at
   */
  point(at) {
    return at > 0 ? this.children[at - 1].span[1] : this.node.span[0];
  }

  /**
   * A tested symbol: the symbol, then its test on the child that it reads.
   * @param {any} expr
   * @param {Route[]} routes
   */
  tested(expr, routes) {
    return routes.flatMap(route => this.match(expr.expr, [route]).map(next => {
      const child = this.children[route.at];
      return { ...next, tests: [...next.tests, this.test(expr, child)] };
    }));
  }

  /**
   * The outcome of a symbol test on a child, from its real bag.
   * @param {any} expr
   * @param {any} child
   */
  test(expr, child) {
    const shown = `the test at ${expr.at?.join?.(":") ?? "?"} on ${child.rule ?? child.terminal} at [${child.span}]`;
    try {
      const bag = child.bag();
      if (expr.test === "tags") {
        for (const requirement of expr.requirements) {
          for (const key of this.requirementKeys(requirement.value)) {
            const held = key === "_Elided" ? child.kind === "elided" : bag.has(key);
            if (held === requirement.negated) return { outcome: false, detail: `the recognizer held ${shown}, and its bag fails it on ${key}`, at: expr.at };
          }
        }
        return { outcome: true, at: expr.at };
      }
      const value = bag.value("value");
      const expected = this.context.evaluator.string(expr.value, this.scope);
      const equal = value === expected;
      if (equal !== (expr.test === "=")) return { outcome: false, detail: `the recognizer held ${shown}, and its value is ${JSON.stringify(value)}`, at: expr.at };
      return { outcome: true, at: expr.at };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof GencmuError && REFUSAL.test(message)) return { outcome: "refused", detail: message, at: expr.at };
      return { outcome: false, detail: `the recognizer held ${shown}, and the stage fails on it: ${message}`, at: expr.at };
    }
  }

  /**
   * The keys that a requirement names: a tag, or the keys of a key-set
   * constant.
   * @param {any} value
   * @returns {string[]}
   */
  requirementKeys(value) {
    if (value.tag !== undefined) return [value.tag];
    const keys = this.context.evaluator.evaluate(value, this.scope);
    return keys.keys();
  }

  /**
   * Whether a child is an occurrence of a symbol.
   * @param {any} expr
   * @param {any} child
   */
  symbol(expr, child) {
    if (expr.ref !== undefined) {
      const name = expr.ref;
      if (isTerminalTag(name)) {
        if (child.kind === "elided") return child.terminal === name;
        return child.kind === "token" && child.bag().has(name);
      }
      return child.kind === "rule" && child.rule === name;
    }
    if (expr.call !== undefined) return child.kind === "rule" && this.templateOf(child) === expr.call;
    if (expr.splice) {
      if (child.kind !== "splice") return false;
      const target = expr.splice;
      return target.ref !== undefined ? child.rule === target.ref : this.templateOf(child) === target.call;
    }
    if (expr.wildcard) return child.kind === "token";
    if (expr.literal !== undefined) {
      if (child.kind !== "token") return false;
      return child.bag().value("value") === this.context.evaluator.string(expr.literal, this.scope);
    }
    if (expr.range) {
      if (child.kind !== "token") return false;
      const value = child.bag().value("value");
      const [low, high] = expr.range.map((/** @type {any} */ bound) => this.context.evaluator.string(bound, this.scope));
      if (typeof value !== "string" || [...value].length !== 1) return false;
      const code = /** @type {number} */ (value.codePointAt(0));
      return code >= /** @type {number} */ (low.codePointAt(0)) && code <= /** @type {number} */ (high.codePointAt(0));
    }
    throw new OracleLimit(`the oracle cannot yet match the body form ${JSON.stringify(Object.keys(expr))}`);
  }

  /**
   * The template of a rule occurrence that is an instance, or null.
   * @param {any} child
   */
  templateOf(child) {
    const lhs = child.derivation?.production?.spliceOf ?? child.derivation?.production?.lhs;
    const instance = this.context.data.grammar?.instances?.find((/** @type {any} */ item) => (item.name ?? item.canonical) === lhs);
    return instance?.call?.call ?? null;
  }
}

/**
 * The bindings of a chosen route with those of an option over its run.
 * @param {Map<string, any[]>} outer
 * @param {Map<string, any[]>} inner
 */
function merged(outer, inner) {
  const bindings = new Map(outer);
  for (const [name, values] of inner) bindings.set(name, values);
  return bindings;
}

/** @param {string} name */
function isTerminalTag(name) {
  return /^[A-Z_]/.test(name);
}

/**
 * The head terminal of the body of an elidable optional.
 * @param {any} body
 * @returns {string | undefined}
 */
function headTerminal(body) {
  let current = body;
  while (current) {
    if (current.seq) current = current.seq[0];
    else if (current.capture !== undefined && current.expr) current = current.expr;
    else if (current.test !== undefined) current = current.expr;
    else if (current.primary) current = current.primary;
    else return current.ref;
  }
  return undefined;
}

/** @param {any} expr */
function isCompound(expr) {
  return Boolean(expr.seq || expr.choice || expr.ranked || expr.and || expr.optional || (expr.repeat && !expr.chain));
}

/**
 * The capture slots of a body: one node, or a list, as the stage gives
 * them. A compound operand is one node for each visit too.
 * @param {any} body
 * @returns {Map<string, string>}
 */
function captureKindsOf(body) {
  return captureKindsCache.get(body) ?? computeKinds(body);
}

/** @type {WeakMap<object, Map<string, string>>} */
const captureKindsCache = new WeakMap();
/** @type {(body: any) => Map<string, string>} */
let kindsOf = () => new Map();

/**
 * @param {any} body
 */
function computeKinds(body) {
  const kinds = kindsOf(body);
  if (body && typeof body === "object") captureKindsCache.set(body, kinds);
  return kinds;
}

/**
 * Sets the function that gives the capture slots of a body. The stage
 * owns it, and the oracle reads it.
 * @param {(body: any) => Map<string, string>} fn
 */
export function setCaptureKinds(fn) {
  kindsOf = fn;
}

/**
 * A clause with each presence test of an undeclared name as false, and the
 * truth operators around it folded: true, false or the clause.
 * @param {any} node
 * @param {Set<string>} declared
 * @returns {any}
 */
function simplified(node, declared) {
  if (!node || typeof node !== "object") return node;
  const presence = node.capture !== undefined && node.capture !== "" ? node.capture
    : node.method === "present" && node.receiver?.capture !== undefined && node.receiver.capture !== "" ? node.receiver.capture : null;
  if (presence !== null) return declared.has(presence) ? node : false;
  if (node.not !== undefined) {
    const inner = simplified(node.not, declared);
    return inner === true ? false : inner === false ? true : { ...node, not: inner };
  }
  if (Array.isArray(node.all) || Array.isArray(node.any)) {
    const conjunction = Array.isArray(node.all);
    const parts = [];
    for (const item of node.all ?? node.any) {
      const part = simplified(item, declared);
      if (part === !conjunction) return !conjunction;
      if (part !== conjunction) parts.push(part);
    }
    if (!parts.length) return conjunction;
    return parts.length === 1 ? parts[0] : { ...node, [conjunction ? "all" : "any"]: parts };
  }
  if (node.if !== undefined) {
    const test = simplified(node.if, declared);
    if (node.else === undefined) {
      if (test === false) return true;
      const then = simplified(node.then, declared);
      if (then === true) return true;
      if (test === true) return then;
      if (then === false) return { not: test };
      return { ...node, if: test, then };
    }
    const then = simplified(node.then, declared);
    const otherwise = simplified(node.else, declared);
    if (test === true) return then;
    if (test === false) return otherwise;
    return { ...node, if: test, then, else: otherwise };
  }
  return node;
}

/**
 * The capture names that an expression reads, outside the functions that
 * bind them again.
 * @param {any} node
 * @param {Set<string>} [into]
 * @returns {Set<string>}
 */
function capturesOf(node, into = new Set()) {
  /** @type {[any, Set<string>][]} */
  const pending = [[node, new Set()]];
  while (pending.length) {
    const [current, bound] = /** @type {[any, Set<string>]} */ (pending.pop());
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      for (const item of current) pending.push([item, bound]);
      continue;
    }
    if (current.lambda !== undefined) {
      pending.push([current.body, new Set([...bound, current.lambda])]);
      continue;
    }
    if (typeof current.capture === "string" && current.capture !== "" && !bound.has(current.capture)) into.add(current.capture);
    for (const [key, value] of Object.entries(current)) if (key !== "at" && value && typeof value === "object") pending.push([value, bound]);
  }
  return into;
}
