/** @param {any} root @returns {boolean} */
export declare function hasUnresolved(root: any): boolean;
/** @param {any} expr @returns {any} */
export declare function argumentOfExpression(expr: any): any;
/** @param {any} value @param {((source:any,target:any)=>void)|null} [copyLocation] @returns {any} */
export declare function normalizeArgument(value: any, copyLocation?: ((source: any, target: any) => void) | null): any;
/** @param {any} root @returns {boolean} */
export declare function argumentReadsCapture(root: any): boolean;
