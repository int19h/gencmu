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
export type WorkCounts = {
    /**
     * the items that the recognizer made
     */
    items: number;
    /**
     * the checks of maximality in nested queries
     */
    checks: number;
    /**
     * the items of the chart that those checks
     * read to find their table of completions
     */
    scanned: number;
    /**
     * the completions that those checks read for
     * a tested symbol
     */
    candidates: number;
    /**
     * the most of each
     * count that the work may reach
     */
    budget?: Partial<Record<WorkKind, number>>;
};
export type WorkKind = "items" | "checks" | "scanned" | "candidates";
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
/**
 * The counts of `hooks.work`.
 * @typedef {object} WorkCounts
 * @property {number} items the items that the recognizer made
 * @property {number} checks the checks of maximality in nested queries
 * @property {number} scanned the items of the chart that those checks
 *   read to find their table of completions
 * @property {number} candidates the completions that those checks read for
 *   a tested symbol
 * @property {Partial<Record<WorkKind, number>>} [budget] the most of each
 *   count that the work may reach
 */
/** @typedef {"items" | "checks" | "scanned" | "candidates"} WorkKind */
/**
 * A count of `hooks.work` past its budget. It is no GencmuError, so no
 * handler of the library's catches it.
 */
export declare class WorkBudget extends Error {
}
/**
 * Counts one of `work`, and throws a WorkBudget if that passes its budget.
 * @param {WorkCounts} work
 * @param {WorkKind} kind
 */
export declare function countWork(work: WorkCounts, kind: WorkKind): void;
/** @type {{elisionCheck: ((run: ElisionCheckRun) => ElisionCheckWatch) | null, work: WorkCounts | null}} */
export declare const hooks: {
    elisionCheck: ((run: ElisionCheckRun) => ElisionCheckWatch) | null;
    work: WorkCounts | null;
};
/**
 * Whether a fault is on, at one of its sites. A fault that is on counts the
 * site as entered.
 * @param {string} name
 * @param {string} [site] the site, for a fault with several
 * @returns {boolean}
 */
export declare function fault(name: string, site?: string): boolean;
