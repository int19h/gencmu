import { resolvePath } from "../lib/js/src/markdown.js";
import { MigrationRequired } from "./translate-dom49.js";

export const childValue49 = "$node.children!'value.join()";
export const inputValue49 = "$.span.tokens!'value.join()";
export const writtenChildValue49 = "$.children!($child ↦ ($child ≅ #·_<_Elided> ? \"\" | $child'value)).join()";

// Include the old declaration and recipe fields as well as body operands.
const operandKeys49 = [
  "rules", "directives", "constants", "classifiers", "implications",
  "receiver", "args", "instance", "steps", "expr", "tags", "value", "image", "alternatives",
  "conditions", "error", "warning", "emit", "items",
  "if", "then", "left", "right", "nonempty", "not", "any", "all", "concat",
  "union", "intersection", "difference", "pattern", "children", "child", "entries", "keys",
  "requirements", "targets", "body", "seq", "choice", "ranked", "and",
  "optional", "default", "repeat", "separator", "splice", "literal", "range",
];

function children49(item, localBody = false) {
  if (Array.isArray(item)) return item;
  return operandKeys49.filter(key => !(localBody && item.call && key === "args")).map(key => item[key])
    .filter(child => child && typeof child === "object");
}

function* records(root, localBody = false) {
  const pending = [root];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== "object") continue;
    yield item;
    const children = children49(item, localBody);
    for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]);
  }
}

export function omittedTerminals49(root, localBody = false) {
  const terminals = new Set();
  for (const node of records(root, localBody)) {
    if (!node.elidable) continue;
    let head = node.optional.seq?.[0] ?? node.optional;
    if (head.capture !== undefined) head = head.expr;
    let fallback;
    while (head.test) {
      if (head.test === "=") fallback = head.value;
      head = head.expr;
    }
    const value = node.default ?? fallback;
    if (value && value.string !== "") terminals.add(head.ref ?? "*");
  }
  return terminals;
}

function groupedRules(entry, doms, stageNames) {
  const stages = new Map();
  const active = new Set();
  let stage;
  function visit(file) {
    const dom = doms.get(file);
    if (!dom || active.has(file)) return;
    active.add(file);
    const declarations = ["rules", "directives", "constants"]
      .flatMap(category => dom[category].map(declaration => [declaration, category]))
      .sort(([a], [b]) => a.at[0] - b.at[0] || a.at[1] - b.at[1]);
    for (const [declaration, category] of declarations) {
      if (category === "directives" && stageNames.has(declaration.name)) {
        stage = declaration.args[0];
      } else if (category === "directives" && declaration.name === "include") {
        visit(resolvePath(file, declaration.args[0]));
      } else {
        if (!stages.has(stage)) stages.set(stage, new Map());
        stages.get(stage).set(declaration, category);
      }
    }
    active.delete(file);
  }
  visit(entry);
  return stages.values();
}

function valueDependencies(body, edges = new Set()) {
  if (!body || typeof body !== "object") return edges;
  if (Array.isArray(body)) {
    for (const item of body) valueDependencies(item, edges);
    return edges;
  }
  if (body.ref && !/^[A-Z_]/.test(body.ref)) edges.add(body.ref);
  if (body.call) edges.add(body.call);
  if (body.rule) edges.add(body.rule);
  if (body.param) edges.add(undefined);
  for (const key of ["seq", "choice", "ranked", "and", "primary", "repeat", "separator", "splice", "body", "expr", "args"]) {
    valueDependencies(body[key], edges);
  }
  if (body.optional && !body.elidable) valueDependencies(body.optional, edges);
  // The elidable head must become a terminal. Only its tail can call a rule.
  if (body.elidable) valueDependencies(body.optional.seq?.slice(1), edges);
  return edges;
}

function valueTestTargets(declarations) {
  const targets = new Set();
  for (const record of records([...declarations])) {
    if (record.test !== "=" && record.test !== "≠") continue;
    let atom = record.expr;
    while (atom?.test) atom = atom.expr;
    if (atom?.call || atom?.name) targets.add(atom.call ?? atom.name);
    if (atom?.ref && !/^[A-Z_]/.test(atom.ref)) targets.add(atom.ref);
    if (atom?.param) targets.add(undefined);
  }
  return targets;
}

function reaches(names, rules) {
  const result = new Set(names);
  for (const name of result) for (const edge of rules.get(name)?.edges ?? []) result.add(edge);
  return result;
}

function checkBodyArguments(declarations) {
  const definitions = new Map();
  for (const [rule, category] of declarations) {
    if (category !== "rules") continue;
    if (!definitions.has(rule.name)) definitions.set(rule.name, []);
    definitions.get(rule.name).push(rule);
  }
  for (const [declaration, category] of declarations) {
    const pending = [[declaration]];
    while (pending.length) {
      const [node, owner, slot] = pending.pop();
      if (!node || typeof node !== "object") continue;
      if (owner) {
        if (!node.body || !omittedTerminals49(node.body).size) continue;
        const targets = definitions.get(owner.call) ?? [];
        const target = targets[0];
        const parameter = target?.params?.[slot];
        if (targets.length === 1 && target.op === "define" && parameter &&
            !Array.from(records(target)).some(part => part.param === parameter)) continue;
        throw new MigrationRequired("Prove the instance value when its body argument can supply a nonempty omitted default.",
          node.at ?? owner.at ?? declaration.at);
      }
      const call = node.call ? node : node === declaration && category === "rules" && declaration.args ?
        { call: declaration.name, args: declaration.args, at: declaration.at } : undefined;
      const children = children49(node, !!call);
      for (let i = children.length - 1; i >= 0; i--) {
        if (children[i] !== call?.args) pending.push([children[i]]);
      }
      if (call) for (let i = call.args.length - 1; i >= 0; i--) {
        const argument = call.args[i];
        pending.push([argument, call, i], [argument]);
      }
    }
  }
}

export function omittedValueSuppliers49(entry, doms, stageNames) {
  const writers = new Map();
  for (const declarations of groupedRules(entry, doms, stageNames)) {
    checkBodyArguments(declarations);
    const rules = new Map();
    const affected = new Map();
    for (const [rule, category] of declarations) {
      if (category !== "rules") continue;
      if (!rules.has(rule.name)) rules.set(rule.name, { edges: new Set(), cooked: false });
      const facts = rules.get(rule.name);
      facts.cooked ||= Boolean(rule.erased || rule.value || rule.alternatives?.some(alt => alt.value));
      valueDependencies(rule.instance, facts.edges);
      for (const alt of rule.alternatives ?? []) {
        valueDependencies(alt.expr, facts.edges);
        if (!rule.erased && !rule.value && !alt.value && omittedTerminals49(alt.expr, true).size) affected.set(alt, rule);
      }
    }
    if (!affected.size) continue;
    const targets = valueTestTargets(declarations.keys());
    const tested = reaches(targets, rules);
    const affectedNames = new Map([...affected.values()].map(rule => [rule.name, rule.at]));
    for (const target of targets) {
      const dependencies = reaches([target], rules);
      const affectedRule = [...dependencies].find(name => affectedNames.has(name));
      if (affectedRule !== undefined && [...dependencies].some(name => rules.get(name)?.cooked)) {
        throw new MigrationRequired("The tested rule needs an input-join proof and can use a cooked value.", affectedNames.get(affectedRule));
      }
    }
    for (const [alt, rule] of affected) {
      const children = reaches(valueDependencies(alt.expr), rules);
      const unknown = [...children].some(name => !rules.has(name));
      if (unknown) throw new MigrationRequired("Prove the value of the children that can accompany the omitted terminal.", rule.at);
      const cooked = [...children].some(name => rules.get(name).cooked);
      if (cooked && (tested.has(rule.name) || tested.has(undefined))) {
        throw new MigrationRequired("The tested rule needs an input-join proof and can inherit a cooked child value.", rule.at);
      }
      const value = cooked ? writtenChildValue49 : inputValue49;
      if (writers.has(alt) && writers.get(alt) !== value) {
        throw new MigrationRequired("The included rule needs different value suppliers in different stages.", rule.at);
      }
      writers.set(alt, value);
    }
  }
  return writers;
}
