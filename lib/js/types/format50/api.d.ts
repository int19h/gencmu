import { Loader50 } from "./loader.js";
import { resultJson50, decodeResult50 } from "./result.js";
import { nodeBrackets50, nodeTree50 } from "./render.js";
/**
 * Refuses a notation version that this library cannot load.
 * @param {unknown} version
 */
export declare function requireNotation50(version: unknown): void;
/**
 * The bundled pipeline names of a list of resource paths.
 * @param {string[]} paths
 * @returns {string[]}
 */
export declare function bundledPipelines50(paths: string[]): string[];
/**
 * The loaders of notation 50 over documents held in memory.
 * @param {number} version
 */
export declare function portableLoaders(version: number): {
    notation: number;
    loaderFromSources: (sources: Map<string, string> | Record<string, string>) => Loader50;
    loadPipelineSources: (/** @type {Map<string, string> | Record<string, string>} */ sources: Map<string, string> | Record<string, string>, /** @type {string} */ pipelinePath: string) => import("./loader.js").Pipeline50;
    resultJson: typeof resultJson50;
    decodeResult: typeof decodeResult50;
    nodeBrackets: typeof nodeBrackets50;
    nodeTree: typeof nodeTree50;
};
