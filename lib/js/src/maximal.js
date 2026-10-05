// Maximal terminators (engine §4): an elided terminator is forbidden
// where its constituent, the node before it, could have been longer.

/**
 * @import { Item, LoweredGrammar, SymbolTest } from "./types.js"
 * @import { Chart } from "./earley.js"
 */

import { testHolds } from "./earley.js";

/**
 * What the ranking asks of maximal.
 * @typedef {object} Maximal
 * @property {(item: Item) => boolean} elided whether a completed item is an
 *   elided terminator: the empty production of an elidable optional's helper
 * @property {(item: Item) => boolean} guards whether an item's next symbol
 *   is an elidable optional whose elision the node before it can forbid:
 *   not at the start of a production, and not after a production's first
 *   symbol when that is its own rule, what a repetition has read so far
 * @property {(item: Item, test?: SymbolTest) => boolean} forbids whether an
 *   elided terminator may not follow the completed item, its constituent,
 *   which stands for a symbol with the given test, if it has one
 */

/**
 * @param {Chart} chart
 * @param {LoweredGrammar} lowered
 * @returns {Maximal}
 */
export function maximalRule(chart, lowered) {
  // The helpers of maximal terminators (engine §4).
  /** @type {Set<string>} */
  const elidable = new Set();
  for (const production of lowered.productions) {
    if (production.helper && production.elided !== null && lowered.maximalHelpers.has(production.lhs)) elidable.add(production.lhs);
  }
  // Whether a constituent could have been longer depends only on its
  // symbol, origin and end: the furthest set holding a completed item of
  // each symbol from each origin decides it.
  /** @type {Map<string, Map<number, number>> | null} */
  let furthest = null;
  const longest = () => {
    if (furthest) return furthest;
    furthest = new Map();
    for (const set of chart.sets) {
      if (!set) continue;
      for (const item of set.items) {
        if (item.dot !== item.production.rhs.length) continue;
        let byOrigin = furthest.get(item.production.lhs);
        if (!byOrigin) furthest.set(item.production.lhs, (byOrigin = new Map()));
        const known = byOrigin.get(item.origin);
        if (known === undefined || known < set.position) byOrigin.set(item.origin, set.position);
      }
    }
    return furthest;
  };
  // For a tested symbol, every completed item of each symbol from each
  // origin, since a longer constituent counts only where the test holds of
  // it too, with its own span and tags (engine §4).
  /** @type {Map<string, Map<number, Item[]>> | null} */
  let completed = null;
  const allCompleted = () => {
    if (completed) return completed;
    completed = new Map();
    for (const set of chart.sets) {
      if (!set) continue;
      for (const item of set.items) {
        if (item.dot !== item.production.rhs.length) continue;
        let byOrigin = completed.get(item.production.lhs);
        if (!byOrigin) completed.set(item.production.lhs, (byOrigin = new Map()));
        const list = byOrigin.get(item.origin);
        if (!list) byOrigin.set(item.origin, [item]);
        else list.push(item);
      }
    }
    return completed;
  };
  return {
    elided: (item) => item.production.rhs.length === 0 && elidable.has(item.production.lhs),
    guards: (item) => {
      const rhs = item.production.rhs;
      const next = rhs[item.dot];
      if (next === undefined || next.terminal || !elidable.has(next.name)) return false;
      return !(item.dot === 1 && !rhs[0].terminal && rhs[0].name === item.production.lhs);
    },
    forbids: (item, test) => {
      if (test !== undefined) {
        const byOrigin = allCompleted().get(item.production.lhs);
        const list = byOrigin === undefined ? undefined : byOrigin.get(item.origin);
        const context = chart.context;
        return list !== undefined && list.some((longer) => longer.end > item.end &&
          testHolds(context, test, item.origin, longer.end, context.interner.get(longer.tagId)));
      }
      const byOrigin = longest().get(item.production.lhs);
      const end = byOrigin === undefined ? undefined : byOrigin.get(item.origin);
      return end !== undefined && end > item.end;
    },
  };
}
