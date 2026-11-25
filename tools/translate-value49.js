import { resolvePath } from "../lib/js/src/markdown.js";
import { MigrationRequired } from "./translate-dom49.js";

export const childValue49 = "$node.children!'value.join()";
export const inputValue49 = "$.span.tokens!'value.join()";
export const writtenChildValue49 = "$.children!($child ↦ ($child ≅ #·_<_Elided> ? \"\" | $child'value)).join()";

function* records(root) {
  const pending = [root];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== "object") continue;
    yield item;
    for (const child of Object.values(item)) pending.push(child);
  }
}

export function omittedTerminals49(root) {
  const terminals = new Set();
  for (const node of records(root)) {
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
    const declarations = [...dom.rules, ...dom.directives, ...dom.constants]
      .sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1]);
    for (const declaration of declarations) {
      if (stageNames.has(declaration.name) && declaration.args && !declaration.op) {
        stage = declaration.args[0];
      } else if (declaration.name === "include" && declaration.args && !declaration.op) {
        visit(resolvePath(file, declaration.args[0]));
      } else {
        if (!stages.has(stage)) stages.set(stage, new Set());
        stages.get(stage).add(declaration);
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

export function omittedValueSuppliers49(entry, doms, stageNames) {
  const writers = new Map();
  for (const declarations of groupedRules(entry, doms, stageNames)) {
    const rules = new Map();
    const affected = new Map();
    for (const rule of declarations) {
      if (!rule.alternatives && !rule.instance) continue;
      if (!rules.has(rule.name)) rules.set(rule.name, { edges: new Set(), cooked: false });
      const facts = rules.get(rule.name);
      facts.cooked ||= Boolean(rule.erased || rule.value || rule.alternatives?.some(alt => alt.value));
      valueDependencies(rule.instance, facts.edges);
      for (const alt of rule.alternatives ?? []) {
        valueDependencies(alt.expr, facts.edges);
        if (!rule.erased && !rule.value && !alt.value && omittedTerminals49(alt.expr).size) affected.set(alt, rule);
      }
    }
    if (!affected.size) continue;
    const targets = valueTestTargets(declarations);
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
