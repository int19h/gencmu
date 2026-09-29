import type { GrammarDom } from "./types.js";
export declare const CAPTURE_NAME: RegExp;
export declare const DOM_MAX_DEPTH = 256;
export declare const DOM_FORMAT = 11;
export declare const CONSTANT_NAME: RegExp;
/**
 * What is wrong with a spelling of a symbol (engine §9), or null: an empty
 * spelling, one with a backtick, which the notation cannot write, one that
 * no canonical sound can be, with a comma or a code point that the
 * lowercase mapping would change, or one of anything but a reference or a
 * terminal, `#` included.
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
 * What is wrong with a range (engine §1, §9), or null: its ends must be two
 * character tags in their canonical spelling by the table, which says which
 * code points are marks, the start not above the end.
 * @param {unknown} range
 * @param {{isMark(code: number): boolean}} unicode
 * @returns {string | null}
 */
export declare function rangeProblem(range: unknown, unicode: {
    isMark(code: number): boolean;
}): string | null;
/**
 * What is wrong with a property's name (engine §1, §9), or null.
 * @param {unknown} name
 * @returns {string | null}
 */
export declare function propertyProblem(name: unknown): string | null;
/**
 * Why a value is not a grammar DOM, or null when it is one. `unicode` is
 * the loader's table: the lowercase mapping that spellings are checked
 * against, and the marks that decide a character tag's canonical spelling.
 * @param {unknown} dom
 * @param {{lowercase(text: string): string, isMark(code: number): boolean}} unicode
 * @returns {string | null}
 */
export declare function domProblem(dom: unknown, unicode: {
    lowercase(text: string): string;
    isMark(code: number): boolean;
}): string | null;
/**
 * What is wrong with a call of split or tag whose argument the reader sees
 * as a string literal (engine §9, §10), or null: an empty delimiter, or a
 * tag's string that is not a name.
 * @param {string} call
 * @param {unknown[]} args
 * @returns {string | null}
 */
export declare function literalCallProblem(call: string, args: unknown[]): string | null;
/**
 * Whether a value is a grammar DOM, by the loader's table.
 * @param {unknown} dom
 * @param {{lowercase(text: string): string, isMark(code: number): boolean}} unicode
 * @returns {dom is GrammarDom}
 */
export declare function isDom(dom: unknown, unicode: {
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
export type TermType = "string" | "strings" | "tags" | "span" | "set" | "any";
export type ConstantTypes = (name: string) => TermType;
/**
 * The kind of sets joined by ∪, ∩ or ∖, or why they cannot be joined: each
 * is a set, and all whose kind is known have one kind. A constant whose
 * type is not known yet fits any set.
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
 * Why a comparison's two sides do not fit its comparator, or null. A side
 * of type `any` fits, and the loader checks it again (engine §9).
 * @param {string} op
 * @param {TermType} left
 * @param {TermType} right
 * @returns {string | null}
 */
export declare function comparisonProblem(op: string, left: TermType, right: TermType): string | null;
/**
 * Why a term of type `type` cannot stand where `expected` is needed, or
 * null. A set of open kind takes the kind it is given, and a constant of
 * unknown type fits.
 * @param {TermType} type
 * @param {"string" | "tags"} expected
 * @returns {string | null}
 */
export declare function expectedProblem(type: TermType, expected: "string" | "tags"): string | null;
export type TypeFault = {
    problem: string;
    node: any;
};
/**
 * A disagreement of types, and the smallest construct that holds it.
 * @typedef {{problem: string, node: any}} TypeFault
 */
/**
 * The type of a term, or why its parts do not agree (engine §10), with the
 * smallest construct whose parts disagree. The term's shape must already
 * be checked. `constants` gives the type of each constant.
 * @param {any} term
 * @param {ConstantTypes} [constants]
 * @returns {{type: TermType} | TypeFault}
 */
export declare function termType(term: any, constants?: ConstantTypes): {
    type: TermType;
} | TypeFault;
/**
 * Why a condition's terms do not agree in type, with the smallest
 * construct that disagrees, or null (engine §10).
 * @param {any} condition
 * @param {ConstantTypes} [constants]
 * @returns {TypeFault | null}
 */
export declare function conditionTypeFault(condition: any, constants?: ConstantTypes): TypeFault | null;
/**
 * Why a condition's terms do not agree in type, or null (engine §10).
 * @param {any} condition
 * @returns {string | null}
 */
export declare function conditionTypeProblem(condition: any): string | null;
/**
 * Why a rule's terms and conditions do not agree in type, with the
 * construct at fault, or null.
 * @param {any} rule
 * @param {ConstantTypes} [constants]
 * @returns {TypeFault | null}
 */
export declare function ruleTypeFault(rule: any, constants?: ConstantTypes): TypeFault | null;
/**
 * The type of a constant's value, or why it cannot be one (engine §2,
 * §10): a string, a set of strings or a tag set. A redefinition keeps the
 * constant's type, which gives `∅` its kind, so its value can be of open
 * kind.
 * @param {any} value
 * @param {boolean} redefine
 * @param {ConstantTypes} [constants]
 * @returns {{type: TermType} | TypeFault}
 */
export declare function constantValueType(value: any, redefine: boolean, constants?: ConstantTypes): {
    type: TermType;
} | TypeFault;
/**
 * The first part of a term that is not closed (engine §10), or null: a
 * capture, a guarded term, or a call of anything but split and tag. The
 * shape of the term need not be checked.
 * @param {unknown} term
 * @returns {any}
 */
export declare function openPart(term: unknown): any;
/**
 * The references to constants in a term, a condition, a rule or any part
 * of a DOM, in the order written.
 * @param {unknown} node
 * @returns {import("./types.js").ConstantTerm[]}
 */
export declare function constantsIn(node: unknown): import("./types.js").ConstantTerm[];
