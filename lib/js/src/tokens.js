// Tokens (engine §1): what every stage reads and writes.

import { GencmuError } from "./errors.js";
import { tagSet } from "./tags.js";

/** @import { TagSet, Span } from "./types.js" */
/** @import { UnicodeTable } from "./unicode.js" */

/**
 * A token attached to another (engine §11): a token with no span, since its
 * span counts the input of the stage that attached it.
 * @typedef {Omit<Token, "span">} AttachedToken
 */

// The attachments of a token that has none: one frozen list, shared, so that
// a character token costs no lists of its own.
/** @type {AttachedToken[]} */
export const NO_ATTACHMENTS = /** @type {AttachedToken[]} */ (/** @type {unknown} */ (Object.freeze([])));

export class Token {
  /**
   * @param {TagSet} tags
   * @param {Span} span the tokens of the stage before it this token covers
   * @param {Span} source the code points of the text it covers
   * @param {string} text the text it covers, as written
   * @param {string} [value] the stored comparison string
   * @param {string | undefined} insertedBy the rule that inserted it, for a
   *   token no text stands for
   * @param {string} [image] what it shows to people (engine §5): by default
   *   its text, as for a caller-supplied token
   */
  constructor(tags, span, source, text, value = text, insertedBy = undefined, image = text) {
    this.tags = tags;
    this.span = span;
    this.source = source;
    this.text = text;
    this.value = value;
    this.insertedBy = insertedBy;
    this.image = image;
    /**
     * The tokens attached before this one (engine §11), none by default.
     * @type {AttachedToken[]}
     */
    this.before = NO_ATTACHMENTS;
    /**
     * The tokens attached after this one (engine §11), none by default.
     * @type {AttachedToken[]}
     */
    this.after = NO_ATTACHMENTS;
  }
}

/**
 * Whether a token has attachments (engine §11).
 * @param {AttachedToken} token
 * @returns {boolean}
 */
export function hasAttachments(token) {
  return token.before.length > 0 || token.after.length > 0;
}

/**
 * A token as an attachment: the same token without its span (engine §11).
 * @param {Token} token
 * @returns {AttachedToken}
 */
export function attached(token) {
  const { span, ...rest } = token;
  void span;
  return rest;
}

// The source of a run of tokens (engine §1): from the least source start
// among them to the greatest source end. Tokens usually lie in the order of
// their sources, and then that is the first token's start and the last
// token's end. Otherwise a table of the least start and the greatest end of
// every run of a power of two tokens answers without a scan, so that the
// nested nodes of a long left-recursive rule cost no more than its tokens.
export class Sources {
  /** @param {Token[]} tokens */
  constructor(tokens) {
    this.tokens = tokens;
    /**
     * Made at the first question: null when the tokens are in order.
     * @type {{lows: number[][], highs: number[][]} | null | undefined}
     */
    this.table = undefined;
  }

  /**
   * The source of tokens [start, end), which must not be empty.
   * @param {number} start
   * @param {number} end
   * @returns {Span}
   */
  of(start, end) {
    if (this.table === undefined) this.table = sourceTable(this.tokens);
    if (this.table === null) return [this.tokens[start].source[0], this.tokens[end - 1].source[1]];
    // Two runs of a power of two tokens cover the span between them.
    const level = 31 - Math.clz32(end - start);
    const other = end - (1 << level);
    const lows = this.table.lows[level];
    const highs = this.table.highs[level];
    return [Math.min(lows[start], lows[other]), Math.max(highs[start], highs[other])];
  }
}

/**
 * @param {Token[]} tokens
 * @returns {{lows: number[][], highs: number[][]} | null}
 */
function sourceTable(tokens) {
  let ordered = true;
  for (let index = 1; index < tokens.length && ordered; index++) {
    const before = tokens[index - 1].source;
    const after = tokens[index].source;
    ordered = before[0] <= after[0] && before[1] <= after[1];
  }
  if (ordered) return null;
  // lows[k][i] is the least start of tokens [i, i + 2^k), and highs[k][i]
  // the greatest end.
  const lows = [tokens.map((token) => token.source[0])];
  const highs = [tokens.map((token) => token.source[1])];
  for (let width = 1; 2 * width <= tokens.length; width *= 2) {
    const low = lows[lows.length - 1];
    const high = highs[highs.length - 1];
    /** @type {number[]} */
    const nextLow = [];
    /** @type {number[]} */
    const nextHigh = [];
    for (let index = 0; index + 2 * width <= tokens.length; index++) {
      nextLow.push(Math.min(low[index], low[index + width]));
      nextHigh.push(Math.max(high[index], high[index + width]));
    }
    lows.push(nextLow);
    highs.push(nextHigh);
  }
  return { lows, highs };
}

// The first stage's input: one token per decomposed scalar, with its
// original source and the scalar's engine tags (engine §1).
/**
 * @param {string} text
 * @param {UnicodeTable} unicode
 * @returns {Token[]}
 */
export function characterTokens(text, unicode) {
  if (/[\uD800-\uDFFF]/u.test(text)) throw new GencmuError("usage", "the text contains a lone surrogate");
  const tokens = [];
  // Recognition treats these sets as immutable. The dialect gives each
  // public token its own set before returning a result.
  /** @type {Map<number,TagSet>} */
  const profiles = new Map();
  let index = 0;
  const original = [...text];
  for (const { character, origin } of unicode.decomposeWithOrigins(text)) {
    const code = /** @type {number} */ (character.codePointAt(0));
    let tags = profiles.get(code);
    if (!tags) {
      tags = tagSet(unicode.profile(code));
      profiles.set(code,tags);
    }
    tokens.push(new Token(tags, [index, index + 1], [origin, origin + 1], original[origin], character, undefined, character));
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
