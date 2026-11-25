// @ts-nocheck
import { CAPTURE_NAME, DOM_MAX_DEPTH, KEY_STEPS, validSteps } from "../dom.js";
import { GencmuError } from "../errors.js";
import { run } from "../trampoline.js";
import { methods50, validProperty50 } from "./signatures.js";

const argumentsError = "an argument cannot read or declare captures";
const baseSymbol = node => ["ref", "call", "param", "literal", "range", "wildcard", "splice", "test"]
  .some(key => Object.hasOwn(node, key));
const ruleName = /^[a-z][A-Za-z0-9_-]*$/;
const featureName = /^[A-Za-z][A-Za-z0-9-]*$/;
const terminalName = /^[A-Z_]/;
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
  const atom = atomOf(node);
  if (!atom.any && !atom.name && !atom.call && !atom.param) {
    fail(node, "only a rule atom, call or parameter can have a child list");
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
  if (!head?.param && !/^[A-Z]/.test(head?.ref ?? "")) {
    fail(node, "an elidable optional starts with an ungrouped user terminal or parameter and can bind only its sole terminator");
  }
  if (start.capture !== undefined && optional.seq || optional.seq?.slice(1).some(part => captureSlots50(part).size)) {
    fail(node, "an elidable optional starts with an ungrouped user terminal or parameter and can bind only its sole terminator");
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
      let base = symbol;
      while (base.test) base = base.expr;
      if (!baseSymbol(base)) fail(node, "a primary marks one symbol or capture");
      if (blocked || base.splice) fail(node, "a primary must mark a mandatory child that is not a splice");
      const route = yield visit(node.primary, blocked, chain, false);
      route.min++;
      route.max++;
      return route;
    }
    if (node.capture !== undefined && node.expr) {
      if (chain) fail(node, "a chain item or separator cannot bind a capture directly");
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
    if (node.and?.length > 16) fail(node, "an ordered subset takes at most sixteen operands");
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

// Inspect every branch that can be reached with these slots. An unknown
// predicate alone cannot prove that a missing capture is safe to read.
function checkExpansionScope(root, slots, fail, truth = false) {
  return run(expansionScope(root, slots, fail, new Set([""]), truth));
}

function* expansionScope(root, slots, fail, bindings, truth = false) {
  if (!root || typeof root !== "object") return;
  if (root.method === "present" && root.receiver?.capture !== undefined) {
    return yield expansionScope(root.receiver, slots, fail, bindings, true);
  }
  if (root.capture !== undefined && !root.expr) {
    const name = root.capture;
    if (!bindings.has(name) && !slots.has(name)) {
      if (truth) return false;
      fail(root, `$${name} is absent from this expansion`);
    }
    if (truth && slots.get(name) === false) return true;
    return;
  }
  if (root.lambda !== undefined) {
    yield expansionScope(root.body, slots, fail, new Set([...bindings, root.lambda]));
    return;
  }
  if (root.guard) {
    const guard = yield expansionScope(root.guard, slots, fail, bindings, true);
    if (guard === false) return;
  }
  if (root.if) {
    const condition = yield expansionScope(root.if, slots, fail, bindings, true);
    if (condition === undefined) {
      const then = yield expansionScope(root.then, slots, fail, bindings, truth || !root.else);
      const other = root.else ? yield expansionScope(root.else, slots, fail, bindings, truth) : true;
      return then === other ? then : undefined;
    }
    if (!condition && !root.else) return true;
    return yield expansionScope(condition ? root.then : root.else, slots, fail, bindings, truth || !root.else);
  }
  if (root.not) {
    const value = yield expansionScope(root.not, slots, fail, bindings, true);
    return value === undefined ? value : !value;
  }
  if (root.all || root.any) {
    const result = !!root.any;
    let unknown = false;
    for (const part of root.all ?? root.any) {
      const value = yield expansionScope(part, slots, fail, bindings, true);
      if (value === result) return value;
      unknown ||= value === undefined;
    }
    return unknown ? undefined : !result;
  }
  for (const [key, child] of Object.entries(root)) {
    if (key !== "at" && key !== "guard") yield expansionScope(child, slots, fail, bindings);
  }
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

export function validateDefinitionExpansion50(rule, alternative, slots, fail, check = validateClosedTypes) {
  const visit = (node, forwarding = false, message = false) => {
    if (!node) return;
    if (forwarding) {
      if (node.term && slots.get(node.capture)) fail(node, "a braced output item needs a node");
      const reached = !node.guard || checkExpansionScope(node.guard, slots, fail, true) !== false;
      if (reached && (slots.has(node.capture) || node.insert || node.capture === "")) {
        checkExpansionScope(node.term, slots, fail);
      }
    } else {
      checkExpansionScope(node, slots, fail);
    }
    const hiddenKeys = node === rule.term ? directKeys(alternative.term?.bag) : undefined;
    check(node, fail, { slots, forwarding, message, nodeTerm: !message, hiddenKeys });
  };
  visit(rule.term);
  visit(alternative.term);
  visit(rule.error ?? rule.warning, false, true);
  for (const item of rule.emit?.items ?? []) visit(item, true);
}

export function validateDefinitionBoundaries50(rule, fail) {
  for (const root of rule.conditions ?? []) {
    let first;
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
        if (node.args.some(target => target.terminal?.startsWith("_"))) {
          fail(node, "a boundary target must be a rule, exact instance or user tag");
        }
        if (first) fail(node, "a condition item cannot have more than one boundary atom");
        first = node;
      }
      const children = Object.values(node);
      for (let i = children.length - 1; i >= 0; i--) pending.push([children[i], locals]);
    }
    const receiver = first?.receiver?.capture;
    if (receiver && [...captures].some(name => name !== receiver)) {
      fail(first, "a condition with a named boundary receiver cannot read another capture");
    }
  }
}

export function validateDefinitionConditions50(rule, slots, fail, check = validateClosedTypes) {
  const shared = new Map();
  for (const slot of slots) for (const [name, type] of slot) {
    shared.set(name, !shared.has(name) || shared.get(name) === type ? type : undefined);
  }
  const types = new Map([...shared].filter(([, type]) => type !== undefined));
  for (const condition of rule.conditions ?? []) check(condition, fail, { slots: types, truth: true });
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
const joinTypes = (left, right) => left === right ? left : isBag(left) && isBag(right) ? "bag" : undefined;
const spanTypes = ["span", "node"];
const methodTypes = new Map([
  ["split", ["list", "string"]],
  ["ngrams", ["list", "string"]],
  ["parse", ["forest", ...spanTypes]],
  ["span", ["span", "node"]],
  ["tokens", ["list", ...spanTypes]],
  ["join", ["string", "list"]],
  ["preceding-tokens", ["span", ...spanTypes]],
  ["following-tokens", ["span", ...spanTypes]],
  ["first-token", ["span", ...spanTypes]],
  ["last-token", ["span", ...spanTypes]],
  ["onward", ["span", ...spanTypes]],
  ["starts-input", ["truth", ...spanTypes]],
  ["ends-input", ["truth", ...spanTypes]],
  ["without-elision", ["span", "node"]],
  ["without-elision-except", ["span", "node"]],
  ["flags", ["keys", "keys", "bag", "span", "node", "forest"]],
  ["classes", ["keys", "keys", "bag", "span", "node"]],
]);

// The document can check closed operand types. A reference that needs the
// effective stage, a template binding or an input shape stays unresolved.
function validateClosedTypes(root, fail, { closed = false, slots = new Map(), truth = false, forwarding = false,
  message = false, nodeTerm = false, hiddenKeys = new Set() } = {}) {
  const types = new WeakMap();
  const elements = new WeakMap();
  const type = node => node && typeof node === "object" ? types.get(node) : undefined;
  const remember = (node, value) => {
    if (value !== undefined) types.set(node, value);
  };
  const invalid = (value, allowed) => value !== undefined && !allowed.includes(value);
  const pending = [[root, false, new Set(), false, truth]];
  const captureTypes = new Map([...slots].map(([name, list]) => [name, list ? "list" : "node"]));
  const listMethods = new Set(["present", "all", "any", "join", "union"]);
  const predicates = new WeakSet();
  while (pending.length) {
    const [node, ready, scope, implicit, needsTruth] = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (!ready) {
      pending.push([node, true, scope, implicit, needsTruth]);
      if (["all", "any"].includes(node.method) && node.args[0]?.lambda !== undefined) predicates.add(node.args[0]);
      if (node.lambda !== undefined) {
        const name = node.lambda;
        if (name && scope.has(name)) fail(node, "a function binder cannot hide a live name");
        pending.push([node.body, false, name ? new Set([...scope, name]) : scope, true, predicates.has(node)]);
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
    if (closed && node.capture !== undefined && !scope.has(node.capture)) {
      fail(node, "a constant cannot read a capture outside its function scope");
    }
    if (closed && node.item && !implicit) fail(node, "an implicit receiver needs a function binding");
    if (node.capture !== undefined && !scope.has(node.capture) && !(forwarding && node === root)) {
      remember(node, captureTypes.get(node.capture));
    }
    if (node.string !== undefined) remember(node, "string");
    if (node.integer !== undefined) remember(node, "number");
    if (node.lambda !== undefined) remember(node, "function");
    if (node.list) {
      remember(node, "list");
      const members = new Set();
      for (const entry of node.list) {
        if (entry.kind === "splat") {
          if (invalid(type(entry.value), ["list"])) fail(entry, "a list splat needs a list");
          members.add(elements.get(entry.value));
        } else {
          members.add(type(entry.value));
        }
      }
      const member = members.size && [...members].reduce(joinTypes);
      if (member) elements.set(node, member);
    }
    if (node.emptySet || node.pattern) remember(node, "pattern");
    if (node.bag) {
      remember(node, node.bag.every(entry => entry.kind === "bare" || entry.kind === "delete") ? "keys" : "bag");
      for (const entry of node.bag) {
        if (entry.kind === "splat" && invalid(type(entry.value), ["keys", "node", "bag"])) {
          fail(entry, "a bag splat needs a bag or node");
        }
        if (entry.kind !== "write") continue;
        const value = type(entry.value);
        if (value === "function") fail(entry.value, "a key cannot store a function");
        const writesNode = nodeTerm && node === (forwarding ? root.term : root);
        if (writesNode && entry.keys.some(key => key.startsWith("_"))) fail(entry, "a constructor cannot write an engine key");
        if (writesNode && entry.keys.some(key => (key === "image" || key === "value") && !hiddenKeys.has(key)) &&
            invalid(value, ["string"])) {
          fail(entry.value, "a value or image needs a string");
        }
      }
    }
    if (node.method && type(node.receiver) === "list") {
      const isCapture = node.receiver.capture !== undefined && !scope.has(node.receiver.capture);
      if (!listMethods.has(node.method) || node.method === "any" && !node.args.length ||
          isCapture && ["join", "union"].includes(node.method)) {
        fail(node, "a method has the wrong receiver or arguments");
      }
    }
    if (message && node.method === "parse") fail(node, "a message cannot read a query");
    if (node.property && invalid(type(node.receiver), ["node", "bag", "keys"])) {
      fail(node, "a property read needs a node or bag");
    }
    const signature = methodTypes.get(node.method);
    if (signature) {
      const [result, ...receivers] = signature;
      if (invalid(type(node.receiver), receivers)) fail(node, "a method has the wrong receiver or arguments");
      if (node.method === "split" && invalid(type(node.args[0]), ["string"])) {
        fail(node, "a method has the wrong receiver or arguments");
      }
      if (node.method === "split" || node.method === "ngrams") elements.set(node, "string");
      remember(node, result);
    }
    if (node.concat) {
      if (node.concat.some(part => invalid(type(part), ["string"]))) fail(node, "++ requires string operands");
      remember(node, "string");
    }
    if (node.if) {
      const yes = type(node.then);
      const no = type(node.else);
      const result = joinTypes(yes, no);
      if (yes && no && result === undefined) {
        fail(node, "a conditional requires compatible branch types");
      }
      if (!node.else) remember(node, "truth");
      else remember(node, result);
    }
    const group = node.union ?? node.intersection ?? node.difference;
    if (group && node.at) {
      const known = group.map(type).filter(value => value !== undefined);
      const listDifference = node.difference && type(group[0]) === "list";
      const openDifference = node.difference && type(group[0]) === undefined;
      if (listDifference) {
        const [left, right] = group;
        const member = elements.get(left);
        const removed = type(right) === "list" ? elements.get(right) : type(right);
        if (member && removed && !joinTypes(member, type(right)) && !joinTypes(member, removed)) {
          fail(node, "∖ requires compatible operands");
        }
        if (member) elements.set(node, member);
      }
      if (!listDifference && !openDifference &&
          (known.some(value => value !== "keys" && value !== "pattern") || new Set(known).size > 1)) {
        const op = node.union ? "∪" : node.intersection ? "∩" : "∖";
        fail(node, `${op} requires compatible operands`);
      }
      if (!openDifference) remember(node, known[0]);
    }
    if (needsTruth && (node.op === "+" || ["string", "number", "pattern", "function"].includes(type(node)))) {
      fail(node, "this operand does not have a truth value");
    }
    if (!node.op) continue;
    const left = type(node.left);
    const right = type(node.right);
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
      const member = elements.get(node.right);
      if (left && member && left !== member) fail(node, `${node.op} requires compatible operands`);
    }
    if (["≅", "≇"].includes(node.op)) {
      if (node.left.capture === undefined && !node.left.item) {
        fail(node, "a structural comparison needs one capture or bound item on its left");
      }
      if (node.left.capture !== undefined && node.left.capture === node.right.capture ||
          node.left.item && node.right.item) {
        fail(node, "a structural comparison cannot compare a binding with itself");
      }
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
    if (!ruleName.test(name) && !(unicode ? unicode.isEmojiName(name) : typeof name === "string" && [...name].length === 1)) {
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
        if (seen.has(param)) fail(declaration, `duplicate parameter @${param}`);
        seen.add(param);
      }
      if (declaration.error || declaration.warning) fail(declaration, "a template cannot declare an error or warning");
    }
    if (declaration.suppressWarnings?.some(code => code !== "_" && !featureName.test(code))) {
      fail(declaration, "invalid warning code");
    }
  } else if (name === "include" || name === "names") {
    if (conditions || args?.length !== 1 || typeof args[0] !== "string") fail(declaration, `%${name} takes one quoted path`);
  } else if (name === "features") {
    if (!args?.length || args.some(arg => !featureName.test(arg))) fail(declaration, "%features takes feature names");
  } else if (name === "elision-only") {
    if (conditions || args?.length !== 0) fail(declaration, "%elision-only takes no operands");
  } else if (stageDirectives.has(name)) {
    if (conditions || args?.length !== 1 || !ruleName.test(args[0])) fail(declaration, `%${name} takes one stage name`);
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
  for (const alt of declaration.alternatives ?? []) validateBody50(alt.expr, locate);
  for (const step of declaration.steps ?? []) {
    if (step.pattern) validateExactPattern50(step.pattern, locate, { origin: step.step !== "leftmost-longest" });
  }
  for (const item of declaration.emit?.items ?? []) {
    if (item.capture === "" && !item.term) locate(item, "only a braced item can select the whole rule");
  }
  const predicateSlots = new WeakSet();
  const pending = [[declaration, false, false, false, false]];
  while (pending.length) {
    const [node, width, inRepeat, inPattern, requirement] = pending.pop();
    if (!node || typeof node !== "object") continue;
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
    if (node.method) {
      const sig = methods50.get(node.method);
      if (!sig) locate(node, `unknown method .${node.method}`);
      if (!node.args || node.args.length < sig.min || node.args.length > sig.max) {
        locate(node, `method .${node.method} has the wrong number of arguments`);
      }
      if (["all", "any"].includes(node.method) && node.args[0]?.lambda === "") predicateSlots.add(node.args[0]);
      if (node.method === "split" && node.args[0].string === "") emptyDelimiters.push(node);
      if (node.method === "parse") {
        const body = node.args[0].body;
        if (body?.chain) locate(node, "a chain cannot be the query target");
        validateBindings50(body, locate, { query: true });
      }
    }
    if (node.call && node.args) for (const arg of node.args) {
      validateBindings50(arg, locate, { closed: true });
    }
    validateOrigin50(node, locate, inPattern);
    if (node.children) validatePatternChildren50(node, locate);
    if (node.bag) validateBag50(node.bag, locate);
    if (inRepeat && node.siblings) locate(node, "a repeated child list cannot contain a sibling gap");
    for (const [key, value] of Object.entries(node).reverse()) {
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
    if (declaration.alternatives) {
      const slots = declaration.alternatives.map(alt => captureSlots50(alt.expr));
      validateDefinitionNames50(declaration, slots, locate);
      validateDefinitionConditions50(declaration, slots, locate);
      for (const [index, alternative] of declaration.alternatives.entries()) {
        validateDefinitionExpansion50(declaration, alternative, slots[index], locate);
      }
      validateDefinitionBoundaries50(declaration, locate);
    } else if (declaration.name === "features") {
      for (const condition of declaration.conditions ?? []) {
        validateBindings50(condition, (node, message) =>
          locate(node, message === argumentsError ? "a feature condition cannot read a named capture" : message),
          { closed: true, bindings: [""] });
        validateClosedTypes(condition, locate, { truth: true });
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
  for (const arg of declaration.args ?? []) push(arg, 0);
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
