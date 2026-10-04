// Tags and tag sets (engine §1). A tag is a string in its canonical
// spelling: an identifier tag is a name, a phoneme tag is `/p/`, and a
// character tag is one character between quotes, `'a'`. A tag has no
// strength, so a tag set is a set of these strings.

/** @import { TagSet } from "./types.js" */

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
  if (right.size === 0) return left;
  if (left.size === 0) return right;
  const result = new Set(left);
  for (const tag of right) result.add(tag);
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
    if (tags.size === 0) return;
    if (this.tags.size === 0) {
      this.tags = tags;
      return;
    }
    if (!this.owned) {
      this.tags = new Set(this.tags);
      this.owned = true;
    }
    for (const tag of tags) this.tags.add(tag);
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
  const result = new Set();
  for (const tag of left) if (right.has(tag)) result.add(tag);
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
  for (const tag of left) if (!right.has(tag)) result.add(tag);
  return result;
}

/**
 * Whether every tag of the first set is in the second.
 * @param {TagSet} small
 * @param {TagSet} large
 * @returns {boolean}
 */
export function isSubset(small, large) {
  for (const tag of small) if (!large.has(tag)) return false;
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
  if (left.size !== right.size) return false;
  for (const tag of left) if (!right.has(tag)) return false;
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
 * A tag set's tags in code point order, as the output lists them.
 * @param {TagSet} tags
 * @returns {string[]}
 */
export function sortedTags(tags) {
  return [...tags].sort(compareCodePoints);
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
 * Whether a tag is a phoneme tag: three code points, the first and last
 * `/` (engine §1).
 * @param {string} tag
 * @returns {boolean}
 */
export function isPhonemeTag(tag) {
  return tag.length >= 3 && tag[0] === "/" && tag[tag.length - 1] === "/" && [...tag].length === 3;
}

/**
 * Whether a code point is written as `\u{h…}` in a character tag's
 * canonical spelling (engine §1): a control character, a nonspacing mark,
 * a private-use character, the quote or the backslash.
 * @param {number} code
 * @param {{isMark(code: number): boolean}} unicode
 * @returns {boolean}
 */
function escapedInTag(code, unicode) {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x27 || code === 0x5c ||
    (code >= 0xe000 && code <= 0xf8ff) || (code >= 0xf0000 && code <= 0xffffd) || (code >= 0x100000 && code <= 0x10fffd) ||
    unicode.isMark(code);
}

/**
 * The character tag of a Unicode scalar value, in its canonical spelling
 * (engine §1): `'a'`, or `'\u{301}'` for a code point that is escaped.
 * @param {number} code
 * @param {{isMark(code: number): boolean}} unicode
 * @returns {string}
 */
export function characterTag(code, unicode) {
  if (escapedInTag(code, unicode)) return `'\\u{${code.toString(16).toUpperCase()}}'`;
  return `'${String.fromCodePoint(code)}'`;
}

/**
 * The scalar value that a character tag in its canonical spelling names,
 * or null for a string that is not one.
 * @param {string} tag
 * @param {{isMark(code: number): boolean}} unicode
 * @returns {number | null}
 */
export function characterOfTag(tag, unicode) {
  if (tag.length < 3 || tag[0] !== "'" || tag[tag.length - 1] !== "'") return null;
  const inner = tag.slice(1, -1);
  let code;
  const escaped = /^\\u\{([0-9A-F]{1,6})\}$/.exec(inner);
  if (escaped) code = parseInt(escaped[1], 16);
  else if ([...inner].length === 1) code = /** @type {number} */ (inner.codePointAt(0));
  else return null;
  if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return null;
  return characterTag(code, unicode) === tag ? code : null;
}

/**
 * Whether a string is a tag in its canonical spelling: a name, a phoneme
 * tag or a character tag (engine §1). Without a table, which says which
 * code points are marks, a character tag passes in either spelling that a
 * table could make canonical.
 * @param {unknown} tag
 * @param {{isMark(code: number): boolean}} [unicode]
 * @returns {boolean}
 */
export function isTag(tag, unicode) {
  if (typeof tag !== "string") return false;
  if (isName(tag) || isPhonemeTag(tag)) return true;
  if (unicode) return characterOfTag(tag, unicode) !== null;
  // No mark lies below U+0300.
  return characterOfTag(tag, { isMark: () => false }) !== null || characterOfTag(tag, { isMark: (code) => code >= 0x300 }) !== null;
}

/**
 * The scalar value of a character tag in its canonical spelling, or -1 for
 * any other tag. The tag is not checked beyond its first character: every
 * tag inside the engine is in its canonical spelling (engine §1).
 * @param {string} tag
 * @returns {number}
 */
export function codeOfCharacterTag(tag) {
  if (tag.charCodeAt(0) !== 0x27) return -1;
  if (tag.charCodeAt(1) === 0x5c) return parseInt(tag.slice(4, -2), 16);
  return /** @type {number} */ (tag.codePointAt(1));
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

/**
 * The written form of a property, its identity as a terminal (engine §4).
 * @param {string} name
 * @returns {string}
 */
export function propertyName(name) {
  return `'\\p{${name}}'`;
}

/**
 * The character tags of a range (engine §1), from its start to its end by
 * scalar value, the surrogates skipped.
 * @param {[string, string]} range
 * @param {{isMark(code: number): boolean}} unicode
 * @returns {TagSet}
 */
export function rangeTags(range, unicode) {
  const result = new Set();
  const last = codeOfCharacterTag(range[1]);
  for (let code = codeOfCharacterTag(range[0]); code <= last; code++) {
    if (code === 0xd800) code = 0xe000;
    if (code > last) break;
    result.add(characterTag(code, unicode));
  }
  return result;
}

/**
 * A test as an expected list writes it after its terminal (docs/output.md):
 * its comparator and its value in canonical form. A string stands between
 * double quotes, a backslash before each `\` and `"`. A tag set is `∅`, its
 * one tag, or its tags in code point order joined by ` ∪ ` in parentheses.
 * @param {string} op
 * @param {{string: string} | {set: Set<string>}} value
 * @returns {string}
 */
export function writtenTest(op, value) {
  let written;
  if ("string" in value) {
    written = `"${value.string.replace(/[\\"]/g, (character) => `\\${character}`)}"`;
  } else {
    const tags = sortedTags(value.set);
    written = tags.length === 0 ? "∅" : tags.length === 1 ? tags[0] : `(${tags.join(" ∪ ")})`;
  }
  if (op === "∩=∅" || op === "∩≠∅") return `∩${written}${op.slice(1)}`;
  return `${op}${written}`;
}
