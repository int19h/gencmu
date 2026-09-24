/**
 * @param {string} markdown
 * @param {string} path
 * @returns {{text: string, positions: import("./types.js").Position[]}}
 */
export declare function extractGrammarText(markdown: string, path: string): {
    text: string;
    positions: import("./types.js").Position[];
};
/**
 * @param {string} text
 * @returns {string[]}
 */
export declare function splitLines(text: string): string[];
/**
 * @param {string} markdown
 * @param {string} path
 * @returns {{name: string, documents: string[]}[]}
 */
export declare function readPipeline(markdown: string, path: string): {
    name: string;
    documents: string[];
}[];
/**
 * @param {string} from
 * @param {string} relative
 * @returns {string}
 */
export declare function resolvePath(from: string, relative: string): string;
