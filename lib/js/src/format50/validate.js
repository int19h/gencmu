import { CAPTURE_NAME, CONSTANT_NAME, DOM_MAX_DEPTH, KEY_STEPS, validSteps } from "../dom.js";
import { GencmuError } from "../errors.js";
import { run } from "../trampoline.js";
import { memberFault50, operandFields50, recordKind50 } from "./records.js";
import { methods50, validProperty50 } from "./signatures.js";

const argumentsError = "an argument cannot read or declare captures";

const symbolKinds50 = new Set(["reference", "call", "parameter", "literal", "range", "wildcard", "splice", "bodyTags", "bodyTest"]);
/**
 * @internal
 * @param {any} node
 */
export const isBodySymbol50 = node => symbolKinds50.has(recordKind50(node, "body"));
const ruleName50 = /^(?!.*--)[a-z][A-Za-z0-9_-]*$/;
const featureName = /^(?!.*--)[A-Za-z][A-Za-z0-9-]*$/;
const terminalName = /^[A-Z_]/;
const userTag = /^(?!.*--)[A-Z][A-Za-z0-9_-]*$/;
const parameterName = /^(?!.*--)[A-Za-z][A-Za-z0-9_-]*$/;
// A custom Unicode table can grant an emoji name to any permitted scalar.
/**
 * @param {any} name
 * @param {any} unicode
 */
const validRule = (name, unicode) => ruleName50.test(name) ||
  typeof name === "string" && (unicode ? unicode.isEmojiName(name) :
    name !== "#" && name !== "@" && [...name].length === 1 && !/^[\uD800-\uDFFF]$/.test(name));
/**
 * @param {any} name
 * @param {any} unicode
 */
const validTag = (name, unicode) => userTag.test(name) || name.startsWith("_") && validProperty50(name, unicode);
/**
 * @typedef {{ document?: string, unicode?: import("../unicode.js").UnicodeTable }} DocumentValidation
 * @param {any} node
 */
const atomOf = node => {
  while (node.test) node = node.expr;
  return node;
};

/**
 * @param {any} node
 * @param {any} fail
 * @param {any} pattern
 */
export function validateOrigin50(node, fail, pattern) {
  const kind = recordKind50(node, pattern ? "pattern" : "body");
  if (kind !== "patternTags" && kind !== "bodyTags") return;
  const atom = atomOf(node);
  const rule = atom.name || atom.call || atom.splice || atom.ref && !terminalName.test(atom.ref);
  if (rule && node.requirements.some((/** @type {any} */ req) => req.value.tag === "_Elided" && (kind === "bodyTags" || !req.negated))) {
    fail(node, "the _Elided origin test applies only to a terminal");
  }
}

/**
 * @param {any} node
 * @param {any} fail
 */
export function validatePatternChildren50(node, fail) {
  const kind = recordKind50(node, "pattern");
  if (!["bareChildren", "exactBareChildren", "patternName", "patternCallWithChildren", "patternParameterWithChildren"].includes(kind)) {
    fail(node, "only an untested rule atom, call or parameter can have a child list");
  }
}

/** @param {any} document */
export function documentFault50(document) {
  return (/** @type {any} */ node, /** @type {any} */ description) => {
    const [line, column] = Array.isArray(node?.at) ? node.at : [];
    throw new GencmuError("grammar", description, { document, line, column });
  };
}

/**
 * @param {any} root
 * @param {any} fail
 * @param {any} owner
 * @param {any} category
 */
export function withOwner50(root, fail, owner, category, checkMembers = false) {
  const sites = new WeakMap();
  const pending = [[root, owner, category]];
  while (pending.length) {
    const [node, parent, kind] = /** @type {any[]} */ (pending.pop());
    const site = Array.isArray(node?.at) ? node : parent;
    if (checkMembers) {
      const fault = memberFault50(node, kind);
      if (fault) fail(site, fault);
    }
    if (!node || typeof node !== "object") continue;
    sites.set(node, site);
    for (const [, child, childKind] of operandFields50(node, kind).reverse()) pending.push([child, site, childKind]);
  }
  return (/** @type {any} */ node, /** @type {any} */ message) => fail(Array.isArray(node?.at) ? node : sites.get(node) ?? owner, message);
}

// A template actual is closed. A parse method owns a separate query body.
// The receiver stays in the scope of the enclosing expression.
/**
 * @param {any} parent
 * @param {any} childSlot
 */
function captureBoundary50(parent, childSlot) {
  if (childSlot === "argument[]") return "argument";
  if (childSlot === "methodArgument[]" && parent.method === "parse") return "query";
}

/**
 * @param {{ closed?: boolean, query?: boolean, bindings?: Iterable<string>, slot?: string }} [configuration]
 * @param {any} root
 * @param {any} fail
 */
export function validateBindings50(root, fail, configuration = {}) {
  const { closed = false, query = false, bindings = [], slot } = configuration;
  const pending = [[root, new Set(bindings), false, slot, query ? "query" : closed ? "argument" : undefined]];
  while (pending.length) {
    const [node, scope, implicit, nodeSlot, mode] = /** @type {any[]} */ (pending.pop());
    if (!node || typeof node !== "object") continue;
    if (node.lambda !== undefined) {
      const name = node.lambda;
      if (name && scope.has(name)) fail(node, "a function binder cannot hide a live name");
      pending.push([node.body, name ? new Set([...scope, name]) : scope, true, "expression", mode]);
      continue;
    }
    if (node.capture !== undefined) {
      if (node.expr && mode) {
        fail(node, mode === "query" ? "a query cannot declare captures" : argumentsError);
      }
      if (mode === "argument" && !scope.has(node.capture)) fail(node, argumentsError);
    }
    if (node.item && !implicit) fail(node, "an implicit receiver needs a function binding");
    for (const [, child, childSlot] of operandFields50(node, nodeSlot).reverse()) {
      const boundary = captureBoundary50(node, childSlot);
      pending.push([child, boundary ? new Set() : scope, !boundary && implicit, childSlot, boundary ?? mode]);
    }
  }
}

/**
 * @param {any} argument
 * @param {any} fail
 */
export function validateArgument50(argument, fail) {
  validateBindings50(argument, fail, { closed: true, slot: "argument" });
  if (recordKind50(argument, "argument") === "bodyArgument") validateBody50(argument.body, fail);
}

/** @param {any} node */
function bodyChildren50(node) {
  return operandFields50(node, "body").flatMap(([, child, slot]) => slot === "body[]" ? child : slot === "body" ? [child] : []);
}

/**
 * @param {any} method
 * @param {any} fail
 */
export function validateQuery50(method, fail) {
  const body = method.args[0]?.body;
  if (!body) return fail(method, "a query needs a body");
  const items = body.seq ?? [body];
  const first = Number(Boolean(items[0]?.remainder));
  const end = items.length - Number(Boolean(items.at(-1)?.remainder));
  const parts = items.slice(first, end);
  if (!parts.length) fail(method, "a query needs a body");
  const pending = parts.slice().reverse();
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (node.remainder) fail(method, "a query permits a remainder only at each outer edge");
    if (node.chain) fail(method, "a chain cannot be the query target");
    const children = bodyChildren50(node);
    for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
  }
  validateBindings50(body, fail, { query: true, slot: "body" });
  validateBody50(parts.length === 1 ? parts[0] : { seq: parts }, fail);
}

export const elidableForm50 = "an elidable optional starts with an ungrouped user terminal or parameter and can bind only its sole terminator";

/**
 * @param {any} size
 * @param {any} node
 * @param {any} fail
 */
export function validateSubsetSize50(size, node, fail) {
  if (size > 16) fail(node, "an ordered subset takes at most sixteen operands");
}

/** @param {any} optional */
function elidableHead50(optional) {
  const start = optional.seq?.[0] ?? optional;
  let head = start.capture !== undefined ? start.expr : start;
  const tests = [];
  while (head?.test) {
    tests.push(head);
    head = head.expr;
  }
  return { start, head, tests };
}

/** @param {any} node */
function omissionAllowed50(node) {
  const { head, tests } = elidableHead50(node.optional);
  const fallback = tests.find(test => test.test === "=")?.value;
  const value = (node.default ?? fallback ?? { string: "" }).string;
  let known = true;
  for (const test of tests) {
    if (test.requirements) {
      for (const { negated, value: requirement } of test.requirements) {
        const tag = requirement.tag;
        if (!tag || !head.ref && tag !== "_Elided") known = false;
        else if ((tag === "_Elided" || tag === head.ref) === negated) return false;
      }
    } else if (!node.default && test.test === "=" && test.value === fallback) {
      continue;
    } else if (value === undefined || test.value?.string === undefined) {
      known = false;
    } else if ((test.value.string === value) !== (test.test === "=")) {
      return false;
    }
  }
  return known ? true : undefined;
}

/**
 * @param {any} node
 * @param {any} fail
 */
function validateOmission(node, fail) {
  if (!node.elidable) return;
  const optional = node.optional;
  const { start, head } = elidableHead50(optional);
  if (!head?.param && !/^[A-Z]/.test(head?.ref ?? "") ||
      start.capture !== undefined && optional.seq || optional.seq?.slice(1).some((/** @type {any} */ part) => captureSlots50(part).size)) {
    fail(node, elidableForm50);
  }
  if (node.default?.string !== undefined && omissionAllowed50(node) === false) {
    fail(node.default, "the default does not pass the omission predicate");
  }
}

/**
 * @internal The capture names of a body that stand only inside ranked groups.
 * @param {any} body
 * @returns {Set<string>}
 */
export function rankedOnlyNames(body) {
  /** @type {Set<string>} */
  const inside = new Set();
  /** @type {Set<string>} */
  const outside = new Set();
  /** @param {any} node @param {boolean} ranked */
  const visit = (node, ranked) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(item => visit(item, ranked));
    if (node.capture !== undefined && node.expr) (ranked ? inside : outside).add(node.capture);
    const nested = ranked || Array.isArray(node.ranked);
    for (const [key, value] of Object.entries(node)) if (key !== "at" && value && typeof value === "object") visit(value, nested);
  };
  visit(body, false);
  return new Set([...inside].filter(name => !outside.has(name)));
}

// Each slot is a node if the alternative binds it once on every route.
/** @param {any} body */
export function captureSlots50(body) {
  return run(bindingSlots(body, false));
}

/**
 * @param {any} body
 * @param {any} list
 * @returns {Generator<any, any, any>}
 */
function* bindingSlots(body, list) {
  const kind = recordKind50(body, "body");
  if (kind === "captureSymbol") return new Map([[body.capture, list]]);
  if (kind === "primary") return yield bindingSlots(body.primary, list);
  if (kind === "elidable") return yield bindingSlots(body.optional, true);
  if (kind === "optional") {
    // A plain optional whose captures stand only inside ranked groups has a
    // helper for each route (engine §3.2). Such a capture is a node there.
    const inner = yield bindingSlots(body.optional, list);
    const privateOnly = rankedOnlyNames(body.optional);
    return new Map([...inner].map(([name, childList]) => [name, childList || !privateOnly.has(name)]));
  }
  if (!["choice", "ranked", "sequence", "subset", "repeat", "chain"].includes(kind)) return new Map();
  const children = bodyChildren50(body);
  const slots = [];
  for (const child of children) slots.push(yield bindingSlots(child, list || !!body.repeat || body.and?.length > 1));
  const result = new Map();
  for (const child of slots) for (const [name, childList] of child) {
    result.set(name, !!result.get(name) || childList || !!body.choice && slots.some(slot => !slot.has(name)));
  }
  return result;
}

/**
 * @param {any} body
 * @param {any} fail
 */
export function validateBody50(body, fail) {
  const zero = () => ({ names: new Map(), min: 0, max: 0 });
  /**
   * @param {any} node
   * @returns {Generator<any, any, any>}
   */
  function* visit(node, blocked = false, chain = false, whole = true) {
    const kind = recordKind50(node, "body");
    if (kind === "primary") {
      const symbol = node.primary.expr && node.primary.capture !== undefined ? node.primary.expr : node.primary;
      const base = atomOf(symbol);
      if (!isBodySymbol50(base)) fail(node, "a primary marks one symbol or capture");
      if (blocked || base.splice) fail(node, "a primary must mark a mandatory child that is not a splice");
      /** @type {any} */
      const route = yield visit(node.primary, blocked, chain, false);
      route.min++;
      route.max++;
      return route;
    }
    if (kind === "captureSymbol") {
      if (chain) fail(node, "a chain item or separator cannot bind a capture directly");
      if (!CAPTURE_NAME.test(node.capture)) fail(node, "a capture name must use lowercase letters, digits, hyphens or underscores");
      if (!isBodySymbol50(node.expr)) fail(node, "a capture wraps one symbol");
      /** @type {any} */
      const route = yield visit(node.expr, blocked, chain, false);
      if (route.names.has(node.capture)) fail(route.names.get(node.capture), "a route binds a capture twice");
      route.names.set(node.capture, node);
      return route;
    }
    if (kind === "optional" || kind === "elidable") {
      do {
        validateOmission(node, fail);
        node = node.optional;
      } while (node.optional);
      /** @type {any} */
      const route = yield visit(node, true, chain, false);
      route.min = 0;
      return route;
    }
    if (!["sequence", "subset", "choice", "ranked", "repeat", "chain"].includes(kind)) return zero();
    const children = bodyChildren50(node);
    if (node.chain && !whole) fail(node, "a chain must occupy a whole alternative");
    if (node.and) validateSubsetSize50(node.and.length, node, fail);
    const exclusive = !!(node.choice || node.ranked);
    const route = zero();
    for (const [index, child] of children.entries()) {
      const next = yield visit(child, blocked || !!(node.ranked || node.repeat), node.repeat ? !!node.chain : chain, false);
      for (const [name, binder] of next.names) {
        if (!exclusive && route.names.has(name)) fail(binder, `a route binds $${name} twice`);
        if (!route.names.has(name)) route.names.set(name, binder);
      }
      if (exclusive) {
        route.min = index ? Math.min(route.min, next.min) : next.min;
        route.max = Math.max(route.max, next.max);
      } else {
        route.min = node.and && index ? Math.min(route.min, next.min) : route.min + next.min;
        route.max += next.max;
        if (route.max > 1) fail(child, "a route has more than one primary");
      }
    }
    return route;
  }
  const route = run(visit(body));
  if (route.min !== route.max || route.max > 1) fail(body, "each route must have one primary or every route must have none");
}

/**
 * @param {any} pattern
 * @param {any} fail
 */
export function validateExactPattern50(pattern, fail, { origin = true } = {}) {
  const kind = recordKind50(pattern, "resolutionPattern");
  if (kind === "constantReference" || kind === "patternConstant") return;
  if (["patternUnion", "patternIntersection", "patternDifference"].includes(kind)) {
    for (const part of operandFields50(pattern, "resolutionPattern")[0][1]) {
      validateExactPattern50(part, fail, { origin });
    }
    return;
  }
  if (!pattern.exact || kind === "patternPath" || pattern.children) {
    fail(pattern, "a key step needs an exact local pattern");
  }
  let atom = pattern;
  while (atom.test) {
    if (!origin && atom.requirements?.some((/** @type {any} */ item) => !item.negated && item.value.tag === "_Elided")) {
      fail(atom, "a leftmost-longest pattern cannot require _Elided");
    }
    atom = atom.expr;
  }
}

/**
 * @param {any} entries
 * @param {any} fail
 */
export function validateBag50(entries, fail) {
  const unconditional = new Set();
  for (const entry of entries) {
    const keys = entry.kind === "write" ? entry.keys : ["copy", "bare"].includes(entry.kind) ? [entry.key] : [];
    const chain = new Set();
    for (const key of keys) {
      const direct = !entry.guard && !entry.gates.length;
      if (chain.has(key) || direct && unconditional.has(key)) fail(entry, `duplicate direct write for ${key}`);
      chain.add(key);
      if (direct) unconditional.add(key);
    }
  }
}

/**
 * @param {any} range
 * @param {any} site
 * @param {any} fail
 */
function validateRange(range, site, fail) {
  for (const endpoint of range) {
    if (endpoint.string !== undefined && [...endpoint.string].length !== 1) {
      fail(site, "a range endpoint must be one scalar");
    }
  }
  const [left, right] = range;
  if (left.string !== undefined && right.string !== undefined &&
      left.string.codePointAt(0) > right.string.codePointAt(0)) {
    fail(site, "a range starts above its end");
  }
}

// A name that the definition never binds is an error even behind a guard.
/**
 * @param {any} rule
 * @param {any} slots
 * @param {any} fail
 */
export function validateDefinitionNames50(rule, slots, fail) {
  const bindings = new Set(["", ...slots.flatMap((/** @type {any} */ slot) => [...slot.keys()])]);
  const terms = rule.alternatives.map((/** @type {any} */ alt, /** @type {any} */ index) => [alt.term, new Set(["", ...slots[index].keys()]), false, "expression"]);
  const clauses = [...rule.conditions ?? [], rule.error, rule.warning].map(root => [root, bindings, false, "expression"]);
  const outputs = (rule.emit?.items ?? []).map((/** @type {any} */ root) => [root, bindings, false, "output"]);
  const pending = [[rule.term, bindings, false, "expression"], ...terms, ...clauses, ...outputs].reverse();
  while (pending.length) {
    const [part, scope, implicit, slot] = /** @type {any[]} */ (pending.pop());
    // Shape validation checks each actual in its own scope.
    if (!part || typeof part !== "object" || slot === "argument[]") continue;
    if (part.lambda !== undefined) {
      if (part.lambda && scope.has(part.lambda)) fail(part, "a function binder cannot hide a live name");
      pending.push([part.body, part.lambda ? new Set([...scope, part.lambda]) : scope, true, "expression"]);
      continue;
    }
    if (!implicit && part.item) fail(part, "an implicit receiver needs a function binding");
    if (part.capture !== undefined && !part.expr && !scope.has(part.capture) && !bindings.has(part.capture)) {
      fail(part, `$${part.capture} is captured by no alternative of ${rule.name}`);
    }
    for (const [, child, childSlot] of operandFields50(part, slot).reverse()) pending.push([child, scope, implicit, childSlot]);
  }
}

// Only fold operations with closed scalar operands here. The native loader
// resolves constants, input properties and parameter-dependent guards.
/**
 * @param {any} node
 * @returns {Generator<any, any, any>}
 */
function* closedScalar50(node) {
  const kind = recordKind50(node, "expression");
  if (node.string !== undefined) return node.string;
  if (node.integer !== undefined) return BigInt(node.integer);
  if (node.not) {
    /** @type {any} */
    const operand = yield closedScalar50(node.not);
    if (typeof operand === "boolean") return !operand;
  }
  if (kind === "conjunction" || kind === "disjunction") {
    const deciding = kind === "disjunction";
    for (const part of node[deciding ? "any" : "all"]) {
      /** @type {any} */
      const value = yield closedScalar50(part);
      if (typeof value !== "boolean") return;
      if (value === deciding) return deciding;
    }
    return !deciding;
  }
  if (node.if) {
    /** @type {any} */
    const condition = yield closedScalar50(node.if);
    if (typeof condition !== "boolean") return;
    if (!condition && !node.else) return true;
    return yield closedScalar50(condition ? node.then : node.else);
  }
  if (node.concat) {
    let result = "";
    for (const part of node.concat) {
      const value = yield closedScalar50(part);
      if (typeof value !== "string") return;
      result += value;
    }
    return result;
  }
  if (!node.op) return;
  /** @type {any} */
  const left = yield closedScalar50(node.left);
  /** @type {any} */
  const right = yield closedScalar50(node.right);
  if (left === undefined || typeof left !== typeof right) return;
  if (node.op === "=") return left === right;
  if (node.op === "≠") return left !== right;
  if (typeof left !== "bigint") return;
  if (node.op === "+") return left + right;
  if (node.op === "<") return left < right;
  if (node.op === "≤") return left <= right;
  if (node.op === ">") return left > right;
  if (node.op === "≥") return left >= right;
}

/**
 * @param {any} node
 * @returns {Generator<any, any, any>}
 */
function* closedTruth50(node) {
  const scalar = yield closedScalar50(node);
  if (typeof scalar === "boolean") return scalar;
  if (node.bag) {
    const keys = new Set();
    for (const entry of node.bag) {
      if (entry.gates.length || entry.guard || entry.kind === "copy" || entry.kind === "splat") return;
      if (entry.kind === "delete") keys.delete(entry.key);
      else for (const key of entry.keys ?? [entry.key]) keys.add(key);
    }
    return keys.size > 0;
  }
  if (node.list?.every((/** @type {any} */ entry) => !entry.gates.length && !entry.guard && entry.kind === "item")) {
    return node.list.length > 0;
  }
}

// Compare route keys in structural expansion order. The keys contain choice
// indices, optional routes and subset masks in the order the body reads them.
/**
 * @param {any} left
 * @param {any} right
 */
function routeOrder50(left, right) {
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}

/**
 * @param {any} routes
 * @param {any} state
 * @param {any} route
 */
function keepFirstRoute50(routes, state, route) {
  const old = routes.get(state);
  if (!old || routeOrder50(route, old) < 0) routes.set(state, route);
}

/**
 * @param {any} body
 * @param {any} required
 * @param {any} forbidden
 * @param {any} names
 * @returns {Generator<any, any, any>}
 */
function* captureWitness50(body, required, forbidden, names) {
  if (!required.every((/** @type {any} */ name) => names(body).has(name))) return;
  const kind = recordKind50(body, "body");
  if (kind === "captureSymbol") return forbidden.has(body.capture) ? undefined : [];
  if (kind === "primary") return yield captureWitness50(body.primary, required, forbidden, names);
  if (kind === "optional" || kind === "elidable") {
    if (!required.length && (!body.elidable || omissionAllowed50(body) === true)) return [0];
    /** @type {any} */
    const route = yield captureWitness50(body.optional, required, forbidden, names);
    if (route) return [1, ...route];
    return;
  }
  if (kind === "choice" || kind === "ranked") {
    for (const [index, child] of bodyChildren50(body).entries()) {
      /** @type {any} */
      const route = yield captureWitness50(child, required, forbidden, names);
      if (route) return [index, ...route];
    }
    return;
  }
  if (kind === "repeat" || kind === "chain") return yield repeatWitness50(body, required, forbidden, names);
  if (kind === "subset") {
    let mask = 0;
    /** @type {any[]} */
    let route = [];
    for (const [index, child] of bodyChildren50(body).entries()) {
      const needed = required.filter((/** @type {any} */ name) => names(child).has(name));
      if (!needed.length && (required.length || mask)) continue;
      /** @type {any} */
      const childRoute = yield captureWitness50(child, needed, forbidden, names);
      if (!childRoute) {
        if (needed.length) return;
        continue;
      }
      mask += 2 ** index;
      route = route.concat(childRoute);
    }
    return mask ? [mask, ...route] : undefined;
  }
  if (kind === "sequence") {
    /** @type {any[]} */
    let route = [];
    for (const child of bodyChildren50(body)) {
      const needed = required.filter((/** @type {any} */ name) => names(child).has(name));
      /** @type {any} */
      const childRoute = yield captureWitness50(child, needed, forbidden, names);
      if (!childRoute) return;
      route = route.concat(childRoute);
    }
    return route;
  }
  return [];
}

/**
 * @param {any} body
 * @param {any} bits
 * @param {any} forbidden
 * @param {any} names
 * @returns {Generator<any, any, any>}
 */
function* repeatRoutes50(body, bits, forbidden, names) {
  const relevant = [...bits].filter(([name]) => names(body).has(name));
  const routes = new Map();
  const pending = [[0, 0n, [], forbidden]];
  while (pending.length) {
    const [index, mask, required, absent] = /** @type {any[]} */ (pending.pop());
    const route = yield captureWitness50(body, required, absent, names);
    if (!route) continue;
    if (index === relevant.length) {
      routes.set(mask, route);
    } else {
      const [name, bit] = relevant[index];
      pending.push([index + 1, mask, required, new Set([...absent, name])]);
      pending.push([index + 1, mask | bit, [...required, name], absent]);
    }
  }
  return routes;
}

/**
 * @param {any} body
 * @param {any} required
 * @param {any} forbidden
 * @param {any} names
 * @returns {Generator<any, any, any>}
 */
function* repeatWitness50(body, required, forbidden, names) {
  /** @type {any} */
  const base = yield captureWitness50(body.repeat, required, forbidden, names);
  if (base) return [0, ...base];
  const bits = new Map(required.map((/** @type {any} */ name, /** @type {any} */ index) => [name, 1n << BigInt(index)]));
  const all = (1n << BigInt(required.length)) - 1n;
  const items = yield repeatRoutes50(body.repeat, bits, forbidden, names);
  const separators = body.separator ? yield repeatRoutes50(body.separator, bits, forbidden, names) : new Map([[0n, []]]);
  const inputs = new Map();
  for (const [x, item] of items) for (const [y, separator] of separators) {
    keepFirstRoute50(inputs, x | y, body.chain === "right" ? item.concat(separator) : separator.concat(item));
  }
  // Base productions come first. Follow the recursive productions until
  // they supply the requested bindings, with no extra iterations.
  let current = items;
  const seen = new Set(current.keys());
  let iterations = 1;
  while (current.size) {
    const next = new Map();
    for (const [x, prefix] of inputs) for (const [y, prior] of current) {
      const mask = x | y;
      if (!seen.has(mask)) keepFirstRoute50(next, mask, prefix.concat(prior));
    }
    const route = next.get(all);
    if (route) return [iterations, ...route];
    for (const mask of next.keys()) seen.add(mask);
    current = next;
    iterations++;
  }
}

const deferredTruth = Symbol("specialized truth");

class CapturePresence50 {
  /** @param {any} name */
  constructor(name) {
    this.name = name;
  }
}

/** @param {any} body */
function captureRoutes50(body) {
  const slots = new WeakMap();
  /** @param {any} node */
  const names = node => {
    if (!slots.has(node)) slots.set(node, captureSlots50(node));
    return slots.get(node);
  };
  const routes = new WeakMap();
  const unconstrained = new Map();
  /** @returns {Generator<any, any, any>} */
  return function* witness(presence = unconstrained) {
    if (routes.has(presence)) return routes.get(presence);
    const required = [];
    const forbidden = new Set();
    for (const [name, present] of presence) {
      if (present) required.push(name);
      else forbidden.add(name);
    }
    const route = yield captureWitness50(body, required, forbidden, names);
    routes.set(presence, route);
    return route;
  };
}

/**
 * @param {any} root
 * @param {any} slots
 * @param {any} witness
 * @param {any} note
 * @param {any} rootSlot
 */
function checkExpansionScope(root, slots, witness, note, rootSlot) {
  const containsMissing = new WeakMap();
  /**
   * @param {any} part
   * @param {any} slot
   * @returns {any}
   */
  function* readsMissing(part, slot) {
    if (!part || typeof part !== "object" || slot === "argument[]") return false;
    if (containsMissing.has(part)) return containsMissing.get(part);
    let missing = Boolean(part.capture && !slots.has(part.capture));
    for (const [, child, childSlot] of operandFields50(part, slot)) {
      if (missing) break;
      missing = yield readsMissing(child, childSlot);
    }
    containsMissing.set(part, missing);
    return missing;
  }

  /**
   * @param {any} node
   * @param {any} description
   * @param {any} presence
   * @returns {Generator<any, any, any>}
   */
  function* report(node, description, presence) {
    const route = yield witness(presence);
    if (route) note(route, node, description);
  }

  // A separate operand check inherits its enclosing guard assignments.
  // Assignments from one entry do not constrain another entry.
  /**
   * @param {any} part
   * @param {any} bindings
   * @param {any} outerPresence
   * @param {any} slot
   * @returns {Generator<any, any, any>}
   */
  function* check(part, bindings, outerPresence, slot) {
    if (!(yield readsMissing(part, slot))) return;
    const choices = [outerPresence];
    while (choices.length) {
      const presence = choices.pop();
      try {
        yield expansionScope(part, slots, report, bindings, presence, check, slot);
      } catch (error) {
        if (!(error instanceof CapturePresence50)) throw error;
        for (const value of [false, true]) {
          const next = new Map(presence);
          next.set(error.name, value);
          if (yield witness(next)) choices.push(next);
        }
      }
    }
  }
  run(check(root, new Set([""]), new Map(), rootSlot));
}

/**
 * @param {any} root
 * @param {any} slots
 * @param {any} report
 * @param {any} bindings
 * @param {any} presence
 * @param {any} check
 * @param {any} slot
 * @returns {Generator<any, any, any>}
 */
function* expansionScope(root, slots, report, bindings, presence, check, slot, truth = false) {
  if (!root || typeof root !== "object") return;
  const kind = recordKind50(root, slot);
  const forwarding = slot === "output";
  /** @param {any} part */
  const walk = (part, asTruth = false, childSlot = "expression") => asTruth ?
    expansionScope(part, slots, report, bindings, presence, check, childSlot, true) : check(part, bindings, presence, childSlot);
  if (root.method === "present" && root.receiver?.capture !== undefined) {
    return yield walk(root.receiver, true);
  }
  if (root.capture !== undefined && !root.expr && !forwarding) {
    const name = root.capture;
    if (!bindings.has(name) && !slots.has(name)) {
      if (truth) return false;
      yield report(root, `$${name} is absent from this expansion`, presence);
      return;
    }
    if (truth && !bindings.has(name)) {
      if (presence.has(name)) return presence.get(name);
      throw new CapturePresence50(name);
    }
    return;
  }
  if (root.lambda !== undefined) {
    yield check(root.body, new Set([...bindings, root.lambda]), presence, "expression");
    return;
  }
  if (root.guard) {
    const guard = yield walk(root.guard, true);
    if (guard === false || guard === deferredTruth) return;
  }
  if (forwarding) {
    if (slots.has(root.capture) || root.insert || root.capture === "") yield walk(root.term);
    return;
  }
  if (root.if) {
    const condition = yield walk(root.if, true);
    if (condition === deferredTruth) return deferredTruth;
    if (condition === undefined) {
      const yes = yield walk(root.then, truth || !root.else);
      const no = root.else ? yield walk(root.else, truth) : true;
      return yes === no ? yes : undefined;
    }
    if (!condition && !root.else) return true;
    return yield walk(condition ? root.then : root.else, truth || !root.else);
  }
  if (root.not) {
    const value = yield walk(root.not, true);
    return typeof value === "boolean" ? !value : value;
  }
  if (kind === "conjunction" || kind === "disjunction") {
    const result = kind === "disjunction";
    let unknown = false;
    for (const part of root[result ? "any" : "all"]) {
      const value = yield walk(part, true);
      if (value === result || value === deferredTruth) return value;
      unknown ||= value === undefined;
    }
    return unknown ? undefined : !result;
  }
  for (const [key, child, childSlot] of operandFields50(root, slot)) {
    if (key !== "guard") yield walk(child, false, childSlot);
  }
  if (!truth) return;
  const literal = yield closedTruth50(root);
  if (typeof literal === "boolean") return literal;
  const pending = [[root, slot]];
  let inputDependent = false;
  while (pending.length) {
    const [item, itemSlot] = /** @type {any[]} */ (pending.pop());
    if (!item || typeof item !== "object" || itemSlot === "argument[]") continue;
    if (item.const || item.param || item.apply) return deferredTruth;
    inputDependent ||= item.capture !== undefined || item.item === true;
    for (const [, child, childSlot] of operandFields50(item, itemSlot)) pending.push([child, childSlot]);
  }
  return inputDependent ? undefined : deferredTruth;
}

// The caller supplies the expansion in grammar order. A native caller can
// extend each operand check with its stage types and presence witness.
/** @param {any} entries */
function directKeys(entries = []) {
  const keys = new Set();
  for (const entry of entries) {
    if (entry.guard || entry.gates.length) continue;
    if (entry.kind === "write") for (const key of entry.keys) keys.add(key);
    if (entry.kind === "delete" || entry.kind === "bare") keys.add(entry.key);
  }
  return keys;
}

const stringFields = ["value", "image"];
const noFieldEdit = Symbol("no field edit");
const absentField = Symbol("absent field");
const bareField = Symbol("bare field");
const unknownPayload = Symbol("present field with an unresolved payload");

// Unknown edits can hide a writer. Leave its string requirement to the
// loader when a later supplier is unresolved.
/**
 * @param {any} entry
 * @param {any} key
 * @returns {Generator<any, any, any>}
 */
function* stringFieldEdit50(entry, key) {
  let edit = noFieldEdit;
  if (entry.kind === "write" && entry.keys.includes(key)) edit = entry.value;
  if (entry.kind === "bare" && entry.key === key) edit = bareField;
  if (entry.kind === "delete" && entry.key === key) edit = absentField;
  if (entry.kind === "splat" || entry.kind === "copy" && entry.key === key) {
    const source = yield bagField50(entry.value ?? entry.source, key);
    edit = source === absentField ? noFieldEdit : source;
  }
  if (edit === noFieldEdit) return edit;
  const guard = entry.guard ? yield closedTruth50(entry.guard) : true;
  if (guard === false) return noFieldEdit;
  if (guard !== true || entry.gates.length) return;
  return edit;
}

/**
 * @param {any} node
 * @param {any} key
 * @returns {Generator<any, any, any>}
 */
function* bagField50(node, key) {
  if (node?.if && node.else) {
    const condition = yield closedTruth50(node.if);
    if (typeof condition === "boolean") return yield bagField50(condition ? node.then : node.else, key);
    /** @type {any} */
    const yes = yield bagField50(node.then, key);
    const no = yield bagField50(node.else, key);
    if (yes === no) return yes;
    if (yes && no && yes !== absentField && no !== absentField) return unknownPayload;
  }
  if (node?.method === "flags" || node?.method === "classes") return absentField;
  if (!node?.bag) return;
  let field = absentField;
  for (const item of node.bag) {
    const edit = yield stringFieldEdit50(item, key);
    if (edit !== noFieldEdit) field = edit;
  }
  return field;
}

/** @param {any} entries */
function laterStringFields50(entries = []) {
  return new Set(stringFields.filter(key => entries.some((/** @type {any} */ entry) => run(stringFieldEdit50(entry, key)) !== noFieldEdit)));
}

/**
 * @param {any} rule
 * @param {any} alternative
 * @param {any} slots
 * @param {any} fail
 * @param {any} afterTerms
 */
export function validateDefinitionExpansion50(rule, alternative, slots, fail, check = validateClosedTypes, afterTerms) {
  const witness = captureRoutes50(alternative.expr);
  /** @type {any} */
  let fault;
  let late = false;
  /** @type {any} */
  let clause;
  /** @type {any} */
  let clauseSlot;
  /** @type {any} */
  let sites;
  /** @param {any} node */
  const siteOrder = node => {
    if (!sites) {
      sites = new WeakMap();
      const pending = [[clause, false, clauseSlot]];
      let index = 0;
      while (pending.length) {
        const [part, ready, slot] = /** @type {any[]} */ (pending.pop());
        if (!part || typeof part !== "object") continue;
        if (ready) {
          sites.set(part, index++);
        } else {
          pending.push([part, true, slot]);
          for (const [, child, childSlot] of operandFields50(part, slot).reverse()) pending.push([child, false, childSlot]);
        }
      }
    }
    return sites.get(node) ?? Infinity;
  };
  /**
   * @param {any} route
   * @param {any} node
   * @param {any} description
   */
  const note = (route, node, description) => {
    const order = fault ? routeOrder50(route, fault.route) : -1;
    if (order < 0 || order === 0 && clause === fault.clause && siteOrder(node) < siteOrder(fault.node)) {
      fault = { route, node, description, late, clause };
    }
  };
  const collected = Symbol("collected type fault");
  /**
   * @param {any} node
   * @param {any} description
   */
  const noteType = (node, description) => {
    const route = run(witness());
    if (route) note(route, node, description);
    throw collected;
  };
  /** @param {any} node */
  const visit = (node, forwarding = false, message = false, body = false) => {
    if (!node) return;
    clause = node;
    clauseSlot = body ? "body" : forwarding ? "output" : "expression";
    sites = undefined;
    try {
      if (body) return check(node, noteType, { slot: clauseSlot });
      if (forwarding && node.term && slots.get(node.capture)) noteType(node, "a braced output item needs a node");
      checkExpansionScope(node, slots, witness, note, clauseSlot);
      const hiddenKeys = node === rule.term ? directKeys(alternative.term?.bag) : undefined;
      const hiddenStrings = node === rule.term ? laterStringFields50(alternative.term?.bag) : undefined;
      check(node, noteType, { slot: clauseSlot, slots, forwarding, message, nodeTerm: !message, hiddenKeys, hiddenStrings });
    } catch (error) {
      if (error !== collected) throw error;
    }
  };
  visit(rule.term);
  visit(alternative.expr, false, false, true);
  visit(alternative.term);
  late = true;
  visit(rule.error ?? rule.warning, false, true);
  for (const item of rule.emit?.items ?? []) visit(item, true);
  if (!fault || fault.late) afterTerms?.();
  if (fault) fail(fault.node, fault.description);
}

/** @param {any} node */
function boundaryTargetFault(node) {
  if ((node.method === "followed-by" || node.method === "preceded-by") &&
      node.args.some((/** @type {any} */ target) => target.terminal?.startsWith("_"))) {
    return "a boundary target must be a rule, exact instance or user tag";
  }
}

/** @param {any} root */
function boundaryFault(root) {
  let first, fault;
  const captures = new Set();
  const pending = [[root, new Set(), "expression"]];
  while (pending.length) {
    const [node, locals, slot] = /** @type {any[]} */ (pending.pop());
    if (!node || typeof node !== "object" || slot === "argument[]") continue;
    if (node.lambda !== undefined) {
      pending.push([node.body, new Set([...locals, node.lambda]), "expression"]);
      continue;
    }
    if (node.capture !== undefined && !node.expr && !locals.has(node.capture)) captures.add(node.capture);
    if (node.method === "followed-by" || node.method === "preceded-by") {
      if (!fault) {
        const message = boundaryTargetFault(node) ??
          (first ? "a condition item cannot have more than one boundary atom" : undefined);
        if (message) fault = { node, message };
      }
      first ??= node;
    }
    for (const [, child, childSlot] of operandFields50(node, slot).reverse()) pending.push([child, locals, childSlot]);
  }
  const receiver = first?.receiver?.capture;
  if (!fault && receiver && [...captures].some(name => name !== receiver)) {
    return { node: first, message: "a condition with a named boundary receiver cannot read another capture" };
  }
  return fault;
}

/**
 * @param {any} rule
 * @param {any} fail
 */
export function validateDefinitionBoundaries50(rule, fail) {
  for (const condition of rule.conditions ?? []) {
    const fault = boundaryFault(condition);
    if (fault) fail(fault.node, fault.message);
  }
}

// Test the declared slots of one alternative. An optional slot still
// exists, but its truth is unresolved until its bindings are available.
/**
 * @param {any} condition
 * @param {any} slots
 */
function conditionApplies50(condition, slots) {
  const absent = Symbol("absent condition capture");
  const report = () => { throw absent; };
  /**
   * @param {any} part
   * @param {any} bindings
   * @param {any} presence
   * @param {any} slot
   * @returns {Generator<any, any, any>}
   */
  function* check(part, bindings, presence, slot) {
    if (slot === "argument[]" || part?.gates?.length) return;
    return yield expansionScope(part, slots, report, bindings, presence, check, slot);
  }
  const present = new Map([...slots].filter(([, list]) => !list).map(([name]) => [name, true]));
  try {
    run(expansionScope(condition, slots, report, new Set([""]), present, check, "expression", true));
    return true;
  } catch (error) {
    if (error === absent) return false;
    if (error instanceof CapturePresence50) return true;
    throw error;
  }
}

/**
 * @param {any} rule
 * @param {any} slots
 * @param {any} fail
 */
export function validateDefinitionConditions50(rule, slots, fail, check = validateClosedTypes) {
  const shared = new Map();
  for (const slot of slots) for (const [name, type] of slot) {
    shared.set(name, !shared.has(name) || shared.get(name) === type ? type : undefined);
  }
  const types = new Map([...shared].filter(([, type]) => type !== undefined));
  for (const condition of rule.conditions ?? []) {
    const boundary = boundaryFault(condition);
    check(condition, fail, { slots: types, truth: true, boundary });
    if (slots.length > 1 && !slots.some((/** @type {any} */ slot) => conditionApplies50(condition, slot))) {
      fail(rule, "a condition applies to no alternative");
    }
  }
}

// The native loader supplies the expanded productions in order and the
// structural nullability result for each one.
/**
 * @param {any} productions
 * @param {any} nullable
 * @param {any} fail
 */
export function validateDefinitionNullability50(productions, nullable, fail) {
  for (const production of productions) {
    if (production.errorSource && nullable(production)) {
      fail(production.errorSource, "an error production can derive an empty sequence");
    }
  }
}

const comparable = new Set(["string", "number", "truth", "keys"]);
/** @param {any} type */
const isBag = type => type === "bag" || type === "keys";
const emptyElement = Symbol("empty list element");
const incompatible = Symbol("incompatible types");
/** @param {any} type */
const kindOf = type => Array.isArray(type) ? "list" : type;
/** @param {any} type */
const elementOf = type => Array.isArray(type) ? type[0] : undefined;
/** @param {any} type */
const openType = type => type === undefined || type === emptyElement;
const storedTypes = new Set(["string", "number", "bag", "keys"]);

/** @param {any} type */
function invalidStoredType(type) {
  while (Array.isArray(type)) type = elementOf(type);
  return !openType(type) && !storedTypes.has(type);
}

/**
 * @param {any} left
 * @param {any} right
 * @returns {any}
 */
function joinTypes(left, right, constraint = false) {
  if (left === incompatible || right === incompatible) return incompatible;
  if (left === emptyElement) return right;
  if (right === emptyElement) return left;
  if (left === undefined || right === undefined) return constraint ? left ?? right : undefined;
  if (left === right) return left;
  if (isBag(left) && isBag(right)) return "bag";
  if (Array.isArray(left) && Array.isArray(right)) {
    /** @type {any} */
    const element = joinTypes(elementOf(left), elementOf(right), constraint);
    return element === incompatible ? incompatible : [element];
  }
  return incompatible;
}

/** @param {any} type */
function comparableElement(type) {
  while (Array.isArray(type)) type = type[0];
  return openType(type) || comparable.has(type);
}

/**
 * @param {any} left
 * @param {any} right
 */
function sameElementType(left, right) {
  // Bags and key sets have a common storage type, but only key sets have
  // element equality.
  return comparableElement(left) && comparableElement(right) && joinTypes(left, right) !== incompatible;
}

const spanTypes = ["span", "node"];
const bagTypes = ["keys", "bag", "node"];
const predicateTypes = ["list", "forest"];
const methodTypes = new Map([
  ["split", ["list", "string"]],
  ["ngrams", ["list", "string"]],
  ["parse", ["forest", ...spanTypes]],
  ["span", ["span", "node"]],
  ["children", ["list", "node"]],
  ["tokens", ["list", ...spanTypes]],
  ["join", ["string", "list"]],
  ["union", ["keys", "list"]],
  ["present", ["truth", "node", "list"]],
  ["all", ["truth", ...predicateTypes]],
  ["any", ["truth", ...predicateTypes]],
  ["preceding-tokens", ["span", ...spanTypes]],
  ["following-tokens", ["span", ...spanTypes]],
  ["first-token", ["span", ...spanTypes]],
  ["last-token", ["span", ...spanTypes]],
  ["tokens-after-first", ["span", ...spanTypes]],
  ["onward", ["span", ...spanTypes]],
  ["starts-input", ["truth", ...spanTypes]],
  ["ends-input", ["truth", ...spanTypes]],
  ["source-text", ["string", ...spanTypes]],
  ["decomposed-source-text", ["string", ...spanTypes]],
  ["verbatim-text", ["string", ...spanTypes]],
  ["without-elision", ["span", "node"]],
  ["without-elision-except", ["span", "node"]],
  ["preceded-by", ["truth", "node"]],
  ["followed-by", ["truth", "node"]],
  ["flags", ["keys", ...bagTypes, "span", "forest"]],
  ["classes", ["keys", ...bagTypes, "span"]],
  ["keys", ["keys", ...bagTypes]],
  ["has", ["truth", ...bagTypes]],
  ["has-value", ["truth", ...bagTypes]],
  ["select", [undefined, ...bagTypes]],
  ["overlaps", ["truth", "keys"]],
  ["classify", ["keys", "keys", "bag"]],
  ["at-most", ["number", "number"]],
  ["error-free", ["forest", "forest"]],
]);

// Resolve only literal, unconditionally edited classifier entries here.
/** @param {any} node */
function literalBagFields(node) {
  if (!node?.bag) return;
  const fields = new Map();
  const names = new Set();
  for (const entry of node.bag) {
    if (entry.gates.length || entry.guard) return;
    if (entry.kind === "delete") fields.delete(entry.key);
    else if (entry.kind === "write" || entry.kind === "bare") {
      for (const key of entry.keys ?? [entry.key]) {
        fields.set(key, entry.value);
        names.add(key);
      }
    } else return;
  }
  return { fields, names };
}

/**
 * @param {any} node
 * @param {any} receiver
 * @param {any} type
 * @param {any} fail
 */
function validateLiteralClassifier(node, receiver, type, fail) {
  const table = literalBagFields(receiver);
  if (!table) return;
  for (const field of table.fields.values()) {
    const value = type(field);
    const member = elementOf(value);
    const strings = Array.isArray(value) && (openType(member) || member === "string");
    if (!field || !(openType(value) || value === "keys" || value === "string" || strings)) {
      fail(node, "a method has the wrong receiver or arguments");
    }
    const references = value === "keys" && literalBagFields(field);
    if (references) for (const key of references.fields.keys()) {
      if (!table.names.has(key)) fail(node, `a classifier references unknown class ${key}`);
    }
  }
}

const methodArguments = new Map([
  ["split", "string"], ["join", "string"], ["classify", "string"],
  ["select", "keys"], ["overlaps", "keys"], ["all", "function"], ["any", "function"],
]);

// The document can check closed operand types. A reference that needs the
// effective stage, a template binding or an input shape stays unresolved.
/**
 * @param {any} root
 * @param {any} fail
 * @param {any} [options]
 */
function validateClosedTypes(root, fail, { closed = false, slots = new Map(), truth = false, forwarding = false,
  message = false, nodeTerm = false, hiddenKeys = new Set(), hiddenStrings = new Set(), boundary, whole = "node",
  slot = "expression" } = {}) {
  const types = new WeakMap();
  /** @param {any} node */
  const type = node => node && typeof node === "object" ? types.get(node) : undefined;
  /**
   * @param {any} node
   * @param {any} value
   */
  const remember = (node, value) => {
    if (value !== undefined) types.set(node, value);
  };
  /**
   * @param {any} value
   * @param {any} allowed
   */
  const invalid = (value, allowed) => !openType(value) && !allowed.includes(kindOf(value));
  const pending = [[root, false, new Map(), false, truth, slot, slot === "argument[]"]];
  const captureTypes = new Map([...slots].map(([name, list]) => [name, list ? ["node"] : "node"]));
  const predicates = new WeakMap();
  const maps = new WeakMap();
  while (pending.length) {
    const [node, ready, scope, implicit, needsTruth, nodeSlot, inActual] = /** @type {any[]} */ (pending.pop());
    if (!node || typeof node !== "object") continue;
    const kind = recordKind50(node, nodeSlot);
    if (!ready) {
      pending.push([node, true, scope, implicit, needsTruth, nodeSlot, inActual]);
      if (["all", "any"].includes(node.method) && node.args[0]?.lambda !== undefined) predicates.set(node.args[0], node);
      if (node.map && node.by) maps.set(node.by, node.map);
      if (node.lambda !== undefined) {
        const name = node.lambda;
        if (name && scope.has(name)) fail(node, "a function binder cannot hide a live name");
        const predicate = predicates.get(node);
        const receiver = predicate ? type(predicate.receiver) ?? elementOf(type(maps.get(predicate))) : type(maps.get(node));
        const argument = receiver === "forest" ? "node" : elementOf(receiver);
        const frame = new Map(scope);
        frame.set("", argument);
        if (name) frame.set(name, argument);
        // The binder of an empty list has no element type yet. Its first
        // typed use fixes one, which every later use must fit.
        if (name && argument === emptyElement) frame.set("\u0000" + name, { known: undefined });
        pending.push([node.body, false, frame, true, predicates.has(node), "expression", inActual]);
        continue;
      }
      for (const [key, child, childSlot] of operandFields50(node, nodeSlot).reverse()) {
        const childTruth = key === "if" || key === "guard" || key === "not" ||
          key === "then" && (!node.else || needsTruth) || key === "else" && needsTruth ||
          kind === "conjunction" || kind === "disjunction" || Array.isArray(node) && needsTruth;
        const context = captureBoundary50(node, childSlot);
        pending.push([child, false, context ? new Map() : scope, !context && implicit, !context && childTruth,
          childSlot, inActual || context === "argument"]);
      }
      continue;
    }
    if (Array.isArray(node)) continue;
    if (boundary?.node === node) fail(node, boundary.message);
    const targetFault = boundaryTargetFault(node);
    if (targetFault) fail(node, targetFault);
    if (closed && node.capture !== undefined && !scope.has(node.capture)) {
      fail(node, "a constant cannot read a capture outside its function scope");
    }
    if (closed && node.item && !implicit) fail(node, "an implicit receiver needs a function binding");
    if (node.capture !== undefined && !node.expr && !(forwarding && node === root)) {
      const inferred = scope.has(node.capture) && node.capture ? scope.get(node.capture) :
        node.capture === "" ? whole : captureTypes.get(node.capture);
      remember(node, inferred);
    }
    if (node.item) remember(node, scope.get(""));
    if (node.string !== undefined) remember(node, "string");
    if (node.integer !== undefined) remember(node, "number");
    if (node.lambda !== undefined) {
      if (type(node.body) === "function") fail(node.body, "a function cannot return a function");
      remember(node, "function");
    }
    if (node.map) {
      if (invalid(type(node.map), ["list"])) fail(node, "a map needs a list");
      if (node.by.lambda === undefined && !node.by.method && !node.by.property &&
          invalid(type(node.by), ["function"])) fail(node, "a map needs a function or selector");
      remember(node, [type(node.by.lambda !== undefined ? node.by.body : node.by)]);
    }
    if (node.flatten) {
      const nested = elementOf(type(node.flatten));
      if (invalid(type(node.flatten), ["list"]) || invalid(nested, ["list"])) {
        fail(node, "flatten needs a list of lists");
      }
      remember(node, [nested === emptyElement ? emptyElement : elementOf(nested)]);
    }
    if (node.list) {
      let member = emptyElement;
      let required = emptyElement;
      for (const entry of node.list) {
        const value = type(entry.value);
        if (entry.kind === "splat" && invalid(value, ["list"])) fail(entry, "a list splat needs a list");
        if (value === "function") fail(entry.value, "a list cannot store a function");
        const item = entry.kind === "splat" ? elementOf(value) : value;
        member = joinTypes(member, item);
        if (!entry.guard && !entry.gates.length) required = joinTypes(required, item, true);
      }
      if (required === incompatible) fail(node, "a list needs one common element type");
      remember(node, [member === incompatible ? undefined : member]);
    }
    if (node.emptySet || node.pattern) remember(node, "pattern");
    if (node.bag) {
      const definiteKeys = node.bag.every((/** @type {any} */ entry) => entry.kind === "bare" || entry.kind === "delete" ||
        entry.kind === "splat" && type(entry.value) === "keys");
      const payloads = new Map();
      let open = false;
      for (const entry of node.bag) {
        if (entry.kind === "write" && !entry.guard && !entry.gates.length) {
          for (const key of entry.keys) payloads.set(key, true);
        } else if (entry.kind === "write" || entry.kind === "copy" || entry.kind === "splat" && type(entry.value) !== "keys") {
          open = true;
          payloads.clear();
        } else if ((entry.kind === "delete" || entry.kind === "bare") && !entry.guard && !entry.gates.length) {
          payloads.delete(entry.key);
        }
      }
      if (definiteKeys || !open && !payloads.size) remember(node, "keys");
      else if (payloads.size) remember(node, "bag");
      const writesNode = nodeTerm && node === (forwarding ? root.term : root);
      const hidden = new Set(hiddenKeys);
      const effective = new Set();
      const effectiveStrings = new Set();
      const laterStrings = new Set(hiddenStrings);
      if (writesNode) for (const entry of node.bag.slice().reverse()) {
        for (const key of stringFields) {
          const edit = run(stringFieldEdit50(entry, key));
          if (edit !== noFieldEdit && !laterStrings.has(key)) {
            // A winning bare value or image gives the node no string, as a
            // payload of another type does. A deletion leaves no effective key.
            if (edit === bareField || invalid(type(edit), ["string"])) effectiveStrings.add(entry);
            laterStrings.add(key);
          }
        }
        if (entry.kind === "write" || entry.kind === "bare") {
          const keys = entry.keys ?? [entry.key];
          if (keys.some((/** @type {any} */ key) => !hidden.has(key) && key.startsWith("_"))) {
            effective.add(entry);
          }
        }
        if (!entry.guard && !entry.gates.length) {
          if (entry.kind === "write") for (const key of entry.keys) hidden.add(key);
          if (entry.kind === "bare" || entry.kind === "delete") hidden.add(entry.key);
        }
      }
      for (const entry of node.bag) {
        if (entry.kind === "splat" && invalid(type(entry.value), ["keys", "node", "bag"])) {
          fail(entry, "a bag splat needs a bag or node");
        }
        if (entry.kind === "bare" && effective.has(entry) && entry.key.startsWith("_")) {
          fail(entry, "a constructor cannot write an engine key without provenance");
        }
        if (entry.kind !== "write" && effectiveStrings.has(entry)) {
          fail(entry, "a value or image needs a string");
        }
        if (entry.kind === "copy" && invalid(type(entry.source), bagTypes)) {
          fail(entry, "a copy needs a node or bag");
        }
        if (entry.kind !== "write") continue;
        const value = type(entry.value);
        if (value === "function") fail(entry.value, "a key cannot store a function");
        if (entry.keys.some((/** @type {any} */ key) => key.startsWith("_"))) fail(entry, "a constructor cannot write an engine key");
        if (effectiveStrings.has(entry)) {
          fail(entry.value, "a value or image needs a string");
        }
        if (invalidStoredType(value)) fail(entry.value, "a key needs a stored value");
      }
    }
    if (message && !inActual) {
      if (node.method === "parse") fail(node, "a message cannot read a query");
      if (node.method === "verbatim-text") fail(node, "a message cannot claim verbatim text");
    }
    const mapped = maps.get(node);
    const receiver = type(node.receiver) ?? elementOf(type(mapped));
    if (node.property && invalid(receiver, bagTypes)) fail(node, "a property read needs a node or bag");
    const signature = methodTypes.get(node.method);
    if (signature) {
      const [result, ...receivers] = signature;
      const wrong = () => fail(node, "a method has the wrong receiver or arguments");
      if (invalid(receiver, receivers)) wrong();
      const argumentType = methodArguments.get(node.method);
      if (argumentType && invalid(type(node.args[0]), [argumentType])) wrong();
      if (node.method === "any" && kindOf(receiver) === "list" && !node.args.length) wrong();
      if (node.method === "classify") {
        if (node.receiver) validateLiteralClassifier(node, node.receiver, type, fail);
        else for (const entry of mapped?.list ?? []) {
          if (entry.kind === "item" && !entry.guard && !entry.gates.length) {
            validateLiteralClassifier(node, entry.value, type, fail);
          }
        }
      }
      const member = elementOf(receiver);
      if (node.method === "join" && invalid(member, ["string"]) ||
          node.method === "union" && invalid(member, ["keys"])) wrong();
      const element = ["split", "ngrams"].includes(node.method) ? "string" : "node";
      remember(node, result === "list" ? [element] :
        node.method === "select" && receiver === "keys" ? "keys" : result);
    }
    if (node.concat) {
      if (node.concat.some((/** @type {any} */ part) => invalid(type(part), ["string"]))) fail(node, "++ requires string operands");
      remember(node, "string");
    }
    if (node.if) {
      const yes = type(node.then);
      const no = type(node.else);
      const result = joinTypes(yes, no);
      if (node.else && result === incompatible) {
        fail(node, "a conditional requires compatible branch types");
      }
      if (!node.else) remember(node, "truth");
      else remember(node, result);
    }
    const group = node.union ?? node.intersection ?? node.difference;
    if (group && node.at) {
      const known = group.map(type).filter((/** @type {any} */ value) => !openType(value));
      const listDifference = node.difference && kindOf(type(group[0])) === "list";
      const openDifference = node.difference && openType(type(group[0]));
      if (listDifference) {
        const [left, right] = group.map(type);
        const member = elementOf(left);
        const direct = sameElementType(member, right);
        const exclusion = Array.isArray(right) && sameElementType(member, elementOf(right));
        if (!direct && !exclusion) fail(node, "∖ requires compatible operands");
      }
      if (!listDifference && !openDifference &&
          (known.some((/** @type {any} */ value) => value !== "keys" && value !== "pattern") || new Set(known).size > 1)) {
        const op = node.union ? "∪" : node.intersection ? "∩" : "∖";
        fail(node, `${op} requires compatible operands`);
      }
      if (!openDifference) remember(node, listDifference ? type(group[0]) : known[0]);
    }
    if (kind === "negation" || kind === "conjunction" || kind === "disjunction") remember(node, "truth");
    if (needsTruth && ["string", "number", "pattern", "function"].includes(type(node))) {
      fail(node, "this operand does not have a truth value");
    }
    if (!node.op) continue;
    const left = type(node.left);
    const right = type(node.right);
    /**
     * @param {any} side
     * @param {any} known
     */
    const constrain = (side, known) => {
      const cell = side?.capture ? scope.get("\u0000" + side.capture) : undefined;
      if (!cell || openType(known)) return;
      if (cell.known !== undefined && joinTypes(cell.known, known) === incompatible) {
        fail(node, `the binder $${side.capture} of an empty list needs one element type`);
      }
      cell.known ??= known;
    };
    if (["=", "≠"].includes(node.op)) {
      constrain(node.left, right);
      constrain(node.right, left);
    }
    if (["+", "<", "≤", ">", "≥"].includes(node.op)) {
      constrain(node.left, "number");
      constrain(node.right, "number");
    }
    if (["+", "<", "≤", ">", "≥"].includes(node.op) && [left, right].some(value => invalid(value, ["number"]))) {
      fail(node, `${node.op} requires number operands`);
    }
    if (needsTruth && node.op === "+") fail(node, "this operand does not have a truth value");
    if (["=", "≠"].includes(node.op)) {
      if ([left, right].some(value => !openType(value) && !comparable.has(value)) ||
          joinTypes(left, right) === incompatible) {
        fail(node, `${node.op} requires comparable operands of one type`);
      }
    }
    if (["⊆", "⊈"].includes(node.op) && [left, right].some(value => invalid(value, ["keys"]))) {
      fail(node, `${node.op} requires key sets`);
    }
    if (["∈", "∉"].includes(node.op)) {
      if (invalid(right, ["list"])) fail(node, `${node.op} requires a list on its right`);
      if (!sameElementType(left, elementOf(right))) fail(node, `${node.op} requires compatible operands`);
    }
    if (["≅", "≇"].includes(node.op)) {
      if (node.left.capture === undefined && !node.left.item) {
        fail(node, "a structural comparison needs one capture or bound item on its left");
      }
      if (node.left.capture !== undefined && node.left.capture === node.right.capture ||
          node.left.item && node.right.item) {
        fail(node, "a structural comparison cannot compare a binding with itself");
      }
      if (invalid(left, ["node"])) fail(node, "a structural comparison needs a bound node on its left");
      if (invalid(right, ["pattern", "node"])) {
        fail(node, "a structural comparison needs a pattern or a bound node on its right");
      }
    }
    remember(node, node.op === "+" ? "number" : "truth");
  }
  if (message && invalid(type(root), ["string"])) fail(root, "a message needs a string");
}

const stageDirectives = new Set(["stage", "extend-stage", "redefine-stage"]);

/**
 * @param {any} category
 * @param {any} declaration
 * @param {any} fail
 * @param {any} unicode
 */
function validateHeader(category, declaration, fail, unicode) {
  const { name } = declaration;
  if (category === "rules") {
    const { args, instance, params, op } = declaration;
    if (!validRule(name, unicode)) {
      fail(declaration, "a rule name must begin with a lowercase letter or be an emoji name");
    }
    if (instance && (args || params)) fail(declaration, "an instance binding needs a plain rule name");
    if (instance && op === "extend") fail(declaration, "an instance binding cannot extend a rule");
    if (args && (op === "define" || args.some((/** @type {any} */ arg) => arg.param))) {
      fail(declaration, "a rule head needs all parameters or an exact instance edit");
    }
    if (params) {
      const seen = new Set();
      for (const param of params) {
        if (!parameterName.test(param)) fail(declaration, "invalid parameter name");
        if (seen.has(param)) fail(declaration, `duplicate parameter @${param}`);
        seen.add(param);
      }
      if (declaration.error || declaration.warning) fail(declaration, "a template cannot declare an error or warning");
    }
    if (declaration.suppressWarnings?.some((/** @type {any} */ code) => code !== "_" && !featureName.test(code))) {
      fail(declaration, "invalid warning code");
    }
  } else if (category === "constants") {
    if (!CONSTANT_NAME.test(name)) fail(declaration, "invalid constant name");
  } else if (name === "include" || name === "names") {
    const { args } = declaration;
    if (args?.length !== 1 || typeof args[0] !== "string") fail(declaration, `%${name} takes one quoted path`);
  } else if (name === "features") {
    const { args } = declaration;
    if (!args?.length || args.some((/** @type {any} */ arg) => !featureName.test(arg))) fail(declaration, "%features takes feature names");
  } else if (name === "elision-only") {
    if (declaration.args?.length !== 0) fail(declaration, "%elision-only takes no operands");
  } else if (stageDirectives.has(name)) {
    const { args } = declaration;
    if (args?.length !== 1 || !ruleName50.test(args[0])) fail(declaration, `%${name} takes one stage name`);
  } else if (name === "ambiguity-resolution") {
    const { steps } = declaration;
    for (const step of steps ?? []) {
      if (Boolean(step.pattern) !== KEY_STEPS.has(step.step)) fail(step, "invalid resolution step operand");
    }
    if (!validSteps(steps)) fail(declaration, "invalid resolution policy");
  }
}

/**
 * @param {any} category
 * @param {any} declaration
 * @param {any} fail
 * @param {any} unicode
 * @param {any} emptyDelimiters
 */
export function validateDeclarationShape50(category, declaration, fail, unicode, emptyDelimiters = []) {
  const locate = withOwner50(declaration, fail, declaration, category, true);
  validateHeader(category, declaration, locate, unicode);
  if (category === "constants" && declaration.name === "INPUTS") fail(declaration, "$INPUTS is supplied by the engine");
  const resolution = category === "directives" && declaration.name === "ambiguity-resolution";
  for (const step of resolution ? declaration.steps ?? [] : []) {
    if (step.pattern) validateExactPattern50(step.pattern, locate, { origin: step.step !== "leftmost-longest" });
  }

  const rule = category === "rules" ? declaration : undefined;
  const ruleBodies = new WeakSet((rule?.alternatives ?? []).map((/** @type {any} */ alt) => alt.expr));
  const outputItems = new WeakSet(rule?.emit?.items ?? []);
  const parameters = new Set(rule?.params);
  const defaults = new WeakMap();
  /** @type {any[]} */
  const pending = operandFields50(declaration, category).reverse()
    .map(([, node, slot]) => ({ node, slot, captureContext: slot === "argument[]" ? "argument" : undefined }));
  while (pending.length) {
    const task = /** @type {any} */ (pending.pop());
    const { node, slot, phase, captureContext, width, inRepeat, predicate } = task;
    if (!node || typeof node !== "object") continue;
    if (phase === "complete") {
      if (slot === "argument") validateArgument50(node, locate);
      if (node.method === "parse") validateQuery50(node, locate);
      continue;
    }
    const selector = node.method || node.property;
    if (selector && node.receiver && phase !== "selector") {
      pending.push({ ...task, phase: "selector" }, { node: node.receiver, slot: "expression", captureContext });
      continue;
    }
    const kind = recordKind50(node, slot);
    const requirement = slot === "requirementValue";
    if (ruleBodies.has(node)) validateBody50(node, locate);
    if (outputItems.has(node) && node.capture === "" && !node.term) locate(node, "only a braced item can select the whole rule");
    if (node.range) validateRange(node.range, node, locate);
    if (node.integer !== undefined && (width ? !/^[1-9][0-9]*$/.test(node.integer) :
      !/^(0|[1-9][0-9]*)$/.test(node.integer) || Number(node.integer) > 255)) {
      locate(node, width ? "a width must be positive" : "a count literal must be between 0 and 255");
    }
    if (node.capture !== undefined && node.expr && captureContext) {
      locate(node, captureContext === "query" ? "a query cannot declare captures" : argumentsError);
    }
    if (node.capture !== undefined && (node.capture !== "" || node.expr) && !CAPTURE_NAME.test(node.capture)) {
      locate(node, "a capture name must use lowercase letters, digits, hyphens or underscores");
    }
    if (node.lambda === "" && !predicate) locate(node, "a predicate requires an explicit binder");
    if (node.lambda && !CAPTURE_NAME.test(node.lambda)) {
      locate(node, "a capture name must use lowercase letters, digits, hyphens or underscores");
    }
    if (node.feature && !featureName.test(node.feature)) locate(node, "invalid feature name");
    if (node.ref === "_Elided" || node.terminal === "_Elided" || node.property === "_Elided" ||
        node.key === "_Elided" || !requirement && node.tag === "_Elided" ||
        Array.isArray(node.keys) && node.keys.includes("_Elided") ||
        ["has", "has-value"].includes(node.method) && node.args?.[0]?.key === "_Elided") {
      locate(node, "unknown or forbidden engine key _Elided");
    }
    if (node.property !== undefined && !validProperty50(node.property, unicode)) locate(node, "invalid property name");
    for (const value of [node.const, node.constant, node.apply]) {
      if (typeof value === "string" && !CONSTANT_NAME.test(value)) locate(node, "invalid constant name");
    }
    if (node.param !== undefined) {
      if (!parameterName.test(node.param)) locate(node, "invalid parameter name");
      if (!parameters.has(node.param)) locate(node, `unknown parameter @${node.param}`);
    }
    if (typeof node.call === "string" && !validRule(node.call, unicode) ||
        typeof node.rule === "string" && !validRule(node.rule, unicode) ||
        kind === "patternName" && !validRule(node.name, unicode)) {
      locate(node, "invalid rule name");
    }
    for (const name of [node.tag, node.terminal, typeof node.ref === "string" && terminalName.test(node.ref) ? node.ref : undefined]) {
      if (typeof name === "string" && !(requirement && name === "_Elided") && !validTag(name, unicode)) {
        locate(node, "invalid tag name");
      }
    }
    if (typeof node.ref === "string" && !terminalName.test(node.ref) && !validRule(node.ref, unicode)) locate(node, "invalid rule name");
    for (const key of Array.isArray(node.keys) ? node.keys : [node.key]) {
      if (typeof key === "string" && !validProperty50(key, unicode)) locate(node, "invalid key name");
    }
    if (node.method) {
      const sig = /** @type {{min: number, max: number}} */ (methods50.get(node.method));
      if (!sig) locate(node, `unknown method .${node.method}`);
      if (!node.args || node.args.length < sig.min || node.args.length > sig.max) {
        locate(node, `method .${node.method} has the wrong number of arguments`);
      }
      if (node.method === "split" && node.args[0].string === "") emptyDelimiters.push(node);
    }
    if (kind === "bodyTags" || kind === "patternTags") validateOrigin50(node, locate, kind === "patternTags");
    if (node.children) validatePatternChildren50(node, locate);
    if (node.bag) validateBag50(node.bag, locate);
    if (inRepeat && node.siblings) locate(node, "a repeated child list cannot contain a sibling gap");
    if (slot === "argument" || node.method === "parse") {
      pending.push({ ...task, phase: "complete" });
    }
    const ordered = operandFields50(node, slot);
    if (node.elidable && node.default && node.optional.seq) defaults.set(node.optional.seq, node.default);
    if (defaults.has(node)) ordered.splice(1, 0, ["default", defaults.get(node), "stringTerm"]);
    for (const [key, value, childSlot] of ordered.reverse()) {
      if (selector && key === "receiver" || key === "default" && node.optional?.seq) continue;
      const methodArgs = childSlot === "methodArgument[]";
      const arrayItem = Array.isArray(node);
      const childList = childSlot === "childItem" || childSlot === "childItem[]" || childSlot === "childItem[][]";
      pending.push({
        node: value, slot: childSlot,
        captureContext: captureBoundary50(node, childSlot) ?? captureContext,
        width: methodArgs && node.method === "ngrams" || arrayItem && width,
        inRepeat: childList && (inRepeat || kind === "childRepeat" || kind === "childRepeatSeparated"),
        predicate: childSlot === "selector" || methodArgs && (node.method === "all" || node.method === "any") ||
          arrayItem && key === "0" && predicate,
      });
    }
  }
}

/** @param {any} dom */
const orderedDeclarations = dom => ["rules", "directives", "constants"]
  .flatMap(category => dom[category].map((/** @type {any} */ declaration) => [category, declaration]))
  .sort(([, a], [, b]) => a.at[0] - b.at[0] || a.at[1] - b.at[1]);

/**
 * @param {DocumentValidation} [configuration]
 * @param {any} dom
 */
export function validateDocumentShape50(dom, configuration = {}) {
  const { document, unicode } = configuration;
  const fail = documentFault50(document);
  const fault = memberFault50(dom, "document");
  if (fault) fail(dom, fault);
  /** @type {any[]} */
  const emptyDelimiters = [];
  let preamble = true;
  for (const [category, declaration] of orderedDeclarations(dom)) {
    if (category === "directives" && declaration.name === "names") {
      if (!preamble) fail(declaration, "%names must precede all other declarations");
    } else {
      preamble = false;
    }
    validateDeclarationShape50(category, declaration, fail, unicode, emptyDelimiters);
  }
  if (emptyDelimiters.length) fail(emptyDelimiters[0], "a split delimiter cannot be empty");
}

/**
 * @param {DocumentValidation} [configuration]
 * @param {any} dom
 */
export function validateDocumentDefinitions50(dom, configuration = {}) {
  const { document } = configuration;
  const fail = documentFault50(document);
  for (const [category, declaration] of orderedDeclarations(dom)) {
    const locate = withOwner50(declaration, fail, declaration, category);
    if (category === "rules" && declaration.instance) validateClosedTypes(declaration.instance, locate, { slot: "instance" });
    if (category === "rules" && declaration.alternatives) {
      if (declaration.args) validateClosedTypes(declaration.args, locate, { slot: "argument[]" });
      const slots = declaration.alternatives.map((/** @type {any} */ alt) => captureSlots50(alt.expr));
      validateDefinitionNames50(declaration, slots, locate);
      let earlier;
      for (const [index, alternative] of declaration.alternatives.entries()) {
        let checkingTerms = true;
        try {
          validateDefinitionExpansion50(declaration, alternative, slots[index], locate, validateClosedTypes,
            () => { checkingTerms = false; });
        } catch (error) {
          if (checkingTerms || !(error instanceof GencmuError)) throw error;
          // Conditions precede the message and outputs in the declaration.
          // Remember the winning expansion fault before checking conditions.
          earlier = error;
          break;
        }
      }
      validateDefinitionConditions50(declaration, slots, locate);
      if (earlier) throw earlier;
    } else if (category === "directives" && declaration.name === "features") {
      for (const condition of declaration.conditions ?? []) {
        validateBindings50(condition, (/** @type {any} */ node, /** @type {any} */ message) =>
          locate(node, message === argumentsError ? "a feature condition cannot read a named capture" : message),
          { closed: true, bindings: [""], slot: "expression" });
        validateClosedTypes(condition, locate, { truth: true, whole: "span" });
      }
    } else if (category === "directives" && declaration.name === "ambiguity-resolution") {
      for (const step of declaration.steps) {
        validateClosedTypes(step.pattern, locate, { slot: "resolutionPattern" });
      }
    } else if (category === "constants") {
      validateClosedTypes(declaration.value, locate, { closed: true });
    }
  }
}

/**
 * @param {DocumentValidation} [configuration]
 * @param {any} dom
 */
export function validateDocumentDepth50(dom, configuration = {}) {
  const { document } = configuration;
  const fail = documentFault50(document);
  for (const [category, declaration] of orderedDeclarations(dom)) {
    if (tooDeep(category, declaration)) fail(declaration, `an expression, term or condition is nested more than ${DOM_MAX_DEPTH} deep`);
  }
}

/**
 * @param {DocumentValidation} [configuration]
 * @param {any} dom
 */
export function validateDocument50(dom, configuration) {
  validateDocumentShape50(dom, configuration);
  validateDocumentDefinitions50(dom, configuration);
  validateDocumentDepth50(dom, configuration);
  return dom;
}

const transparentDepth50 = new Set([
  "primary", "expressionArgument", "bodyArgument", "query", "requirementsArgument", "targetsArgument",
  "requirement", "bare", "write", "copy", "delete", "splat", "item",
]);

/**
 * @param {any} category
 * @param {any} declaration
 */
function tooDeep(category, declaration) {
  /** @type {any[]} */
  const pending = [];
  /**
   * @param {any} value
   * @param {any} depth
   * @param {any} slot
   */
  const push = (value, depth, slot) => {
    if (value && typeof value === "object") pending.push([value, depth, slot]);
  };
  for (const [key, child, slot] of operandFields50(declaration, category)) {
    if (key === "alternatives" || key === "steps" || key === "emit") {
      const [hosts, hostSlot] = key === "emit" ? [child.items, "output[]"] : [child, slot];
      for (const [, host, kind] of operandFields50(hosts, hostSlot)) {
        for (const [field, value, operand] of operandFields50(host, kind)) if (field !== "gates") push(value, 0, operand);
      }
    } else push(child, key === "args" ? 1 : 0, slot);
  }
  while (pending.length) {
    const [node, depth, slot] = /** @type {any[]} */ (pending.pop());
    if (depth > DOM_MAX_DEPTH) return true;
    const kind = recordKind50(node, slot);
    const children = operandFields50(node, slot);
    if (kind === "bag" || kind === "list") {
      for (const [, entries, entryList] of children) {
        for (const [, entry, entrySlot] of operandFields50(entries, entryList)) {
          for (const [key, child, operand] of operandFields50(entry, entrySlot)) {
            if (key !== "gates") push(child, depth + 1, operand);
          }
        }
      }
      continue;
    }
    for (const [key, child, operand] of children) {
      if (key === "gates") continue;
      if (key === "by" && ["shortMethod", "shortProperty"].includes(recordKind50(child, operand))) {
        for (const [, arg, argSlot] of operandFields50(child, operand)) push(arg, depth + 1, argSlot);
      } else {
        const transparent = Array.isArray(node) || transparentDepth50.has(kind) ||
          key === "literal" || key === "range" || key === "requirements";
        push(child, transparent ? depth : depth + 1, operand);
      }
    }
  }
  return false;
}
