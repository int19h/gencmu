export declare class StageCheck {
    constants: Map<string, {
        record: any;
        document: string;
    }[]>;
    /**
     * @param {Map<string, {record: any, document: string}[]>} constants
     */
    constructor(constants: Map<string, {
        record: any;
        document: string;
    }[]>);
    constantValue(name: any, version: any): {
        record: any;
        document: string;
    } | undefined;
    /** The possible types of an expression, as a set of names. */
    typeOf(node: any, ctx: any): any;
    propertyType(node: any, ctx: any): Set<any>;
    /**
     * Checks an expression in a truth position.
     * @returns {any | null} the expression, where the answer depends on the features
     */
    truth(node: any, ctx: any, document: any, what?: string): any | null;
    /**
     * Walks an expression: checks each truth position in it, and each method
     * receiver that the types decide.
     */
    walk(node: any, ctx: any, document: any, deferred: any, truthPosition?: boolean): any;
    /**
     * Checks a stage. Returns the truth positions that depend on the features.
     * @param {{rule: any, document: string}[]} rules the written rules of the stage
     */
    check(rules: {
        rule: any;
        document: string;
    }[]): {
        node: any;
        ctx: {
            captures: Map<any, any>;
            document: string;
        };
        document: string;
    }[];
    instances(rules: any, deferred: any): void;
    /**
     * The value certificate (part 2 §4): the rules whose value provably
     * equals the join of their input values. Returns each value test or
     * recognition read of a rule value that has no certificate.
     */
    certificates(rules: any): any[];
    /**
     * A read of a payload needs a payload on each route that reaches it. A
     * route of a rule without the key, or with the key bare, needs a test of
     * .has-value(k) on the same capture before the read (part 3 §3).
     */
    payloadRefinement(rules: any): any[];
    /**
     * The possible states of each key that the stage's tokens can carry
     * (part 2 §2): "absent", "bare" or "valued", for each key that a term of
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
     * (part 3 §3). .has(k) removes absence and .has-value(k) also removes the
     * bare state. A guard refines its entry, and an antecedent its
     * consequent.
     * @param {{rule: any, document: string}[]} rules
     * @param {Map<string, Set<string>>} input the states of the input keys
     */
    inputRefinement(rules: {
        rule: any;
        document: string;
    }[], input: Map<string, Set<string>>): any[];
    defaultsJoinChildren(): boolean;
    scope(term: any, rule: any, statementKinds: any, document: any, sharedTerm: any, own: any): void;
    nodeBag(term: any, document: any): void;
    constantGraph(): void;
    classifiers(rules: any): void;
    outputs(): void;
}
