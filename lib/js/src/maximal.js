// The resolution maximal (engine §4): an elided terminator is forbidden
// where its constituent, the node before it, could have been longer.

/**
 * @import { Item, LoweredGrammar } from "./types.js"
 * @import { Chart } from "./earley.js"
 */

import { spellingMatches } from "./earley.js";

/**
 * What the ranking asks of maximal.
 * @typedef {object} Maximal
 * @property {(item: Item) => boolean} elided whether a completed item is an
 *   elided terminator: the empty production of an elidable optional's helper
 * @property {(item: Item) => boolean} guards whether an item's next symbol
 *   is an elidable optional whose elision the node before it can forbid:
 *   not at the start of a production, and not after a production's first
 *   symbol when that is its own rule, what a repetition has read so far
 * @property {(item: Item, spelling?: string) => boolean} forbids whether an
 *   elided terminator may not follow the completed item, its constituent,
 *   which stands for a symbol with the given spelling, if it has one
 */

/**
 * @param {Chart} chart
 * @param {LoweredGrammar} lowered
 * @returns {Maximal}
 */
export function maximalRule(chart, lowered) {
  /** @type {Set<string>} */
  const elidable = new Set();
  for (const production of lowered.productions) {
    if (production.helper && production.elided !== null) elidable.add(production.lhs);
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
  // For a spelled symbol, every end of a completed item of each symbol from
  // each origin, since a longer constituent counts only where its span
  // sounds like the spelling too (engine §4).
  /** @type {Map<string, Map<number, number[]>> | null} */
  let ends = null;
  const allEnds = () => {
    if (ends) return ends;
    ends = new Map();
    for (const set of chart.sets) {
      if (!set) continue;
      for (const item of set.items) {
        if (item.dot !== item.production.rhs.length) continue;
        let byOrigin = ends.get(item.production.lhs);
        if (!byOrigin) ends.set(item.production.lhs, (byOrigin = new Map()));
        const list = byOrigin.get(item.origin);
        if (!list) byOrigin.set(item.origin, [set.position]);
        else if (list[list.length - 1] !== set.position) list.push(set.position);
      }
    }
    return ends;
  };
  return {
    elided: (item) => item.production.helper && item.production.elided !== null && item.production.rhs.length === 0,
    guards: (item) => {
      const rhs = item.production.rhs;
      const next = rhs[item.dot];
      if (next === undefined || next.terminal || !elidable.has(next.name)) return false;
      return !(item.dot === 1 && !rhs[0].terminal && rhs[0].name === item.production.lhs);
    },
    forbids: (item, spelling) => {
      if (spelling !== undefined) {
        const byOrigin = allEnds().get(item.production.lhs);
        const list = byOrigin === undefined ? undefined : byOrigin.get(item.origin);
        return list !== undefined && list.some((end) => end > item.end && spellingMatches(chart.context, spelling, item.origin, end));
      }
      const byOrigin = longest().get(item.production.lhs);
      const end = byOrigin === undefined ? undefined : byOrigin.get(item.origin);
      return end !== undefined && end > item.end;
    },
  };
}
