import { Stage } from "./stage.js";
import { Token } from "./tokens.js";
import { UnicodeTable } from "./unicode.js";
export { fnv1a64 } from "./hash.js";
import type { Feature, GrammarDom, ParseOptions, ParseResult, Resources, ResultNode } from "./types.js";
export type PreparsedEntry = {
    hash: string;
    dom: GrammarDom;
    names?: Record<string, string>;
};
export type RunOptions = {
    features: Set<string>;
    withoutFeatures?: Set<string>;
    until?: string;
    elisionOnly?: boolean | null;
    tokens?: Token[];
    inspectLexical?: (tokens: Token[]) => void;
};
/** @import { Feature, GrammarDom, ParseError, ParseOptions, ParseResult, Resources, ResultNode, StageReport } from "./types.js" */
/**
 * A preparsed document of compiled.json.
 * @typedef {{hash: string, dom: GrammarDom, names?: Record<string,string>}} PreparsedEntry
 */
/**
 * The options one run of the stages takes.
 * @typedef {object} RunOptions
 * @property {Set<string>} features
 * @property {Set<string>} [withoutFeatures]
 * @property {string} [until]
 * @property {boolean | null} [elisionOnly]
 * @property {Token[]} [tokens]
 * @property {(tokens:Token[])=>void} [inspectLexical]
 */
export declare class Loader {
    read: Resources;
    namesOverride: (path: string) => boolean;
    /** @type {Record<string,string> | undefined} */
    bundledNames: Record<string, string> | undefined;
    unicodeHash: string;
    unicode: UnicodeTable;
    propertiesHash: string | null;
    bootstrapHash: string;
    notation: Dialect;
    /** @type {Map<string, PreparsedEntry>} */
    preparsed: Map<string, PreparsedEntry>;
    /** @type {Map<string, GrammarDom>} */
    cache: Map<string, GrammarDom>;
    /** @type {WeakMap<GrammarDom,Record<string,string>>} */
    namesDependencies: WeakMap<GrammarDom, Record<string, string>>;
    /** @type {Map<string,string[]>} */
    inheritedNames: Map<string, string[]>;
    /** @param {Resources} read @param {(path:string)=>boolean} [namesOverride] */
    constructor(read: Resources, namesOverride?: (path: string) => boolean);
    /**
     * Admit a cache envelope only under this loader's complete identity.
     * The playground uses the same gate for DOMs retained across workers.
     * @param {any} data
     */
    usePreparsed(data: any): void;
    /**
     * A resource's text, or a grammar error when it is missing.
     * @param {string} path
     * @returns {string}
     */
    need(path: string): string;
    /** @param {string} path @returns {string} */
    needNames(path: string): string;
    /**
     * The DOM of a grammar document, from the cache when its text, the
     * bootstrap and the format all match, else read with the notation.
     * @param {string} path
     * @param {string[]} [inherited]
     * @returns {GrammarDom}
     */
    documentDom(path: string, inherited?: string[]): GrammarDom;
    /**
     * Reads a grammar document's Markdown into its DOM with the notation.
     * @param {string} markdown
     * @param {string} path
     * @param {boolean} [deferEmission] slot checks precede absent-carrier pruning
     * @param {string[]} [inherited]
     * @returns {GrammarDom}
     */
    readDocument(markdown: string, path: string, deferEmission?: boolean, inherited?: string[]): GrammarDom;
    /** @param {Record<string,string> | undefined} dependencies @param {string[]} extras @returns {boolean} */
    namesMatch(dependencies: Record<string, string> | undefined, extras: string[]): boolean;
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
     * @returns {{stages: import("./splice.js").SplicedStage[], features: string[]}}
     */
    splice(path: string): {
        stages: import("./splice.js").SplicedStage[];
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
     * Runs each selected stage once.
     * @param {string} text
     * @param {RunOptions} options
     * @returns {ParseResult}
     */
    run(text: string, options: RunOptions): ParseResult;
}
/**
 * A document's DOM from the notation's syntax tree of it: the reader's DOM,
 * held to the rules of a preparsed DOM, or a grammar error at its place
 * (engine §9). The hand-written reader of tools/bootstrap-reader.js reads
 * its own tree with it too.
 * @param {ResultNode} tree
 * @param {Token[]} tokens the syntax stage's input tokens
 * @param {(token: Token) => import("./types.js").Position} positionOf
 * @param {string} path
 * @param {UnicodeTable} unicode
 * @param {boolean} [deferEmission] slot checks precede absent-carrier pruning
 * @param {(token:Token, path:boolean)=>string} [decodeString]
 * @returns {GrammarDom}
 */
export declare function domOfTree(tree: ResultNode, tokens: Token[], positionOf: (token: Token) => import("./types.js").Position, path: string, unicode: UnicodeTable, deferEmission?: boolean, decodeString?: (token: Token, path: boolean) => string): GrammarDom;
