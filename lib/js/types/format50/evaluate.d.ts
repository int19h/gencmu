import { GencmuError } from "../errors.js";
import { Bag } from "./bag.js";
/** A function value: one parameter and a body, closed over its scope. */
export declare class Fn {
    param: any;
    body: any;
    scope: any;
    constructor(param: any, body: any, scope: any);
}
/**
 * The forest of a query after the choice of a parse. The stage answers its
 * tests on the chosen derivation through the recognizer's evaluator.
 */
export declare class Forest {
    node: any;
    scope: any;
    /**
     * @param {any} node the query record
     * @param {any} scope the scope of its evaluation
     */
    constructor(node: any, scope: any);
}
/** A half-open window on the input of a stage. */
export declare class Span {
    stage: StageData;
    start: number;
    end: number;
    /**
     * @param {StageData} stage
     * @param {number} start
     * @param {number} end
     */
    constructor(stage: StageData, start: number, end: number);
}
export type StageData = {
    /**
     * the input tokens of the stage, as format 50 tokens
     */
    tokens: any[];
    /**
     * the original text as code points
     */
    sourceText: string[];
    /**
     * the input leaf of a token
     */
    leaf: (token: any, index: number) => any;
    /**
     * the features that are on
     */
    features: Set<string>;
    /**
     * the versions of each constant
     */
    constants: Map<string, any[]>;
};
/**
 * What an expression can read of its stage.
 * @typedef {object} StageData
 * @property {any[]} tokens the input tokens of the stage, as format 50 tokens
 * @property {string[]} sourceText the original text as code points
 * @property {(token: any, index: number) => any} leaf the input leaf of a token
 * @property {Set<string>} features the features that are on
 * @property {Map<string, any[]>} constants the versions of each constant
 */
export declare function evaluationError(description: any, at: any, document: any): GencmuError;
export declare class Evaluator {
    stage: StageData;
    /** @type {Map<any, any>} */
    constantValues: Map<any, any>;
    /** @param {StageData} stage */
    constructor(stage: StageData);
    fail(description: any, node: any, scope: any): void;
    /**
     * The value of a constant version.
     * @param {string} name
     * @param {number} index
     */
    constant(name: string, index: number, node: any, scope: any): any;
    constantReference(name: any, node: any, scope: any): any;
    /** Applies a function value to one argument. */
    applyFunction(fn: any, argument: any, node: any): any;
    predicate(node: any, scope: any): any;
    truth(node: any, scope: any): any;
    toTruth(value: any, node: any, scope: any): any;
    /**
     * Evaluates an expression record.
     * @param {any} node
     * @param {any} scope
     * @param {boolean} [truthPosition] whether a missing capture gives false
     */
    evaluate(node: any, scope: any, truthPosition?: boolean): any;
    item(node: any, scope: any): any;
    capture(node: any, scope: any, truthPosition: any): any;
    bag(entries: any, scope: any, bag?: Bag): Bag;
    payload(node: any, scope: any): any;
    bagOf(value: any, node: any, scope: any): void | Bag;
    list(items: any, scope: any): any;
    string(node: any, scope: any): any;
    comparison(node: any, scope: any): any;
    keys(value: any, node: any, scope: any): any;
    setOperation(kind: any, operands: any, scope: any, node: any): Bag;
    difference(node: any, scope: any): any;
    property(receiver: any, key: any, node: any, scope: any): any;
    map(node: any, scope: any): any;
    method(receiver: any, node: any, scope: any): any;
    bagMethod(bag: any, node: any, scope: any): any;
    spanMethod(span: any, node: any, scope: any): any;
}
/**
 * The classes of a lexicon that hold a string (engine §2): the keys whose
 * string or list holds it, and the keys whose key set names a class found.
 * @param {Bag} lexicon
 * @param {string} spelling
 */
export declare function classify(lexicon: Bag, spelling: string): Bag;
export declare function isPayload(value: any): boolean;
/** Equality of strings, numbers, truths, key sets and lists of those. */
export declare function equal(left: any, right: any): any;
export declare function describe(value: any): "a bag" | "a function" | "a list" | "a node" | "a number" | "a span" | "a string" | "a truth value" | "a value";
/**
 * One occurrence of a chosen tree, a projection or an insertion (engine §1).
 */
export declare class Occurrence {
    kind: any;
    bagCache: any;
    computing: boolean | undefined;
    constructor(kind: any, fields: any);
    /** @returns {Bag} */
    bag(): Bag;
    /** The children that a term reads through `.children`. */
    workingChildren(): any;
}
