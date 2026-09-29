import type { GrammarDom } from "./types.js";
export declare const CAPTURE_NAME: RegExp;
export declare const DOM_MAX_DEPTH = 256;
export declare const DOM_FORMAT = 9;
/**
 * What is wrong with a spelling of a symbol (engine §9), or null: an empty
 * spelling, one with a backtick, which the notation cannot write, one that
 * the lowercase mapping would change, since the match ignores stress, or
 * one of anything but a reference, a string or a phoneme tag, `#` included.
 * The spelled symbol is exactly one reference or one terminal, so that no
 * node is read one way here and another way when lowered. Without a table,
 * the lowercase mapping is not checked.
 * @param {unknown} spelling
 * @param {unknown} expr the spelled expression
 * @param {{lowercase(text: string): string, isMark(code: number): boolean}} [unicode]
 * @returns {string | null}
 */
export declare function spellingProblem(spelling: unknown, expr: unknown, unicode?: {
    lowercase(text: string): string;
    isMark(code: number): boolean;
}): string | null;
/**
 * Why a value is not a grammar DOM, or null when it is one. `unicode` is
 * the lowercase mapping that spellings are checked against.
 * @param {unknown} dom
 * @param {{lowercase(text: string): string, isMark(code: number): boolean}} [unicode]
 * @returns {string | null}
 */
export declare function domProblem(dom: unknown, unicode?: {
    lowercase(text: string): string;
    isMark(code: number): boolean;
}): string | null;
/**
 * Whether a value is a grammar DOM.
 * @param {unknown} dom
 * @param {{lowercase(text: string): string, isMark(code: number): boolean}} [unicode]
 * @returns {dom is GrammarDom}
 */
export declare function isDom(dom: unknown, unicode?: {
    lowercase(text: string): string;
    isMark(code: number): boolean;
}): dom is GrammarDom;
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
export type TermType = "string" | "strings" | "tags" | "span" | "set";
/**
 * The kind of sets joined by ∪, ∩ or ∖, or why they cannot be joined: each
 * is a set, and all whose kind is known have one kind.
 * @param {TermType[]} types
 * @param {string} operator
 * @returns {{type: TermType} | {problem: string}}
 */
export declare function joinedType(types: TermType[], operator: string): {
    type: TermType;
} | {
    problem: string;
};
/**
 * Why a comparison's two sides do not fit its comparator, or null.
 * @param {string} op
 * @param {TermType} left
 * @param {TermType} right
 * @returns {string | null}
 */
export declare function comparisonProblem(op: string, left: TermType, right: TermType): string | null;
/**
 * Why a term of type `type` cannot stand where `expected` is needed, or
 * null. A set of open kind takes the kind it is given.
 * @param {TermType} type
 * @param {"string" | "tags"} expected
 * @returns {string | null}
 */
export declare function expectedProblem(type: TermType, expected: "string" | "tags"): string | null;
/**
 * The type of a term, or why its parts do not agree (engine §10). The
 * term's shape must already be checked.
 * @param {any} term
 * @returns {{type: TermType} | {problem: string}}
 */
export declare function termType(term: any): {
    type: TermType;
} | {
    problem: string;
};
/**
 * Why a condition's terms do not agree in type, or null (engine §10).
 * @param {any} condition
 * @returns {string | null}
 */
export declare function conditionTypeProblem(condition: any): string | null;
