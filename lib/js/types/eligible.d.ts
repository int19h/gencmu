import type { Item } from "./types.js";
import type { Chart } from "./earley.js";
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
export declare function eligibleWitnesses(chart: Chart, witnesses: Item[]): Item[];
