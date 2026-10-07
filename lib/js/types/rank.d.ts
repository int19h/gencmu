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
    profile: RuleProfile;
    /**
     * with the witness hook's marks,
     * whether the count counted W(D); null without marks
     */
    witnessCounted: boolean | null;
};
/**
 * How two derivations other than the first reading compare as the second
 * reading (engine §6): the one that diverges earlier from the first, in
 * visible actions, comes first, and the order T decides between two that
 * diverge at one point. Negative where `left` comes first.
 * @param {Rope} first
 * @param {Rope} left
 * @param {Rope} right
 * @param {Lean} lean
 * @returns {number}
 */
export declare function secondOrder(first: Rope, left: Rope, right: Rope, lean: Lean): number;
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
    /** @type {(left: Item, right: Item) => boolean} */
    sameSpan: (left: Item, right: Item) => boolean;
    elisions: boolean;
    profiles: boolean;
    /** @type {number[] | null} */
    profileProject: number[] | null;
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
    /** @type {{plain: Map<Item, Allowed<number> & {w: boolean}>, contextual: Map<Item, Map<string, Allowed<number> & {w: boolean}>>}} */
    counts: {
        plain: Map<Item, Allowed<number> & {
            w: boolean;
        }>;
        contextual: Map<Item, Map<string, Allowed<number> & {
            w: boolean;
        }>>;
    };
    /** @type {Map<Item, RopeLeaf>} */
    closes: Map<Item, RopeLeaf>;
    /** @type {Map<string, RopeLeaf>} */
    reads: Map<string, RopeLeaf>;
    check: boolean;
    /**
     * The witness hook's marks (tests/README.md): for each item of W(D),
     * the indices of its edges that W(D) uses. With marks, the count also
     * says whether it counted a derivation made of marked edges only. A
     * parse that no test watches has none, and does the same work as
     * without them.
     * @type {Map<Item, Set<number>> | null}
     */
    marks: Map<Item, Set<number>> | null;
    /**
     * @param {Token[]} tokens
     * @param {Lean} lean
     * @param {Maximal | null} [maximal] the maximal terminators, if there are
     *   any (engine §4)
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
     * The number of an item's derivations, capped at two, over all of them
     * and over those that maximal allows. With the witness hook's marks, `w`
     * says whether the count includes a derivation made of marked edges
     * only (tests/README.md). The same loop decides both, over the same
     * edges, so any choice that drops W(D) from the count drops it from `w`.
     * A dependency that closes a cycle has no derivation, and no `w`.
     * @param {Item} item
     * @returns {Allowed<number> & {w: boolean}}
     */
    countOf(item: Item): Allowed<number> & {
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
    vector: ElisionSeq | null;
    profile: RuleProfile;
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
export type RuleProfile = [number, number, Count][];
/** @typedef {[number, number, Count][]} RuleProfile */
/**
 * Compares sparse span counts in start order and reverse end order.
 * A negative result means that the left profile wins.
 * @param {RuleProfile} left
 * @param {RuleProfile} right
 * @returns {number}
 */
export declare function compareProfiles(left: RuleProfile, right: RuleProfile): number;
/**
 * Counts every completed flagged occurrence in a chosen derivation.
 * @param {Derivation} root
 * @returns {RuleProfile}
 */
export declare function derivationProfile(root: Derivation): RuleProfile;
export {};
