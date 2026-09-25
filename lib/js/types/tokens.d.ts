import type { TagSet, Span } from "./types.js";
import type { UnicodeTable } from "./unicode.js";
/** @import { TagSet, Span } from "./types.js" */
/** @import { UnicodeTable } from "./unicode.js" */
export declare class Token {
    tags: TagSet;
    span: Span;
    source: Span;
    text: string;
    phonemes: string | null;
    insertedBy: string | undefined;
    verbatim: boolean;
    /**
     * @param {TagSet} tags
     * @param {Span} span the tokens of the stage before it this token covers
     * @param {Span} source the code points of the text it covers
     * @param {string} text the text it covers, as written
     * @param {string | null} phonemes what it sounds like
     * @param {string | undefined} insertedBy the rule that inserted it, for a
     *   token no text stands for
     * @param {boolean} [verbatim] whether it sounds like its text (engine §11)
     */
    constructor(tags: TagSet, span: Span, source: Span, text: string, phonemes: string | null, insertedBy: string | undefined, verbatim?: boolean);
}
/**
 * @param {string} text
 * @param {UnicodeTable} unicode
 * @returns {Token[]}
 */
export declare function characterTokens(text: string, unicode: UnicodeTable): Token[];
/**
 * @param {string} text
 * @returns {string[]}
 */
export declare function codePoints(text: string): string[];
