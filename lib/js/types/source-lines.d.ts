export type LineIndex = {
    characters: string[];
    breaks: number[];
};
/** @typedef {{characters:string[],breaks:number[]}} LineIndex */
/**
 * @param {Iterable<string>} text
 * @returns {LineIndex}
 */
export declare function lineIndex(text: Iterable<string>): LineIndex;
/** @param {LineIndex} lines @param {number} offset */
export declare function positionAt({ breaks }: LineIndex, offset: number): {
    line: number;
    column: number;
    lineStart: number;
};
/**
 * @param {LineIndex} lines
 * @param {import("./types.js").Span} source code point range
 * @returns {{line: number, column: number, excerpt: string}}
 */
export declare function excerptAt({ characters, breaks }: LineIndex, source: import("./types.js").Span): {
    line: number;
    column: number;
    excerpt: string;
};
