export type DocumentValidation = {
    document?: string;
    unicode?: import("../unicode.js").UnicodeTable;
};
/**
 * @param {any} node
 * @param {any} fail
 * @param {any} pattern
 */
export declare function validateOrigin50(node: any, fail: any, pattern: any): void;
/**
 * @param {any} node
 * @param {any} fail
 */
export declare function validatePatternChildren50(node: any, fail: any): void;
/** @param {any} document */
export declare function documentFault50(document: any): (/** @type {any} */ node: any, /** @type {any} */ description: any) => never;
/**
 * @param {any} root
 * @param {any} fail
 * @param {any} owner
 */
export declare function withOwner50(root: any, fail: any, owner: any): (/** @type {any} */ node: any, /** @type {any} */ message: any) => any;
/**
 * @param {{ closed?: boolean, query?: boolean, bindings?: Iterable<string> }} [configuration]
 * @param {any} root
 * @param {any} fail
 */
export declare function validateBindings50(root: any, fail: any, configuration?: {
    closed?: boolean;
    query?: boolean;
    bindings?: Iterable<string>;
}): void;
/**
 * @param {any} argument
 * @param {any} fail
 */
export declare function validateArgument50(argument: any, fail: any): void;
/**
 * @param {any} method
 * @param {any} fail
 */
export declare function validateQuery50(method: any, fail: any): any;
export declare const elidableForm50 = "an elidable optional starts with an ungrouped user terminal or parameter and can bind only its sole terminator";
/**
 * @param {any} size
 * @param {any} node
 * @param {any} fail
 */
export declare function validateSubsetSize50(size: any, node: any, fail: any): void;
/** @param {any} body */
export declare function captureSlots50(body: any): any;
/**
 * @param {any} body
 * @param {any} fail
 */
export declare function validateBody50(body: any, fail: any): void;
/**
 * @param {any} pattern
 * @param {any} fail
 */
export declare function validateExactPattern50(pattern: any, fail: any, { origin }?: {
    origin?: boolean | undefined;
}): void;
/**
 * @param {any} entries
 * @param {any} fail
 */
export declare function validateBag50(entries: any, fail: any): void;
/**
 * @param {any} rule
 * @param {any} slots
 * @param {any} fail
 */
export declare function validateDefinitionNames50(rule: any, slots: any, fail: any): void;
/**
 * @param {any} rule
 * @param {any} alternative
 * @param {any} slots
 * @param {any} fail
 * @param {any} afterTerms
 */
export declare function validateDefinitionExpansion50(rule: any, alternative: any, slots: any, fail: any, check: typeof validateClosedTypes | undefined, afterTerms: any): void;
/**
 * @param {any} rule
 * @param {any} fail
 */
export declare function validateDefinitionBoundaries50(rule: any, fail: any): void;
/**
 * @param {any} rule
 * @param {any} slots
 * @param {any} fail
 */
export declare function validateDefinitionConditions50(rule: any, slots: any, fail: any, check?: typeof validateClosedTypes): void;
/**
 * @param {any} productions
 * @param {any} nullable
 * @param {any} fail
 */
export declare function validateDefinitionNullability50(productions: any, nullable: any, fail: any): void;
/**
 * @param {any} root
 * @param {any} fail
 * @param {any} [options]
 */
declare function validateClosedTypes(root: any, fail: any, { closed, slots, truth, forwarding, message, nodeTerm, hiddenKeys, hiddenStrings, boundary, whole }?: any): void;
/**
 * @param {any} declaration
 * @param {any} fail
 * @param {any} unicode
 * @param {any} emptyDelimiters
 */
export declare function validateDeclarationShape50(declaration: any, fail: any, unicode: any, emptyDelimiters?: any): void;
/**
 * @param {DocumentValidation} [configuration]
 * @param {any} dom
 */
export declare function validateDocumentShape50(dom: any, configuration?: DocumentValidation): void;
/**
 * @param {DocumentValidation} [configuration]
 * @param {any} dom
 */
export declare function validateDocumentDefinitions50(dom: any, configuration?: DocumentValidation): void;
/**
 * @param {DocumentValidation} [configuration]
 * @param {any} dom
 */
export declare function validateDocumentDepth50(dom: any, configuration?: DocumentValidation): void;
/**
 * @param {DocumentValidation} [configuration]
 * @param {any} dom
 */
export declare function validateDocument50(dom: any, configuration?: DocumentValidation): any;
export {};
