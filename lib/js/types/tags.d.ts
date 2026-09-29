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
 * The value of split(string, delimiter) (engine §10): the pieces between
 * the occurrences of the delimiter, found from the left without overlap,
 * with the empty pieces dropped. The delimiter is not empty.
 * @param {string} string
 * @param {string} delimiter
 * @returns {Set<string>}
 */
export declare function splitString(string: string, delimiter: string): Set<string>;
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
/**
 * The scalar value of a character tag in its canonical spelling, or -1 for
 * any other tag. The tag is not checked beyond its first character: every
 * tag inside the engine is in its canonical spelling (engine §1).
 * @param {string} tag
 * @returns {number}
 */
export declare function codeOfCharacterTag(tag: string): number;
/**
 * The written form of a range, its identity as a terminal (engine §4):
 * its two ends, in their canonical spelling, joined by `..`.
 * @param {[string, string]} range
 * @returns {string}
 */
export declare function rangeName(range: [string, string]): string;
/**
 * The written form of a property, its identity as a terminal (engine §4).
 * @param {string} name
 * @returns {string}
 */
export declare function propertyName(name: string): string;
/**
 * The character tags of a range (engine §1), from its start to its end by
 * scalar value, the surrogates skipped.
 * @param {[string, string]} range
 * @param {{isMark(code: number): boolean}} unicode
 * @returns {TagSet}
 */
export declare function rangeTags(range: [string, string], unicode: {
    isMark(code: number): boolean;
}): TagSet;
