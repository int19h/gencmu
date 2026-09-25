import type { Action, Derivation, Item, Lean, Production, Rope, RopeLeaf, Token } from "./types.js";
import type { Maximal } from "./maximal.js";
export type Allowed<T> = {
    all: T;
    allowed: T;
};
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
    maximal: Maximal | null;
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
    /** @type {Map<Item, number>} */
    itemIds: Map<Item, number>;
    /** @type {Map<Item, RopeLeaf>} */
    closes: Map<Item, RopeLeaf>;
    /** @type {Map<string, RopeLeaf>} */
    reads: Map<string, RopeLeaf>;
    /**
     * @param {Token[]} tokens
     * @param {Lean} lean
     * @param {Maximal | null} [maximal] the resolution's maximal, if it has
     *   it (engine §4)
     */
    constructor(tokens: Token[], lean: Lean, maximal?: Maximal | null);
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
     * @param {boolean} weak
     * @returns {RopeLeaf}
     */
    readLeaf(token: number, terminal: string, weak: boolean): RopeLeaf;
    /**
     * An item's candidates, each ended by the item's own close.
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
     * @param {{plain: Map<Item, T>, contextual: Map<Item, Map<string, T>>}} memo
     * @param {(item: Item, dependency: (item: Item) => T) => T} combine
     * @param {T} cut the value of a dependency that would close a cycle
     * @returns {T}
     */
    traverse<T>(root: Item, memo: {
        plain: Map<Item, T>;
        contextual: Map<Item, Map<string, T>>;
    }, combine: (item: Item, dependency: (item: Item) => T) => T, cut: T): T;
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
