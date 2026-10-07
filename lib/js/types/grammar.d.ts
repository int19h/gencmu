import { GencmuError } from "./errors.js";
import type { Condition, DomAlternative, DomClassifier, DomConstant, DomImplication, DomRule, Emission, ErrorLocation, GrammarDom, LoweredGrammar, Resolution, SymbolTest, TagSet, Term, TermValue, TestOp } from "./types.js";
import type { TermType } from "./dom.js";
export type StageConstant = {
    value: TermValue;
    type: TermType;
    document: string;
};
export type StageImplication = {
    if: TagSet;
    then: TagSet;
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
    opaque: boolean;
};
export type StitchedRule = {
    name: string;
    document: string;
    at: ErrorLocation;
    alternatives: StitchedAlternative[];
    flags: string[];
};
export type RuleChange = {
    kind: "replaced" | "extended";
    rule: string;
    document: string;
    previous: string;
    flagChange?: {
        from: string[];
        to: string[];
    };
};
export type SequenceItem = {
    symbol: import("./types.js").GrammarSymbol;
    capture?: string;
};
export type Where = {
    rule: StitchedRule;
    alternative: StitchedAlternative;
    pending: PendingHelper[];
};
export type PendingHelper = {
    name: string;
    build: (where: Where) => SequenceItem[][];
    elided: string | null;
    elidedTest: SymbolTest | null;
};
export declare class Grammar {
    stageName: string;
    unicode: {
        isMark(code: number): boolean;
        lowercase(text: string): string;
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
    /** @type {Resolution | null} */
    resolution: Resolution | null;
    /**
     * The stage's `%classifier` items in stitching order, each with its
     * document (engine §2).
     * @type {{path: string, classifier: DomClassifier}[]}
     */
    classifierItems: {
        path: string;
        classifier: DomClassifier;
    }[];
    /** @type {{path: string, implication: DomImplication}[]} */
    implicationItems: {
        path: string;
        implication: DomImplication;
    }[];
    /** @type {StageImplication[]} */
    implications: StageImplication[];
    /**
     * The features that gate an entry of a classifier. Only these change
     * the classifiers' values.
     * @type {string[]}
     */
    classifierGates: string[];
    /**
     * The classifiers resolved for each set of the classifier gates that is
     * on (engine §2).
     * @type {Map<string, Map<string, Map<string, TagSet>>>}
     */
    classifierTables: Map<string, Map<string, Map<string, TagSet>>>;
    /**
     * Each test of a body with its value, made once for every lowering.
     * @type {WeakMap<object, SymbolTest>}
     */
    tests: WeakMap<object, SymbolTest>;
    /**
     * The features that gate an alternative or an entry of a classifier.
     * Only these change a lowered grammar. A warning keeps its alternative
     * (engine §3.1), and any other name matches no guard (engine §13).
     * @type {string[]}
     */
    gates: string[];
    /**
     * The lowered grammars, keyed by the gates that are on.
     * @type {Map<string, LoweredGrammar>}
     */
    lowered: Map<string, LoweredGrammar>;
    /**
     * @param {string} stageName
     * @param {{path: string, dom: GrammarDom}[]} documents
     * @param {{isMark(code: number): boolean, lowercase(text: string): string}} unicode
     *   the loader's table, for the tags of a range in a constant's value and
     *   the canonical sound of a string constant in a test
     */
    constructor(stageName: string, documents: {
        path: string;
        dom: GrammarDom;
    }[], unicode: {
        isMark(code: number): boolean;
        lowercase(text: string): string;
    });
    /**
     * @param {string} path
     * @param {GrammarDom} dom
     */
    addDocument(path: string, dom: GrammarDom): void;
    /**
     * An implication's two sides, with the constants' final values: closed
     * terms whose type is a tag set (engine §2, §9).
     * @param {string} path
     * @param {DomImplication} implication
     * @returns {StageImplication}
     */
    resolveImplication(path: string, implication: DomImplication): StageImplication;
    /**
     * Each classifier of the stage for one set of features: each key's
     * classes after every entry whose gates hold, in stitching order (engine
     * §2). An entry that adds a membership that holds, or removes one that
     * does not, is an error of the grammar for these features.
     * @param {Set<string>} features
     * @returns {Map<string, Map<string, TagSet>>}
     */
    classifiers(features: Set<string>): Map<string, Map<string, TagSet>>;
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
    /**
     * A test of a body with its value, from the constants' final values
     * (engine §2, §4).
     * @param {{test: TestOp, value: Term}} test
     * @param {string} path
     * @param {ErrorLocation} at
     * @returns {SymbolTest}
     */
    symbolTest(test: {
        test: TestOp;
        value: Term;
    }, path: string, at: ErrorLocation): SymbolTest;
    checkReferences(): void;
    /**
     * The productions for a set of enabled features. The check of
     * elision-only reads the same productions in a mode of its own (engine
     * §3.8, §7.4).
     * @param {Set<string>} features
     * @returns {LoweredGrammar}
     */
    lower(features: Set<string>): LoweredGrammar;
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
