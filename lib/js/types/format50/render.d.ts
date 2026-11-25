/** The rendering context of each root of a native result. */
export declare const renderContexts: WeakMap<object, any>;
/**
 * Records the context of the roots of a parse.
 * @param {any} result a native format 50 result
 * @param {any} unicode the core table of the pipeline
 */
export declare function retainRenderContext(result: any, unicode: any): void;
/**
 * The bracket rendering of a root of a native result.
 * @param {any} root
 * @param {{showElided?: boolean}} [options]
 */
export declare function nodeBrackets50(root: any, options?: {
    showElided?: boolean;
}): string;
/**
 * The tree rendering of a root of a native result.
 * @param {any} root
 */
export declare function nodeTree50(root: any): string;
