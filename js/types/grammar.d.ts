import type { Condition, DomAlternative, Emission, ErrorLocation, GrammarDom, LoweredGrammar, Resolution, Term } from "./types.js";
export type StitchedAlternative = DomAlternative & {
    clauses: RuleClauses;
    document: string;
};
export type RuleClauses = {
    tags: Term | undefined;
    emit: Emission | undefined;
    conditions: Condition[];
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
};
export declare class Grammar {
    stageName: string;
    /** @type {Map<string, StitchedRule>} */
    rules: Map<string, StitchedRule>;
    /** @type {RuleChange[]} */
    changes: RuleChange[];
    /** @type {Set<string>} */
    elidable: Set<string>;
    /** @type {Resolution | null} */
    resolution: Resolution | null;
    /** @type {string | null} */
    freeModifiers: string | null;
    /** @type {Map<string, LoweredGrammar>} */
    lowered: Map<string, LoweredGrammar>;
    /**
     * @param {string} stageName
     * @param {{path: string, dom: GrammarDom}[]} documents
     */
    constructor(stageName: string, documents: {
        path: string;
        dom: GrammarDom;
    }[]);
    /**
     * @param {string} path
     * @param {GrammarDom} dom
     */
    addDocument(path: string, dom: GrammarDom): void;
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
