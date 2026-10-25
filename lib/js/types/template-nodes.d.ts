/** @param {any} root @returns {boolean} */
export declare function hasUnresolved(root: any): boolean;
/** @param {any} expr @returns {any} */
export declare function argumentOfExpression(expr: any): any;
/** @param {any} value @param {((source:any,target:any)=>void)|null} [copyLocation] @param {Set<string>} [patterns] @returns {any} */
export declare function normalizeArgument(value: any, copyLocation?: ((source: any, target: any) => void) | null, patterns?: Set<string>): any;
/** @param {any} root @returns {boolean} */
export declare function argumentReadsCapture(root: any): boolean;
/** @param {any} root @param {Set<string>} patterns @returns {boolean} */
export declare function patternTerm(root: any, patterns: Set<string>): boolean;
/** @param {any[]} definitions @returns {Set<string>} */
export declare function patternConstantNames(definitions: any[]): Set<string>;
