import type { Action, Derivation, Item, Lean, Production, Rope, RopeLeaf, Token } from "./types.js";
import type { Maximal } from "./maximal.js";
export type Allowed<T> = {
    all: T;
    allowed: T;
};
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
};
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
declare function firstDifference(left: Rope, right: Rope, onlyVisible: boolean): Difference | null;
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
declare function totalOrder(left: Rope, right: Rope, lean: Lean): number;
export type TraversalContext = Set<string>;
export declare class Ranker {
    tokens: import("./tokens.js").Token[];
    /** @type {(left: Item, right: Item) => boolean} */
    sameSpan: (left: Item, right: Item) => boolean;
    elisions: boolean;
    /** @type {Lean} */
    lean: Lean;
    maximal: Maximal | null;
    /** @type {{plain: Map<Item, Allowed<ElisionSummary>>, contextual: Map<Item, Map<string, Allowed<ElisionSummary>>>}} */
    summaries: {
        plain: Map<Item, Allowed<ElisionSummary>>;
        contextual: Map<Item, Map<string, Allowed<ElisionSummary>>>;
    };
    /** @type {Map<number, ElisionSeq>} */
    elisionLeaves: Map<number, ElisionSeq>;
    /** @type {Map<string, number>} */
    ruleGroups: Map<string, number>;
    /** @type {(rule: string) => number | undefined} */
    groups: (rule: string) => number | undefined;
    /** @type {{plain: Map<Item, Allowed<Candidate[]>>, contextual: Map<Item, Map<string, Allowed<Candidate[]>>>}} */
    memo: {
        plain: Map<Item, Allowed<Candidate[]>>;
        contextual: Map<Item, Map<string, Allowed<Candidate[]>>>;
    };
    /** @type {{plain: Map<Item, Allowed<number>>, contextual: Map<Item, Map<string, Allowed<number>>>}} */
    counts: {
        plain: Map<Item, Allowed<number>>;
        contextual: Map<Item, Map<string, Allowed<number>>>;
    };
    /** @type {Map<Item, RopeLeaf>} */
    closes: Map<Item, RopeLeaf>;
    /** @type {Map<string, RopeLeaf>} */
    reads: Map<string, RopeLeaf>;
    /**
     * @param {Token[]} tokens
     * @param {Lean} lean
     * @param {Maximal | null} [maximal] the resolution's maximal, if it has
     *   it (engine §4)
     * @param {number[] | null} [project] positions to find cycles over in
     *   place of the items' own, which only a fault of the check of engine
     *   §7 gives (F19)
     */
    constructor(tokens: Token[], lean: Lean, maximal?: Maximal | null, project?: number[] | null);
    /**
     * @param {Item} item
     * @returns {Candidate[]}
     */
    candidates(item: Item): Candidate[];
    /**
     * @param {Item} item
     * @returns {Allowed<Candidate[]>}
     */
    allowedCandidates(item: Item): Allowed<Candidate[]>;
    /**
     * @param {Item} item
     * @returns {Allowed<ElisionSummary>}
     */
    elisionSummary(item: Item): Allowed<ElisionSummary>;
    /**
     * The summaries of an item in the context that `key` names, which
     * elisionSummary has already computed.
     * @param {Item} item
     * @param {string} key
     * @returns {Allowed<ElisionSummary>}
     */
    summaryAt(item: Item, key: string): Allowed<ElisionSummary>;
    /**
     * The edges of an item that attain a least vector in its context.
     * @param {Item} item
     * @param {string} key
     * @returns {import("./types.js").Edge[]}
     */
    keptEdges(item: Item, key: string): import("./types.js").Edge[];
    /**
     * The one sequence of a single elision at a position.
     * @param {number} at
     * @returns {ElisionSeq}
     */
    elisionLeaf(at: number): ElisionSeq;
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
     * @param {Item[]} [groupsOf] the roots whose forest gives the rules'
     *   groups, and so the contexts of cycles: by default `roots`. The witness
     *   hook of the check ranks a part of a forest in the contexts of the
     *   whole.
     * @returns {Ranking | null} null when every derivation is cyclic
     */
    rank(roots: Item[], groupsOf?: Item[]): Ranking | null;
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
    vector: ElisionSeq | null;
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
export {};
