// Tokens (engine §1): what every stage reads and writes.

import { tagSet } from "./tags.js";

/** @import { TagSet, Span } from "./types.js" */
/** @import { UnicodeTable } from "./unicode.js" */

export class Token {
  /**
   * @param {TagSet} tags
   * @param {Span} span the tokens of the stage before it this token covers
   * @param {Span} source the code points of the text it covers
   * @param {string} text the text it covers, as written
   * @param {string | null} phonemes what it sounds like
   * @param {string | undefined} insertedBy the rule that inserted it, for a
   *   token no text stands for
   */
  constructor(tags, span, source, text, phonemes, insertedBy) {
    this.tags = tags;
    this.span = span;
    this.source = source;
    this.text = text;
    this.phonemes = phonemes;
    this.insertedBy = insertedBy;
  }
}

// The first stage's input: one token per code point, tagged with the
// character, strong, and its class, weak.
/**
 * @param {string} text
 * @param {UnicodeTable} unicode
 * @returns {Token[]}
 */
export function characterTokens(text, unicode) {
  const tokens = [];
  let index = 0;
  for (const character of text) {
    const tags = tagSet([[character, true]]);
    const kind = unicode.classOf(/** @type {number} */ (character.codePointAt(0)));
    if (!tags.has(kind)) tags.set(kind, false);
    tokens.push(new Token(tags, [index, index + 1], [index, index + 1], character, null, undefined));
    index++;
  }
  return tokens;
}

// A text's code points, for slicing by code point positions.
/**
 * @param {string} text
 * @returns {string[]}
 */
export function codePoints(text) {
  return [...text];
}
