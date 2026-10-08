import { Ranker } from "./rank.js";
import type { Item, Rope, Lean, Action, Token } from "./types.js";
import type { Candidate, RuleProfile, Ranking } from "./rank.js";
export type Signature = {
    profile: RuleProfile;
    occurrences: Map<string, bigint>;
    elisions: Map<number, bigint>;
    candidates: Candidate[];
    count: number;
};
export type SignatureSet = Map<string, Signature>;
export type SignatureSummary = {
    all: SignatureSet;
    allowed: SignatureSet;
};
export type Contest = {
    span: [number, number];
    higher: string;
    lower: string;
    path: string[];
    residualCounts: [string, string];
};
export type EdgeReason = {
    basis: "prefer";
    contests: Contest[];
} | {
    basis: "stage";
    directive: string;
    boundary?: number;
    counts?: [string, string];
    witness?: [Action | null, Action | null];
};
export type CycleEdge = EdgeReason & {
    from: number;
    to: number;
};
export type PreferenceConflict = {
    forward: Contest[];
    reverse: Contest[];
};
export type PreferenceRanking = Ranking & {
    cycle?: CycleEdge[];
    readings?: Rope[];
    conflict?: PreferenceConflict;
    slow?: boolean;
};
export declare class PreferenceRanker extends Ranker {
    preferences: import("./preferences.js").Preferences;
    stageLean: Lean;
    /** @type {{plain: Map<Item, SignatureSummary>, contextual: Map<Item, Map<string, SignatureSummary>>}} */
    signatureMemo: {
        plain: Map<Item, SignatureSummary>;
        contextual: Map<Item, Map<string, SignatureSummary>>;
    };
    statistics: {
        slow: boolean;
        forestItems: number;
        forestEdges: number;
        contexts: number;
        signatures: number;
        largestSet: number;
        comparisons: number;
    };
    /** @param {Token[]} tokens @param {Lean} lean @param {import("./preferences.js").Preferences} preferences @param {import("./maximal.js").Maximal | null} [maximal] @param {number[] | null} [cycleProject] */
    constructor(tokens: Token[], lean: Lean, preferences: import("./preferences.js").Preferences, maximal?: import("./maximal.js").Maximal | null, cycleProject?: number[] | null);
    /** @override @param {Item[]} roots @returns {PreferenceRanking | null} */
    rank(roots: Item[]): PreferenceRanking | null;
    /** @param {Item[]} roots @returns {PreferenceRanking | null} */
    rankComplete(roots: Item[]): PreferenceRanking | null;
    /** @param {Item[]} roots */
    possibleContest(roots: Item[]): boolean;
    /** @param {Candidate} entry @param {Rope} action @returns {Candidate} */
    extend(entry: Candidate, action: Rope): Candidate;
    /** @param {Item} item @returns {SignatureSummary} */
    signatures(item: Item): SignatureSummary;
    /** @param {SignatureSet} set @param {Signature} signature */
    storeSignature(set: SignatureSet, signature: Signature): void;
    /** @param {Signature & {canonical: Candidate}} a @param {Signature & {canonical: Candidate}} b */
    canonicalOrder(a: Signature & {
        canonical: Candidate;
    }, b: Signature & {
        canonical: Candidate;
    }): number;
    /** @param {Signature & {canonical: Candidate}} a @param {Signature & {canonical: Candidate}} b @returns {{order: number, reason?: EdgeReason}} */
    compare(a: Signature & {
        canonical: Candidate;
    }, b: Signature & {
        canonical: Candidate;
    }): {
        order: number;
        reason?: EdgeReason;
    };
}
/** @param {Map<number, bigint>} a @param {Map<number, bigint>} b @returns {{order: number, boundary?: number, counts?: [string, string]}} */
export declare function compareVectors(a: Map<number, bigint>, b: Map<number, bigint>): {
    order: number;
    boundary?: number;
    counts?: [string, string];
};
/** @param {import("./preferences.js").Preferences} preferences @param {Map<string, bigint>} a @param {Map<string, bigint>} b @returns {PreferenceConflict} */
export declare function compareOccurrences(preferences: import("./preferences.js").Preferences, a: Map<string, bigint>, b: Map<string, bigint>): PreferenceConflict;
/** @param {Map<number, EdgeReason>[]} edges @returns {number[] | null} */
export declare function directedCycle(edges: Map<number, EdgeReason>[]): number[] | null;
/** @param {Rope} rope @param {import("./preferences.js").Preferences} preferences @param {number[]} project @returns {Map<string, bigint>} */
export declare function occurrencesOfRope(rope: Rope, preferences: import("./preferences.js").Preferences, project: number[]): Map<string, bigint>;
