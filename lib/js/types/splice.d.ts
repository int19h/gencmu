import type { DomClassifier, DomConstant, DomDirective, DomImplication, DomRule, GrammarDom } from "./types.js";
export type Item = {
    rule: DomRule;
} | {
    directive: DomDirective;
} | {
    constant: DomConstant;
} | {
    classifier: DomClassifier;
} | {
    implication: DomImplication;
};
export type SplicedStage = {
    name: string;
    at: {
        document: string;
        line: number;
        column: number;
    };
    documents: {
        path: string;
        dom: GrammarDom;
    }[];
    changes: StageChange[];
};
export type StageChange = {
    kind: "extended" | "replaced";
    document: string;
    line: number;
    column: number;
};
/** @import { DomClassifier, DomConstant, DomDirective, DomImplication, DomRule, GrammarDom } from "./types.js" */
/**
 * An item of a document: a rule, a directive, a constant's definition, a
 * classifier or an implication.
 * @typedef {{rule: DomRule} | {directive: DomDirective} | {constant: DomConstant} | {classifier: DomClassifier}
 *   | {implication: DomImplication}} Item
 */
/**
 * One stage of a spliced pipeline: its name, where its %stage stands, and its
 * items as runs of consecutive items of one document, each with a DOM that
 * holds exactly those items.
 * @typedef {{name: string, at: {document: string, line: number, column: number}, documents: {path: string, dom: GrammarDom}[], changes: StageChange[]}} SplicedStage
 * @typedef {{kind: "extended" | "replaced", document: string, line: number, column: number}} StageChange
 */
/**
 * A document's rules, directives, constants, classifiers and implications
 * in the order they were written, which is the order of their positions
 * (engine §9).
 * @param {GrammarDom} dom
 * @returns {Item[]}
 */
export declare function itemsInOrder(dom: GrammarDom): Item[];
/**
 * Splices the pipeline document at `path`. `domOf` gives a document's DOM,
 * or undefined when the document does not exist.
 * @param {string} path
 * @param {(path: string, names:string[]) => GrammarDom | undefined} domOf
 * @returns {{stages: SplicedStage[], features: string[]}}
 */
export declare function splicePipeline(path: string, domOf: (path: string, names: string[]) => GrammarDom | undefined): {
    stages: SplicedStage[];
    features: string[];
};
/**
 * A pipeline's pipeline as one jbogenbau text: its features in one %features,
 * then every item of the spliced stream but %include, %names and global
 * %features. Strings use their canonical spelling. Other source text stays
 * as written, with a comment naming each document run (docs/notation.md).
 * @param {{path: string, declared: string[], loader: import("./pipeline.js").Loader}} pipeline
 * @returns {string}
 */
export declare function stitchText(pipeline: {
    path: string;
    declared: string[];
    loader: import("./pipeline.js").Loader;
}): string;
