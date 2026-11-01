import {boundaryLocations, boundaryDocumentErrors} from "./boundary.js";
import {expressionChildren} from "./clause-walk.js";
import {GencmuError} from "./errors.js";
/** @import {Production} from "./types.js" */

/** @type {WeakMap<Production[],Map<number,Set<string>>>} */
const stringDemands = new WeakMap();
/** @param {Production[]} productions @returns {Map<number,Set<string>>} */
export function demandedStrings(productions) {
  const known = stringDemands.get(productions);
  if (known) return known;
  const bindings = new Map();
  for (const p of productions) {
    let names = bindings.get(p.logicalSource ?? p.owner);
    if (!names) bindings.set(p.logicalSource ?? p.owner,names=new Map());
    for (const capture of p.captures) {
      const symbol = p.rhs[capture.index];
      if (symbol.terminal) continue;
      let targets = names.get(capture.name);
      if (!targets) names.set(capture.name,targets=new Set());
      targets.add(symbol.name);
    }
  }
  const demands = new Map();
  const byRule = new Map();
  for (const p of productions) {
    let entries = byRule.get(p.lhs);
    if (!entries) byRule.set(p.lhs,entries=[]);
    entries.push(p);
  }
  let changed = false;
  const add = (/** @type {Production} */ production, /** @type {string} */ channel) => {
    let channels = demands.get(production.id);
    if (!channels) demands.set(production.id, channels = new Set());
    if (!channels.has(channel)) { channels.add(channel); changed = true; }
  };
  const child = (/** @type {string} */ name, /** @type {string} */ channel) => {
    for (const p of byRule.get(name) ?? []) add(p,channel);
  };
  const reads = (/** @type {any} */ term, /** @type {Production} */ production, own = false) => {
    const pending = [term];
    while (pending.length) {
      const part = pending.pop();
      if (!part || typeof part !== "object") continue;
      if (["value","image"].includes(part.method) && part.receiver?.method === "emitted") {
        const name = part.receiver.receiver.capture;
        const slot = production.captureSlot.get(name);
        const symbol = slot === undefined ? null : production.rhs[production.captures[slot].index];
        if (name === "") {
          if (own || !production.helper) add(production,part.method);
          else for (const p of productions) if (!p.helper && p.logicalSource === production.logicalSource) add(p,part.method);
        } else if (symbol && !symbol.terminal) child(symbol.name,part.method);
        else for (const target of bindings.get(production.logicalSource ?? production.owner)?.get(name) ?? []) child(target,part.method);
      }
      for (const value of Object.values(part)) if (value && typeof value === "object") pending.push(...(Array.isArray(value) ? value : [value]));
    }
  };
  for (const p of productions) {
    for (const c of [...p.conditions,...p.rankedConditions ?? []]) reads(c.condition,p);
  }
  do {
    changed = false;
    for (const p of productions) for (const channel of demands.get(p.id) ?? []) {
      if (p.erased) continue;
      const recipe = channel === "value" ? p.value : p.image ?? p.value;
      if (recipe) reads(recipe,p,true);
      else for (const symbol of p.rhs) if (!symbol.terminal) child(symbol.name,channel);
    }
  } while (changed);
  stringDemands.set(productions,demands);
  return demands;
}


/** @param {any} node @returns {any[]} */
function emittedStrings(node) {
  const result = [], pending = [node];
  while (pending.length) {
    const part = pending.pop();
    if (!part || typeof part !== "object") continue;
    if (["value","image"].includes(part.method) && part.receiver?.method === "emitted") result.push(part);
    else pending.push(...Object.values(part).reverse());
  }
  return result;
}

/** @param {Map<string,any>} rules */
export function validateConditionStrings(rules) {
  const definitions = new Map(), bodies = new Map();
  const definition = (/** @type {any} */ rule, /** @type {any} */ alt) => JSON.stringify([rule.name,alt.document,alt.at.line,alt.at.column]);
  const references = (/** @type {any} */ expr) => {
    const names = new Set(), pending = [expr];
    while (pending.length) {
      const part = pending.pop();
      if (rules.has(part.ref)) names.add(part.ref);
      pending.push(...expressionChildren(part));
    }
    return names;
  };
  for (const rule of rules.values()) for (const alt of rule.alternatives) {
    bodies.set(alt,references(alt.expr));
    const key = definition(rule,alt);
    if (!definitions.has(key)) definitions.set(key,new Map());
    const bindings = definitions.get(key), pending = [alt.expr];
    while (pending.length) {
      const part = pending.pop();
      if (typeof part.capture === "string") {
        if (!bindings.has(part.capture)) bindings.set(part.capture,new Set());
        for (const name of references(part.expr)) bindings.get(part.capture).add(name);
      }
      pending.push(...expressionChildren(part));
    }
  }
  const targets = (/** @type {any} */ rule, /** @type {any} */ alt, /** @type {any} */ read) => {
    const capture = read.receiver.receiver.capture;
    return capture === "" ? [rule.name] : definitions.get(definition(rule,alt)).get(capture) ?? [];
  };
  const reachesVerbatim = (/** @type {any} */ rule, /** @type {any} */ alt, /** @type {any} */ read) => {
    const pending = [...targets(rule,alt,read)].map(name => [name,read.method]);
    const seen = new Set();
    while (pending.length) {
      const [name,channel] = /** @type {any[]} */ (pending.pop());
      const key = JSON.stringify([name,channel]);
      if (seen.has(key)) continue;
      seen.add(key);
      const current = rules.get(name);
      for (const variant of current.alternatives) {
        if (variant.clauses.erased) continue;
        const value = variant.value ?? variant.clauses.value;
        const recipe = channel === "value" ? value : variant.image ?? variant.clauses.image ?? value;
        if (recipe) {
          if (recipe.concat.some((/** @type {any} */ atom) => atom.method === "verbatim-text")) return true;
          for (const atom of emittedStrings(recipe)) for (const target of targets(current,variant,atom)) pending.push([target,atom.method]);
        } else for (const target of bodies.get(variant)) pending.push([target,channel]);
      }
    }
    return false;
  };
  for (const rule of rules.values()) for (const alt of rule.alternatives) {
    for (const read of emittedStrings(alt.clauses.conditions)) if (reachesVerbatim(rule,alt,read)) {
      const at = boundaryLocations.get(read.receiver)?.at;
      const error = new GencmuError("grammar","a condition walk cannot reach verbatim-text",{document:alt.document,...(at ? {line:at[0],column:at[1]} : {})});
      boundaryDocumentErrors.set(error,{document:alt.document,node:read.receiver});
      throw error;
    }
  }
}
