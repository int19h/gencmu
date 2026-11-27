export declare class StageCheck {
    /** @type {Map<string, any[]>} */
    constants: Map<string, any[]>;
    /** @type {Map<string, RuleBag>} the bag type of each rule of the stage */
    bags: Map<string, RuleBag>;
    /**
     * @param {Map<string, {record: any, document: string}[]>} constants
     */
    constructor(constants: Map<string, {
        record: any;
        document: string;
    }[]>);
    /**
     * @param {any} name
     * @param {any} [version]
     */
    constantValue(name: any, version?: any): any;
    /**
     * The possible types of an expression, as a set of names.
     * @param {any} node
     * @param {any} ctx
     * @returns {any}
     */
    typeOf(node: any, ctx: any): any;
    /**
     * @param {any} node
     * @param {any} ctx
     */
    propertyType(node: any, ctx: any): Set<any>;
    /**
     * The bag type of each rule of the stage (engine §10): for each key, the
     * states "absent" and "bare" that it can have, and the types of its
     * payloads. In an open bag, a key that is not listed can have any payload.
     * The sources apply in order: the defaults, the primary or the sole
     * symbol, the statement term and the alternative term. The type is a
     * union over the alternatives of every written definition, so it
     * over-approximates. A template, an instance binding, a call and a
     * terminal give an open bag.
     * @param {{rule: any}[]} rules
     */
    ruleBags(rules: {
        rule: any;
    }[]): Map<string, RuleBag>;
    /**
     * The bag type of one alternative of a rule.
     * @param {any} rule
     * @param {any} alternative
     * @param {any[] | null} defaultEntries
     * @returns {RuleBag}
     */
    alternativeBag(rule: any, alternative: any, defaultEntries: any[] | null): RuleBag;
    /**
     * The bag type of a symbol of a body.
     * @param {any} symbol
     * @returns {RuleBag}
     */
    symbolBag(symbol: any): RuleBag;
    /**
     * Applies a later source to a bag type: each key that the source can
     * hold replaces the earlier states, and an absent state keeps them.
     * @param {RuleBag} bag
     * @param {RuleBag} source
     */
    overlay(bag: RuleBag, source: RuleBag): void;
    /**
     * Applies one entry of a constructor to a bag type, in written order. A
     * guard or a gate keeps the earlier states beside the new ones.
     * @param {RuleBag} bag
     * @param {any} entry
     * @param {any} ctx
     */
    applyEntry(bag: RuleBag, entry: any, ctx: any): void;
    /**
     * The union of bag types, for a node that one of several symbols gives.
     * @param {RuleBag[]} sources
     * @returns {RuleBag}
     */
    unionBag(sources: RuleBag[]): RuleBag;
    /**
     * The bag type of an expression that a copy or a splat reads.
     * @param {any} node
     * @param {any} ctx
     * @returns {RuleBag}
     */
    valueBag(node: any, ctx: any): RuleBag;
    /**
     * Checks an expression in a truth position.
     * @returns {any | null} the expression, where the answer depends on the features
     * @param {any} node
     * @param {any} ctx
     * @param {any} document
     */
    truth(node: any, ctx: any, document: any, what?: string): any | null;
    /**
     * Walks an expression: checks each truth position in it, and each method
     * receiver that the types decide.
     * @param {any} node
     * @param {any} ctx
     * @param {any} document
     * @param {any} deferred
     * @returns {any}
     */
    walk(node: any, ctx: any, document: any, deferred: any, truthPosition?: boolean): any;
    /**
     * Checks a stage. Returns the truth positions that depend on the features.
     * @param {{rule: any, document: string}[]} rules the written rules of the stage
     */
    check(rules: {
        rule: any;
        document: string;
    }[]): any[];
    /**
     * @param {any} rules
     * @param {any} deferred
     * @returns {any}
     */
    instances(rules: any, deferred: any): any;
    /**
     * The value certificate (docs/engine.md, "Proof for a rule value"): the rules whose value provably
     * equals the join of their input values. Returns each value test or
     * recognition read of a rule value that has no certificate.
     * @param {any} rules
     * @returns {any}
     */
    certificates(rules: any, readers?: Set<any>, valueReads?: any[]): any;
    /**
     * A read of a payload needs a payload on each route that reaches it. A
     * route of a rule without the key, or with the key bare, needs a test of
     * .has-value(k) on the same capture before the read (engine §10).
     * @param {any} rules
     */
    payloadRefinement(rules: any): any[];
    /**
     * The possible states of each key that the stage's tokens can carry
     * (docs/notation.md, "Stage interfaces"): "absent", "bare" or "valued", for each key that a term of
     * the stage writes, and the input states of each key that a copy of an
     * input bag passes on. The states are a union over all writers, so they
     * over-approximate the interface.
     * @param {{rule: any}[]} rules
     * @param {Map<string, Set<string>> | null} input the states of the input keys
     */
    outputStates(rules: {
        rule: any;
    }[], input: Map<string, Set<string>> | null): Map<any, any>;
    /**
     * A read of the payload of an input token needs a payload on each route
     * (engine §10). .has(k) removes absence and .has-value(k) also removes the
     * bare state. A guard refines its entry, and an antecedent its
     * consequent.
     * @param {{rule: any, document: string}[]} rules
     * @param {Map<string, Set<string>>} input the states of the input keys
     */
    inputRefinement(rules: {
        rule: any;
        document: string;
    }[], input: Map<string, Set<string>>): any[];
    /**
     * Refuses a condition that reads a key, other than value and image, that
     * the stage defaults can write. Recognition reads the tags of a node from
     * its primary, its sole symbol and its terms, not from the defaults. The
     * loader refuses the other recognition reads of such a key, a body filter
     * on a rule and a read of a compound binding (docs/notation.md, "Rule
     * bags").
     * @param {{rule: any, document: string}[]} rules
     */
    defaultKeyReads(rules: {
        rule: any;
        document: string;
    }[]): void;
    /**
     * The keys other than value and image that the stage defaults can write,
     * and whether a splat of the defaults can write any key, or null where
     * they write none.
     * @returns {{written: Set<string>, open: boolean} | null}
     */
    defaultsWrites(): {
        written: Set<string>;
        open: boolean;
    } | null;
    /**
     * Whether the stage defaults give each node the join of the values of
     * its input tokens, as `value: $n.span.tokens!'value.join()`.
     */
    defaultsJoinInput(): boolean;
    defaultsJoinChildren(): boolean;
    /**
     * @param {any} term
     * @param {any} rule
     * @param {any} statementKinds
     * @param {any} document
     * @param {any} sharedTerm
     * @param {any} [own]
     */
    scope(term: any, rule: any, statementKinds: any, document: any, sharedTerm: any, own?: any): void;
    /**
     * @param {any} term
     * @param {any} document
     */
    nodeBag(term: any, document: any): void;
    /**
     * Refuses a constructor that stores an engine membership from permission
     * alone. A stored engine membership needs evidence from a node. Neither
     * $INPUTS nor a constant that names an engine key gives it, also through
     * an alias, a version, a function, a selection, a copy or a splat. A mask
     * can still name an engine key for the selection of a node.
     * @param {any} term a bag constructor
     * @param {any} document
     * @param {any} [at] the place to report instead of the entry
     */
    provenance(term: any, document: any, at?: any): void;
    /**
     * Whether a value can carry an engine membership that no node gives: the
     * permission set $INPUTS, or a value that names an engine key. A value is
     * safe in two ways only. A node gives its keys, as a capture, the item of
     * a predicate, and the key sets and selections of these. Or the value
     * provably holds no engine key: strings, numbers, and bags, lists and key
     * sets whose written keys are ordinary. Every other form counts as
     * permission, so a new form is refused until it is proven safe.
     * @param {any} node
     * @param {Set<any>} [active] the constant versions being followed
     * @returns {boolean}
     */
    fromPermission(node: any, active?: Set<any>): boolean;
    constantGraph(): void;
    /** @param {any} rules */
    classifiers(rules: any): void;
    outputs(): void;
}
export type RuleBag = {
    keys: Map<string, Set<string>>;
    open: boolean;
};
/**
 * The covers of one emission list read disjoint input, in input order
 * (docs/notation.md, "Emission"): the loader checks this for the items
 * with no guard and no gate. On each alternative, it rejects two covers
 * that can consume the same input and a pair of consuming covers that
 * stand in the reverse order of their parts in the body. A whole-node item
 * covers every part. Possible consumption ignores tests and conditions,
 * and a forward covers what the part can hand on. The error stands at the
 * second item of the first conflicting pair, in written order. It runs
 * after stitching and after the check of nullable error productions.
 * @param {{rule: any, document: string}[]} rules
 */
export declare function emissionCovers(rules: {
    rule: any;
    document: string;
}[]): void;
