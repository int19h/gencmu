import { GencmuError } from "./errors.js";
import type { Condition, DomAlternative, DomConstant, DomRule, Emission, ErrorLocation, GrammarDom, LoweredGrammar, Resolution, Term, TermValue } from "./types.js";
import type { TermType } from "./dom.js";
export type StageConstant = {
    value: TermValue;
    type: TermType;
    document: string;
};
export type StitchedAlternative = DomAlternative & {
    clauses: RuleClauses;
    document: string;
    at: ErrorLocation;
};
export type RuleClauses = {
    tags: Term | undefined;
    emit: Emission | undefined;
    conditions: Condition[];
    verbatim: boolean;
};
export type StitchedRule = {
    name: string;
    document: string;
    at: ErrorLocation;
    alternatives: StitchedAlternative[];
};
export type RuleChange = {
    kind: "replaced" | "extended";
    rule: string;
    document: string;
    previous: string;
};
export type SequenceItem = {
    symbol: import("./types.js").GrammarSymbol;
    capture?: string;
};
export type Where = {
    rule: StitchedRule;
    pending: PendingHelper[];
};
export type PendingHelper = {
    name: string;
    build: (where: Where) => SequenceItem[][];
    elided: string | null;
    elidedSpelling: string | null;
};
export declare class Grammar {
    stageName: string;
    unicode: {
        isMark(code: number): boolean;
    };
    /** @type {Map<string, StageConstant>} */
    constants: Map<string, StageConstant>;
    /**
     * The definitions of rules that use constants, which the loader checks
     * once the constants have their final values.
     * @type {{path: string, rule: DomRule}[]}
     */
    constantUsers: {
        path: string;
        rule: DomRule;
    }[];
    /** @type {Map<string, StitchedRule>} */
    rules: Map<string, StitchedRule>;
    /** @type {RuleChange[]} */
    changes: RuleChange[];
    /** @type {Set<string>} */
    elidable: Set<string>;
    /** @type {Resolution | null} */
    resolution: Resolution | null;
    /** @type {Map<string, LoweredGrammar>} */
    lowered: Map<string, LoweredGrammar>;
    /**
     * @param {string} stageName
     * @param {{path: string, dom: GrammarDom}[]} documents
     * @param {{isMark(code: number): boolean}} unicode the loader's table, for
     *   the tags of a range in a constant's value
     */
    constructor(stageName: string, documents: {
        path: string;
        dom: GrammarDom;
    }[], unicode: {
        isMark(code: number): boolean;
    });
    /**
     * @param {string} path
     * @param {GrammarDom} dom
     */
    addDocument(path: string, dom: GrammarDom): void;
    /**
     * An error of the document at a position of it (engine §2).
     * @param {string} path
     * @param {[number, number]} position
     * @param {string} message
     * @returns {GencmuError}
     */
    documentError(path: string, position: [number, number], message: string): GencmuError;
    /**
     * Defines or redefines a constant, with the value its term has at this
     * point of the stage (engine §2).
     * @param {string} path
     * @param {DomConstant} constant
     */
    addConstant(path: string, constant: DomConstant): void;
    /**
     * The error for a construct whose types disagree: at its first constant,
     * which the loader alone could type, or else at the item (engine §9).
     * @param {string} path
     * @param {unknown} node
     * @param {[number, number]} item
     * @param {string} problem
     * @returns {GencmuError}
     */
    faultError(path: string, node: unknown, item: [number, number], problem: string): GencmuError;
    /**
     * The value of a closed term, with the constants' values now (engine §2,
     * §10). An empty delimiter or a tag's string that is not a name comes
     * from a constant here, since the reader refuses a literal one, and the
     * error stands at that constant.
     * @param {string} path
     * @param {Term} term
     * @param {[number, number]} item the position of the definition
     * @returns {TermValue}
     */
    evaluateClosed(path: string, term: Term, item: [number, number]): TermValue;
    /**
     * Gives every constant in a rule its final value, once the stage is
     * stitched, and checks what the reader could not: that each is defined,
     * that the types agree, and that a constant that split or tag reads
     * directly is a delimiter that is not empty, or a name (engine §2, §9,
     * §10).
     */
    resolveConstants(): void;
    checkReferences(): void;
    /**
     * The productions for a set of enabled features; `strict` makes elidable
     * optionals mandatory (engine §3.8).
     * @param {Set<string>} features
     * @param {boolean} strict
     * @returns {LoweredGrammar}
     */
    lower(features: Set<string>, strict: boolean): LoweredGrammar;
}
/**
 * @param {string} name
 * @returns {boolean}
 */
export declare function isTerminalName(name: string): boolean;
/**
 * The captures a term or condition names.
 * @param {Term | Condition} term
 * @returns {string[]}
 */
export declare function termVariables(term: Term | Condition): string[];
/**
 * @param {Condition} condition
 * @returns {string[]}
 */
export declare function conditionVariables(condition: Condition): string[];
