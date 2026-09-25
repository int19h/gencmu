import type { Item, LoweredGrammar } from "./types.js";
import type { Chart } from "./earley.js";
export type Maximal = {
    /**
     * whether a completed item is an
     * elided terminator: the empty production of an elidable optional's helper
     */
    elided: (item: Item) => boolean;
    /**
     * whether an item's next symbol
     * is an elidable optional whose elision the node before it can forbid:
     * not at the start of a production, and not after a production's first
     * symbol when that is its own rule, what a repetition has read so far
     */
    guards: (item: Item) => boolean;
    /**
     * whether an elided terminator
     * may not follow the completed item, its constituent
     */
    forbids: (item: Item) => boolean;
};
/**
 * @import { Item, LoweredGrammar } from "./types.js"
 * @import { Chart } from "./earley.js"
 */
/**
 * What the ranking asks of maximal.
 * @typedef {object} Maximal
 * @property {(item: Item) => boolean} elided whether a completed item is an
 *   elided terminator: the empty production of an elidable optional's helper
 * @property {(item: Item) => boolean} guards whether an item's next symbol
 *   is an elidable optional whose elision the node before it can forbid:
 *   not at the start of a production, and not after a production's first
 *   symbol when that is its own rule, what a repetition has read so far
 * @property {(item: Item) => boolean} forbids whether an elided terminator
 *   may not follow the completed item, its constituent
 */
/**
 * @param {Chart} chart
 * @param {LoweredGrammar} lowered
 * @returns {Maximal}
 */
export declare function maximalRule(chart: Chart, lowered: LoweredGrammar): Maximal;
