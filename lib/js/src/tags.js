import { PROPERTY_NAMES } from "./unicode.js";
// Stored user and engine tags, and their set operations (engine §1).

/** @import { TagSet } from "./types.js" */

import { countWork, hooks } from "./testing.js";

/**
 * The canonical diagnostic spelling of a scalar string (engine §9.1).
 * @param {string} value
 * @param {import("./unicode.js").UnicodeTable} unicode
 * @returns {string}
 */
export function stringName(value, unicode) {
  let result = '"';
  for (const character of value) {
    const code = /** @type {number} */ (character.codePointAt(0));
    if (character === '"' || character === "‹" || code <= 0x1f || code >= 0x7f && code <= 0x9f
      || unicode.isMark(code) || unicode.category(code) === "Cf" || unicode.changesInDocument(code)
      || code !== 0x20 && unicode.isWhiteSpace(code)
      || code >= 0xe000 && code <= 0xf8ff || code >= 0xf0000 && code <= 0xffffd || code >= 0x100000 && code <= 0x10fffd) {
      result += "‹" + (unicode.canonicalAbbreviations.get(code) ?? "U+" + code.toString(16).toUpperCase().padStart(4,"0")) + "›";
    } else result += character;
  }
  return result + '"';
}

/**
 * @param {Iterable<string>} [tags]
 * @returns {TagSet}
 */
export function tagSet(tags) {
  return new Set(tags || []);
}

/**
 * Every tag of either set.
 * @param {TagSet} left
 * @param {TagSet} right
 * @returns {TagSet}
 */
export function tagUnion(left, right) {
  if (left === right) return left;
  if (right.size === 0) return left;
  if (left.size === 0) return right;
  // Each tag counts as it is copied, so a budget stops the union at the
  // first tag past it.
  const result = new Set();
  for (const tag of left) {
    if (hooks.work) countWork(hooks.work, "tags");
    result.add(tag);
  }
  for (const tag of right) {
    if (hooks.work) countWork(hooks.work, "tags");
    result.add(tag);
  }
  return result;
}

/**
 * The union of many tag sets, built by adding each to one set that the
 * union owns. A fold of tagUnion copies its growing left side at every
 * step, so k sets would cost the square of k. Like tagUnion, the result can
 * be one of the sets given, until a second set with tags arrives, so no
 * caller may change it.
 */
export class TagUnion {
  constructor() {
    /** @type {TagSet} */
    this.tags = EMPTY_TAGS;
    this.owned = false;
  }
  /** @param {TagSet} tags */
  add(tags) {
    if (tags === this.tags) return;
    if (tags.size === 0) return;
    if (this.tags.size === 0) {
      this.tags = tags;
      return;
    }
    if (!this.owned) {
      /** @type {TagSet} */
      const owned = new Set();
      for (const tag of this.tags) {
        if (hooks.work) countWork(hooks.work, "tags");
        owned.add(tag);
      }
      this.tags = owned;
      this.owned = true;
    }
    for (const tag of tags) {
      if (hooks.work) countWork(hooks.work, "tags");
      this.tags.add(tag);
    }
  }
  /**
   * The union, a new empty set when nothing had tags, as the folds that
   * this replaces gave.
   * @returns {TagSet}
   */
  result() {
    return this.tags === EMPTY_TAGS ? new Set() : this.tags;
  }
}

/** @type {TagSet} */
const EMPTY_TAGS = new Set();

/**
 * The tags of both sets.
 * @param {TagSet} left
 * @param {TagSet} right
 * @returns {TagSet}
 */
export function tagIntersection(left, right) {
  // Each tag of the left side counts as it is read, before its lookup in
  // the right side, so a budget stops a fold of many sets at once.
  const result = new Set();
  for (const tag of left) {
    if (hooks.work) countWork(hooks.work, "tags");
    if (right.has(tag)) result.add(tag);
  }
  return result;
}

/**
 * The tags of the first set that are not in the second.
 * @param {TagSet} left
 * @param {TagSet} right
 * @returns {TagSet}
 */
export function tagDifference(left, right) {
  const result = new Set();
  for (const tag of left) {
    if (hooks.work) countWork(hooks.work, "tags");
    if (!right.has(tag)) result.add(tag);
  }
  return result;
}

/**
 * Whether every tag of the first set is in the second.
 * @param {TagSet} small
 * @param {TagSet} large
 * @returns {boolean}
 */
export function isSubset(small, large) {
  if (small === large) return true;
  for (const tag of small) {
    if (hooks.work) countWork(hooks.work, "tags");
    if (!large.has(tag)) return false;
  }
  return true;
}

/**
 * A stable, unambiguous string for a tag set: its tags in code point order.
 * @param {TagSet} tags
 * @returns {string}
 */
export function tagKey(tags) {
  return JSON.stringify(sortedTags(tags));
}

/**
 * @param {TagSet} left
 * @param {TagSet} right
 * @returns {boolean}
 */
export function sameTags(left, right) {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const tag of left) {
    if (hooks.work) countWork(hooks.work, "tags");
    if (!right.has(tag)) return false;
  }
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
  let a = 0, b = 0;
  while (a < left.length && b < right.length) {
    const first = /** @type {number} */ (left.codePointAt(a));
    const second = /** @type {number} */ (right.codePointAt(b));
    if (first !== second) return first - second;
    a += first > 0xffff ? 2 : 1;
    b += second > 0xffff ? 2 : 1;
  }
  return left.length - a - (right.length - b);
}

/**
 * A tag set's tags in code point order, as the output lists them.
 * @param {TagSet} tags
 * @returns {string[]}
 */
export function sortedTags(tags) {
  const names = [...tags];
  // UTF-16 and code-point order agree unless a string contains a surrogate.
  return names.some(name => /[\uD800-\uDFFF]/.test(name)) ? names.sort(compareCodePoints) : names.sort();
}

const NAME = /^[A-Za-z][A-Za-z0-9-]*$/;

/**
 * Whether a string is a name, and so an identifier tag (engine §1).
 * @param {string} tag
 * @returns {boolean}
 */
export function isName(tag) {
  return NAME.test(tag);
}

/** @param {string} string @param {string} digits @returns {Set<string>} */
export function ngrams(string, digits) {
  const points = [...string], n = Number(digits);
  const result = new Set();
  for (let i = 0; i + n <= points.length; i++) result.add(points.slice(i, i + n).join(""));
  return result;
}

/**
 * The value of split(string, delimiter) (engine §10): the pieces between
 * the occurrences of the delimiter, found from the left without overlap,
 * with the empty pieces dropped. The delimiter is not empty.
 * @param {string} string
 * @param {string} delimiter
 * @returns {Set<string>}
 */
export function splitString(string, delimiter) {
  return new Set(string.split(delimiter).filter((piece) => piece !== ""));
}





/**
 * Whether a string is a user tag or a reserved engine tag (engine §1).
 * @param {unknown} tag
 * @param {{isMark(code: number): boolean, changesInDocument?(code:number):boolean, canonicalTag?(name:string):string|null}} [unicode]
 * @returns {boolean}
 */
export function isTag(tag, unicode) {
  if (typeof tag !== "string") return false;
  return /^[A-Z][A-Za-z0-9_-]*$/.test(tag) || tag.startsWith("_") && (unicode?.canonicalTag ? unicode.canonicalTag(tag) !== null : PROPERTY_NAMES.has(tag.slice(1)));
}


/**
 * The written form of a range, its identity as a terminal (engine §4):
 * its two ends, in their canonical spelling, joined by `..`.
 * @param {[string, string]} range
 * @returns {string}
 */
export function rangeName(range) {
  return `${range[0]}..${range[1]}`;
}
