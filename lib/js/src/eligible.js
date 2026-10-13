// Written-terminator priority for nested queries (engine §4): which
// completed items of a queried rule have an eligible witness.

/**
 * @import { Edge, Item, LoweredGrammar } from "./types.js"
 * @import { Chart } from "./earley.js"
 */


/** @type {WeakMap<LoweredGrammar, {elidable:Set<string>,optional:Map<string,object>}>} */
const helperSites = new WeakMap();

/**
 * Elidable helpers and the written sites of split plain optional helpers. A
 * captured optional can have separate helpers for its expanded routes.
 * @param {LoweredGrammar} lowered
 * @returns {{elidable:Set<string>,optional:Map<string,object>}}
 */
function helpersOf(lowered) {
  let helpers = helperSites.get(lowered);
  if (!helpers) {
    helpers = {elidable:new Set(),optional:new Map()};
    /** @type {Map<object,Set<string>>} */
    const sites = new Map();
    for (const production of lowered.productions) {
      if (!production.helper) continue;
      if (production.elided !== null) helpers.elidable.add(production.lhs);
      const expression = production.writtenExpression;
      if (expression && "optional" in expression && expression.elidable !== true) {
        let names = sites.get(expression);
        if (!names) sites.set(expression,names=new Set());
        names.add(production.lhs);
      }
    }
    // One helper already joins all its optional's routes in the chart.
    // Only distinct names of one written site need the logical group key.
    for (const [expression,names] of sites) {
      if (names.size > 1) for (const name of names) helpers.optional.set(name,expression);
    }
    helperSites.set(lowered, helpers);
  }
  return helpers;
}

/**
 * Whether a completed item is the empty helper of an elidable optional: an
 * advance over it is an omission.
 * @param {Item} item
 * @returns {boolean}
 */
function omitted(item) {
  return item.production.helper && item.production.elided !== null && item.production.rhs.length === 0;
}

/**
 * Whether a completed item is an elidable optional's helper over its
 * nonempty alternative: an advance over it reads the optional as written.
 * @param {Item} item
 * @returns {boolean}
 */
function written(item) {
  return item.dot === item.production.rhs.length && item.production.helper && item.production.elided !== null && item.production.rhs.length > 0;
}

/**
 * @param {Item} item
 * @returns {{node:import("./logical.js").LogicalSymbol|undefined, initial:boolean}|null}
 */
function logicalPredecessor(item) {
  const roots = item.production.logical;
  if (!roots) return null;
  /** @param {import("./logical.js").LogicalSymbol[]} nodes @param {boolean} root @returns {{node:import("./logical.js").LogicalSymbol|undefined,initial:boolean}|null} */
  const find = (nodes,root) => {
    for (let index=0;index<nodes.length;index++) {
      const node = nodes[index];
      if (node.symbol && node.from === item.dot) return {node:nodes[index-1],initial:root && index === 1};
      if (node.children && node.from <= item.dot && item.dot < node.to) {
        const result = find(node.children,false);
        if (result) return result;
      }
    }
    return null;
  };
  return find(roots,true);
}

/**
 * The witnesses, completed items of the queried rule, that have an eligible
 * witness in the chart (engine §4). An omission is an advance over the
 * empty helper of an elidable optional at its position p. It is forbidden
 * where the prefix that the witness holds fixed can go on and read the
 * optional as written:
 *
 * - Where the optional has a constituent Y, the prefix is the item before Y
 *   in the same witness. The omission is forbidden when the chart advances
 *   that item over Y to some p' ≥ p, and the item so made advances over the
 *   optional's nonempty alternative.
 * - Otherwise the prefix is the item before the optional, and the omission
 *   is forbidden when the chart advances that item over the nonempty
 *   alternative.
 *
 * The chart is the whole recognition of the query, before any filtering,
 * so an attempt that never completes the rule can forbid an omission.
 *
 * Each item has two states, computed together to the least fixpoint: it has
 * an eligible witness (A), and it has an eligible witness that permits the
 * optional after it to be empty (L). L follows the edge of the witness,
 * so a permitted omission never combines with another witness's prefix.
 * @param {Chart} chart
 * @param {Item[]} witnesses
 * @returns {Item[]}
 */
export function eligibleWitnesses(chart, witnesses) {
  if (witnesses.length === 0) return witnesses;
  const {elidable:helpers,optional:optionals} = helpersOf(chart.context.lowered);
  if (helpers.size === 0) return witnesses;
  // The items the witnesses rest on, children before the items made from
  // them where the edges allow, so that one sweep settles most of them.
  /** @type {Map<Item, number>} */
  const index = new Map();
  /** @type {Item[]} */
  const order = [];
  let omits = false;
  for (const witness of witnesses) {
    if (index.has(witness)) continue;
    index.set(witness, -1);
    /** @type {{item: Item, edges: Edge[], next: number}[]} */
    const stack = [{ item: witness, edges: witness.edges, next: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      let pushed = false;
      while (frame.next < frame.edges.length * 2) {
        const step = frame.next++;
        const edge = frame.edges[step >> 1];
        /** @type {Item | null} */
        let below = null;
        if ((step & 1) === 0) below = edge.kind === "seed" || edge.kind === "restore" ? null : edge.previous;
        else if (edge.kind === "complete") {
          below = edge.child;
          if (omitted(edge.child)) omits = true;
        }
        if (below !== null && !index.has(below)) {
          index.set(below, -1);
          stack.push({ item: below, edges: below.edges, next: 0 });
          pushed = true;
          break;
        }
      }
      if (pushed) continue;
      stack.pop();
      index.set(frame.item, order.length);
      order.push(frame.item);
    }
  }
  // With no omission, every item of a chart has a finite proof, made from
  // predicted items in the order in which the recognizer made it.
  if (!omits) return witnesses;

  // The prefixes that advance over a written optional, and for each item
  // before a constituent Y, the furthest end of an advance over Y that then
  // reads the optional as written.
  /** @type {Set<Item>} */
  const reads = new Set();
  for (const set of chart.sets) {
    if (!set) continue;
    for (const item of set.items) {
      for (const edge of item.edges) if (edge.kind === "complete" && written(edge.child)) reads.add(edge.previous);
    }
  }
  /** @type {Map<Item, number>} */
  const further = new Map();
  for (const item of reads) {
    for (const edge of item.edges) {
      if (edge.kind !== "complete") continue;
      const known = further.get(edge.previous);
      if (known === undefined || known < item.end) further.set(edge.previous, item.end);
    }
  }

  // For each item, whether an elidable optional comes next, and whether it
  // has a constituent: not at the start, not after a terminal, and not
  // after the first symbol of a production whose first symbol is its own
  // rule (engine §4).
  /** @type {Map<Item,import("./logical.js").LogicalSymbol>} */
  const precedingGroups = new Map();
  /** @param {Item} item @returns {"none"|"alone"|"constituent"|"group"} */
  const nextKind = item => {
    const rhs = item.production.rhs;
    const symbol = rhs[item.dot];
    if (symbol === undefined || symbol.terminal || !helpers.has(symbol.name)) return "none";
    const logical = logicalPredecessor(item);
    if (logical) {
      const previous = logical.node;
      if (!previous || previous.symbol?.terminal) return "alone";
      const optional = previous.symbol && optionals.get(previous.symbol.name);
      if (previous.children || optional) {
        // Both physical helper variants and inline expansions retain one
        // optional boundary for the fixed prefix and all blocker routes.
        precedingGroups.set(item,optional ? {...previous,written:optional} : previous);
        return "group";
      }
      if (logical.initial && previous.symbol?.name === item.production.lhs) return "alone";
      return "constituent";
    }
    if (item.dot === 0 || rhs[item.dot-1].terminal) return "alone";
    if (item.dot === 1 && rhs[0].name === item.production.lhs) return "alone";
    return "constituent";
  };
  const next = order.map(nextKind);
  const identities = new WeakMap();
  let identityCount = 0;
  /** @param {object|undefined} object */
  const identity = object => {
    if (!object) return 0;
    let id = identities.get(object);
    if (id === undefined) identities.set(object,id=++identityCount);
    return id;
  };
  /** @param {Item} item @param {import("./logical.js").LogicalSymbol} group */
  const fixedKey = (item,group) => {
    const captures = [];
    for (let slot=item.slots;slot;slot=slot.parent) {
      const name = item.production.captures[slot.index].name;
      captures.push([name,slot.start,slot.end,slot.tags,slot.structure,slot.observation?.sequence]);
    }
    const symbols = item.production.rhs.map((symbol,index) => [symbol.name,symbol.test?.written,
      item.production.captures.filter(capture => capture.index === index && !capture.name.startsWith("\u0000")).map(capture => capture.name)]);
    // Only the preceding optional's route varies. Every outside expansion
    // remains part of the same logical production and fixed prefix.
    const outside = [...symbols.slice(0,group.from),["optional"],...symbols.slice(group.to)];
    // A surrounding optional can also have one helper per expanded route.
    const owner = optionals.get(item.production.lhs);
    const scope = owner ? ["optional",identity(owner)] : item.production.lhs;
    return JSON.stringify([identity(item.production.logicalSource ?? item.production.source),scope,identity(group.written),
      item.origin,item.end,item.structure,item.observationPrefix?.sequence,outside,captures.reverse()]);
  };
  /** @param {Item} item @param {number} dot @returns {Item[]} */
  const boundaries = (item,dot) => {
    const result = [], pending = [item], seen = new Set();
    while (pending.length) {
      const current = /** @type {Item} */ (pending.pop());
      if (seen.has(current)) continue;
      seen.add(current);
      if (current.dot === dot) result.push(current);
      else for (const edge of current.edges) if (edge.kind === "scan" || edge.kind === "complete") pending.push(edge.previous);
    }
    return result;
  };
  const groupFurther = new Map();
  for (const item of reads) if (nextKind(item) === "group") {
    const group = /** @type {import("./logical.js").LogicalSymbol} */ (precedingGroups.get(item));
    for (const prefix of boundaries(item,group.from)) {
      const key = fixedKey(prefix,group);
      groupFurther.set(key,Math.max(groupFurther.get(key) ?? -1,item.end));
    }
  }
  const eligible = new Uint8Array(order.length);
  const permits = new Uint8Array(order.length);
  /** @type {(item: Item) => number} */
  const at = (item) => /** @type {number} */ (index.get(item));
  /** @param {Item} item @param {import("./logical.js").LogicalSymbol} group @param {number} end @returns {boolean} */
  const groupPermits = (item,group,end) => {
    const pending = [item], seen = new Set();
    while (pending.length) {
      const current = /** @type {Item} */ (pending.pop());
      if (seen.has(current) || !eligible[at(current)]) continue;
      seen.add(current);
      if (current.dot === group.from) {
        if ((groupFurther.get(fixedKey(current,group)) ?? -1) < end) return true;
        continue;
      }
      for (const edge of current.edges) {
        if (edge.kind === "scan") pending.push(edge.previous);
        else if (edge.kind === "complete" && eligible[at(edge.child)] && (!omitted(edge.child) || permits[at(edge.previous)])) pending.push(edge.previous);
      }
    }
    return false;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (let x = 0; x < order.length; x++) {
      if (eligible[x] && (permits[x] || next[x] === "none")) continue;
      const item = order[x];
      let a = 0;
      let l = 0;
      for (const edge of item.edges) {
        let through = 0;
        // A query reads no synthetic token, so it has no restoration.
        if (edge.kind === "seed" || edge.kind === "restore") through = 1;
        else if (edge.kind === "scan") through = eligible[at(edge.previous)];
        else {
          const before = at(edge.previous);
          through = (omitted(edge.child) ? permits[before] : eligible[before]) & eligible[at(edge.child)];
        }
        if (!through) continue;
        a = 1;
        if (next[x] === "alone") {
          if (!reads.has(item)) l = 1;
        } else if (next[x] === "group") {
          const group = /** @type {import("./logical.js").LogicalSymbol} */ (precedingGroups.get(item));
          if (groupPermits(item,group,item.end)) l = 1;
        } else if (next[x] === "constituent" && edge.kind === "complete") {
          const end = further.get(edge.previous);
          if (end === undefined || end < item.end) l = 1;
        }
      }
      if (a && !eligible[x]) {
        eligible[x] = 1;
        changed = true;
      }
      if (l && !permits[x]) {
        permits[x] = 1;
        changed = true;
      }
    }
  }
  return witnesses.filter((witness) => eligible[at(witness)]);
}
