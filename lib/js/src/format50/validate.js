// @ts-nocheck
import { CAPTURE_NAME, CONSTANT_NAME, DOM_MAX_DEPTH, KEY_STEPS, validSteps } from "../dom.js";
import { GencmuError } from "../errors.js";
import { run } from "../trampoline.js";
import { methods50, validProperty50 } from "./signatures.js";

const argumentsError = "an argument cannot read or declare captures";
const baseSymbol = node => ["ref", "call", "param", "literal", "range", "wildcard", "splice", "test"]
  .some(key => Object.hasOwn(node, key));
const ruleName50 = /^(?!.*--)[a-z][A-Za-z0-9_-]*$/;
const featureName = /^(?!.*--)[A-Za-z][A-Za-z0-9-]*$/;
const terminalName = /^[A-Z_]/;
const userTag = /^(?!.*--)[A-Z][A-Za-z0-9_-]*$/;
const parameterName = /^(?!.*--)[A-Za-z][A-Za-z0-9_-]*$/;
// A custom Unicode table can grant an emoji name to any permitted scalar.
const validRule = (name, unicode) => ruleName50.test(name) ||
  typeof name === "string" && (unicode ? unicode.isEmojiName(name) :
    name !== "#" && name !== "@" && [...name].length === 1 && !/^[\uD800-\uDFFF]$/.test(name));
const validTag = (name, unicode) => userTag.test(name) || name.startsWith("_") && validProperty50(name, unicode);
/** @typedef {{ document?: string, unicode?: import("../unicode.js").UnicodeTable }} DocumentValidation */
const atomOf = node => {
  while (node.test) node = node.expr;
  return node;
};

export function validateOrigin50(node, fail, pattern) {
  if (!node.requirements || !node.test) return;
  const atom = atomOf(node);
  const rule = atom.name || atom.call || atom.splice || atom.ref && !terminalName.test(atom.ref);
  if (rule && node.requirements.some(req => req.value.tag === "_Elided" && (!pattern || !req.negated))) {
    fail(node, "the _Elided origin test applies only to a terminal");
  }
}

export function validatePatternChildren50(node, fail) {
  if (node.test || !node.any && !node.name && !node.call && !node.param) {
    fail(node, "only an untested rule atom, call or parameter can have a child list");
  }
}

export function documentFault50(document) {
  return (node, description) => {
    const [line, column] = Array.isArray(node?.at) ? node.at : [];
    throw new GencmuError("grammar", description, { document, line, column });
  };
}

export function withOwner50(root, fail, owner) {
  const sites = new WeakMap();
  const pending = [[root, owner]];
  while (pending.length) {
    const [node, parent] = pending.pop();
    if (!node || typeof node !== "object") continue;
    const site = Array.isArray(node.at) ? node : parent;
    sites.set(node, site);
    for (const [key, child] of Object.entries(node)) {
      if (key !== "at") pending.push([child, site]);
    }
  }
  return (node, message) => fail(Array.isArray(node?.at) ? node : sites.get(node) ?? owner, message);
}

/** @param {{ closed?: boolean, query?: boolean, bindings?: Iterable<string> }} [configuration] */
export function validateBindings50(root, fail, configuration = {}) {
  const { closed = false, query = false, bindings = [] } = configuration;
  const pending = [[root, new Set(bindings), false]];
  while (pending.length) {
    const [node, scope, implicit] = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (node.lambda !== undefined) {
      const name = node.lambda;
      if (name && scope.has(name)) fail(node, "a function binder cannot hide a live name");
      pending.push([node.body, name ? new Set([...scope, name]) : scope, true]);
      continue;
    }
    if (node.capture !== undefined) {
      if (node.expr && (closed || query)) {
        fail(node, query ? "a query cannot declare captures" : argumentsError);
      }
      if (closed && !scope.has(node.capture)) fail(node, argumentsError);
    }
    if (node.item && !implicit) fail(node, "an implicit receiver needs a function binding");
    const children = Object.values(node);
    for (let i = children.length - 1; i >= 0; i--) pending.push([children[i], scope, implicit]);
  }
}

export function validateArgument50(argument, fail) {
  validateBindings50(argument, fail, { closed: true });
  if (argument.body) validateBody50(argument.body, fail);
}

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
    const children = node.seq ?? node.choice ?? node.ranked ?? node.and ??
      [node.optional, node.repeat, node.separator, node.primary, node.expr];
    for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
  }
  validateBindings50(body, fail, { query: true });
  validateBody50(parts.length === 1 ? parts[0] : { seq: parts }, fail);
}

export const elidableForm50 = "an elidable optional starts with an ungrouped user terminal or parameter and can bind only its sole terminator";

export function validateSubsetSize50(size, node, fail) {
  if (size > 16) fail(node, "an ordered subset takes at most sixteen operands");
}

function validateOmission(node, fail) {
  if (!node.elidable) return;
  const optional = node.optional;
  const start = optional.seq?.[0] ?? optional;
  let head = start.capture !== undefined ? start.expr : start;
  const tests = [];
  while (head?.test) {
    tests.push(head);
    head = head.expr;
  }
  if (!head?.param && !/^[A-Z]/.test(head?.ref ?? "") ||
      start.capture !== undefined && optional.seq || optional.seq?.slice(1).some(part => captureSlots50(part).size)) {
    fail(node, elidableForm50);
  }
  const value = node.default?.string;
  if (value === undefined) return;
  for (const test of tests) {
    if (test.value?.string !== undefined && (test.value.string === value) !== (test.test === "=") ||
        test.requirements?.some(({ negated, value }) => value.tag && (head.ref || value.tag === "_Elided") &&
          (value.tag === "_Elided" || value.tag === head.ref) === negated)) {
      fail(node.default, "the default does not pass the omission predicate");
    }
  }
}

// Each slot is a node if the alternative binds it once on every route.
export function captureSlots50(body) {
  return run(bindingSlots(body, false));
}

function* bindingSlots(body, list) {
  if (body.capture !== undefined) return new Map([[body.capture, list]]);
  if (body.primary) return yield bindingSlots(body.primary, list);
  if (body.optional) return yield bindingSlots(body.optional, true);
  const routes = body.choice ?? body.ranked;
  const children = routes ?? body.seq ?? body.and ??
    (body.repeat ? [body.repeat, ...(body.separator ? [body.separator] : [])] : []);
  const slots = [];
  for (const child of children) slots.push(yield bindingSlots(child, list || !!body.repeat || body.and?.length > 1));
  const result = new Map();
  for (const child of slots) for (const [name, childList] of child) {
    result.set(name, !!result.get(name) || childList || !!body.choice && slots.some(slot => !slot.has(name)));
  }
  return result;
}

export function validateBody50(body, fail) {
  const zero = () => ({ names: new Map(), min: 0, max: 0 });
  function* visit(node, blocked = false, chain = false, whole = true) {
    if (node.primary) {
      const symbol = node.primary.expr && node.primary.capture !== undefined ? node.primary.expr : node.primary;
      const base = atomOf(symbol);
      if (!baseSymbol(base)) fail(node, "a primary marks one symbol or capture");
      if (blocked || base.splice) fail(node, "a primary must mark a mandatory child that is not a splice");
      const route = yield visit(node.primary, blocked, chain, false);
      route.min++;
      route.max++;
      return route;
    }
    if (node.capture !== undefined && node.expr) {
      if (chain) fail(node, "a chain item or separator cannot bind a capture directly");
      if (!CAPTURE_NAME.test(node.capture)) fail(node, "a capture name must use lowercase letters, digits, hyphens or underscores");
      if (!baseSymbol(node.expr)) fail(node, "a capture wraps one symbol");
      const route = yield visit(node.expr, blocked, chain, false);
      if (route.names.has(node.capture)) fail(route.names.get(node.capture), "a route binds a capture twice");
      route.names.set(node.capture, node);
      return route;
    }
    if (node.optional) {
      do {
        validateOmission(node, fail);
        node = node.optional;
      } while (node.optional);
      const route = yield visit(node, true, chain, false);
      route.min = 0;
      return route;
    }
    const children = node.seq ?? node.and ?? node.choice ?? node.ranked ??
      (node.repeat && [node.repeat, ...(node.separator ? [node.separator] : [])]);
    if (!children) return zero();
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

export function validateExactPattern50(pattern, fail, { origin = true } = {}) {
  if (pattern.const || pattern.constant) return;
  if (pattern.union || pattern.intersection || pattern.difference) {
    for (const part of pattern.union ?? pattern.intersection ?? pattern.difference) {
      validateExactPattern50(part, fail, { origin });
    }
    return;
  }
  if (!pattern.exact || pattern.path || pattern.children || pattern.any) fail(pattern, "a key step needs an exact local pattern");
  let atom = pattern;
  while (atom.test) {
    if (!origin && atom.requirements?.some(item => !item.negated && item.value.tag === "_Elided")) {
      fail(atom, "a leftmost-longest pattern cannot require _Elided");
    }
    atom = atom.expr;
  }
}

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
export function validateDefinitionNames50(rule, slots, fail) {
  const bindings = new Set(["", ...slots.flatMap(slot => [...slot.keys()])]);
  const roots = [rule.term, ...rule.conditions ?? [],
    rule.error, rule.warning, ...rule.emit?.items ?? []];
  const terms = rule.alternatives.map((alt, index) => [alt.term, new Set(["", ...slots[index].keys()]), false]);
  const pending = [[rule.term, bindings, false], ...terms,
    ...roots.slice(1).map(root => [root, bindings, false])].reverse();
  while (pending.length) {
    const [part, scope, implicit] = pending.pop();
    if (!part || typeof part !== "object") continue;
    if (part.lambda !== undefined) {
      if (part.lambda && scope.has(part.lambda)) fail(part, "a function binder cannot hide a live name");
      pending.push([part.body, part.lambda ? new Set([...scope, part.lambda]) : scope, true]);
      continue;
    }
    if (!implicit && part.item) fail(part, "an implicit receiver needs a function binding");
    if (part.capture !== undefined && !part.expr && !scope.has(part.capture) && !bindings.has(part.capture)) {
      fail(part, `$${part.capture} is captured by no alternative of ${rule.name}`);
    }
    const children = Object.values(part);
    for (let i = children.length - 1; i >= 0; i--) pending.push([children[i], scope, implicit]);
  }
}

// Only fold operations with closed scalar operands here. The native loader
// resolves constants, input properties and parameter-dependent guards.
function* closedScalar50(node) {
  if (node.string !== undefined) return node.string;
  if (node.integer !== undefined) return BigInt(node.integer);
  if (node.not) {
    const operand = yield closedScalar50(node.not);
    if (typeof operand === "boolean") return !operand;
  }
  if (node.all || node.any) {
    const deciding = !!node.any;
    for (const part of node.all ?? node.any) {
      const value = yield closedScalar50(part);
      if (typeof value !== "boolean") return;
      if (value === deciding) return deciding;
    }
    return !deciding;
  }
  if (node.if) {
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
  const left = yield closedScalar50(node.left);
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
  if (node.list?.every(entry => !entry.gates.length && !entry.guard && entry.kind === "item")) {
    return node.list.length > 0;
  }
}

function* captureWitness50(body, required, forbidden, names) {
  if (!required.every(name => names(body).has(name))) return false;
  if (body.capture !== undefined) return !forbidden.has(body.capture);
  if (body.primary) return yield captureWitness50(body.primary, required, forbidden, names);
  if (body.optional) {
    if (!body.elidable && required.length === 0) return true;
    return yield captureWitness50(body.optional, required, forbidden, names);
  }
  if (body.choice || body.ranked) {
    for (const child of body.choice ?? body.ranked) {
      if (yield captureWitness50(child, required, forbidden, names)) return true;
    }
    return false;
  }
  if (body.repeat) {
    const itemNeeds = required.filter(name => names(body.repeat).has(name));
    const separatorNeeds = required.filter(name => !names(body.repeat).has(name));
    if (!separatorNeeds.length && (yield captureWitness50(body.repeat, itemNeeds, forbidden, names))) return true;
    if (!(yield captureWitness50(body.repeat, [], forbidden, names))) return false;
    if (body.separator && !(yield captureWitness50(body.separator, [], forbidden, names))) return false;
    // Separate iterations can supply the required names of a flat list.
    for (const name of required) {
      if (names(body.repeat).has(name)) {
        if (!(yield captureWitness50(body.repeat, [name], forbidden, names))) return false;
      } else if (!(yield captureWitness50(body.separator, [name], forbidden, names))) return false;
    }
    return true;
  }
  if (body.seq || body.and) {
    let selected = false;
    for (const child of body.seq ?? body.and) {
      const needed = required.filter(name => names(child).has(name));
      const possible = yield captureWitness50(child, needed, forbidden, names);
      if ((body.seq || needed.length) && !possible) return false;
      selected ||= possible;
    }
    return selected;
  }
  return true;
}

const deferredTruth = Symbol("specialized truth");

class CapturePresence50 {
  constructor(name) {
    this.name = name;
  }
}

function checkExpansionScope(root, alternative, slots, fail, forwarding = false) {
  const containsMissing = new WeakMap();
  function* readsMissing(part) {
    if (!part || typeof part !== "object") return false;
    if (containsMissing.has(part)) return containsMissing.get(part);
    let missing = Boolean(part.capture && !slots.has(part.capture));
    for (const child of Object.values(part)) {
      if (missing) break;
      missing = yield readsMissing(child);
    }
    containsMissing.set(part, missing);
    return missing;
  }

  const cache = new WeakMap();
  const names = body => {
    if (!cache.has(body)) cache.set(body, captureSlots50(body));
    return cache.get(body);
  };
  // A separate operand check inherits its enclosing guard assignments.
  // Assignments from one entry do not constrain another entry.
  function* check(part, bindings, outerPresence, output = false) {
    if (!(yield readsMissing(part))) return;
    const choices = [outerPresence];
    while (choices.length) {
      const presence = choices.pop();
      try {
        yield expansionScope(part, slots, fail, bindings, presence, check, false, output);
      } catch (error) {
        if (!(error instanceof CapturePresence50)) throw error;
        for (const value of [false, true]) {
          const next = new Map(presence);
          next.set(error.name, value);
          const required = [];
          const forbidden = new Set();
          for (const [name, present] of next) {
            if (present) required.push(name);
            else forbidden.add(name);
          }
          if (yield captureWitness50(alternative.expr, required, forbidden, names)) choices.push(next);
        }
      }
    }
  }
  run(check(root, new Set([""]), new Map(), forwarding));
}

function* expansionScope(root, slots, fail, bindings, presence, check, truth = false, forwarding = false) {
  if (!root || typeof root !== "object") return;
  const walk = (part, asTruth = false) => asTruth ?
    expansionScope(part, slots, fail, bindings, presence, check, true) : check(part, bindings, presence);
  if (root.method === "present" && root.receiver?.capture !== undefined) {
    return yield walk(root.receiver, true);
  }
  if (root.capture !== undefined && !root.expr && !forwarding) {
    const name = root.capture;
    if (!bindings.has(name) && !slots.has(name)) {
      if (truth) return false;
      fail(root, `$${name} is absent from this expansion`);
    }
    if (truth && !bindings.has(name)) {
      if (presence.has(name)) return presence.get(name);
      throw new CapturePresence50(name);
    }
    return;
  }
  if (root.lambda !== undefined) {
    yield check(root.body, new Set([...bindings, root.lambda]), presence);
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
  if (root.all || root.any) {
    const result = !!root.any;
    let unknown = false;
    for (const part of root.all ?? root.any) {
      const value = yield walk(part, true);
      if (value === result || value === deferredTruth) return value;
      unknown ||= value === undefined;
    }
    return unknown ? undefined : !result;
  }
  for (const [key, child] of Object.entries(root)) {
    if (key !== "at" && key !== "guard") yield walk(child);
  }
  if (!truth) return;
  const literal = yield closedTruth50(root);
  if (typeof literal === "boolean") return literal;
  const pending = [root];
  let inputDependent = false;
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== "object") continue;
    if (item.const || item.param || item.apply) return deferredTruth;
    inputDependent ||= item.capture !== undefined || item.item === true;
    for (const child of Object.values(item)) pending.push(child);
  }
  return inputDependent ? undefined : deferredTruth;
}

// The caller supplies the expansion in grammar order. A native caller can
// extend each operand check with its stage types and presence witness.
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

function* bagField50(node, key) {
  if (node?.if && node.else) {
    const condition = yield closedTruth50(node.if);
    if (typeof condition === "boolean") return yield bagField50(condition ? node.then : node.else, key);
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

function laterStringFields50(entries = []) {
  return new Set(stringFields.filter(key => entries.some(entry => run(stringFieldEdit50(entry, key)) !== noFieldEdit)));
}

export function validateDefinitionExpansion50(rule, alternative, slots, fail, check = validateClosedTypes, afterTerms) {
  const visit = (node, forwarding = false, message = false) => {
    if (!node) return;
    if (forwarding) {
      if (node.term && slots.get(node.capture)) fail(node, "a braced output item needs a node");
    }
    checkExpansionScope(node, alternative, slots, fail, forwarding);
    const hiddenKeys = node === rule.term ? directKeys(alternative.term?.bag) : undefined;
    const hiddenStrings = node === rule.term ? laterStringFields50(alternative.term?.bag) : undefined;
    check(node, fail, { slots, forwarding, message, nodeTerm: !message, hiddenKeys, hiddenStrings });
  };
  visit(rule.term);
  check(alternative.expr, fail);
  visit(alternative.term);
  afterTerms?.();
  visit(rule.error ?? rule.warning, false, true);
  for (const item of rule.emit?.items ?? []) visit(item, true);
}

function boundaryFault(root) {
  let first, fault;
  const captures = new Set();
  const pending = [[root, new Set()]];
  while (pending.length) {
    const [node, locals] = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (node.lambda !== undefined) {
      pending.push([node.body, new Set([...locals, node.lambda])]);
      continue;
    }
    if (node.capture !== undefined && !node.expr && !locals.has(node.capture)) captures.add(node.capture);
    if (node.method === "followed-by" || node.method === "preceded-by") {
      if (!fault) {
        if (node.args.some(target => target.terminal?.startsWith("_"))) {
          fault = { node, message: "a boundary target must be a rule, exact instance or user tag" };
        } else if (first) {
          fault = { node, message: "a condition item cannot have more than one boundary atom" };
        }
      }
      first ??= node;
    }
    const children = Object.values(node);
    for (let i = children.length - 1; i >= 0; i--) pending.push([children[i], locals]);
  }
  const receiver = first?.receiver?.capture;
  if (!fault && receiver && [...captures].some(name => name !== receiver)) {
    return { node: first, message: "a condition with a named boundary receiver cannot read another capture" };
  }
  return fault;
}

export function validateDefinitionBoundaries50(rule, fail) {
  for (const condition of rule.conditions ?? []) {
    const fault = boundaryFault(condition);
    if (fault) fail(fault.node, fault.message);
  }
}

export function validateDefinitionConditions50(rule, slots, fail, check = validateClosedTypes) {
  const shared = new Map();
  for (const slot of slots) for (const [name, type] of slot) {
    shared.set(name, !shared.has(name) || shared.get(name) === type ? type : undefined);
  }
  const types = new Map([...shared].filter(([, type]) => type !== undefined));
  for (const condition of rule.conditions ?? []) {
    const boundary = boundaryFault(condition);
    check(condition, fail, { slots: types, truth: true, boundary });
  }
}

// The native loader supplies the expanded productions in order and the
// structural nullability result for each one.
export function validateDefinitionNullability50(productions, nullable, fail) {
  for (const production of productions) {
    if (production.errorSource && nullable(production)) {
      fail(production.errorSource, "an error production can derive an empty sequence");
    }
  }
}

const comparable = new Set(["string", "number", "truth", "keys"]);
const isBag = type => type === "bag" || type === "keys";
const emptyElement = Symbol("empty list element");
const incompatible = Symbol("incompatible types");
const kindOf = type => Array.isArray(type) ? "list" : type;
const elementOf = type => Array.isArray(type) ? type[0] : undefined;

function joinTypes(left, right, constraint = false) {
  if (left === incompatible || right === incompatible) return incompatible;
  if (left === emptyElement) return right;
  if (right === emptyElement) return left;
  if (left === undefined || right === undefined) return constraint ? left ?? right : undefined;
  if (left === right) return left;
  if (isBag(left) && isBag(right)) return "bag";
  if (Array.isArray(left) && Array.isArray(right)) {
    const element = joinTypes(elementOf(left), elementOf(right), constraint);
    return element === incompatible ? incompatible : [element];
  }
  return incompatible;
}

function comparableElement(type) {
  while (Array.isArray(type)) type = type[0];
  return type === undefined || type === emptyElement || comparable.has(type);
}

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

const methodArguments = new Map([
  ["split", "string"], ["join", "string"], ["classify", "string"],
  ["select", "keys"], ["overlaps", "keys"], ["all", "function"], ["any", "function"],
]);

// The document can check closed operand types. A reference that needs the
// effective stage, a template binding or an input shape stays unresolved.
function validateClosedTypes(root, fail, { closed = false, slots = new Map(), truth = false, forwarding = false,
  message = false, nodeTerm = false, hiddenKeys = new Set(), hiddenStrings = new Set(), boundary, whole = "node" } = {}) {
  const types = new WeakMap();
  const type = node => node && typeof node === "object" ? types.get(node) : undefined;
  const remember = (node, value) => {
    if (value !== undefined) types.set(node, value);
  };
  const invalid = (value, allowed) => value !== undefined && value !== emptyElement && !allowed.includes(kindOf(value));
  const pending = [[root, false, new Map(), false, truth]];
  const captureTypes = new Map([...slots].map(([name, list]) => [name, list ? ["node"] : "node"]));
  const predicates = new WeakMap();
  const maps = new WeakMap();
  while (pending.length) {
    const [node, ready, scope, implicit, needsTruth] = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (!ready) {
      pending.push([node, true, scope, implicit, needsTruth]);
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
        pending.push([node.body, false, frame, true, predicates.has(node)]);
        continue;
      }
      const children = Object.entries(node);
      for (let i = children.length - 1; i >= 0; i--) {
        const [key, child] = children[i];
        const childTruth = key === "if" || key === "guard" || key === "not" ||
          key === "then" && (!node.else || needsTruth) || key === "else" && needsTruth ||
          (key === "all" || key === "any") && Array.isArray(child) || Array.isArray(node) && needsTruth;
        pending.push([child, false, scope, implicit, childTruth]);
      }
      continue;
    }
    if (Array.isArray(node)) continue;
    if (boundary?.node === node) fail(node, boundary.message);
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
      const definiteKeys = node.bag.every(entry => entry.kind === "bare" || entry.kind === "delete" ||
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
            if (invalid(type(edit), ["string"])) effectiveStrings.add(entry);
            laterStrings.add(key);
          }
        }
        if (entry.kind === "write" || entry.kind === "bare") {
          const keys = entry.keys ?? [entry.key];
          if (keys.some(key => !hidden.has(key) && key.startsWith("_"))) {
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
        if (entry.kind !== "write") continue;
        const value = type(entry.value);
        if (value === "function") fail(entry.value, "a key cannot store a function");
        if (entry.keys.some(key => key.startsWith("_"))) fail(entry, "a constructor cannot write an engine key");
        if (effectiveStrings.has(entry)) {
          fail(entry.value, "a value or image needs a string");
        }
      }
    }
    if (message && node.method === "parse") fail(node, "a message cannot read a query");
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
      const member = elementOf(receiver);
      if (node.method === "join" && invalid(member, ["string"]) ||
          node.method === "union" && invalid(member, ["keys"])) wrong();
      const element = ["split", "ngrams"].includes(node.method) ? "string" : "node";
      remember(node, result === "list" ? [element] :
        node.method === "select" && receiver === "keys" ? "keys" : result);
    }
    if (node.concat) {
      if (node.concat.some(part => invalid(type(part), ["string"]))) fail(node, "++ requires string operands");
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
      const known = group.map(type).filter(value => value !== undefined);
      const listDifference = node.difference && kindOf(type(group[0])) === "list";
      const openDifference = node.difference && type(group[0]) === undefined;
      if (listDifference) {
        const [left, right] = group.map(type);
        const member = elementOf(left);
        const direct = sameElementType(member, right);
        const exclusion = Array.isArray(right) && sameElementType(member, elementOf(right));
        if (!direct && !exclusion) fail(node, "∖ requires compatible operands");
      }
      if (!listDifference && !openDifference &&
          (known.some(value => value !== "keys" && value !== "pattern") || new Set(known).size > 1)) {
        const op = node.union ? "∪" : node.intersection ? "∩" : "∖";
        fail(node, `${op} requires compatible operands`);
      }
      if (!openDifference) remember(node, listDifference ? type(group[0]) : known[0]);
    }
    if (node.not || Array.isArray(node.all) || Array.isArray(node.any)) remember(node, "truth");
    if (needsTruth && ["string", "number", "pattern", "function"].includes(type(node))) {
      fail(node, "this operand does not have a truth value");
    }
    if (!node.op) continue;
    const left = type(node.left);
    const right = type(node.right);
    if (["+", "<", "≤", ">", "≥"].includes(node.op) && [left, right].some(value => invalid(value, ["number"]))) {
      fail(node, `${node.op} requires number operands`);
    }
    if (needsTruth && node.op === "+") fail(node, "this operand does not have a truth value");
    if (["=", "≠"].includes(node.op)) {
      if ([left, right].some(value => value !== undefined && !comparable.has(value)) ||
          left !== undefined && right !== undefined && left !== right) {
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

function validateHeader(declaration, fail, unicode) {
  const { name, args, conditions, steps, instance, params, op } = declaration;
  if (declaration.alternatives || instance) {
    if (!validRule(name, unicode)) {
      fail(declaration, "a rule name must begin with a lowercase letter or be an emoji name");
    }
    if (instance && (args || params)) fail(declaration, "an instance binding needs a plain rule name");
    if (instance && op === "extend") fail(declaration, "an instance binding cannot extend a rule");
    if (args && (op === "define" || args.some(arg => arg.param))) {
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
    if (declaration.suppressWarnings?.some(code => code !== "_" && !featureName.test(code))) {
      fail(declaration, "invalid warning code");
    }
  } else if (declaration.value) {
    if (!CONSTANT_NAME.test(name)) fail(declaration, "invalid constant name");
  } else if (name === "include" || name === "names") {
    if (conditions || args?.length !== 1 || typeof args[0] !== "string") fail(declaration, `%${name} takes one quoted path`);
  } else if (name === "features") {
    if (!args?.length || args.some(arg => !featureName.test(arg))) fail(declaration, "%features takes feature names");
  } else if (name === "elision-only") {
    if (conditions || args?.length !== 0) fail(declaration, "%elision-only takes no operands");
  } else if (stageDirectives.has(name)) {
    if (conditions || args?.length !== 1 || !ruleName50.test(args[0])) fail(declaration, `%${name} takes one stage name`);
  } else if (name === "ambiguity-resolution") {
    for (const step of steps ?? []) {
      if (Boolean(step.pattern) !== KEY_STEPS.has(step.step)) fail(step, "invalid resolution step operand");
    }
    if (!validSteps(steps)) fail(declaration, "invalid resolution policy");
  }
}

export function validateDeclarationShape50(declaration, fail, unicode, emptyDelimiters = []) {
  const locate = withOwner50(declaration, fail, declaration);
  validateHeader(declaration, locate, unicode);
  if (declaration.value && declaration.name === "INPUTS") fail(declaration, "$INPUTS is supplied by the engine");
  for (const step of declaration.steps ?? []) {
    if (step.pattern) validateExactPattern50(step.pattern, locate, { origin: step.step !== "leftmost-longest" });
  }

  const ruleBodies = new WeakSet((declaration.alternatives ?? []).map(alt => alt.expr));
  const outputItems = new WeakSet(declaration.emit?.items ?? []);
  const predicateSlots = new WeakSet();
  const pending = [[declaration, false, false, false, false]];
  while (pending.length) {
    const [node, width, inRepeat, inPattern, requirement] = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (ruleBodies.has(node)) validateBody50(node, locate);
    if (outputItems.has(node) && node.capture === "" && !node.term) locate(node, "only a braced item can select the whole rule");
    if (node.range) validateRange(node.range, node, locate);
    if (node.integer !== undefined && (width ? !/^[1-9][0-9]*$/.test(node.integer) :
      !/^(0|[1-9][0-9]*)$/.test(node.integer) || Number(node.integer) > 255)) {
      locate(node, width ? "a width must be positive" : "a count literal must be between 0 and 255");
    }
    if (node.capture !== undefined && (node.capture !== "" || node.expr) && !CAPTURE_NAME.test(node.capture)) {
      locate(node, "a capture name must use lowercase letters, digits, hyphens or underscores");
    }
    if (node.lambda === "" && !predicateSlots.has(node)) locate(node, "a predicate requires an explicit binder");
    if (node.lambda && !CAPTURE_NAME.test(node.lambda)) {
      locate(node, "a capture name must use lowercase letters, digits, hyphens or underscores");
    }
    if (node.by?.lambda === "") predicateSlots.add(node.by);
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
    if (node.param !== undefined && !parameterName.test(node.param)) locate(node, "invalid parameter name");
    if (typeof node.call === "string" && !validRule(node.call, unicode) ||
        typeof node.rule === "string" && !validRule(node.rule, unicode) ||
        inPattern && typeof node.name === "string" && !validRule(node.name, unicode)) {
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
      const sig = methods50.get(node.method);
      if (!sig) locate(node, `unknown method .${node.method}`);
      if (!node.args || node.args.length < sig.min || node.args.length > sig.max) {
        locate(node, `method .${node.method} has the wrong number of arguments`);
      }
      if (["all", "any"].includes(node.method) && node.args[0]?.lambda === "") predicateSlots.add(node.args[0]);
      if (node.method === "split" && node.args[0].string === "") emptyDelimiters.push(node);
      if (node.method === "parse") validateQuery50(node, locate);
    }
    if ((node.call || node === declaration && declaration.alternatives) && node.args) for (const arg of node.args) {
      validateArgument50(arg, locate);
    }
    validateOrigin50(node, locate, inPattern);
    if (node.children) validatePatternChildren50(node, locate);
    if (node.bag) validateBag50(node.bag, locate);
    if (inRepeat && node.siblings) locate(node, "a repeated child list cannot contain a sibling gap");
    const parts = node === declaration && declaration.alternatives ?
      [["args", node.args], ["term", node.term], ["alternatives", node.alternatives], ["conditions", node.conditions],
        ["error", node.error], ["warning", node.warning], ["emit", node.emit]] : Object.entries(node);
    for (const [key, value] of parts.reverse()) {
      if (key === "at") continue;
      const repeated = inRepeat && key !== "child" || Array.isArray(node.repeat) && (key === "repeat" || key === "separator");
      pending.push([value, node.method === "ngrams" && key === "args" || width && Array.isArray(node),
        repeated, key === "pattern" || inPattern && key !== "body", key === "value" && Object.hasOwn(node, "negated")]);
    }
  }
}

const orderedDeclarations = dom => [...dom.rules, ...dom.directives, ...dom.constants]
  .sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1]);

/** @param {DocumentValidation} [configuration] */
export function validateDocumentShape50(dom, configuration = {}) {
  const { document, unicode } = configuration;
  const fail = documentFault50(document);
  const emptyDelimiters = [];
  let preamble = true;
  for (const declaration of orderedDeclarations(dom)) {
    if (declaration.name === "names" && declaration.args) {
      if (!preamble) fail(declaration, "%names must precede all other declarations");
    } else {
      preamble = false;
    }
    validateDeclarationShape50(declaration, fail, unicode, emptyDelimiters);
  }
  if (emptyDelimiters.length) fail(emptyDelimiters[0], "a split delimiter cannot be empty");
}

/** @param {DocumentValidation} [configuration] */
export function validateDocumentDefinitions50(dom, configuration = {}) {
  const { document } = configuration;
  const fail = documentFault50(document);
  for (const declaration of orderedDeclarations(dom)) {
    const locate = withOwner50(declaration, fail, declaration);
    if (declaration.args && declaration.alternatives) validateClosedTypes(declaration.args, locate);
    if (declaration.instance) validateClosedTypes(declaration.instance, locate);
    if (declaration.alternatives) {
      const slots = declaration.alternatives.map(alt => captureSlots50(alt.expr));
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
    } else if (declaration.name === "features") {
      for (const condition of declaration.conditions ?? []) {
        validateBindings50(condition, (node, message) =>
          locate(node, message === argumentsError ? "a feature condition cannot read a named capture" : message),
          { closed: true, bindings: [""] });
        validateClosedTypes(condition, locate, { truth: true, whole: "span" });
      }
    } else if (declaration.value) {
      validateClosedTypes(declaration.value, locate, { closed: true });
    }
  }
}

/** @param {DocumentValidation} [configuration] */
export function validateDocumentDepth50(dom, configuration = {}) {
  const { document } = configuration;
  const fail = documentFault50(document);
  for (const declaration of orderedDeclarations(dom)) {
    if (tooDeep(declaration)) fail(declaration, `an expression, term or condition is nested more than ${DOM_MAX_DEPTH} deep`);
  }
}

/** @param {DocumentValidation} [configuration] */
export function validateDocument50(dom, configuration) {
  validateDocumentShape50(dom, configuration);
  validateDocumentDefinitions50(dom, configuration);
  validateDocumentDepth50(dom, configuration);
  return dom;
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
  for (const arg of declaration.args ?? []) push(arg, 1);
  while (pending.length) {
    const [node, depth] = pending.pop();
    if (depth > DOM_MAX_DEPTH) return true;
    if (Array.isArray(node)) {
      for (const child of node) push(child, depth);
      continue;
    }
    if (node.primary || node.expression || node.kind || node.body && node.lambda === undefined) {
      push(node.primary ?? node.expression ?? node.body, depth);
      if (node.kind) entries([node], depth);
      continue;
    }
    if (node.targets || Object.hasOwn(node, "negated") && node.value) {
      push(node.targets ?? node.value, depth);
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
