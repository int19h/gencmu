export type SlotCandidate = {
    item: import("./types.js").Item;
    index: number;
    edge: Extract<import("./types.js").Edge, {
        kind: "complete";
    }>;
    label: string;
};
export type AdmissionMask = {
    all: Set<number>;
    allowed: Set<number>;
};
/** @typedef {{item: import("./types.js").Item, index: number, edge: Extract<import("./types.js").Edge, {kind:"complete"}>, label: string}} SlotCandidate */
/** @typedef {{all: Set<number>, allowed: Set<number>}} AdmissionMask */
export declare class SlotAdmission {
    preferences: import("./preferences.js").Preferences;
    maximal: import("./maximal.js").Maximal | null;
    /** @type {Map<string,SlotCandidate[]>} */
    groups: Map<string, SlotCandidate[]>;
    /** @type {Map<import("./types.js").Item,Map<number,SlotCandidate[]>>} */
    at: Map<import("./types.js").Item, Map<number, SlotCandidate[]>>;
    /** @type {{plain: Map<import("./types.js").Item,AdmissionMask>, contextual: Map<import("./types.js").Item,Map<string,AdmissionMask>>}} */
    masks: {
        plain: Map<import("./types.js").Item, AdmissionMask>;
        contextual: Map<import("./types.js").Item, Map<string, AdmissionMask>>;
    };
    /** @type {Map<SlotCandidate[], Map<string, {all:Set<string>, allowed:Set<string>}>>} */
    maxima: Map<SlotCandidate[], Map<string, {
        all: Set<string>;
        allowed: Set<string>;
    }>>;
    stats: {
        chartFacts: number;
        groups: number;
        candidateEdges: number;
        retainedEdges: number;
    };
    /** @param {import("./earley.js").Chart} chart @param {import("./preferences.js").Preferences} preferences @param {import("./maximal.js").Maximal | null} maximal */
    constructor(chart: import("./earley.js").Chart, preferences: import("./preferences.js").Preferences, maximal: import("./maximal.js").Maximal | null);
    /** @param {import("./types.js").Item} item @param {string} context */
    availabilityKey(item: import("./types.js").Item, context: string): string;
    /** @param {import("./types.js").Item} item @param {string} context */
    dependencies(item: import("./types.js").Item, context: string): {
        kind: "complete";
        previous: import("./types.js").Item;
        child: import("./types.js").Item;
    }[];
    /** @param {import("./types.js").Item} item @param {(item: import("./types.js").Item) => {all:number,allowed:number}} dependency @param {string} context */
    compute(item: import("./types.js").Item, dependency: (item: import("./types.js").Item) => {
        all: number;
        allowed: number;
    }, context: string): {
        all: Set<any>;
        allowed: Set<any>;
    } | null;
    /** @param {import("./types.js").Item} item @param {string} context */
    mask(item: import("./types.js").Item, context: string): AdmissionMask | null;
}
