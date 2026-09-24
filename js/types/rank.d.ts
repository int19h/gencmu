import type { Action, Derivation, Item, Lean, Production, Rope, RopeLeaf, Token } from "./types.js";
export type Candidate = {
    seq: Rope;
    alts: Rope[];
    at: number;
};
export type Difference = {
    left: Action | null;
    right: Action | null;
    index: number;
};
export type Ranking = {
    verdict: import("./types.js").Verdict;
    chosen: Rope;
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
export type TraversalContext = Set<Item | string>;
export declare class Ranker {
    tokens: import("./tokens.js").Token[];
    lean: Lean;
    /** @type {Map<Item, Map<string, Candidate[]>>} */
    memo: Map<Item, Map<string, Candidate[]>>;
    /** @type {Map<Item, Map<string, number>>} */
    counts: Map<Item, Map<string, number>>;
    /** @type {Map<Item, number>} */
    itemIds: Map<Item, number>;
    /**
     * @param {Token[]} tokens
     * @param {Lean} lean
     */
    constructor(tokens: Token[], lean: Lean);
    /**
     * @param {Item} item
     * @returns {Candidate[]}
     */
    candidates(item: Item): Candidate[];
    /**
     * @param {Item} item
     * @returns {Candidate[]}
     */
    full(item: Item): Candidate[];
    /**
     * @param {Candidate} entry
     * @param {Rope} alt
     * @param {number} at
     * @returns {Candidate}
     */
    offer(entry: Candidate, alt: Rope, at: number): Candidate;
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
     * @param {Map<Item, Map<string, T>>} memo
     * @param {(item: Item, dependency: (item: Item) => T) => T} combine
     * @param {T} cut the value of a dependency that would close a cycle
     * @returns {T}
     */
    traverse<T>(root: Item, memo: Map<Item, Map<string, T>>, combine: (item: Item, dependency: (item: Item) => T) => T, cut: T): T;
    /**
     * @param {Item[]} roots
     * @returns {Ranking}
     */
    rank(roots: Item[]): Ranking;
}
/**
 * @param {Rope} rope
 * @returns {Derivation}
 */
export declare function derivationTree(rope: Rope): Derivation;
export declare const internals: {
    actions: typeof actions;
    firstDifference: typeof firstDifference;
    totalOrder: typeof totalOrder;
    decide: typeof decide;
    visible: typeof visible;
    concat: typeof concat;
    leaf: typeof leaf;
};
export {};
