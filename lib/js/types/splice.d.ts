import type { DomClassifier, DomConstant, DomDirective, DomImplication, DomRule, DomCheck, GrammarDom } from "./types.js";
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
} | {
    check: DomCheck;
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
export type IncludeFrame = {
    path: string;
    dom: GrammarDom;
    items: Item[];
    next: number;
    names: string[];
    inherited: string[];
};
/**
 * A pipeline's documents as one jbogenbau text: its features in one %features,
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
