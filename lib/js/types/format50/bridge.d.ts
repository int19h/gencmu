/** The capture name that marks a primary without a written label. */
export declare const PRIMARY_CAPTURE = "^";
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
/**
 * The key of an alternative in the origin table: its document, the
 * position of its definition and its index there.
 */
export declare function alternativeKey(document: any, at: any, index: any): string;
export declare function isClosed(node: any, bound?: Set<any>): any;
