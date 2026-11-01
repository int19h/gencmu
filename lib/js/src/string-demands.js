import {boundaryLocations, boundaryDocumentErrors} from "./boundary.js";
import {GencmuError} from "./errors.js";
/** @import {Production} from "./types.js" */

/** @type {WeakMap<Production[],Map<number,Set<string>>>} */
const stringDemands = new WeakMap();
/** @param {Production[]} productions @param {any[]} [seeds] @returns {Map<number,Set<string>>} */
export function demandedStrings(productions, seeds) {
  const known = seeds ? null : stringDemands.get(productions);
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
  if (seeds) for (const [p,term] of seeds) reads(term,p);
  else for (const p of productions) {
    for (const c of [...p.conditions,...p.rankedConditions ?? []]) reads(c.condition,p);
    reads(p.itemConditions,p);
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
  if (!seeds) stringDemands.set(productions,demands);
  return demands;
}


/** @param {Production[]} productions */
export function validateConditionStrings(productions) {
  for (const p of productions) {
    if (p.helper || !p.logicalSource) continue;
    /** @type {any[]} */
    const pending = [p.logicalSource.clauses.conditions];
    while (pending.length) {
      const term = pending.pop();
      if (!term || typeof term !== "object") continue;
      if (["value","image"].includes(term.method) && term.receiver?.method === "emitted") {
        const demands = demandedStrings(productions,[[p,term]]);
        const bad = productions.some(q => !q.erased && [...demands.get(q.id) ?? []].some(channel => {
          const selected = channel === "value" ? q.value : q.image ?? q.value;
          return selected?.concat.some(atom => "method" in atom && atom.method === "verbatim-text");
        }));
        if (bad) {
          const at = boundaryLocations.get(term.receiver)?.at;
          const error = new GencmuError("grammar","a condition walk cannot reach verbatim-text",{document:p.logicalSource.document,...(at ? {line:at[0],column:at[1]} : {})});
          boundaryDocumentErrors.set(error,{document:p.logicalSource.document,node:term.receiver});
          throw error;
        }
      }
      pending.push(...Object.values(term).reverse());
    }
  }
}
