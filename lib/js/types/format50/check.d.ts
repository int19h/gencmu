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
    scope(term: any, rule: any, statementKinds: any, document: any, sharedTerm: any, own: any): void;
    nodeBag(term: any, document: any): void;
    constantGraph(): void;
    classifiers(rules: any): void;
    outputs(): void;
}
