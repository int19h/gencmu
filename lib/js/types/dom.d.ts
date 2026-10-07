import type { GrammarDom } from "./types.js";
export declare const CAPTURE_NAME: RegExp;
export declare const DOM_MAX_DEPTH = 256;
export declare const DOM_FORMAT = 20;
export declare const CONSTANT_NAME: RegExp;
export declare const CLASSIFIER_NAME: RegExp;
export declare const TEST_OPS: Set<string>;
/**
 * Whether a test's comparator is a sound test, whose value is a string,
 * rather than a tag test, whose value is a tag set (engine §2).
 * @param {string} op
 * @returns {boolean}
 */
export declare function isSoundTest(op: string): boolean;
/**
 * What is wrong with the string of a sound test (engine §9), or null: one
 * that no canonical sound can be, with a comma or a code point that the
 * lowercase mapping would change. Without a table, the lowercase mapping is
 * not checked.
 * @param {string} sound
 * @param {{lowercase(text: string): string}} [unicode]
 * @returns {string | null}
 */
export declare function soundProblem(sound: string, unicode?: {
    lowercase(text: string): string;
}): string | null;
/**
 * What is wrong with a test's value (engine §9), or null: it must be a
 * closed term, of type string for a sound test and tag set for a tag test,
 * and a string literal of a sound test must be a canonical sound. The shape
 * of the value must already be checked, and its nesting bounded.
 * @param {string} op
 * @param {any} value
 * @param {{lowercase(text: string): string}} [unicode]
 * @returns {{problem: string, node: any} | null}
 */
export declare function testValueFault(op: string, value: any, unicode?: {
    lowercase(text: string): string;
}): {
    problem: string;
    node: any;
} | null;
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
 * the loader's table: the lowercase mapping that the strings of sound
 * tests are checked against, and the marks that decide a character tag's canonical spelling.
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
export type PreparedClause = {
    /**
     * how the parts join, or
     * null for a clause alone
     */
    join: "union" | "all" | "any" | null;
    parts: any[];
    /**
     * whether the parts are the conditions of a list,
     * each of which is prepared in turn
     */
    list: boolean;
    /**
     * the parts that every production keeps, in
     * order: those that test no presence and do not vanish, and the others
     */
    fixed: number[];
    /**
     * each part's simplified value,
     * where it is the same for every production that keeps it
     */
    values: (any | undefined)[];
    /**
     * the parts that a production
     * keeps only if it has a capture, by that capture, each list in order
     */
    guards: Map<string, number[]>;
    /**
     * for a guarded clause alone, its value for a
     * production without the capture
     */
    absent: any;
    /**
     * for a ∨, whether a part true for every
     * production makes it true
     */
    decided: boolean;
    /**
     * for a ∨, whether a guarded part is true
     * where its capture is present
     */
    guardedTrue: boolean;
};
export type CaptureNames = {
    size: number;
    keys(): Iterable<string>;
};
/**
 * A clause prepared for the productions of its definition, once for each
 * clause.
 * @param {any} node a condition or a term
 * @returns {PreparedClause}
 */
export declare function prepareClause(node: any): PreparedClause;
/**
 * A list of conditions prepared for the productions of its definition,
 * once for each list. A condition false for a production removes it, and
 * one true is dropped, as the items of an ∧ are. A condition that uses a
 * capture the production lacks is left out, which the caller would drop.
 * @param {any[]} conditions
 * @returns {PreparedClause}
 */
export declare function prepareConditions(conditions: any[]): PreparedClause;
/**
 * The indexes of the parts kept for a production, in order: those every
 * production keeps, and those under the captures it has.
 * @param {number[]} fixed
 * @param {Map<string, number[]>} guards
 * @param {(name: string) => boolean} has
 * @param {CaptureNames} names
 * @returns {number[]}
 */
export declare function keptIndexes(fixed: number[], guards: Map<string, number[]>, has: (name: string) => boolean, names: CaptureNames): number[];
/**
 * The values of a prepared clause's parts that a production keeps, in
 * order: each simplified, without those its join drops.
 * @param {PreparedClause} prepared
 * @param {(name: string) => boolean} has
 * @param {CaptureNames} names
 * @returns {any[]}
 */
export declare function partsFor(prepared: PreparedClause, has: (name: string) => boolean, names: CaptureNames): any[];
/**
 * A prepared clause simplified for a production, the same as simplify
 * gives (engine §3.6).
 * @param {PreparedClause} prepared
 * @param {(name: string) => boolean} has
 * @param {CaptureNames} names
 * @returns {any}
 */
export declare function simplifyFor(prepared: PreparedClause, has: (name: string) => boolean, names: CaptureNames): any;
export type EmissionIndex = {
    fixed: number[];
    carriers: Map<string, number[]>;
    attached: Map<string, number[]>;
};
/**
 * The index of an emission's items, once for each list of items.
 * @param {any[]} items
 * @returns {EmissionIndex}
 */
export declare function emissionIndex(items: any[]): EmissionIndex;
/**
 * The indexes of the emission items that a production keeps, in order:
 * those whose carrier it has, and those with none (engine §3.6).
 * @param {any[]} items
 * @param {(name: string) => boolean} has
 * @param {CaptureNames} names
 * @returns {number[]}
 */
export declare function presentItems(items: any[], has: (name: string) => boolean, names: CaptureNames): number[];
/**
 * The first emission item, in order, whose carrier a production lacks but
 * one of whose attachments it has (engine §9), or -1.
 * @param {any[]} items
 * @param {(name: string) => boolean} has
 * @param {CaptureNames} names
 * @returns {number}
 */
export declare function strayAttachment(items: any[], has: (name: string) => boolean, names: CaptureNames): number;
/**
 * The captures a clause uses as values or spans, presence tests aside.
 * @param {unknown} node
 * @returns {string[]}
 */
export declare function capturesUsed(node: unknown): string[];
/**
 * The captures of each production of an alternative, name to its place in
 * the order that the production reads them, with `$` at -1 (engine §3.5).
 * @param {any} alternative
 * @returns {Map<string, number>[]}
 */
export declare function alternativeCaptures(alternative: any): Map<string, number>[];
export type CaptureNode = {
    parent: CaptureNode | null;
    name: string;
    length: number;
    children: Map<string, CaptureNode> | null;
};
/**
 * A sequence of capture names, as a node of a trie of all the sequences
 * of one expression: one node for each distinct sequence, which shares its
 * prefix with the sequences it extends.
 * @typedef {{parent: CaptureNode | null, name: string, length: number, children: Map<string, CaptureNode> | null}} CaptureNode
 */
/**
 * The distinct sequences of captures that the productions of an expression
 * read, each in the order read (engine §3.2, §3.5): a choice gives each
 * branch's, an `&` each subsequence's, a plain optional none or its
 * content's, and braces and an elidable optional none. Productions that
 * read the same names in the same order are one sequence. Gates do not
 * matter, since they drop whole alternatives.
 *
 * The sequences are nodes of a trie, so that extending one by a capture
 * costs one step and two equal sequences are one node. A copy of each
 * growing prefix would cost the square of a sequence's length.
 * @param {any} expr
 * @returns {string[][]}
 */
export declare function captureSequences(expr: any): string[][];
/**
 * The captures that some production of an expression reads after a
 * capture of the same name (engine §3.5, §9), found from the structure
 * alone: two captures are read by one production exactly when they stand
 * in different items of one sequence or one &, since each item is read in
 * any of its expansions. So no production is listed. A choice's branches
 * never meet. Braces and an elidable optional hold no capture.
 * @param {any} expr
 * @returns {{capture: string}[]}
 */
export declare function duplicateCaptures(expr: any): {
    capture: string;
}[];
/**
 * The terminal at the head of an elidable optional's expression, or null
 * when the expression has no such head (engine §3.8, §9): a `ref` whose
 * name begins with a capital, a `terminal` whose tag is a name, or an `=`
 * test of one of these, alone or first in a `seq`.
 * @param {any} expr
 * @returns {any}
 */
export declare function elidableHead(expr: any): any;
/**
 * Why a definition, a rule's alternatives with its own clauses, cannot be
 * read (engine §9), or null. The DOM's shape must already be checked. The
 * checks that simplification decides skip a clause that holds a constant
 * without its value.
 * @param {any} rule
 * @returns {string | null}
 */
export declare function definitionProblem(rule: any): string | null;
/**
 * An emission item's attachment captures, before and after it, in order.
 * @param {any} item
 * @returns {string[]}
 */
export declare function attachmentsOf(item: any): string[];
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
 * The tested symbols of an expression, in the order written.
 * @param {any} expr
 * @returns {{test: string, value: any, expr: any}[]}
 */
export declare function testsIn(expr: any): {
    test: string;
    value: any;
    expr: any;
}[];
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
