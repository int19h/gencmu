import { GencmuError } from "../errors.js";
import { BEFORE, FAULT } from "./validate.js";
export type Step = import("../trampoline.js").Step;
/**
 * @param {any} declarations
 * @param {any} configuration
 * @param {any} storeDom
 */
export declare function inspectConverted50(declarations: any, configuration: any, storeDom: any): any;
export declare class DomBuilder {
    tokens: any;
    position: any;
    document: any;
    unicode: any;
    strings: any;
    domFault: (node: any, description: any) => never;
    /** @type {WeakMap<object, any> | undefined} the default of each elided head */
    defaults: WeakMap<object, any> | undefined;
    /** @type {GencmuError[]} the conversion faults of the current declaration */
    faults: GencmuError[];
    bodyOwner: any;
    /**
     * @param {any} tokens
     * @param {any} position
     * @param {any} document
     * @param {any} unicode
     * @param {any} strings
     */
    constructor(tokens: any, position: any, document: any, unicode: any, strings: any);
    /** @param {any} node */
    token(node: any): any;
    /** @param {any} node */
    at(node: any): any;
    /** @param {any} node */
    value(node: any): any;
    /**
     * @param {any} node
     * @param {any} description
     */
    fail(node: any, description: any): void;
    /**
     * @param {any} node
     * @param {any} description
     */
    error(node: any, description: any): GencmuError;
    /**
     * @param {Step} step
     * @param {[any, string][]} [before]
     * @returns {Step}
     */
    deferred(step: Step, before?: [any, string][]): Step;
    /**
     * @param {any} node
     * @param {any} description
     */
    waitingFault(node: any, description: any): {
        [FAULT]: GencmuError;
        [BEFORE]: [any, string][];
    };
    /**
     * @param {GencmuError} error
     * @param {[any, string][]} [before]
     */
    waiting(error: GencmuError, before?: [any, string][]): {
        [FAULT]: GencmuError;
        [BEFORE]: [any, string][];
    };
    /**
     * @param {any[]} items
     * @param {(item: any, index: number) => Step} convert
     * @returns {Step}
     */
    each(items: any[], convert: (item: any, index: number) => Step): Step;
    /**
     * @param {any} tree
     * @param {any} [storeDom]
     */
    build(tree: any, storeDom?: any): any;
    /** @param {any} tree */
    declarations(tree: any): Generator<any[], void, unknown>;
    /**
     * @param {any} node
     * @returns {Step}
     */
    misplacedNames(node: any): Step;
    /**
     * @param {any} node
     * @returns {Step}
     */
    directive(node: any): Step;
    /**
     * @param {any} node
     * @returns {Step}
     */
    ranking(node: any): Step;
    /**
     * @param {any} node
     * @returns {Step}
     */
    rule(node: any): Step;
    /**
     * @param {any} node
     * @returns {Step}
     */
    conditions(node: any): Step;
    /**
     * @param {any} node
     * @param {any} kind
     * @param {any} owner
     * @returns {Step}
     */
    alternative(node: any, kind: any, owner: any): Step;
    /** @param {any} node */
    name(node: any): any;
    /** @param {any} node */
    binder(node: any): any;
    /** @param {any} node */
    gate(node: any): {
        feature: any;
        kind: string;
        negated: boolean;
    };
    /**
     * @param {any} node
     * @param {any} owner
     * @returns {Step}
     */
    ownedBody(node: any, owner: any, whole?: boolean): Step;
    /**
     * @param {any} node
     * @returns {Step}
     */
    body(node: any, whole?: boolean, elidable?: boolean): Step;
    /**
     * @param {any} node
     * @returns {Step}
     */
    bodyRecord(node: any, whole?: boolean, elidable?: boolean): Step;
    /**
     * @param {any} node
     * @param {any} route
     * @returns {Step}
     */
    optional(node: any, route: any): Step;
    /** @param {any} testNodes */
    testOrder(testNodes: any, elidable?: boolean): any;
    /**
     * @param {any} base
     * @param {any} tests
     * @returns {Step}
     */
    tests(base: any, tests: any): Step;
    /**
     * @param {any} node
     * @returns {Step}
     */
    requirements(node: any): Step;
    /**
     * @param {any} requirement
     * @returns {Step}
     */
    requirement(requirement: any): Step;
    /**
     * @param {any} node
     * @returns {Step}
     */
    stringOperand(node: any, test?: boolean, message?: string): Step;
    /**
     * @param {any} node
     * @param {boolean} test
     * @param {string} message
     * @returns {Step}
     */
    stringRecord(node: any, test: boolean, message: string): Step;
    /** @param {any} node */
    parameter(node: any): {
        param: any;
        at: any;
    };
    /**
     * @param {any} node
     * @returns {Step}
     */
    call(node: any): Step;
    /**
     * @param {any} node
     * @returns {Step}
     */
    target(node: any): Step;
    /**
     * @param {any} node
     * @returns {Step}
     */
    targetRecord(node: any): Step;
    /**
     * @param {any} node
     * @returns {Step}
     */
    argument(node: any): Step;
    /**
     * @param {any} node
     * @returns {Step}
     */
    expression(node: any): Step;
    /**
     * @param {any} node
     * @returns {Step}
     */
    expressionRecord(node: any): Step;
    /**
     * @param {any} selector
     * @param {any} value
     * @returns {Step}
     */
    selector(selector: any, value: any): Step;
    /**
     * @param {any} map
     * @returns {Step}
     */
    mapProperty(map: any): Step;
    /**
     * @param {any} node
     * @param {(child: any) => Step} convert
     * @param {any} pattern
     * @returns {Step}
     */
    binary(node: any, convert: (child: any) => Step, pattern: any): Step;
    /**
     * @param {any} node
     * @param {any} [receiver]
     * @returns {Step}
     */
    method(node: any, receiver?: any): Step;
    /**
     * @param {any} node
     * @returns {Step}
     */
    predicate(node: any): Step;
    /**
     * @param {any} node
     * @returns {Step}
     */
    entry(node: any): Step;
    /**
     * @param {any} node
     * @param {any} suffix
     * @param {[any, string][]} before
     * @returns {Step}
     */
    entryForm(node: any, suffix: any, before: [any, string][]): Step;
    /**
     * @param {any} node
     * @returns {Step}
     */
    pattern(node: any): Step;
    /**
     * @param {any} node
     * @returns {Step}
     */
    patternRecord(node: any): Step;
    /**
     * @param {any} node
     * @param {any} pattern
     */
    patternPath(node: any, pattern: any): any;
    /**
     * @param {any} node
     * @returns {Step}
     */
    singlePattern(node: any): Step;
    /**
     * @param {any} node
     * @returns {Step}
     */
    singlePatternRecord(node: any): Step;
    /**
     * @param {any} node
     * @returns {Step}
     */
    items(node: any): Step;
}
