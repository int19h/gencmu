import { Stage } from "./stage.js";
import { Token } from "./tokens.js";
import { UnicodeTable } from "./unicode.js";
import type { Feature, GrammarDom, ParseOptions, ParseResult, Resources, ResultNode } from "./types.js";
export type CompiledEntry = {
    hash: string;
    dom: GrammarDom;
};
export type RunOptions = {
    features: Set<string>;
    until?: string;
    elisionOnly?: boolean | null;
    tokens?: Token[];
};
/** @import { Feature, GrammarDom, ParseError, ParseOptions, ParseResult, Resources, ResultNode, StageReport } from "./types.js" */
/**
 * A precompiled document of compiled.json.
 * @typedef {{hash: string, dom: GrammarDom}} CompiledEntry
 */
/**
 * The options one run of the stages takes.
 * @typedef {object} RunOptions
 * @property {Set<string>} features
 * @property {string} [until]
 * @property {boolean | null} [elisionOnly]
 * @property {Token[]} [tokens]
 */
export declare class Loader {
    read: Resources;
    unicode: UnicodeTable;
    bootstrapHash: string;
    notation: Dialect;
    /** @type {Map<string, CompiledEntry>} */
    compiled: Map<string, CompiledEntry>;
    /** @type {Map<string, GrammarDom>} */
    cache: Map<string, GrammarDom>;
    /** @param {Resources} read */
    constructor(read: Resources);
    /**
     * A resource's text, or a grammar error when it is missing.
     * @param {string} path
     * @returns {string}
     */
    need(path: string): string;
    /**
     * The DOM of a grammar document, from the cache when its text, the
     * bootstrap and the format all match, else read with the notation.
     * @param {string} path
     * @returns {GrammarDom}
     */
    documentDom(path: string): GrammarDom;
    /**
     * Reads a grammar document's Markdown into its DOM with the notation.
     * @param {string} markdown
     * @param {string} path
     * @param {boolean} [deferEmission] slot checks precede absent-carrier pruning
     * @returns {GrammarDom}
     */
    readDocument(markdown: string, path: string, deferEmission?: boolean): GrammarDom;
    /**
     * A dialect from its pipeline document's path.
     * @param {string} path
     * @returns {Dialect}
     */
    dialect(path: string): Dialect;
    /**
     * The stages of the pipeline document at `path`, each a list of runs of
     * one document's items, and the features the pipeline turns on (engine
     * §13).
     * @param {string} path
     * @returns {{stages: import("./pipeline.js").SplicedStage[], features: string[]}}
     */
    pipeline(path: string): {
        stages: import("./pipeline.js").SplicedStage[];
        features: string[];
    };
}
export declare class Dialect {
    path: string;
    stages: Stage[];
    loader: Loader;
    declared: string[];
    /** @type {Feature[]} the dialect's features, with their kinds and defaults */
    features: Feature[];
    /**
     * @param {string} path
     * @param {Stage[]} stages
     * @param {Loader} loader
     * @param {string[]} [declared] the features the pipeline turns on
     */
    constructor(path: string, stages: Stage[], loader: Loader, declared?: string[]);
    /**
     * Parses a text.
     * @param {string} text
     * @param {ParseOptions} [options]
     * @returns {ParseResult}
     */
    parse(text: string, options?: ParseOptions): ParseResult;
    /**
     * Runs the stages, continuing a probe's stages where it stopped.
     * @param {string} text
     * @param {RunOptions} options
     * @param {ParseResult | null} continued
     * @returns {ParseResult}
     */
    run(text: string, options: RunOptions, continued: ParseResult | null): ParseResult;
}
/**
 * A document's DOM from the notation's syntax tree of it: the reader's DOM,
 * held to the rules of a precompiled DOM, or a grammar error at its place
 * (engine §9). The hand-written reader of tools/bootstrap-reader.js reads
 * its own tree with it too.
 * @param {ResultNode} tree
 * @param {Token[]} tokens the syntax stage's input tokens
 * @param {(token: Token) => import("./types.js").Position} positionOf
 * @param {string} path
 * @param {UnicodeTable} unicode
 * @param {boolean} [deferEmission] slot checks precede absent-carrier pruning
 * @returns {GrammarDom}
 */
export declare function domOfTree(tree: ResultNode, tokens: Token[], positionOf: (token: Token) => import("./types.js").Position, path: string, unicode: UnicodeTable, deferEmission?: boolean): GrammarDom;
/**
 * @param {string} text
 * @returns {string}
 */
export declare function fnv1a64(text: string): string;
