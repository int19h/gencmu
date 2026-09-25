import type { GrammarDom } from "./types.js";
export declare const DOM_MAX_DEPTH = 256;
export declare const DOM_FORMAT = 5;
/**
 * Why a value is not a grammar DOM, or null when it is one.
 * @param {unknown} dom
 * @returns {string | null}
 */
export declare function domProblem(dom: unknown): string | null;
/**
 * Whether a value is a grammar DOM.
 * @param {unknown} dom
 * @returns {dom is GrammarDom}
 */
export declare function isDom(dom: unknown): dom is GrammarDom;
/**
 * Whether a term, or a condition inside one, reads the tags of `$`, the
 * constituent whose tags it may be defining: `$` as a value, `tags($)` or
 * `classes($)`. A span argument such as `phonemes($)` reads tokens, not tags.
 * The DOM's shape need not have been checked: anything malformed reads
 * nothing, and the check of its shape refuses it.
 * @param {unknown} node
 * @returns {boolean}
 */
export declare function readsOwnTags(node: unknown): boolean;
/** A condition that simplifies to true or false for a production. */
export declare const DOM_TRUE: Readonly<{
    constant: true;
}>;
export declare const DOM_FALSE: Readonly<{
    constant: false;
}>;
/**
 * A clause simplified for a production that has the captures `has`: each
 * presence test becomes true or false, and guards and logic over them are
 * reduced (engine §3.6). A condition may become DOM_TRUE or DOM_FALSE; a term may
 * become the empty set.
 * @param {any} node a condition or a term
 * @param {(name: string) => boolean} has
 * @returns {any}
 */
export declare function simplify(node: any, has: (name: string) => boolean): any;
/**
 * The captures a clause uses as values or spans, presence tests aside.
 * @param {unknown} node
 * @returns {string[]}
 */
export declare function capturesUsed(node: unknown): string[];
/**
 * The captures of an alternative's top level, name to position.
 * @param {any} alternative
 * @returns {Map<string, number>}
 */
export declare function alternativeCaptures(alternative: any): Map<string, number>;
/**
 * Why a definition, a rule's alternatives with its own clauses, cannot be
 * read (engine §9), or null. The DOM's shape must already be checked.
 * @param {any} rule
 * @returns {string | null}
 */
export declare function definitionProblem(rule: any): string | null;
