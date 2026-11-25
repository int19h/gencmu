import { DOM_MAX_DEPTH } from "../../lib/js/src/dom.js";
import { GencmuError } from "../../lib/js/src/errors.js";
import { methods50, validProperty50 } from "./signatures.js";

const argumentsError = "an argument cannot read or declare captures";
const baseSymbol = node => ["ref", "call", "param", "literal", "range", "wildcard", "splice", "test"]
  .some(key => Object.hasOwn(node, key));

export function validateBindings50(root, fail, { closed = false, query = false } = {}) {
  const visit = (node, scope, implicit) => {
    if (!node || typeof node !== "object") return;
    if (node.lambda !== undefined) {
      const name = node.lambda;
      if (name && scope.has(name)) fail(node, "a function binder cannot hide a live name");
      visit(node.body, name ? new Set([...scope, name]) : scope, true);
      return;
    }
    if (node.capture !== undefined) {
      if (node.expr && (closed || query)) {
        fail(node, query ? "a query cannot declare captures" : argumentsError);
      }
      if (closed && !scope.has(node.capture)) fail(node, argumentsError);
    }
    if (node.item && !implicit) fail(node, "an implicit receiver needs a function binding");
    for (const child of Object.values(node)) visit(child, scope, implicit);
  };
  visit(root, new Set(), false);
}

function validateOmission(node, fail) {
  const value = node.default?.string;
  if (value === undefined) return;
  const optional = node.optional;
  let head = optional.seq?.[0] ?? (optional.capture !== undefined ? optional.expr : optional);
  const tests = [];
  while (head.test) {
    tests.push(head);
    head = head.expr;
  }
  for (const test of tests) {
    if (test.value?.string !== undefined && (test.value.string === value) !== (test.test === "=") ||
        test.requirements?.some(({ negated, value }) => value.tag && (head.ref || value.tag === "_Elided") &&
          (value.tag === "_Elided" || value.tag === head.ref) === negated)) {
      fail(node.default, "the default does not pass the omission predicate");
    }
  }
}

export function validateBody50(body, fail) {
  const zero = () => ({ names: new Map(), min: 0, max: 0 });
  const visit = (node, blocked = false, chain = false, whole = true) => {
    if (node.primary) {
      const symbol = node.primary.expr && node.primary.capture !== undefined ? node.primary.expr : node.primary;
      let base = symbol;
      while (base.test) base = base.expr;
      if (!baseSymbol(base)) fail(node, "a primary marks one symbol or capture");
      if (blocked || base.splice) fail(node, "a primary must mark a mandatory child that is not a splice");
      const route = visit(node.primary, blocked, chain, false);
      route.min++;
      route.max++;
      return route;
    }
    if (node.capture !== undefined && node.expr) {
      if (chain) fail(node, "a chain item or separator cannot bind a capture directly");
      if (!baseSymbol(node.expr)) fail(node, "a capture wraps one symbol");
      const route = visit(node.expr, blocked, chain, false);
      if (route.names.has(node.capture)) fail(route.names.get(node.capture), "a route binds a capture twice");
      route.names.set(node.capture, node);
      return route;
    }
    if (node.optional) {
      validateOmission(node, fail);
      const route = visit(node.optional, true, chain, false);
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
      const next = visit(child, blocked || !!(node.ranked || node.repeat), node.repeat ? !!node.chain : chain, false);
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
  };
  const route = visit(body);
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

export function validateDocument50(dom, { document, unicode, location = node => node.at } = {}) {
  const fail = (node, description) => {
    const [line, column] = location(node) ?? [];
    throw new GencmuError("grammar", description, { document, line, column });
  };
  const declarations = [...dom.rules, ...dom.directives, ...dom.constants]
    .sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1]);
  const pending = [];
  const visit = (node, owner, width = false) => {
    if (!node || typeof node !== "object") return;
    const site = location(node) ? node : owner;
    if (node.integer !== undefined && (width ? !/^[1-9][0-9]*$/.test(node.integer) :
      !/^(0|[1-9][0-9]*)$/.test(node.integer) || Number(node.integer) > 255)) {
      fail(site, width ? "a width must be positive" : "a count literal must be between 0 and 255");
    }
    if (node.property !== undefined && !validProperty50(node.property, unicode)) fail(site, "invalid property name");
    if (node.method) {
      const sig = methods50.get(node.method);
      if (!sig) fail(site, `unknown method .${node.method}`);
      if (!node.args || node.args.length < sig.min || node.args.length > sig.max) {
        fail(site, `method .${node.method} has the wrong number of arguments`);
      }
      if (node.method === "split" && node.args[0].string === "") pending.push(site);
      if (node.method === "parse") {
        const body = node.args[0].body;
        if (body?.chain) fail(site, "a chain cannot be the query target");
        validateBindings50(body, (part, message) => fail(location(part) ? part : site, message), { query: true });
      }
    }
    if (node.call && node.args) for (const arg of node.args) {
      validateBindings50(arg, (part, message) => fail(location(part) ? part : arg, message), { closed: true });
    }
    if (node.bag) validateBag50(node.bag, fail);
    for (const [key, value] of Object.entries(node)) {
      if (key === "at") continue;
      visit(value, site, node.method === "ngrams" && key === "args" || width && Array.isArray(node));
    }
  };
  for (const declaration of declarations) {
    if (dom.constants.includes(declaration) && declaration.name === "INPUTS") {
      fail(declaration, "$INPUTS is supplied by the engine");
    }
    for (const alt of declaration.alternatives ?? []) validateBody50(alt.expr, (node, message) => fail(location(node) ? node : declaration, message));
    for (const step of declaration.steps ?? []) {
      if (step.pattern) validateExactPattern50(step.pattern, (node, message) => fail(location(node) ? node : declaration, message),
        { origin: step.step !== "leftmost-longest" });
    }
    visit(declaration, declaration);
  }
  if (pending.length) fail(pending[0], "a split delimiter cannot be empty");
  for (const declaration of declarations) {
    if (tooDeep(declaration)) fail(declaration, `an expression, term or condition is nested more than ${DOM_MAX_DEPTH} deep`);
  }
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
