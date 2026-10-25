// A ranking view carries the written invocation across generated helpers.
// Recognition keeps the original chart and its completion tables.
/** @typedef {import("./types.js").Item} Item */
/** @typedef {{id:number,frames:Item[],bounds:{carrier:Item}[]}} SlotScope */
/** @param {import("./earley.js").Chart} chart @param {Set<string>} names */
export function helperSlotForest(chart, names) {
  const lowered = chart.context.lowered;
  const helpers = new Set(lowered.productions.filter(p => p.helper).map(p => p.lhs));
  const users = new Map();
  for (const p of lowered.productions) if (p.helper) for (const s of p.rhs) {
    const list = users.get(s.name) ?? [];
    list.push(p.lhs);
    users.set(s.name, list);
  }
  const wrapped = new Set(names), pending = [...names];
  for (let at = 0; at < pending.length; at++) for (const name of users.get(pending[at]) ?? []) {
    if (!wrapped.has(name)) { wrapped.add(name); pending.push(name); }
  }
  if (!wrapped.size) return null;
  const sets = chart.sets.map(set => set ? {...set, items: /** @type {Item[]} */ ([])} : set);
  /** @type {Map<Item,Item>} */
  const plain = new Map();
  /** @type {Map<SlotScope,Map<Item,Item>>} */
  const scoped = new Map();
  /** @type {Map<string,SlotScope>} */
  const scopes = new Map();
  /** @type {Item[]} */
  const queue = [];
  /** @type {WeakMap<import("./types.js").Edge,number>} */
  const rawIndices = new WeakMap();
  let nextScope = 0, nextSource = 0;
  /** @type {WeakMap<Item,number>} */
  const sourceIds = new WeakMap();
  /** @param {Item} item */
  const id = item => {
    let found = sourceIds.get(item);
    if (found === undefined) sourceIds.set(item, found = nextSource++);
    return found;
  };
  /** @param {Item} raw @param {SlotScope|null} [scope] @returns {Item} */
  const view = (raw, scope = null) => {
    let map = plain;
    if (scope) {
      const found = scoped.get(scope);
      if (found) map = found;
      else { map = new Map(); scoped.set(scope, map); }
    }
    const old = map.get(raw);
    if (old) return old;
    const item = Object.setPrototypeOf({...raw, slotOriginal:raw, slotScope:scope}, Object.getPrototypeOf(raw));
    Object.defineProperty(item, "edges", {value:[], writable:true});
    map.set(raw, item);
    sets[raw.end].items.push(item);
    queue.push(item);
    return item;
  };
  /** @param {Item} before @param {Item} carrier @param {SlotScope|null} outer @returns {SlotScope} */
  const scopeFor = (before, carrier, outer) => {
    // A flat repetition consumes another item within the same invocation.
    if (outer && before.production.lhs === carrier.production.lhs) return outer;
    const key = JSON.stringify([outer?.id ?? -1, id(before), id(carrier)]);
    const old = scopes.get(key);
    if (old) return old;
    const scope = {id:nextScope++, frames:[...(outer?.frames ?? []), before],
      bounds:[...(outer?.bounds ?? []), {carrier}]};
    scopes.set(key, scope);
    return scope;
  };
  for (const set of chart.sets) if (set) for (const raw of set.items) view(raw);
  for (let at = 0; at < queue.length; at++) {
    const item = queue[at], raw = /** @type {Item} */ (item.slotOriginal), scope = item.slotScope ?? null;
    /** @param {import("./types.js").Edge} next @param {number} index */
    const append = (next, index) => {
      item.edges.push(next);
      rawIndices.set(next, index);
    };
    for (const [index, edge] of raw.edges.entries()) {
      if (edge.kind === "seed" || edge.kind === "restore") { append(edge, index); continue; }
      const previous = view(edge.previous, scope);
      if (edge.kind === "scan") { append({...edge, previous}, index); continue; }
      const child = edge.child;
      const carries = child.production.helper && wrapped.has(child.production.lhs) && (!raw.production.helper || scope);
      if (!carries) { append({...edge, previous, child:view(child)}, index); continue; }
      const inner = scopeFor(edge.previous, child, scope);
      append({...edge, previous, child:view(child, inner)}, index);
    }
  }
  return {chart:{...chart, sets}, plain, helpers, rawIndices};
}
