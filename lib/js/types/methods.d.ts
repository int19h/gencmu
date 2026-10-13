export declare const SPAN_METHODS: Set<string>;
export declare const QUERY_METHODS: Set<string>;
export declare const INPUT_STRINGS: Set<string>;
export declare const METHODS: Set<string>;
/**
 * @param {string} name
 * @param {any} receiver
 * @param {any[]} args
 * @param {string} type
 * @param {string[]} argumentTypes
 * @param {boolean} [recipe]
 * @returns {string | null}
 */
export declare function methodProblem(name: string, receiver: any, args: any[], type: string, argumentTypes: string[], recipe?: boolean): string | null;
/** @param {string} name @returns {string} */
export declare function methodType(name: string): string;
