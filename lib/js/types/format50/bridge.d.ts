/**
 * The capture name that marks a primary without a written label. The
 * bridge adds underscores until no capture of the rule has the name.
 */
export declare const PRIMARY_CAPTURE = "primary_";
/** A visible key: a capitalized key or an engine key. */
export declare function isVisibleKey(key: any): boolean;
/**
 * The format 49 records of one DOM 50 document, for recognition.
 * @param {any} dom a valid DOM 50
 * @param {string} path the document
 * @returns {any} a DOM 49 with the extra members `format50` and `origins`
 */
export declare function bridgeDocument(dom: any, path: string, origins: any): any;
/** The hidden recognizer key for a payload of a key, or for one value. */
export declare function payloadTag(key: any, value: any): string;
/** The name of a classifier for the recognizer, which needs a lowercase name. */
export declare function classifierName(name: any): string;
/**
 * The key of an alternative in the origin table: its document, the
 * position of its definition and its index there.
 */
export declare function alternativeKey(document: any, at: any, index: any): string;
/**
 * The format 50 expression of an argument as the recognizer stores it in
 * an instance: the inverse of argumentTerm. Other arguments stay as they are.
 */
export declare function argumentExpression(arg: any): any;
export declare function isClosed(node: any, bound?: Set<any>): any;
