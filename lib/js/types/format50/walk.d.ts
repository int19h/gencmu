export declare class DomBuilder {
    tokens: any;
    position: any;
    document: any;
    unicode: any;
    strings: any;
    domFault: (node: any, description: any) => never;
    declarationSite: {
        at: any;
    } | undefined;
    constructor(tokens: any, position: any, document: any, unicode: any, strings: any);
    token(node: any): any;
    at(node: any): any;
    value(node: any): any;
    fail(node: any, description: any): void;
    build(tree: any): {
        format: number;
        rules: never[];
        directives: never[];
        constants: never[];
    };
    directive(node: any): any;
    ranking(node: any): {
        name: string;
        steps: any;
        at: any;
    };
    rule(node: any): any;
    conditions(node: any): any;
    alternative(node: any, kind: any, owner: any): any;
    name(node: any): any;
    binder(node: any): any;
    gate(node: any): {
        feature: any;
        kind: string;
        negated: boolean;
    };
    body(node: any, whole?: boolean, elidable?: boolean, chain?: boolean, blockedPrimary?: boolean): any;
    optional(node: any, route: any, chain: any): any;
    testOrder(testNodes: any, elidable?: boolean): any;
    tests(base: any, tests: any, pattern: any): any;
    requirements(node: any): any;
    stringOperand(node: any, test?: boolean, message?: string): any;
    parameter(node: any): {
        param: any;
        at: any;
    };
    call(node: any): {
        call: any;
        args: any;
        at: any;
    };
    target(node: any): any;
    argument(node: any): any;
    expression(node: any): any;
    binary(node: any, convert: any, pattern: any): any;
    method(node: any, receiver: any): any;
    predicate(node: any): any;
    entry(node: any): any;
    pattern(node: any): any;
    patternPath(node: any, pattern: any): any;
    singlePattern(node: any): any;
    items(node: any): any;
}
