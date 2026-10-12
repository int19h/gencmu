export declare const CATEGORIES: string[];
export declare const PROPERTY_NAMES: Set<string>;
export declare class UnicodeTable {
    /** @type {string | null} */
    version: string | null;
    /** @type {number[]} */
    starts: number[];
    /** @type {number[]} */
    ends: number[];
    /** @type {string[]} */
    categories: string[];
    /** @type {[number, number][]} */
    whiteSpace: [number, number][];
    /** @param {string} text the contents of unicode.txt */
    constructor(text: string);
    /**
     * The General_Category of a code point, in its short form (engine §1):
     * `Cs` for a surrogate, which a table does not list, and `Cn` for any
     * other code point that the table omits.
     * @param {number} code
     * @returns {string}
     */
    category(code: number): string;
    /**
     * Whether a code point is a nonspacing mark, of General_Category Mn.
     * @param {number} code
     * @returns {boolean}
     */
    isMark(code: number): boolean;
    /**
     * Whether a code point has the White_Space property.
     * @param {number} code
     * @returns {boolean}
     */
    isWhiteSpace(code: number): boolean;
}
