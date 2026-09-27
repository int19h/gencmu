import type { DomDirective, DomRule, GrammarDom } from "./types.js";
export type Item = {
    rule: DomRule;
} | {
    directive: DomDirective;
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
};
/** @import { DomDirective, DomRule, GrammarDom } from "./types.js" */
/**
 * An item of a document: a rule or a directive.
 * @typedef {{rule: DomRule} | {directive: DomDirective}} Item
 */
/**
 * One stage of a spliced pipeline: its name, where its %stage stands, and its
 * items as runs of consecutive items of one document, each with a DOM that
 * holds exactly those items.
 * @typedef {{name: string, at: {document: string, line: number, column: number}, documents: {path: string, dom: GrammarDom}[]}} SplicedStage
 */
/**
 * A document's rules and directives in the order they were written, which is
 * the order of their positions (engine §9).
 * @param {GrammarDom} dom
 * @returns {Item[]}
 */
export declare function itemsInOrder(dom: GrammarDom): Item[];
/**
 * Splices the pipeline document at `path`. `domOf` gives a document's DOM,
 * or undefined when the document does not exist.
 * @param {string} path
 * @param {(path: string) => GrammarDom | undefined} domOf
 * @returns {{stages: SplicedStage[], features: string[]}}
 */
export declare function splicePipeline(path: string, domOf: (path: string) => GrammarDom | undefined): {
    stages: SplicedStage[];
    features: string[];
};
/**
 * A dialect's pipeline as one jbogenbau text: its features in one %features,
 * then every item of the spliced stream but %include and %features, each as
 * its author wrote it, with a comment naming the document of each run of
 * items as a string (docs/design.md, "Pipelines").
 * @param {{path: string, declared: string[], loader: {read: (path: string) => string | undefined, documentDom: (path: string) => GrammarDom}}} dialect
 * @returns {string}
 */
export declare function stitchText(dialect: {
    path: string;
    declared: string[];
    loader: {
        read: (path: string) => string | undefined;
        documentDom: (path: string) => GrammarDom;
    };
}): string;
