import type { Action, Derivation, Item, KeyStep, Lean, Production, Rope, RopeLeaf, Token } from "./types.js";
export type Candidate = {
    seq: Rope;
    alts: Rope[];
    at: Count;
};
export type Difference = {
    left: Action | null;
    right: Action | null;
    index: Count;
};
export type Count = number | bigint;
export type Ranking = {
    verdict: import("./types.js").Verdict;
    first: Rope;
    second: Rope | null;
    witness: [Action | null, Action | null] | null;
    profile: Profile;
    /**
     * with the runtime witness marks,
     * whether the count counted W(D); null without marks
     */
    witnessCounted: boolean | null;
};
/**
 * The rope of a sequence of actions, for a derivation that no ranking
 * built: the witness hook's W(D) (tests/README.md).
 * @param {Iterable<Action>} sequence
 * @returns {Rope}
 */
export declare function ropeOf(sequence: Iterable<Action>): Rope;
/**
 * @param {Action} action
 * @returns {RopeLeaf}
 */
declare function leaf(action: Action): RopeLeaf;
/**
 * @param {Rope} left
 * @param {Rope} right
 * @returns {Rope}
 */
declare function concat(left: Rope, right: Rope): Rope;
/**
 * The actions of a rope, in order.
 * @param {Rope} rope
 * @returns {Generator<Action>}
 */
declare function actions(rope: Rope): Generator<Action>;
/**
 * @param {Production} production
 * @returns {boolean}
 */
export declare function isTransparent(production: Production): boolean;
/**
 * @param {Action} action
 * @returns {boolean}
 */
declare function visible(action: Action): boolean;
/**
 * The first differing pair of two ropes' actions, visible ones only or all.
 * @param {Rope} left
 * @param {Rope} right
 * @param {boolean} onlyVisible
 * @returns {Difference | null}
 */
export declare function firstDifference(left: Rope, right: Rope, onlyVisible: boolean): Difference | null;
/**
 * @param {{left: Action, right: Action}} difference
 * @param {Lean} lean
 * @returns {number}
 */
declare function decide(difference: {
    left: Action;
    right: Action;
}, lean: Lean): number;
/**
 * @param {Rope} left
 * @param {Rope} right
 * @param {Lean} lean
 * @returns {number}
 */
export declare function totalOrder(left: Rope, right: Rope, lean: Lean): number;
export type TraversalContext = Set<string>;
export declare class Ranker {
    tokens: import("./tokens.js").Token[];
    /** @type {Profiles} */
    space: Profiles;
    /** @type {(left: Item, right: Item) => boolean} */
    sameSpan: (left: Item, right: Item) => boolean;
    profiles: boolean;
    configured: boolean;
    /** @type {Set<Production>} */ profileProductions: Set<Production>;
    /** @type {any} */ interner: any;
    /** @type {number[] | null} */
    profileProject: number[] | null;
    /** @type {Lean} */
    lean: Lean;
    /** @type {{plain: Map<Item, ElisionSummary>, contextual: Map<Item, Map<string, ElisionSummary>>}} */
    summaries: {
        plain: Map<Item, ElisionSummary>;
        contextual: Map<Item, Map<string, ElisionSummary>>;
    };
    /** @type {Map<string, number>} */
    ruleGroups: Map<string, number>;
    /** @type {(rule: string) => number | undefined} */
    groups: (rule: string) => number | undefined;
    /** @type {{plain: Map<Item, Candidate[]>, contextual: Map<Item, Map<string, Candidate[]>>}} */
    memo: {
        plain: Map<Item, Candidate[]>;
        contextual: Map<Item, Map<string, Candidate[]>>;
    };
    /** @type {{plain: Map<Item, {all: number} & {w: boolean}>, contextual: Map<Item, Map<string, {all: number} & {w: boolean}>>}} */
    counts: {
        plain: Map<Item, {
            all: number;
        } & {
            w: boolean;
        }>;
        contextual: Map<Item, Map<string, {
            all: number;
        } & {
            w: boolean;
        }>>;
    };
    /** @type {Map<Item, RopeLeaf>} */
    closes: Map<Item, RopeLeaf>;
    /** @type {Map<string, RopeLeaf>} */
    reads: Map<string, RopeLeaf>;
    check: boolean;
    /**
     * The runtime witness marks (tests/README.md): for each item of W(D),
     * the indices of its edges that W(D) uses. With marks, the count also
     * says whether it counted a derivation made of marked edges only.
     * Every elision-only check supplies these marks, including without a test hook.
     * @type {Map<Item, Set<number>> | null}
     */
    marks: Map<Item, Set<number>> | null;
    /** @type {import("./ranked-admission.js").RankedAdmission | null} */
    admission: import("./ranked-admission.js").RankedAdmission | null;
    /**
     * @param {Token[]} tokens
     * @param {KeyStep[]} steps the key steps of the directive, in order
     * @param {Lean} lean
     * @param {number[] | null} [project] positions to find cycles over in
     *   place of the items' own, which only a fault of the check of engine
     *   §7 gives (F19)
     */
    constructor(tokens: Token[], steps: KeyStep[], lean: Lean, project?: number[] | null);
    /**
     * @param {Item} item
     * @returns {Candidate[]}
     */
    candidateSummary(item: Item): Candidate[];
    /**
     * @param {Item} item
     * @returns {ElisionSummary}
     */
    profileSummary(item: Item): ElisionSummary;
    /**
     * The summaries of an item in the context that `key` names, which
     * profileSummary has already computed.
     * @param {Item} item
     * @param {string} key
     * @returns {ElisionSummary}
     */
    summaryAt(item: Item, key: string): ElisionSummary;
    /**
     * The edges of an item that attain the greatest profile in its context.
     * @param {Item} item
     * @param {string} key
     * @returns {import("./types.js").Edge[]}
     */
    keptEdges(item: Item, key: string): import("./types.js").Edge[];
    /**
     * The one leaf for closing an item: every sequence that closes it shares
     * it, rather than each making its own.
     * @param {Item} item
     * @returns {RopeLeaf}
     */
    closeLeaf(item: Item): RopeLeaf;
    /**
     * The one leaf for reading a token as a terminal.
     * @param {number} token
     * @param {string} terminal
     * @returns {RopeLeaf}
     */
    readLeaf(token: number, terminal: string): RopeLeaf;
    /**
     * An item's candidates, each ended by the item's own close.
     * @param {Item} item
     * @returns {Candidate[]}
     */
    full(item: Item): Candidate[];
    /**
     * @param {Candidate} entry
     * @param {Rope} alt
     * @param {Count} at
     * @returns {Candidate}
     */
    offer(entry: Candidate, alt: Rope, at: Count): Candidate;
    /**
     * @param {Candidate[]} kept
     * @param {Candidate} entry
     * @returns {Candidate[]}
     */
    keep(kept: Candidate[], entry: Candidate): Candidate[];
    /**
     * The number of derivations, capped at two.
     * @param {Item} item
     * @returns {number}
     */
    count(item: Item): number;
    /**
     * The number of an item's derivations, capped at two. With the runtime witness marks, `w`
     * says whether the count includes a derivation made of marked edges
     * only (tests/README.md). The same loop decides both, over the same
     * edges, so any choice that drops W(D) from the count drops it from `w`.
     * A dependency that closes a cycle has no derivation, and no `w`.
     * @param {Item} item
     * @returns {{all: number} & {w: boolean}}
     */
    countOf(item: Item): {
        all: number;
    } & {
        w: boolean;
    };
    /**
     * @template T
     * @param {Item} root
     * @param {{plain: Map<Item, T>, contextual: Map<Item, Map<string, T>>}} memo
     * @param {(item: Item, dependency: (item: Item) => T, key: string) => T} combine
     *   `key` names the item's context
     * @param {T} cut the value of a dependency that would close a cycle
     * @param {((item: Item, key: string) => import("./types.js").Edge[]) | null} [edgesOf]
     *   the edges whose children `combine` reads, if not all
     * @returns {T}
     */
    traverse<T>(root: Item, memo: {
        plain: Map<Item, T>;
        contextual: Map<Item, Map<string, T>>;
    }, combine: (item: Item, dependency: (item: Item) => T, key: string) => T, cut: T, edgesOf?: ((item: Item, key: string) => import("./types.js").Edge[]) | null): T;
    /**
     * @param {Item[]} roots
     */
    groupRules(roots: Item[]): void;
    /**
     * @param {Item[]} roots
     * @returns {Ranking | null} null when every derivation is cyclic
     */
    rank(roots: Item[]): Ranking | null;
}
/**
 * @param {Rope} rope
 * @returns {Derivation}
 */
export declare function derivationTree(rope: Rope): Derivation;
export type ElisionSeq = ElisionNode | {
    size: 0;
};
export type ElisionNode = {
    size: Count;
    first: number;
    last: number;
    left?: ElisionSeq;
    right?: ElisionSeq;
};
export type ElisionSummary = {
    /**
     * null when there is no derivation
     */
    profile: Profile | null;
    least: number;
    total: number;
    kept: Set<number>;
};
/**
 * @param {ElisionSeq} left
 * @param {ElisionSeq} right
 * @returns {ElisionSeq}
 */
declare function concatElisions(left: ElisionSeq, right: ElisionSeq): ElisionSeq;
/**
 * @param {ElisionSeq} left
 * @param {ElisionSeq} right
 * @returns {number}
 */
export declare function compareElisions(left: ElisionSeq, right: ElisionSeq): number;
export type ElisionCursor = {
    stack: ElisionSeq[];
    taken: Count;
};
export declare const internals: {
    actions: typeof actions;
    firstDifference: typeof firstDifference;
    totalOrder: typeof totalOrder;
    decide: typeof decide;
    visible: typeof visible;
    concat: typeof concat;
    leaf: typeof leaf;
    concatElisions: typeof concatElisions;
};
export type SpanVector = [number, number, Count][];
export type Component = SpanVector | Count | ElisionSeq;
export type Profile = Component[];
/** @typedef {[number, number, Count][]} SpanVector */
/**
 * One component of a profile: the counts of one key step's pattern over
 * the spans, the sum of the counts, or the sequence of the starting
 * positions (engine §6).
 * @typedef {SpanVector | Count | ElisionSeq} Component
 */
/**
 * A derivation's counts of every pattern that a key step tests, one
 * component per key step, in the order of the steps (engine §6).
 * @typedef {Component[]} Profile
 */
/**
 * The profiles of one ranking: how the key steps of its directive count
 * occurrences, add profiles and compare them (engine §6).
 */
export declare class Profiles {
    steps: KeyStep[];
    /** @type {any} */ tokens: any;
    /** @type {any} */ interner: any;
    /** @type {Map<string,boolean>} */ matches: Map<string, boolean>;
    /** @type {WeakMap<object,number>} */ tagIds: WeakMap<object, number>;
    nextTag: number;
    valueTests: boolean[];
    /** @type {Map<string,number>} */ tagKeys: Map<string, number>;
    /** @type {Profile} */
    zero: Profile;
    /** @type {Map<number, ElisionSeq>} */
    leaves: Map<number, ElisionSeq>;
    /** @param {KeyStep[]} steps */
    constructor(steps: KeyStep[]);
    /** @param {any} node @returns {boolean} */
    possible(node: any): boolean;
    /** @param {any} node @param {number} p @param {number} q @returns {Profile} */
    occurrence(node: any, p: number, q: number): Profile;
    /**
     * One occurrence in the component of a step. An empty span counts
     * nothing under `leftmost-longest`.
     * @param {number} index
     * @param {number} p
     * @param {number} q
     * @returns {Component}
     */
    one(index: number, p: number, q: number): Component;
    /**
     * The one sequence of a single occurrence at a position.
     * @param {number} at
     * @returns {ElisionSeq}
     */
    leaf(at: number): ElisionSeq;
    /**
     * Adds profiles component by component. The positions of `left` precede
     * those of `right`.
     * @param {Profile} left
     * @param {Profile} right
     * @returns {Profile}
     */
    sum(left: Profile, right: Profile): Profile;
    /**
     * Compares two profiles step by step. A negative result means that the
     * left profile is the greater, so the left derivation wins (engine §6).
     * @param {Profile} left
     * @param {Profile} right
     * @returns {number}
     */
    compare(left: Profile, right: Profile): number;
    /**
     * Counts every completed nonempty occurrence in a chosen derivation,
     * and no elision (engine §7).
     * @param {Derivation} root
     * @param {any} [tokens]
     * @returns {Profile}
     */
    derivationProfile(root: Derivation, tokens?: any): Profile;
}
export {};
