import type { TagSet, Span } from "./types.js";
import type { UnicodeTable } from "./unicode.js";
export type AttachedToken = Omit<Token, "span">;
/** @import { TagSet, Span } from "./types.js" */
/** @import { UnicodeTable } from "./unicode.js" */
/**
 * A token attached to another (engine §11): a token with no span, since its
 * span counts the input of the stage that attached it.
 * @typedef {Omit<Token, "span">} AttachedToken
 */
/** @type {AttachedToken[]} */
export declare const NO_ATTACHMENTS: AttachedToken[];
export declare class Token {
    tags: TagSet;
    span: Span;
    source: Span;
    text: string;
    phonemes: string | null;
    insertedBy: string | undefined;
    label: string;
    /**
     * The tokens attached before this one (engine §11), none by default.
     * @type {AttachedToken[]}
     */
    before: AttachedToken[];
    /**
     * The tokens attached after this one (engine §11), none by default.
     * @type {AttachedToken[]}
     */
    after: AttachedToken[];
    /**
     * @param {TagSet} tags
     * @param {Span} span the tokens of the stage before it this token covers
     * @param {Span} source the code points of the text it covers
     * @param {string} text the text it covers, as written
     * @param {string | null} phonemes what it sounds like
     * @param {string | undefined} insertedBy the rule that inserted it, for a
     *   token no text stands for
     * @param {string} [label] what it shows to people (engine §5): by default
     *   its text, as for a character token or one that a caller supplies
     */
    constructor(tags: TagSet, span: Span, source: Span, text: string, phonemes: string | null, insertedBy: string | undefined, label?: string);
}
/**
 * Whether a token has attachments (engine §11).
 * @param {AttachedToken} token
 * @returns {boolean}
 */
export declare function hasAttachments(token: AttachedToken): boolean;
/**
 * A token as an attachment: the same token without its span (engine §11).
 * @param {Token} token
 * @returns {AttachedToken}
 */
export declare function attached(token: Token): AttachedToken;
export declare class Sources {
    tokens: Token[];
    /**
     * Made at the first question: null when the tokens are in order.
     * @type {{lows: number[][], highs: number[][]} | null | undefined}
     */
    table: {
        lows: number[][];
        highs: number[][];
    } | null | undefined;
    /** @param {Token[]} tokens */
    constructor(tokens: Token[]);
    /**
     * The source of tokens [start, end), which must not be empty.
     * @param {number} start
     * @param {number} end
     * @returns {Span}
     */
    of(start: number, end: number): Span;
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
