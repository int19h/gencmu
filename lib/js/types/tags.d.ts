import type { TagSet } from "./types.js";
/**
 * The canonical diagnostic spelling of a scalar string (engine §9.1).
 * @param {string} value
 * @param {import("./unicode.js").UnicodeTable} unicode
 * @returns {string}
 */
export declare function stringName(value: string, unicode: import("./unicode.js").UnicodeTable): string;
/**
 * @param {Iterable<string>} [tags]
 * @returns {TagSet}
 */
export declare function tagSet(tags?: Iterable<string>): TagSet;
/**
 * Every tag of either set.
 * @param {TagSet} left
 * @param {TagSet} right
 * @returns {TagSet}
 */
export declare function tagUnion(left: TagSet, right: TagSet): TagSet;
/**
 * The union of many tag sets, built by adding each to one set that the
 * union owns. A fold of tagUnion copies its growing left side at every
 * step, so k sets would cost the square of k. Like tagUnion, the result can
 * be one of the sets given, until a second set with tags arrives, so no
 * caller may change it.
 */
export declare class TagUnion {
    /** @type {TagSet} */
    tags: TagSet;
    owned: boolean;
    constructor();
    /** @param {TagSet} tags */
    add(tags: TagSet): void;
    /**
     * The union, a new empty set when nothing had tags, as the folds that
     * this replaces gave.
     * @returns {TagSet}
     */
    result(): TagSet;
}
/**
 * The tags of both sets.
 * @param {TagSet} left
 * @param {TagSet} right
 * @returns {TagSet}
 */
export declare function tagIntersection(left: TagSet, right: TagSet): TagSet;
/**
 * The tags of the first set that are not in the second.
 * @param {TagSet} left
 * @param {TagSet} right
 * @returns {TagSet}
 */
export declare function tagDifference(left: TagSet, right: TagSet): TagSet;
/**
 * Whether every tag of the first set is in the second.
 * @param {TagSet} small
 * @param {TagSet} large
 * @returns {boolean}
 */
export declare function isSubset(small: TagSet, large: TagSet): boolean;
/**
 * A stable, unambiguous string for a tag set: its tags in code point order.
 * @param {TagSet} tags
 * @returns {string}
 */
export declare function tagKey(tags: TagSet): string;
/**
 * @param {TagSet} left
 * @param {TagSet} right
 * @returns {boolean}
 */
export declare function sameTags(left: TagSet, right: TagSet): boolean;
/**
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export declare function compareCodePoints(left: string, right: string): number;
/**
 * A tag set's tags in code point order, as the output lists them.
 * @param {TagSet} tags
 * @returns {string[]}
 */
export declare function sortedTags(tags: TagSet): string[];
/**
 * Whether a string is a name, and so an identifier tag (engine §1).
 * @param {string} tag
 * @returns {boolean}
 */
export declare function isName(tag: string): boolean;
/** @param {string} string @param {string} digits @returns {Set<string>} */
export declare function ngrams(string: string, digits: string): Set<string>;
/**
 * The value of split(string, delimiter) (engine §10): the pieces between
 * the occurrences of the delimiter, found from the left without overlap,
 * with the empty pieces dropped. The delimiter is not empty.
 * @param {string} string
 * @param {string} delimiter
 * @returns {Set<string>}
 */
export declare function splitString(string: string, delimiter: string): Set<string>;
/**
 * Whether a string is a user tag or a reserved engine tag (engine §1).
 * @param {unknown} tag
 * @param {{isMark(code: number): boolean, changesInDocument?(code:number):boolean}} [unicode]
 * @returns {boolean}
 */
export declare function isTag(tag: unknown, unicode?: {
    isMark(code: number): boolean;
    changesInDocument?(code: number): boolean;
}): boolean;
/**
 * The written form of a range, its identity as a terminal (engine §4):
 * its two ends, in their canonical spelling, joined by `..`.
 * @param {[string, string]} range
 * @returns {string}
 */
export declare function rangeName(range: [string, string]): string;
