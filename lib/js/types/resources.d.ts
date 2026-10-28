export declare const BOOTSTRAP_PATH = "data/preparsed/gencmu.json";
export declare const NOTATION_PATH = "grammars/gencmu/jbogenbau/pipeline.md";
/** @param {string} name @returns {boolean} */
export declare function validPipelineName(name: string): boolean;
/**
 * Lists valid pipeline names without reading their documents.
 * @param {Map<string,string> | Record<string,string>} [sources]
 * @returns {string[]}
 */
export declare function bundledPipelines(sources?: Map<string, string> | Record<string, string>): string[];
/** @param {string} document @returns {string | undefined} */
export declare function preparsedPath(document: string): string | undefined;
