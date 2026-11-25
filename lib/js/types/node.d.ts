import { Loader, Pipeline } from "./pipeline.js";
export * from "./index.js";
import { Loader50 } from "./format50/loader.js";
/**
 * The loaders of one notation version: the bundled, disk and source-map
 * loaders of notation 50. Other versions are a usage error.
 * @param {number} version
 */
export declare function loaderForNotation(version: number): {
    notation: number;
    loaderFromSources: (sources: Map<string, string> | Record<string, string>) => Loader50;
    resultJson: typeof import("./format50/result.js").resultJson50;
    decodeResult: typeof import("./format50/result.js").decodeResult50;
    nodeBrackets: typeof import("./format50/render.js").nodeBrackets50;
    nodeTree: typeof import("./format50/render.js").nodeTree50;
    bundledPipelines: () => string[];
    /** @param {string} name */
    loadPipeline(name: string): import("./format50/loader.js").Pipeline50;
    /**
     * A loader over the grammar sources of another root, such as a
     * checkout: the documents under its grammars50 directory, with the
     * bootstrap, the caches and the Unicode data of this package.
     * @param {string} directory
     */
    loaderFromDirectory(directory: string): Loader50;
    /** @param {string} file */
    loadPipelineFile(file: string): import("./format50/loader.js").Pipeline50;
    /**
     * @param {Map<string, string> | Record<string, string>} sources
     * @param {string} pipelinePath
     */
    loadPipelineSources(sources: Map<string, string> | Record<string, string>, pipelinePath: string): import("./format50/loader.js").Pipeline50;
};
/** @returns {string} */
export declare function bundledGrammarsDirectory(): string;
/**
 * @param {string} [directory]
 * @returns {Loader}
 */
export declare function loaderFromDirectory(directory?: string): Loader;
/**
 * A bundled pipeline by name: `grammars/NAME/pipeline.md`.
 * @param {string} name
 * @returns {Pipeline}
 */
export declare function loadPipeline(name: string): Pipeline;
/**
 * Lists the package's pipelines, or those of a supplied source map.
 * @param {Map<string,string> | Record<string,string>} [sources]
 * @returns {string[]}
 */
export declare function bundledPipelines(sources?: Map<string, string> | Record<string, string>): string[];
/**
 * A pipeline from a pipeline document on disk; its grammar documents are
 * found relative to it, and the Unicode table and the bootstrap come from
 * the bundled resources. Each document is known by its absolute path, with
 * `/` between the parts, so an error names the file wherever the process
 * runs.
 * @param {string} file
 * @returns {Pipeline}
 */
export declare function loadPipelineFile(file: string): Pipeline;
/**
 * A pipeline from documents held in memory, a map or a plain object from path
 * to text, and the path of the pipeline document among them. The Unicode
 * table, the bootstrap and the preparsed DOMs come from the bundled
 * grammars unless the map has its own.
 * @param {Map<string, string> | Record<string, string>} sources
 * @param {string} pipelinePath
 * @returns {Pipeline}
 */
export declare function loadPipelineSources(sources: Map<string, string> | Record<string, string>, pipelinePath: string): Pipeline;
