import { RankedGroups } from "./ranked.js";
import { GencmuError } from "./errors.js";
import type { Condition, DomAlternative, DomClassifier, DomEntry, DomConstant, DomImplication, DomRule, Emission, ErrorLocation, Expr, GrammarDom, LoweredGrammar, Resolution, SymbolTest, TagSet, Term, TermValue, TestOp } from "./types.js";
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
    order: number;
};
export type RuleClauses = {
    tags: Term | undefined;
    emit: Emission | undefined;
    conditions: Condition[];
    erased: boolean;
    value: import("./types.js").Recipe | undefined;
    image: import("./types.js").Recipe | undefined;
    error: import("./types.js").Recipe | undefined;
    warning: import("./types.js").Recipe | undefined;
    suppressWarnings: string[] | undefined;
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
    captureTerminal?: boolean;
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
    elidedValue?: string;
    elidedTest: SymbolTest | null;
};
export declare class Grammar {
    stageName: string;
    unicode: import("./unicode.js").UnicodeTable;
    /** @type {Map<string, StageConstant>} */
    constants: Map<string, StageConstant>;
    /** @type {any[]} */ constantVersions: any[];
    /** @type {Map<string, any>} */ finalConstants: Map<string, any>;
    /**
     * The definitions of rules that use constants, which the loader checks
     * once the constants have their final values.
     * @type {{path: string, rule: DomRule}[]}
     */
    constantUsers: {
        path: string;
        rule: DomRule;
    }[];
    /** @type {{path:string, rule:DomRule, run:number}[]} */
    emissionUsers: {
        path: string;
        rule: DomRule;
        run: number;
    }[];
    /** @type {Map<string, StitchedRule>} */
    rules: Map<string, StitchedRule>;
    alternativeOrder: number;
    /** @type {RuleChange[]} */
    changes: RuleChange[];
    /** @type {Resolution | null} */
    resolution: Resolution | null;
    /** @type {any} */ rankingReport: any;
    elisionOnly: boolean;
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
    /** @type {{path:string,directive:import("./types.js").DomDirective}[]} */
    featureItems: {
        path: string;
        directive: import("./types.js").DomDirective;
    }[];
    /** @type {{run:number,at:number[],kind:number,check:()=>void}[]} */
    validationItems: {
        run: number;
        at: number[];
        kind: number;
        check: () => void;
    }[];
    erasureChecks: any;
    templates: any;
    instances: any;
    /** @type {WeakMap<DomEntry,string[]>} */
    classifierKeys: WeakMap<DomEntry, string[]>;
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
     * @type {Map<string, Map<string, Map<string, TagSet>> | GencmuError>}
     */
    classifierTables: Map<string, Map<string, Map<string, TagSet>> | GencmuError>;
    /**
     * Each test of a body with its value, made once for every lowering.
     * @type {WeakMap<object, SymbolTest>}
     */
    tests: WeakMap<object, SymbolTest>;
    /** @type {WeakMap<RuleClauses,WeakMap<object,{rule:string,condition:number,order:number}>>} */
    boundarySites: WeakMap<RuleClauses, WeakMap<object, {
        rule: string;
        condition: number;
        order: number;
    }>>;
    boundaries: {
        text: {
            rules: Set<any>;
            terminals: Set<any>;
        };
        all: {
            rules: Set<any>;
            terminals: Set<any>;
        };
        queries: {
            rule: any;
            alternative: any;
            target: any;
            reached: {
                rules: Set<any>;
                terminals: Set<any>;
            };
        }[];
        atoms: {
            rule: any;
            alternative: any;
            atom: any;
        }[];
    };
    /** @type {any[]} */
    defaultValues: any[];
    families: Map<string, Set<string>>;
    ranked: RankedGroups;
    /**
     * The features that gate an alternative or an entry of a classifier.
     * Only these change a lowered grammar. A warning keeps its alternative
     * (engine §3.1), and any other name matches no guard (engine §13).
     * @type {string[]}
     */
    gates: string[];
    /**
     * The lowered grammars, keyed by the gates that are on.
     * @type {Map<string, LoweredGrammar | GencmuError>}
     */
    lowered: Map<string, LoweredGrammar | GencmuError>;
    treeComparisons: boolean | undefined;
    /** @type {Map<string,string>} */ queryTargets: Map<string, string>;
    /** @type {Map<string,string>} */ queryNames: Map<string, string>;
    /** @type {Map<string,StitchedRule>} */ queryRules: Map<string, StitchedRule>;
    /** @type {{rule:StitchedRule,alternative:StitchedAlternative}[]} */
    errorAlternatives: {
        rule: StitchedRule;
        alternative: StitchedAlternative;
    }[];
    /**
     * @param {string} stageName
     * @param {{path: string, dom: GrammarDom}[]} documents
     * @param {import("./unicode.js").UnicodeTable} unicode
     *   the loader's table, for the tags of a range in a constant's value and
     *   the canonical value of a string constant in a test
     */
    constructor(stageName: string, documents: {
        path: string;
        dom: GrammarDom;
    }[], unicode: import("./unicode.js").UnicodeTable);
    /**
     * @param {string} path
     * @param {GrammarDom} dom
     * @param {number} inspectionRun
     */
    addDocument(path: string, dom: GrammarDom, inspectionRun: number): void;
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
     * Records an immutable constant version. Final bindings select the
     * dependency graph before evaluation (engine §2).
     * @param {string} path
     * @param {DomConstant} constant
     */
    addConstant(path: string, constant: DomConstant): void;
    bindConstants(): void;
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
     * §10). A joined empty delimiter errors at the definition. A direct
     * constant delimiter errors at its reference.
     * @param {string} path
     * @param {Term} term
     * @param {[number, number]} item the position of the definition
     * @param {(name:string) => TermValue} [lookup]
     * @param {TermType} [expected]
     * @returns {TermValue}
     */
    evaluateClosed(path: string, term: Term, item: [number, number], lookup?: (name: string) => TermValue, expected?: TermType): TermValue;
    /** @param {any} node @param {string} path @param {[number,number]} at @returns {any} */
    resolvePatterns(node: any, path: string, at: [number, number]): any;
    /** @param {string} path @param {DomRule} rule @param {number} inspectionRun @returns {DomRule} */
    checkConstantRule(path: string, rule: DomRule, inspectionRun: number): DomRule;
    /** @param {any} root @param {string} path @param {[number,number]} at @param {boolean} [computed] */
    checkValueUses(root: any, path: string, at: [number, number], computed?: boolean): void;
    /** @param {any[]} ends @param {string} path @param {[number,number]} at */
    checkRangeUses(ends: any[], path: string, at: [number, number]): void;
    /** @param {any} root @param {string} path @param {[number,number]} at */
    checkPatternUses(root: any, path: string, at: [number, number]): void;
    /** @param {string} path @param {import("./types.js").DomDirective} directive @param {number} inspectionRun */
    resolveFeature(path: string, directive: import("./types.js").DomDirective, inspectionRun: number): {
        path: string;
        directive: import("./types.js").DomDirective;
    };
    /** @param {string} path @param {DomClassifier} classifier */
    resolveClassifierKeys(path: string, classifier: DomClassifier): void;
    /**
     * Substitutes final values in the stitched rules after declaration checks.
     * Clauses shared by alternatives stay shared (engine §2).
     */
    resolveConstants(): void;
    /**
     * A test of a body with its value, from the constants' final values
     * (engine §2, §4).
     * @param {{test: TestOp, value?: Term, requirements?: import("./types.js").Requirement[], expr?:Expr}} test
     * @param {string} path
     * @param {ErrorLocation} at
     * @returns {SymbolTest}
     */
    symbolTest(test: {
        test: TestOp;
        value?: Term;
        requirements?: import("./types.js").Requirement[];
        expr?: Expr;
    }, path: string, at: ErrorLocation): SymbolTest;
    prepareQueries(): void;
    checkReferences(): void;
    checkDiagnosticsAndSplices(): void;
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
