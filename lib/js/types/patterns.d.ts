/** @param {any} test @param {string} sound @param {Set<string>} tags @returns {boolean} */
export declare function leafTest(test: any, sound: string, tags: Set<string>): boolean;
/** @param {any} node @returns {any[]} */
export declare function patternParts(node: any): any[];
/**
 * Shape only. Term and test typing remains in dom.js. The caller bounds
 * nesting before calling this walk.
 * @param {any} root @param {(test: any) => string | null} testFault
 * @returns {string | null}
 */
export declare function patternProblem(root: any, testFault: (test: any) => string | null): string | null;
/** @param {any} root @param {(name:string, at:[number,number]) => any} constant @param {(term:any, test:any) => any} value @returns {any} */
export declare function resolvePattern(root: any, constant: (name: string, at: [number, number]) => any, value: (term: any, test: any) => any): any;
export declare class PatternMachine {
    /** @type {any[]} */ predicates: any[];
    /** @type {any[]} */ machines: any[];
    /** @type {Map<string,number>} */ ids: Map<string, number>;
    /** @type {any[]} */ states: any[];
    /** @type {Map<string,number>} */ stateIds: Map<string, number>;
    /** @type {Map<string,number>} */ transitions: Map<string, number>;
    empty: number;
    seal: number;
    /** @param {any[]} roots */
    constructor(roots: any[]);
    /** @param {any} n @returns {number} */
    compile(n: any): number;
    /** @param {any} body @returns {any} */
    sequence(body: any): any;
    /** @param {any} s @returns {number} */
    intern(s: any): number;
    /** @param {bigint[]} a @param {bigint[]} b @returns {bigint[]} */
    compose(a: bigint[], b: bigint[]): bigint[];
    /** @param {number} left @param {number} right @returns {number} */
    concat(left: number, right: number): number;
    /** @param {bigint} bits @param {boolean} empty @returns {number} */
    nodeState(bits: bigint, empty: boolean): number;
    /** @param {string|null} name @param {number} children @param {any} [leaf] @returns {number} */
    node(name: string | null, children: number, leaf?: any): number;
    /** @param {number} state @param {any} pattern @returns {boolean} */
    matches(state: number, pattern: any): boolean;
}
/** @param {any} pattern @returns {string} */
export declare function patternText(pattern: any): string;
