import { Loader, Dialect } from "./dialect.js";
export * from "./index.js";
/** @returns {string} */
export declare function bundledGrammarsDirectory(): string;
/**
 * @param {string} [directory]
 * @returns {Loader}
 */
export declare function loaderFromDirectory(directory?: string): Loader;
/**
 * A bundled dialect by name: `grammars/dialects/NAME.md`.
 * @param {string} name
 * @returns {Dialect}
 */
export declare function loadDialect(name: string): Dialect;
/**
 * A dialect from a pipeline document on disk; its grammar documents are
 * found relative to it, and the Unicode table and the bootstrap come from
 * the bundled grammars.
 * @param {string} file
 * @returns {Dialect}
 */
export declare function loadDialectFile(file: string): Dialect;
/**
 * A dialect from documents held in memory, a map or a plain object from path
 * to text, and the path of the pipeline document among them. The Unicode
 * table, the bootstrap and the precompiled DOMs come from the bundled
 * grammars unless the map has its own.
 * @param {Map<string, string> | Record<string, string>} sources
 * @param {string} pipelinePath
 * @returns {Dialect}
 */
export declare function loadDialectSources(sources: Map<string, string> | Record<string, string>, pipelinePath: string): Dialect;
