import { PatternMachine } from './patterns.js';
import { StringWalk } from './strings.js';
export declare class ChosenChecks {
    flow: import("./diagnostic-flow.js").DiagnosticFlow;
    context: import("./earley.js").ParseContext;
    features: Set<string>;
    checks: import("./types.js").DomCheck[];
    patterns: PatternMachine;
    /** @type {Map<any,any>} */ nodes: Map<any, any>;
    /** @type {Map<string,number>} */ identities: Map<string, number>;
    /** @type {Map<number,Set<string>>} */ first: Map<number, Set<string>>;
    /** @type {Map<number,Set<string>>} */ last: Map<number, Set<string>>;
    /** @type {any} */ current: any;
    /** @type {import("./types.js").Scope} */
    scope: import("./types.js").Scope;
    strings: StringWalk;
    /** @param {import('./diagnostic-flow.js').DiagnosticFlow} flow
     * @param {import('./earley.js').ParseContext} context @param {Set<string>} features */
    constructor(flow: import('./diagnostic-flow.js').DiagnosticFlow, context: import('./earley.js').ParseContext, features: Set<string>);
    /** @param {any} node @returns {any} */
    make(node: any): any;
    /** Presence is the sole observation that accepts an absent node.
     * @param {any} term @returns {any|null} */
    node(term: any): any | null;
    /** @param {any} term @returns {any} */
    checkValue(term: any): any;
    /** @param {any} node @returns {any|null} */
    preceding(node: any): any | null;
    /** @param {any} symbol @returns {any} */
    expression(symbol: any): any;
    /** @param {any} term @returns {{start:number,rule:string}} */
    localReading(term: any): {
        start: number;
        rule: string;
    };
    /** @param {any} atom @returns {boolean} */
    boundary(atom: any): boolean;
    /** @param {any} derivation @param {Set<string>} suppressed */
    at(derivation: any, suppressed: Set<string>): Generator<{
        check: import("./types.js").DomCheck;
        message: string;
        node: any;
    }, void, unknown>;
}
