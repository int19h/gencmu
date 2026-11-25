import { Loader50 } from "./loader.js";
import { resultJson50, decodeResult50 } from "./result.js";
/** Refuses a notation version that this library cannot load. */
export declare function requireNotation50(version: any): void;
/** The bundled pipeline names of a list of resource paths. */
export declare function bundledPipelines50(paths: any): any;
/**
 * The loaders of notation 50 over documents held in memory.
 * @param {number} version
 */
export declare function portableLoaders(version: number): {
    notation: number;
    loaderFromSources: (sources: any) => Loader50;
    loadPipelineSources: (sources: any, pipelinePath: any) => import("./loader.js").Pipeline50;
    resultJson: typeof resultJson50;
    decodeResult: typeof decodeResult50;
};
