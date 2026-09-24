import type { Argument, GrammarDom } from "./types.js";
export declare const DOM_MAX_DEPTH = 256;
export declare const DOM_FORMAT = 2;
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
 * Whether a term reads the tags of `$`, the constituent whose tags it may
 * be defining.
 * @param {Argument} term
 * @returns {boolean}
 */
export declare function readsOwnTags(term: Argument): boolean;
