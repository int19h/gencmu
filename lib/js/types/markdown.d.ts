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
 * @param {string} from
 * @param {string} relative
 * @returns {string}
 */
export declare function resolvePath(from: string, relative: string): string;
