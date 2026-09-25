// Tag sets: a map from tag to strength, true for strong and false for weak.

/** @import { TagSet } from "./types.js" */

/**
 * @param {Iterable<[string, boolean]>} [entries]
 * @returns {TagSet}
 */
export function tagSet(entries) {
  return new Map(entries || []);
}

/**
 * @param {string} tag
 * @returns {TagSet}
 */
export function strongTag(tag) {
  return new Map([[tag, true]]);
}

/**
 * @param {string} tag
 * @returns {TagSet}
 */
export function weakTag(tag) {
  return new Map([[tag, false]]);
}

// Every tag of either set, strong if it is strong in either.
/**
 * @param {TagSet} left
 * @param {TagSet} right
 * @returns {TagSet}
 */
export function tagUnion(left, right) {
  const result = new Map(left);
  for (const [tag, strong] of right) {
    result.set(tag, (result.get(tag) || false) || strong);
  }
  return result;
}

// The tags of the first set that are also in the second, with the first's
// strength.
/**
 * @param {TagSet} left
 * @param {TagSet} right
 * @returns {TagSet}
 */
export function tagIntersection(left, right) {
  const result = new Map();
  for (const [tag, strong] of left) {
    if (right.has(tag)) result.set(tag, strong);
  }
  return result;
}

// A stable, unambiguous string for a tag set: its tags in code point order,
// each with its strength.
/**
 * @param {TagSet} tags
 * @returns {string}
 */
export function tagKey(tags) {
  return JSON.stringify([...tags.keys()].sort(compareCodePoints).map((tag) => [tag, tags.get(tag)]));
}

/**
 * @param {TagSet} left
 * @param {TagSet} right
 * @returns {boolean}
 */
export function sameTagNames(left, right) {
  if (left.size !== right.size) return false;
  for (const tag of left.keys()) if (!right.has(tag)) return false;
  return true;
}

// Orders strings by code point, as the specification requires, rather than
// by UTF-16 unit as JavaScript's default comparison does.
/**
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function compareCodePoints(left, right) {
  const a = [...left];
  const b = [...right];
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const difference = /** @type {number} */ (a[index].codePointAt(0)) - /** @type {number} */ (b[index].codePointAt(0));
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

/**
 * @param {TagSet} tags
 * @returns {Record<string, boolean>}
 */
export function sortedTagObject(tags) {
  /** @type {Record<string, boolean>} */
  const result = {};
  for (const tag of [...tags.keys()].sort(compareCodePoints)) result[tag] = /** @type {boolean} */ (tags.get(tag));
  return result;
}
