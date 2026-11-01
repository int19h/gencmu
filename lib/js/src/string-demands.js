import {boundaryLocations, boundaryDocumentErrors} from "./boundary.js";
import {GencmuError} from "./errors.js";
/** @import {Production} from "./types.js" */

/** @type {WeakMap<Production[],Map<string,Set<string>>>} */
const stringDemands = new WeakMap();
/** @param {Production[]} productions @param {any[]} [seeds] @returns {Map<string,Set<string>>} */
export function demandedStrings(productions, seeds) {
  const known = seeds ? null : stringDemands.get(productions);
  if (known) return known;
  const bindings = new Map();
  for (const p of productions) {
    let names = bindings.get(p.source ?? p.owner);
    if (!names) bindings.set(p.source ?? p.owner,names=new Map());
    for (const capture of p.captures) {
      const symbol = p.rhs[capture.index];
      if (symbol.terminal) continue;
      let targets = names.get(capture.name);
      if (!targets) names.set(capture.name,targets=new Set());
      targets.add(symbol.name);
    }
  }
  const demands = new Map();
  let changed = false;
  const add = (/** @type {string} */ name, /** @type {string} */ channel) => {
    let channels = demands.get(name);
    if (!channels) demands.set(name, channels = new Set());
    if (!channels.has(channel)) { channels.add(channel); changed = true; }
  };
  const reads = (/** @type {any} */ term, /** @type {Production} */ production) => {
    const pending = [term];
    while (pending.length) {
      const part = pending.pop();
      if (!part || typeof part !== "object") continue;
      if (["value","image"].includes(part.method) && part.receiver?.method === "emitted") {
        const name = part.receiver.receiver.capture;
        const slot = production.captureSlot.get(name);
        const symbol = slot === undefined ? null : production.rhs[production.captures[slot].index];
        if (name === "") { add(production.lhs,part.method); add(production.owner,part.method); }
        else if (symbol && !symbol.terminal) add(symbol.name,part.method);
        else for (const target of bindings.get(production.source ?? production.owner)?.get(name) ?? []) add(target,part.method);
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
    for (const p of productions) for (const channel of demands.get(p.lhs) ?? []) {
      if (p.erased) continue;
      const recipe = channel === "value" ? p.value : p.image ?? p.value;
      if (recipe) reads(recipe,p);
      else for (const symbol of p.rhs) if (!symbol.terminal) add(symbol.name,channel);
    }
  } while (changed);
  if (!seeds) stringDemands.set(productions,demands);
  return demands;
}


/** @param {Production[]} productions */
export function validateConditionStrings(productions) {
  for (const p of productions) {
    if (p.helper || !p.source) continue;
    /** @type {any[]} */
    const pending = [p.source.clauses.conditions];
    while (pending.length) {
      const term = pending.pop();
      if (!term || typeof term !== "object") continue;
      if (["value","image"].includes(term.method) && term.receiver?.method === "emitted") {
        const demands = demandedStrings(productions,[[p,term]]);
        const bad = productions.some(q => !q.erased && [...demands.get(q.lhs) ?? []].some(channel => {
          const selected = channel === "value" ? q.value : q.image ?? q.value;
          return selected?.concat.some(atom => "method" in atom && atom.method === "verbatim-text");
        }));
        if (bad) {
          const at = boundaryLocations.get(term.receiver)?.at;
          const error = new GencmuError("grammar","a condition walk cannot reach verbatim-text",{document:p.source.document,...(at ? {line:at[0],column:at[1]} : {})});
          boundaryDocumentErrors.set(error,{document:p.source.document,node:term.receiver});
          throw error;
        }
      }
      pending.push(...Object.values(term).reverse());
    }
  }
}
