/** @type {Set<string>} */
export declare const faults: Set<string>;
/**
 * How often each site of a fault was entered while that fault was on, by
 * the fault's name, or its name and the site's after an @, for a fault
 * with several sites. The fault test asserts that its named cases enter
 * every declared site (tests/README.md).
 * @type {Map<string, number>}
 */
export declare const hits: Map<string, number>;
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
export type ElisionCheckWatch = {
    marks: Map<import("./earley.js").Item, Set<number>> | null;
    ranked: (outcome: {
        ranking: import("./rank.js").Ranking | null;
        counted: boolean;
    }) => void;
};
/**
 * What the check of engine §7 hands its test hook.
 * @typedef {object} ElisionCheckRun
 * @property {import("./types.js").Derivation} chosen D, the chosen
 *   derivation of the main parse
 * @property {import("./earley.js").Chart} chart the recognition of R
 * @property {import("./types.js").Item[]} roots the completed items of
 *   `text` over R
 * @property {boolean[]} synthetic for each token of R, whether it is
 *   synthetic, by its provenance
 * @property {number[]} originalAt for each token of the stage's input, its
 *   index in R
 * @property {number[]} recordAt for each restoration record, the index of
 *   its synthetic token in R
 */
/**
 * What the witness test hands back to the check: the marks of W(D)'s
 * edges, for each item the indices of the edges that W(D) uses, or null
 * where the chart does not hold W(D); and a callback that receives the
 * check's ranking, with whether its count counted W(D).
 * @typedef {object} ElisionCheckWatch
 * @property {Map<import("./earley.js").Item, Set<number>> | null} marks
 * @property {(outcome: {ranking: import("./rank.js").Ranking | null, counted: boolean}) => void} ranked
 */
/** @type {{elisionCheck: ((run: ElisionCheckRun) => ElisionCheckWatch) | null}} */
export declare const hooks: {
    elisionCheck: ((run: ElisionCheckRun) => ElisionCheckWatch) | null;
};
/**
 * Whether a fault is on, at one of its sites. A fault that is on counts the
 * site as entered.
 * @param {string} name
 * @param {string} [site] the site, for a fault with several
 * @returns {boolean}
 */
export declare function fault(name: string, site?: string): boolean;
