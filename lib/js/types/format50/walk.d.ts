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
     * @param {any} tree
     * @param {any} [storeDom]
     */
    build(tree: any, storeDom?: any): any;
    /** @param {any} tree */
    declarations(tree: any): Generator<any[], void, unknown>;
    /** @param {any} node */
    directive(node: any): any;
    /** @param {any} node */
    ranking(node: any): {
        name: string;
        steps: any;
        at: any;
    };
    /** @param {any} node */
    rule(node: any): any;
    /** @param {any} node */
    conditions(node: any): any;
    /**
     * @param {any} node
     * @param {any} kind
     * @param {any} owner
     */
    alternative(node: any, kind: any, owner: any): any;
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
     * @returns {any}
     */
    ownedBody(node: any, owner: any, whole?: boolean): any;
    /**
     * @param {any} node
     * @returns {any}
     */
    body(node: any, whole?: boolean, elidable?: boolean): any;
    /**
     * @param {any} node
     * @param {any} route
     * @returns {any}
     */
    optional(node: any, route: any): any;
    /** @param {any} testNodes */
    testOrder(testNodes: any, elidable?: boolean): any;
    /**
     * @param {any} base
     * @param {any} tests
     */
    tests(base: any, tests: any): any;
    /** @param {any} node */
    requirements(node: any): any;
    /**
     * @param {any} node
     * @returns {any}
     */
    stringOperand(node: any, test?: boolean, message?: string): any;
    /** @param {any} node */
    parameter(node: any): {
        param: any;
        at: any;
    };
    /** @param {any} node */
    call(node: any): {
        call: any;
        args: any;
        at: any;
    };
    /**
     * @param {any} node
     * @returns {any}
     */
    target(node: any): any;
    /** @param {any} node */
    argument(node: any): any;
    /**
     * @param {any} node
     * @returns {any}
     */
    expression(node: any): any;
    /**
     * @param {any} node
     * @param {any} convert
     * @param {any} pattern
     */
    binary(node: any, convert: any, pattern: any): any;
    /**
     * @param {any} node
     * @param {any} [receiver]
     * @returns {any}
     */
    method(node: any, receiver?: any): any;
    /**
     * @param {any} node
     * @returns {any}
     */
    predicate(node: any): any;
    /** @param {any} node */
    entry(node: any): any;
    /**
     * @param {any} node
     * @returns {any}
     */
    pattern(node: any): any;
    /**
     * @param {any} node
     * @param {any} pattern
     */
    patternPath(node: any, pattern: any): any;
    /**
     * @param {any} node
     * @returns {any}
     */
    singlePattern(node: any): any;
    /**
     * @param {any} node
     * @returns {any}
     */
    items(node: any): any;
}
