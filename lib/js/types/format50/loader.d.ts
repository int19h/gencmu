import { EmptyStageError } from "../errors.js";
import { resolvePath } from "../markdown.js";
import { UnicodeTable } from "../unicode.js";
import { isVisibleKey } from "./bridge.js";
import { Token50 } from "./stage.js";
/** The bundle of notation 50 in the package. */
export declare const BUNDLE_50: Readonly<{
    format: 50;
    sourceRoot: "grammars50";
    notation: "grammars50/gencmu/jbogenbau/pipeline.md";
    bootstrap: "data/preparsed50/gencmu.json";
    cacheRoot: "data/preparsed50";
}>;
/**
 * Reads the bootstrap: the DOMs of the notation pipeline.
 * @param {string} text
 * @returns {Map<string, any>} each document's entry
 */
export declare function readBootstrap50(text: string, unicode: any): Map<string, any>;
/**
 * Validates a DOM that did not come from the reader: a cache entry or a
 * supplied DOM. Every template argument record carries its position.
 */
export declare function validateStoredDom(dom: any, path: any, unicode: any): void;
export declare class Loader50 {
    read: (path: string) => string | undefined;
    unicode: UnicodeTable;
    bootstrapText: string;
    bootstrap: Map<string, any>;
    /** @type {Pipeline50 | null} */
    notationPipeline: Pipeline50 | null;
    /** @type {Map<string, any>} */
    documents: Map<string, any>;
    /** @type {Map<string, any>} the optional cache entries by document */
    preparsed: Map<string, any>;
    /** @type {Set<string>} the cache files read so far */
    preparsedFiles: Set<string>;
    /** @type {Map<string, any>} the DOMs that a caller supplies by document */
    supplied: Map<string, any>;
    /** @type {string[]} the documents whose DOM came from a cache entry */
    cacheHits: string[];
    bootstrapHash: string;
    unicodeHash: string;
    propertiesHash: string | null;
    /**
     * @param {(path: string) => string | undefined} read
     */
    constructor(read: (path: string) => string | undefined);
    need(path: any): string;
    /** The notation reader, built from the bootstrap alone. */
    notation(): Pipeline50;
    /**
     * Reads one grammar document with the notation reader (engine §8, §9).
     * @param {string} markdown
     * @param {string} path
     * @param {string[]} [inherited] the names resources of the including documents
     * @returns {{hash: string, names?: any, dom: any}}
     */
    readDocument(markdown: string, path: string, inherited?: string[]): {
        hash: string;
        names?: any;
        dom: any;
    };
    namesResource(file: any): string;
    /** The DOM of a document, read from its source. */
    documentDom(path: any, inherited: any): any;
    findDom(path: any, inherited: any): any;
    /**
     * Uses the entries of an optional cache whose fingerprints match this
     * loader: the bootstrap, the Unicode table, its properties and the format.
     * @param {any} data
     */
    usePreparsed(data: any): void;
    loadPreparsed(path: any): void;
    /**
     * Supplies the DOM of a document in place of its source.
     * @param {string} path
     * @param {string} json the DOM as JSON
     */
    supplyDom(path: string, json: string): void;
    /**
     * A pipeline from its pipeline document.
     * @param {string} path
     */
    pipeline(path: string): Pipeline50;
    build(path: any, domOf: any): Pipeline50;
}
export declare class Pipeline50 {
    path: any;
    stages: any;
    loader: any;
    declared: any;
    constructor(path: any, stages: any, loader: any, declared: any);
    /**
     * Parses a text.
     * @param {string} text
     * @param {object} [options]
     */
    parse(text: string, options?: object): {
        format: number;
        ok: boolean;
        text: string;
        origin: Token50[];
        stages: any[];
        tree: number | null;
        error: any;
        warnings: never[];
        features: any[];
    };
}
/**
 * The bootstrap file of a set of read documents, in the form that
 * `data/preparsed50/gencmu.json` uses.
 * @param {Loader50} loader
 * @param {Map<string, any>} entries each document's entry
 * @param {(path: string) => string | undefined} read
 */
export declare function bootstrapText(entries: Map<string, any>, read: (path: string) => string | undefined, names?: string[]): string;
export { isVisibleKey, resolvePath, EmptyStageError };
