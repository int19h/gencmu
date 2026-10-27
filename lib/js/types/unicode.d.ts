export declare const CATEGORIES: string[];
export declare const PROPERTY_NAMES: Set<string>;
export declare class UnicodeTable {
    /** @type {string | null} */
    version: string | null;
    versionCount: number;
    /** @type {Map<string, number>} */
    abbreviations: Map<string, number>;
    /** @type {Map<number,string>} */
    canonicalAbbreviations: Map<number, string>;
    /** @type {number[]} */
    starts: number[];
    /** @type {number[]} */
    ends: number[];
    /** @type {string[]} */
    categories: string[];
    /** @type {[number, number][]} */
    whiteSpace: [number, number][];
    /** @type {Map<string, [number, number][]>} */
    emoji: Map<string, [number, number][]>;
    /** @type {Map<number, number[]>} */
    decompositions: Map<number, number[]>;
    /** @type {[number, number, number][]} */
    combining: [number, number, number][];
    /** @type {Map<string,import("./unicode-properties.js").PropertyData>} */
    properties: Map<string, import("./unicode-properties.js").PropertyData>;
    /** @type {Map<number, readonly string[]>} */
    profiles: Map<number, readonly string[]>;
    /** @param {string} text the contents of data/unicode/unicode.txt @param {string} [properties] */
    constructor(text: string, properties?: string);
    /** @param {string} spelling @returns {string | null} */
    canonicalTag(spelling: string): string | null;
    /** @param {number} code @returns {readonly string[]} */
    profile(code: number): readonly string[];
    /**
     * The General_Category of a code point, in its short form (engine §1):
     * `Cs` for a surrogate, which a table does not list, and `Cn` for any
     * other code point that the table omits.
     * @param {number} code
     * @returns {string}
     */
    category(code: number): string;
    /** @param {string} property @param {number} code @returns {boolean} */
    hasEmoji(property: string, code: number): boolean;
    /** @param {string} name @returns {boolean} */
    isEmojiName(name: string): boolean;
    /** @param {number} code @returns {number} */
    combiningClass(code: number): number;
    /** @param {number} code @returns {boolean} */
    changesInDocument(code: number): boolean;
    /**
     * Canonical decomposition, with each scalar's original code point index.
     * Sorting only nonzero runs preserves class-zero barriers and equal classes.
     * @param {string} text
     * @returns {{character:string, origin:number, klass:number}[]}
     */
    decomposeWithOrigins(text: string): {
        character: string;
        origin: number;
        klass: number;
    }[];
    /** @param {string} text @returns {string} */
    decompose(text: string): string;
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
