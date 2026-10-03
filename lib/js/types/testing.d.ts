/** @type {Set<string>} */
export declare const faults: Set<string>;
export type ElisionCheckRun = {
    /**
     * D, the chosen
     * derivation of the main parse
     */
    chosen: import("./types.js").Derivation;
    /**
     * the recognition of R
     */
    chart: import("./earley.js").Chart;
    /**
     * the completed items of
     * `text` over R
     */
    roots: import("./types.js").Item[];
    /**
     *   the check's own ranking of a part of its forest, whose roots are given,
     *   in the cycle contexts of the whole forest: null where it counts no
     *   derivation
     */
    rank: (roots: import("./earley.js").Item[]) => import("./rank.js").Ranking | null;
    /**
     * for each token of R, whether it is
     * synthetic, by its provenance
     */
    synthetic: boolean[];
    /**
     * for each token of the stage's input, its
     * index in R
     */
    originalAt: number[];
    /**
     * for each restoration record, the index of
     * its synthetic token in R
     */
    recordAt: number[];
};
/**
 * What the check of engine §7 hands its test hook.
 * @typedef {object} ElisionCheckRun
 * @property {import("./types.js").Derivation} chosen D, the chosen
 *   derivation of the main parse
 * @property {import("./earley.js").Chart} chart the recognition of R
 * @property {import("./types.js").Item[]} roots the completed items of
 *   `text` over R
 * @property {(roots: import("./earley.js").Item[]) => import("./rank.js").Ranking | null} rank
 *   the check's own ranking of a part of its forest, whose roots are given,
 *   in the cycle contexts of the whole forest: null where it counts no
 *   derivation
 * @property {boolean[]} synthetic for each token of R, whether it is
 *   synthetic, by its provenance
 * @property {number[]} originalAt for each token of the stage's input, its
 *   index in R
 * @property {number[]} recordAt for each restoration record, the index of
 *   its synthetic token in R
 */
/** @type {{elisionCheck: ((run: ElisionCheckRun) => void) | null}} */
export declare const hooks: {
    elisionCheck: ((run: ElisionCheckRun) => void) | null;
};
/**
 * Whether a fault is on.
 * @param {string} name
 * @returns {boolean}
 */
export declare function fault(name: string): boolean;
