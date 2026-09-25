export declare class UnicodeTable {
    /** @type {string | null} */
    version: string | null;
    /** @type {[number, number][]} */
    marks: [number, number][];
    /** @type {[number, number][]} */
    alphas: [number, number][];
    /** @type {Map<number, number>} */
    lower: Map<number, number>;
    /** @param {string} text the contents of unicode.txt */
    constructor(text: string);
    /**
     * The class tag of a code point (engine §1).
     * @param {number} code
     * @returns {"space" | "digit" | "mark" | "alpha" | "other"}
     */
    classOf(code: number): "space" | "digit" | "mark" | "alpha" | "other";
    /**
     * @param {string} text
     * @returns {string}
     */
    lowercase(text: string): string;
}
