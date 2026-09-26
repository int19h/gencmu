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
   * @param {boolean} [verbatim] whether it sounds like its text (engine §11)
   */
  constructor(tags, span, source, text, phonemes, insertedBy, verbatim = false) {
    this.tags = tags;
    this.span = span;
    this.source = source;
    this.text = text;
    this.phonemes = phonemes;
    this.insertedBy = insertedBy;
    this.verbatim = verbatim;
  }
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
