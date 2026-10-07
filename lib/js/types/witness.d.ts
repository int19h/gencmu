/**
 * The restored chosen derivation's matched edge indices and action sequence.
 * @typedef {object} Walk
 * @property {Map<import("./types.js").Item, Set<number>>} marks
 * @property {import("./types.js").Action[]} sequence
 */
export type Walk = {
    marks: Map<import("./types.js").Item, Set<number>>;
    sequence: import("./types.js").Action[];
};
/**
 * Finds the restored chosen derivation before ranking.
 * The walk matches productions, spans and token provenance.
 * It returns matched edges and the witness's actions.
 * A missing witness gives null.
 * @param {import("./testing.js").ElisionCheckRun} run
 * @returns {Walk | null}
 */
export declare function walkWitness(run: import("./testing.js").ElisionCheckRun): Walk | null;
