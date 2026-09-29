import type { TagSet } from "./types.js";
/** @import { TagSet } from "./types.js" */
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
/**
 * Whether a tag is a phoneme tag: three code points, the first and last
 * `/` (engine §1).
 * @param {string} tag
 * @returns {boolean}
 */
export declare function isPhonemeTag(tag: string): boolean;
/**
 * The character tag of a Unicode scalar value, in its canonical spelling
 * (engine §1): `'a'`, or `'\u{301}'` for a code point that is escaped.
 * @param {number} code
 * @param {{isMark(code: number): boolean}} unicode
 * @returns {string}
 */
export declare function characterTag(code: number, unicode: {
    isMark(code: number): boolean;
}): string;
/**
 * The scalar value that a character tag in its canonical spelling names,
 * or null for a string that is not one.
 * @param {string} tag
 * @param {{isMark(code: number): boolean}} unicode
 * @returns {number | null}
 */
export declare function characterOfTag(tag: string, unicode: {
    isMark(code: number): boolean;
}): number | null;
/**
 * Whether a string is a tag in its canonical spelling: a name, a phoneme
 * tag or a character tag (engine §1). Without a table, which says which
 * code points are marks, a character tag passes in either spelling that a
 * table could make canonical.
 * @param {unknown} tag
 * @param {{isMark(code: number): boolean}} [unicode]
 * @returns {boolean}
 */
export declare function isTag(tag: unknown, unicode?: {
    isMark(code: number): boolean;
}): boolean;
