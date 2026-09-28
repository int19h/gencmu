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
     * whether an
     * elided terminator may not follow the completed item, its constituent,
     * which stands for a symbol with the given spelling, if it has one
     */
    forbids: (item: Item, spelling?: string) => boolean;
};
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
export declare function maximalRule(chart: Chart, lowered: LoweredGrammar): Maximal;
