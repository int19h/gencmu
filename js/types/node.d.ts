import { Loader } from "./dialect.js";
export * from "./index.js";
/** @returns {string} */
export declare function bundledGrammarsDirectory(): string;
/**
 * @param {string} [directory]
 * @returns {Loader}
 */
export declare function loaderFromDirectory(directory?: string): Loader;
