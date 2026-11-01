import { Recent } from "./recent.js";
import { Stage } from "./stage.js";
import { Token } from "./tokens.js";
import { UnicodeTable } from "./unicode.js";
export { fnv1a64 } from "./hash.js";
import type { Feature, GrammarDom, ParseOptions, ParseResult, Resources } from "./types.js";
export type PreparsedEntry = {
    hash: string;
    dom: GrammarDom;
    names?: Record<string, string>;
    registry?: Record<string, string>;
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
 * A preparsed document of data/preparsed/FAMILY.json.
 * @typedef {{hash: string, dom: GrammarDom, names?: Record<string,string>, registry?: Record<string,string>}} PreparsedEntry
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
    bootstrapText: string;
    bootstrapHash: string;
    notation: Pipeline;
    /** @type {Recent<string, PreparsedEntry>} */
    preparsed: Recent<string, PreparsedEntry>;
    /** @type {Recent<string,boolean>} */
    preparsedFiles: Recent<string, boolean>;
    /** @type {WeakMap<GrammarDom, Record<string,string> | null>} */
    domRegistries: WeakMap<GrammarDom, Record<string, string> | null>;
    /** @type {Recent<string, GrammarDom>} */
    cache: Recent<string, GrammarDom>;
    /** @type {WeakMap<GrammarDom,Record<string,string>>} */
    namesDependencies: WeakMap<GrammarDom, Record<string, string>>;
    /** @type {Recent<string,string[]>} */
    inheritedNames: Recent<string, string[]>;
    /** @param {Resources} read @param {(path:string)=>boolean} [namesOverride] */
    constructor(read: Resources, namesOverride?: (path: string) => boolean);
    /**
     * Admit a cache envelope only under this loader's complete identity.
     * The playground uses the same gate for DOMs retained across workers.
     * @param {any} data
     * @param {boolean} [replace]
     */
    usePreparsed(data: any, replace?: boolean): void;
    /** @param {string} path */
    loadPreparsed(path: string): void;
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
     * @param {string} [text]
     * @returns {GrammarDom}
     */
    documentDom(path: string, inherited?: string[], text?: string): GrammarDom;
    /**
     * Reads a grammar document's Markdown into its DOM with the notation.
     * @param {string} markdown
     * @param {string} path
     * @param {boolean} [deferEmission] slot checks precede absent-carrier pruning
     * @param {string[]} [inherited]
     * @returns {GrammarDom}
     */
    readDocument(markdown: string, path: string, deferEmission?: boolean, inherited?: string[]): GrammarDom;
    /** @param {Record<string,string> | undefined} dependencies @param {string[]} extras @param {Record<string,string> | null} [registry] @returns {boolean} */
    namesMatch(dependencies: Record<string, string> | undefined, extras: string[], registry?: Record<string, string> | null): boolean;
    /**
     * A pipeline from its pipeline document's path.
     * @param {string} path
     * @returns {Pipeline}
     */
    pipeline(path: string): Pipeline;
    /**
     * The stages of the pipeline document at `path`, each a list of runs of
     * one document's items, and the features the pipeline turns on (engine
     * §13).
     * @param {string} path
     * @param {Map<string,{dom:GrammarDom,inherited:string[]}>} [documents]
     * @returns {{stages: import("./splice.js").SplicedStage[], features: string[]}}
     */
    splice(path: string, documents?: Map<string, {
        dom: GrammarDom;
        inherited: string[];
    }>): {
        stages: import("./splice.js").SplicedStage[];
        features: string[];
    };
}
export declare class Pipeline {
    path: string;
    stages: Stage[];
    loader: Loader;
    declared: string[];
    /** @type {Feature[]} the pipeline's features, with their kinds and defaults */
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
/** @param {Map<string, string>} sources */
export declare function checkSourceStrings(sources: Map<string, string>): void;
