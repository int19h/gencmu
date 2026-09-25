import type { TagSet } from "./types.js";
/** @import { TagSet } from "./types.js" */
/**
 * @param {Iterable<[string, boolean]>} [entries]
 * @returns {TagSet}
 */
export declare function tagSet(entries?: Iterable<[string, boolean]>): TagSet;
/**
 * @param {string} tag
 * @returns {TagSet}
 */
export declare function strongTag(tag: string): TagSet;
/**
 * @param {string} tag
 * @returns {TagSet}
 */
export declare function weakTag(tag: string): TagSet;
/**
 * @param {TagSet} left
 * @param {TagSet} right
 * @returns {TagSet}
 */
export declare function tagUnion(left: TagSet, right: TagSet): TagSet;
/**
 * @param {TagSet} left
 * @param {TagSet} right
 * @returns {TagSet}
 */
export declare function tagIntersection(left: TagSet, right: TagSet): TagSet;
/**
 * @param {TagSet} tags
 * @returns {string}
 */
export declare function tagKey(tags: TagSet): string;
/**
 * @param {TagSet} left
 * @param {TagSet} right
 * @returns {boolean}
 */
export declare function sameTagNames(left: TagSet, right: TagSet): boolean;
/**
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export declare function compareCodePoints(left: string, right: string): number;
/**
 * @param {TagSet} tags
 * @returns {Record<string, boolean>}
 */
export declare function sortedTagObject(tags: TagSet): Record<string, boolean>;
