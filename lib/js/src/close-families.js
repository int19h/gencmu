// Close families read written, stitched structure, before feature gates or
// capture expansion. Lowering helpers keep their named rule's ownership.

import { clauseChildren, expressionChildren } from "./clause-walk.js";

/** @param {import("./types.js").Expr} expr @returns {string[]} */
export function memberEdges(expr) {
  const names = [];
  const pending = [expr];
  while (pending.length) {
    const node = /** @type {import("./types.js").Expr} */ (pending.pop());
    if ("ref" in node && !/^[A-Z_]/.test(node.ref)) names.push(node.ref);
    else if ("capture" in node || "test" in node) pending.push(node.expr);
    else if ("choice" in node) for (let index = node.choice.length - 1; index >= 0; index--) pending.push(node.choice[index]);
  }
  return names;
}

/**
 * Clauses follow the reference check's order. Shared definition clauses
 * occur only with that definition's first surviving alternative.
 * @param {Map<string,import("./grammar.js").StitchedRule>} rules
 * @returns {IterableIterator<{rule:string, alternative:import("./grammar.js").StitchedAlternative, node:any}>}
 */
export function* familyCalls(rules) {
  const seen = new Set();
  for (const [rule, definition] of rules) for (const alternative of definition.alternatives) {
    /** @type {unknown[]} */
    const roots = [alternative.tags];
    if (!seen.has(alternative.clauses)) {
      seen.add(alternative.clauses);
      const {tags, conditions, emit} = alternative.clauses;
      roots.push(tags, conditions, emit?.items.map(item => item.tags));
    }
    const pending = roots.reverse();
    while (pending.length) {
      const node = /** @type {any} */ (pending.pop());
      if (!node || typeof node !== "object") continue;
      if (node.method === "without-elision-except") yield {rule, alternative, node};
      const children = clauseChildren(node);
      for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]);
    }
  }
}

/**
 * @param {Map<string,import("./grammar.js").StitchedRule>} rules
 * @param {string} family
 * @returns {Set<string>}
 */
export function familyMembers(rules, family) {
  const members = new Set([family]);
  // Set iteration visits appended members, giving breadth-first order.
  for (const name of members) for (const alternative of rules.get(name)?.alternatives ?? []) {
    for (const target of memberEdges(alternative.expr)) members.add(target);
  }
  return members;
}

/**
 * @param {Map<string,import("./grammar.js").StitchedRule>} rules
 * @returns {Map<string,Set<string>>}
 */
export function closeFamilies(rules) {
  const families = new Map();
  for (const {node} of familyCalls(rules)) {
    const name = node.args[0].rule;
    if (!families.has(name)) families.set(name, familyMembers(rules, name));
  }
  return families;
}

/**
 * @param {import("./types.js").Expr} expr
 * @returns {IterableIterator<import("./types.js").Expr & {optional:import("./types.js").Expr}>}
 */
export function* ownedOptionals(expr) {
  const pending = [expr];
  while (pending.length) {
    const node = /** @type {import("./types.js").Expr} */ (pending.pop());
    if ("optional" in node && node.elidable) yield node;
    const children = expressionChildren(node);
    for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]);
  }
}
