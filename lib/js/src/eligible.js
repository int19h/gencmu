// Written-terminator priority for nested queries (engine §4): which
// completed items of a queried rule have an eligible witness.

/**
 * @import { Edge, Item, LoweredGrammar, SymbolTest, TagSet } from "./types.js"
 * @import { Chart, ParseContext } from "./earley.js"
 */

import { countWork, hooks } from "./testing.js";

/**
 * Whether a test holds of a span with the given tags: the recognizer's own,
 * passed in so that this module does not import the recognizer.
 * @typedef {(context: ParseContext, test: SymbolTest, from: number, to: number, tags: TagSet) => boolean} TestHolds
 */

/** @type {WeakMap<LoweredGrammar, Set<string>>} */
const elidableHelpers = new WeakMap();

/**
 * The helpers of a grammar's elidable optionals (engine §3.8), by name.
 * @param {LoweredGrammar} lowered
 * @returns {Set<string>}
 */
function helpersOf(lowered) {
  let helpers = elidableHelpers.get(lowered);
  if (!helpers) {
    helpers = new Set();
    for (const production of lowered.productions) if (production.helper && production.elided !== null) helpers.add(production.lhs);
    elidableHelpers.set(lowered, helpers);
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
 * An omission of a maximal terminator with a constituent Y is also
 * forbidden when the chart has a longer Y: a completed item of Y from the
 * same origin with a later end, which passes Y's test. Maximality never
 * forbids an omission with no constituent.
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
 * @param {TestHolds} testHolds
 * @returns {Item[]}
 */
export function eligibleWitnesses(chart, witnesses, testHolds) {
  if (witnesses.length === 0) return witnesses;
  const helpers = helpersOf(chart.context.lowered);
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
  const next = order.map((item) => {
    const rhs = item.production.rhs;
    const symbol = rhs[item.dot];
    if (symbol === undefined || symbol.terminal || !helpers.has(symbol.name)) return "none";
    if (item.dot === 0 || rhs[item.dot - 1].terminal) return "alone";
    if (item.dot === 1 && rhs[0].name === item.production.lhs) return "alone";
    return "constituent";
  });
  // Whether the optional after each item is of a maximal terminator.
  const lowered = chart.context.lowered;
  const maximalNext = order.map((item, x) => {
    if (next[x] !== "constituent" || lowered.maximalTerminals.size === 0) return false;
    const helpers = lowered.byLhs.get(item.production.rhs[item.dot].name) || [];
    return helpers.some((production) => production.elided !== null && lowered.maximalTerminals.has(production.elided));
  });
  // The completed items of each symbol from each origin, in the query's
  // chart, made once per query when a maximal terminator needs them, with
  // the furthest end of each list. For a tested symbol, the furthest end of
  // a completion that passes the test is kept for each test, since a test
  // reads only the candidate's own span and tags. So each check is a
  // lookup, and not a walk of the list.
  /** @type {Map<string, {items: Item[], furthest: number, tested: Map<SymbolTest, number>}> | null} */
  let completed = null;
  /** @type {(constituent: Item, x: number) => boolean} */
  const longer = (constituent, x) => {
    if (hooks.work) countWork(hooks.work, "checks");
    if (completed === null) {
      completed = new Map();
      for (const set of chart.sets) {
        if (!set) continue;
        for (const item of set.items) {
          if (hooks.work) countWork(hooks.work, "scanned");
          if (item.dot !== item.production.rhs.length) continue;
          const key = `${item.production.lhs}\u0000${item.origin}`;
          const entry = completed.get(key);
          if (entry) {
            entry.items.push(item);
            if (item.end > entry.furthest) entry.furthest = item.end;
          } else completed.set(key, { items: [item], furthest: item.end, tested: new Map() });
        }
      }
    }
    const entry = completed.get(`${constituent.production.lhs}\u0000${constituent.origin}`);
    if (entry === undefined) return false;
    const test = order[x].production.rhs[order[x].dot - 1].test;
    if (!test) return entry.furthest > constituent.end;
    let furthest = entry.tested.get(test);
    if (furthest === undefined) {
      furthest = -1;
      for (const candidate of entry.items) {
        if (hooks.work) countWork(hooks.work, "candidates");
        if (candidate.end > furthest && testHolds(chart.context, test, candidate.origin, candidate.end, chart.context.interner.get(candidate.tagId))) furthest = candidate.end;
      }
      entry.tested.set(test, furthest);
    }
    return furthest > constituent.end;
  };
  const eligible = new Uint8Array(order.length);
  const permits = new Uint8Array(order.length);
  /** @type {(item: Item) => number} */
  const at = (item) => /** @type {number} */ (index.get(item));
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
        } else if (next[x] === "constituent" && edge.kind === "complete") {
          const end = further.get(edge.previous);
          if ((end === undefined || end < item.end) && !(maximalNext[x] && longer(edge.child, x))) l = 1;
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
