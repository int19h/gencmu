import { UnicodeTable } from "../unicode.js";
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
 * @param {any} unicode
 */
export declare function readBootstrap50(text: string, unicode: any): Map<string, any>;
/**
 * Validates a DOM that did not come from the reader: a cache entry or a
 * supplied DOM. The record table checks the members, positions and operand
 * forms of each record, as the reader writes them.
 * @param {any} dom
 * @param {any} path
 * @param {any} unicode
 */
export declare function validateStoredDom(dom: any, path: any, unicode: any): void;
export declare class Loader50 {
    read: (path: string) => string | undefined;
    namesOverride: (path: string) => boolean;
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
     * @param {(path: string) => boolean} [namesOverride] whether the reader
     * gives a names resource of its own in place of the bundled one
     */
    constructor(read: (path: string) => string | undefined, namesOverride?: (path: string) => boolean);
    /** @param {any} path */
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
    /**
     * A names resource from the reader. The reader supplies the reference
     * file under its reserved key, and no other file stands in for it
     * (engine §1, "Unicode names for string escapes").
     * @param {any} file
     */
    namesResource(file: any): string;
    /**
     * The DOM of a document, read from its source.
     * @param {any} path
     * @param {any} inherited
     */
    documentDom(path: any, inherited: any): any;
    /**
     * @param {any} path
     * @param {any} inherited
     */
    findDom(path: any, inherited: any): any;
    /**
     * Whether the names dependency of a cache entry matches the names
     * resources that the document selects now (docs/output.md, "Preparsed
     * DOMs"). An entry without the member loaded no names, so it matches.
     * A bundled resource that the reader does not override uses the
     * fingerprint of the registry, and any other resource is read.
     * @param {any} dependencies the names member of the entry
     * @param {string[]} extras the extra resources that the document selects
     * @param {Record<string, string> | undefined} registry the bundledNames
     * of the cache file
     * @returns {boolean}
     */
    namesMatch(dependencies: any, extras: string[], registry: Record<string, string> | undefined): boolean;
    /**
     * Uses the entries of an optional cache whose fingerprints match this
     * loader: the bootstrap, the Unicode table, its properties and the format.
     * Each entry keeps the names registry of its file.
     * @param {any} data
     */
    usePreparsed(data: any): void;
    /** @param {any} path */
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
    /**
     * @param {any} path
     * @param {any} domOf
     * @param {Map<string, import("./bridge.js").HiddenKeys>} [hidden] the hidden keys of each document
     * @returns {Pipeline50}
     */
    build(path: any, domOf: any, hidden?: Map<string, import("./bridge.js").HiddenKeys>): Pipeline50;
}
export declare class Pipeline50 {
    path: any;
    stages: any;
    loader: any;
    declared: any;
    /**
     * @param {any} path
     * @param {any} stages
     * @param {any} loader
     * @param {any} declared
     */
    constructor(path: any, stages: any, loader: any, declared: any);
    /**
     * Parses a text.
     * @param {string} text
     * @param {any} [options]
     */
    parse(text: string, options?: any): {
        format: number;
        stageTrees: any;
        ok: boolean;
        text: string;
        origin: Token50[];
        stages: any[];
        tree: number | null;
        error: any;
        warnings: any[];
        features: any[];
    };
}
/**
 * The bootstrap file of a set of read documents, in the form that
 * `data/preparsed50/gencmu.json` uses.
 * @param {Map<string, any>} entries each document's entry
 * @param {(path: string) => string} read
 */
export declare function bootstrapText(entries: Map<string, any>, read: (path: string) => string, names?: string[]): string;
