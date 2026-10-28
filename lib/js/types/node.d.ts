import { Loader, Pipeline } from "./pipeline.js";
export * from "./index.js";
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
