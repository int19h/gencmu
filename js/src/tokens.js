// Tokens (engine §1): what every stage reads and writes.

import { tagSet } from "./tags.js";

export class Token {
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
export function characterTokens(text, unicode) {
  const tokens = [];
  let index = 0;
  for (const character of text) {
    const tags = tagSet([[character, true]]);
    const kind = unicode.classOf(character.codePointAt(0));
    if (!tags.has(kind)) tags.set(kind, false);
    tokens.push(new Token(tags, [index, index + 1], [index, index + 1], character, null, undefined));
    index++;
  }
  return tokens;
}

// A text's code points, for slicing by code point positions.
export function codePoints(text) {
  return [...text];
}
