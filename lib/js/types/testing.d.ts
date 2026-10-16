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
     * distinct family summaries taken by items
     */
    familySummaries: number;
    /**
     * deletion automaton transitions and relation rows
     */
    familySteps: number;
    /**
     * shared close and cycle summaries interned
     */
    closeStates: number;
    /**
     * shared close sequence links interned
     */
    closeSequences: number;
    /**
     * finite structural states interned
     */
    structuralStates: number;
    /**
     * structural transitions computed
     */
    structuralTransitions: number;
    /**
     * distinct packed forest edges
     */
    packedEdges: number;
    /**
     * summary results stored per traversal
     */
    summaryContexts: number;
    /**
     * distinct boundary records used in recognitions
     */
    boundaryRecords: number;
    /**
     * the items that the recognizer made
     */
    items: number;
    /**
     * the captured parts that the recognizer made
     */
    captures: number;
    /**
     * the steps that find a captured part from
     * the last one, or that list every part at once
     */
    captureSteps: number;
    /**
     * the entries of a production's captures
     * that an advance or a formatter reads to find the capture at a position
     */
    captureLookups: number;
    /**
     * the ways of building an item that the
     * recognizer compares with a new way, to find it already there, or that
     * it indexes for that
     */
    edgeChecks: number;
    /**
     * the conditions that an advance reads to
     * find those ready at its dot
     */
    conditions: number;
    /**
     * the nodes of conditions and terms that an
     * evaluation visits, each counted before it is evaluated, also where the
     * evaluation halts for a nested parse
     */
    visits: number;
    /**
     * the tokens that a value test or value()
     * visits
     */
    valueSteps: number;
    /**
     * the tags that a union of tag sets or an entry of
     * a classifier adds to a set or copies, and those that an intersection,
     * a difference, a comparison or a test of tag sets reads
     */
    tags: number;
    /**
     * the implications, and their tags and
     * the token's, that the closure of a token's tags reads
     */
    implications: number;
    /**
     * the steps of the readers and walks of a
     * document, of its notation's tree and of its DOM, in the library and in
     * the tools
     */
    walkSteps: number;
    /**
     * the symbols and captures that lowering and
     * the checks of a definition add to a sequence or copy, the helpers
     * that lowering moves on its list of those waiting, and the positions,
     * captures and conditions of a production that it indexes
     */
    lowering: number;
    /**
     * the productions, alternatives and symbols
     * that the closures over a grammar's rules read: the nullable rules, the
     * rules that can read, and those that can emit
     */
    closures: number;
    /**
     * the items of an emission and the alternatives
     * of a rule that the checks of a definition and the audit read, and the
     * nodes of the expressions that the audit walks
     */
    clauses: number;
    /**
     * the items, edges, rules and arcs that the
     * grouping of rules for the cycle context of a ranking reads
     */
    groups: number;
    /**
     * the steps, edges, dependencies and rules
     * of a context that a traversal of a forest for a ranking reads
     */
    traversal: number;
    /**
     * the names, stages and documents that a splice
     * of a pipeline checks or copies
     */
    splice: number;
    /**
     * the characters, words, lines and cells that the
     * formatters of diagnostics and the tools' scans of a text read
     */
    text: number;
    /**
     * the most of each
     * count that the work may reach
     */
    budget?: Partial<Record<WorkKind, number>>;
};
export type WorkKind = "boundaryRecords" | "familySummaries" | "familySteps" | "closeStates" | "closeSequences" | "structuralStates" | "structuralTransitions" | "packedEdges" | "summaryContexts" | "items" | "captures" | "captureSteps" | "captureLookups" | "edgeChecks" | "conditions" | "visits" | "valueSteps" | "tags" | "implications" | "walkSteps" | "lowering" | "closures" | "clauses" | "groups" | "traversal" | "splice" | "text";
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
 * @property {number} familySummaries distinct family summaries taken by items
 * @property {number} familySteps deletion automaton transitions and relation rows
 * @property {number} closeStates shared close and cycle summaries interned
 * @property {number} closeSequences shared close sequence links interned
 * @property {number} structuralStates finite structural states interned
 * @property {number} structuralTransitions structural transitions computed
 * @property {number} packedEdges distinct packed forest edges
 * @property {number} summaryContexts summary results stored per traversal
 * @property {number} boundaryRecords distinct boundary records used in recognitions
 * @property {number} items the items that the recognizer made
 * @property {number} captures the captured parts that the recognizer made
 * @property {number} captureSteps the steps that find a captured part from
 *   the last one, or that list every part at once
 * @property {number} captureLookups the entries of a production's captures
 *   that an advance or a formatter reads to find the capture at a position
 * @property {number} edgeChecks the ways of building an item that the
 *   recognizer compares with a new way, to find it already there, or that
 *   it indexes for that
 * @property {number} conditions the conditions that an advance reads to
 *   find those ready at its dot
 * @property {number} visits the nodes of conditions and terms that an
 *   evaluation visits, each counted before it is evaluated, also where the
 *   evaluation halts for a nested parse
 * @property {number} valueSteps the tokens that a value test or value()
 *   visits
 * @property {number} tags the tags that a union of tag sets or an entry of
 *   a classifier adds to a set or copies, and those that an intersection,
 *   a difference, a comparison or a test of tag sets reads
 * @property {number} implications the implications, and their tags and
 *   the token's, that the closure of a token's tags reads
 * @property {number} walkSteps the steps of the readers and walks of a
 *   document, of its notation's tree and of its DOM, in the library and in
 *   the tools
 * @property {number} lowering the symbols and captures that lowering and
 *   the checks of a definition add to a sequence or copy, the helpers
 *   that lowering moves on its list of those waiting, and the positions,
 *   captures and conditions of a production that it indexes
 * @property {number} closures the productions, alternatives and symbols
 *   that the closures over a grammar's rules read: the nullable rules, the
 *   rules that can read, and those that can emit
 * @property {number} clauses the items of an emission and the alternatives
 *   of a rule that the checks of a definition and the audit read, and the
 *   nodes of the expressions that the audit walks
 * @property {number} groups the items, edges, rules and arcs that the
 *   grouping of rules for the cycle context of a ranking reads
 * @property {number} traversal the steps, edges, dependencies and rules
 *   of a context that a traversal of a forest for a ranking reads
 * @property {number} splice the names, stages and documents that a splice
 *   of a pipeline checks or copies
 * @property {number} text the characters, words, lines and cells that the
 *   formatters of diagnostics and the tools' scans of a text read
 * @property {Partial<Record<WorkKind, number>>} [budget] the most of each
 *   count that the work may reach
 */
/** @typedef {"boundaryRecords" | "familySummaries" | "familySteps" | "closeStates" | "closeSequences" | "structuralStates" | "structuralTransitions" | "packedEdges" | "summaryContexts" | "items" | "captures" | "captureSteps" | "captureLookups" | "edgeChecks" | "conditions" | "visits" | "valueSteps" | "tags" | "implications" | "walkSteps" | "lowering" | "closures" | "clauses" | "groups" | "traversal" | "splice" | "text"} WorkKind */
/** @type {readonly WorkKind[]} */
export declare const WORK_KINDS: readonly WorkKind[];
/**
 * Counts of every kind at zero, for a test to set as `hooks.work`.
 * @param {Partial<Record<WorkKind, number>>} [budget]
 * @returns {WorkCounts}
 */
export declare function newWork(budget?: Partial<Record<WorkKind, number>>): WorkCounts;
/**
 * A count of `hooks.work` past its budget. It is no GencmuError, so no
 * handler of the library's catches it.
 */
export declare class WorkBudget extends Error {
}
/**
 * Counts one or more of `work`, and throws a WorkBudget if that passes its
 * budget.
 * @param {WorkCounts} work
 * @param {WorkKind} kind
 * @param {number} [steps]
 */
export declare function countWork(work: WorkCounts, kind: WorkKind, steps?: number): void;
/** @type {{boundaryAdmission:((splits:any[],chart:any)=>void)|null, familyAlignment: ((summary:boolean, direct:boolean) => void)|null, elisionCheck: ((run: ElisionCheckRun) => ElisionCheckWatch) | null, work: WorkCounts | null, slotAdmission: ((statistics: {chartFacts:number,groups:number,candidateEdges:number,retainedEdges:number,boundarySplits?:any[]}) => void) | null}} */
export declare const hooks: {
    boundaryAdmission: ((splits: any[], chart: any) => void) | null;
    familyAlignment: ((summary: boolean, direct: boolean) => void) | null;
    elisionCheck: ((run: ElisionCheckRun) => ElisionCheckWatch) | null;
    work: WorkCounts | null;
    slotAdmission: ((statistics: {
        chartFacts: number;
        groups: number;
        candidateEdges: number;
        retainedEdges: number;
        boundarySplits?: any[];
    }) => void) | null;
};
/**
 * Whether a fault is on, at one of its sites. A fault that is on counts the
 * site as entered.
 * @param {string} name
 * @param {string} [site] the site, for a fault with several
 * @returns {boolean}
 */
export declare function fault(name: string, site?: string): boolean;
