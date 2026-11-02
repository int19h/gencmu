/**
 * @param {string} markdown
 * @param {string} path
 * @param {import("./unicode.js").UnicodeTable} unicode
 * @returns {{text: string, positions: import("./types.js").Position[], blocks: number}}
 */
export declare function extractGrammarText(markdown: string, path: string, unicode: import("./unicode.js").UnicodeTable): {
    text: string;
    positions: import("./types.js").Position[];
    blocks: number;
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
