export type DocumentValidation = {
    document?: string;
    unicode?: import("../unicode.js").UnicodeTable;
};
export declare function validateOrigin50(node: any, fail: any, pattern: any): void;
export declare function validatePatternChildren50(node: any, fail: any): void;
export declare function documentFault50(document: any): (node: any, description: any) => never;
export declare function withOwner50(root: any, fail: any, owner: any, category: any, checkMembers?: boolean): (node: any, message: any) => any;
/** @param {{ closed?: boolean, query?: boolean, bindings?: Iterable<string>, slot?: string }} [configuration] */
export declare function validateBindings50(root: any, fail: any, configuration?: {
    closed?: boolean;
    query?: boolean;
    bindings?: Iterable<string>;
    slot?: string;
}): void;
export declare function validateArgument50(argument: any, fail: any): void;
export declare function validateQuery50(method: any, fail: any): any;
export declare const elidableForm50 = "an elidable optional starts with an ungrouped user terminal or parameter and can bind only its sole terminator";
export declare function validateSubsetSize50(size: any, node: any, fail: any): void;
export declare function captureSlots50(body: any): any;
export declare function validateBody50(body: any, fail: any): void;
export declare function validateExactPattern50(pattern: any, fail: any, { origin }?: {
    origin?: boolean | undefined;
}): void;
export declare function validateBag50(entries: any, fail: any): void;
export declare function validateDefinitionNames50(rule: any, slots: any, fail: any): void;
export declare function validateDefinitionExpansion50(rule: any, alternative: any, slots: any, fail: any, check: typeof validateClosedTypes | undefined, afterTerms: any): void;
export declare function validateDefinitionBoundaries50(rule: any, fail: any): void;
export declare function validateDefinitionConditions50(rule: any, slots: any, fail: any, check?: typeof validateClosedTypes): void;
export declare function validateDefinitionNullability50(productions: any, nullable: any, fail: any): void;
declare function validateClosedTypes(root: any, fail: any, { closed, slots, truth, forwarding, message, nodeTerm, hiddenKeys, hiddenStrings, boundary, whole, slot }?: {
    closed?: boolean | undefined;
    forwarding?: boolean | undefined;
    hiddenKeys?: Set<any> | undefined;
    hiddenStrings?: Set<any> | undefined;
    message?: boolean | undefined;
    nodeTerm?: boolean | undefined;
    slot?: string | undefined;
    slots?: Map<any, any> | undefined;
    truth?: boolean | undefined;
    whole?: string | undefined;
}): void;
export declare function validateDeclarationShape50(category: any, declaration: any, fail: any, unicode: any, emptyDelimiters?: any[]): void;
/** @param {DocumentValidation} [configuration] */
export declare function validateDocumentShape50(dom: any, configuration?: DocumentValidation): void;
/** @param {DocumentValidation} [configuration] */
export declare function validateDocumentDefinitions50(dom: any, configuration?: DocumentValidation): void;
/** @param {DocumentValidation} [configuration] */
export declare function validateDocumentDepth50(dom: any, configuration?: DocumentValidation): void;
/** @param {DocumentValidation} [configuration] */
export declare function validateDocument50(dom: any, configuration?: DocumentValidation): any;
export {};
