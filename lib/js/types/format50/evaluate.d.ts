import { GencmuError } from "../errors.js";
import { Bag } from "./bag.js";
/** A function value: one parameter and a body, closed over its scope. */
export declare class Fn {
    param: any;
    body: any;
    scope: any;
    /**
     * @param {any} param
     * @param {any} body
     * @param {any} scope
     */
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
    /**
     * runs a query after the choice of a parse
     */
    lateQuery?: (kind: string, node: any, scope: any) => any;
};
/**
 * What an expression can read of its stage.
 * @typedef {object} StageData
 * @property {any[]} tokens the input tokens of the stage, as format 50 tokens
 * @property {string[]} sourceText the original text as code points
 * @property {(token: any, index: number) => any} leaf the input leaf of a token
 * @property {Set<string>} features the features that are on
 * @property {Map<string, any[]>} constants the versions of each constant
 * @property {(kind: string, node: any, scope: any) => any} [lateQuery] runs a query after the choice of a parse
 */
/**
 * @param {any} description
 * @param {any} at
 * @param {any} document
 */
export declare function evaluationError(description: any, at: any, document: any): GencmuError;
/**
 * Whether an expression is a set of patterns with at least one operator,
 * such as `#A ∖ ∅` or `#⁅ a b ⁆ ∪ $P` (part 3 §4). An operand can be a
 * constant, but one operand at least is a written pattern, so that a set
 * of key-set constants stays a key set.
 * @param {any} node
 */
export declare function isPatternSet(node: any, nested?: boolean): any;
export declare class Evaluator {
    stage: StageData;
    /** @type {Map<any, any>} */
    constantValues: Map<any, any>;
    /** @type {() => Bag} the bag of the input keys of the stage */
    inputs: () => Bag;
    /** @param {StageData} stage */
    constructor(stage: StageData);
    /**
     * @param {any} description
     * @param {any} node
     * @param {any} scope
     * @returns {never}
     */
    fail(description: any, node: any, scope: any): never;
    /**
     * The value of a constant version.
     * @param {string} name
     * @param {number} index
     * @param {any} node
     * @param {any} scope
     * @returns {any}
     */
    constant(name: string, index: number, node: any, scope: any): any;
    /**
     * @param {any} name
     * @param {any} node
     * @param {any} scope
     * @returns {any}
     */
    constantReference(name: any, node: any, scope: any): any;
    /**
     * Applies a function value to one argument.
     * @param {any} fn
     * @param {any} argument
     * @param {any} node
     * @returns {any}
     */
    applyFunction(fn: any, argument: any, node: any): any;
    /**
     * @param {any} node
     * @param {any} scope
     * @returns {any}
     */
    predicate(node: any, scope: any): any;
    /**
     * @param {any} node
     * @param {any} scope
     * @returns {any}
     */
    truth(node: any, scope: any): any;
    /**
     * @param {any} value
     * @param {any} node
     * @param {any} scope
     */
    toTruth(value: any, node: any, scope: any): any;
    /**
     * Evaluates an expression record.
     * @param {any} node
     * @param {any} scope
     * @param {boolean} [truthPosition] whether a missing capture gives false
     * @returns {any}
     */
    evaluate(node: any, scope: any, truthPosition?: boolean): any;
    /**
     * @param {any} node
     * @param {any} scope
     */
    item(node: any, scope: any): any;
    /**
     * @param {any} node
     * @param {any} scope
     * @param {any} truthPosition
     */
    capture(node: any, scope: any, truthPosition: any): any;
    /**
     * @param {any} entries
     * @param {any} scope
     */
    bag(entries: any, scope: any, bag?: Bag): Bag;
    /**
     * @param {any} node
     * @param {any} scope
     */
    payload(node: any, scope: any): any;
    /**
     * @param {any} value
     * @param {any} node
     * @param {any} scope
     */
    bagOf(value: any, node: any, scope: any): Bag;
    /**
     * @param {any} items
     * @param {any} scope
     * @returns {any}
     */
    list(items: any, scope: any): any;
    /**
     * @param {any} node
     * @param {any} scope
     * @returns {any}
     */
    string(node: any, scope: any): any;
    /**
     * @param {any} node
     * @param {any} scope
     * @returns {any}
     */
    comparison(node: any, scope: any): any;
    /**
     * @param {any} value
     * @param {any} node
     * @param {any} scope
     */
    keys(value: any, node: any, scope: any): string[];
    /**
     * @param {any} kind
     * @param {any} operands
     * @param {any} scope
     * @param {any} node
     */
    setOperation(kind: any, operands: any, scope: any, node: any): Bag;
    /**
     * @param {any} node
     * @param {any} scope
     * @returns {any}
     */
    difference(node: any, scope: any): any;
    /**
     * @param {any} receiver
     * @param {any} key
     * @param {any} node
     * @param {any} scope
     */
    property(receiver: any, key: any, node: any, scope: any): any;
    /**
     * @param {any} node
     * @param {any} scope
     * @returns {any}
     */
    map(node: any, scope: any): any;
    /**
     * @param {any} receiver
     * @param {any} node
     * @param {any} scope
     * @returns {any}
     */
    method(receiver: any, node: any, scope: any): any;
    /**
     * @param {any} bag
     * @param {any} node
     * @param {any} scope
     * @returns {any}
     */
    bagMethod(bag: any, node: any, scope: any): any;
    /**
     * @param {any} span
     * @param {any} node
     * @param {any} scope
     */
    spanMethod(span: any, node: any, scope: any): any;
}
/**
 * The classes of a lexicon that hold a string (engine §2): the keys whose
 * string or list holds it, and the keys whose key set names a class found.
 * @param {Bag} lexicon
 * @param {string} spelling
 */
export declare function classify(lexicon: Bag, spelling: string): Bag;
/** @param {any} value */
export declare function isPayload(value: any): boolean;
/**
 * Equality of strings, numbers, truths, key sets and lists of those.
 * @param {any} left
 * @param {any} right
 * @returns {any}
 */
export declare function equal(left: any, right: any): any;
/** @param {any} value */
export declare function describe(value: any): "a bag" | "a function" | "a list" | "a node" | "a number" | "a span" | "a string" | "a truth value" | "a value";
/**
 * One occurrence of a chosen tree, a projection or an insertion (engine §1).
 */
export declare class Occurrence {
    kind: any;
    /** @type {any} */ rule: any;
    /** @type {any} */ origin: any;
    /** @type {any} */ derivation: any;
    /** @type {any} */ span: any;
    /** @type {any} */ source: any;
    /** @type {any} */ terminal: any;
    /** @type {any} */ token: any;
    /** @type {any} */ input: any;
    /** @type {any} */ erased: any;
    /** @type {any} */ producer: any;
    /** @type {any} */ part: any;
    /** @type {any} */ item: any;
    /** @type {any} the chosen reading that holds a rule node */ reading: any;
    /** @type {Map<string, any> | undefined} */ captures: Map<string, any> | undefined;
    /** @type {Occurrence | null | undefined} */ primary: Occurrence | null | undefined;
    /** @type {() => Bag} */ makeBag: () => Bag;
    computing: boolean;
    /** @type {Occurrence[]} */ children: Occurrence[];
    bagCache: Bag | null;
    /**
     * @param {any} kind
     * @param {any} fields
     */
    constructor(kind: any, fields: any);
    /** @returns {Bag} */
    bag(): Bag;
    /** The children that a term reads through `.children`. */
    workingChildren(): Occurrence[];
}
