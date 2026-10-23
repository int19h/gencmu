import { GencmuError } from "./errors.js";

/** @import { UnicodeTable } from "./unicode.js" */
/** @import { NamesScope } from "./unicode-names.js" */
/** @import { Token } from "./tokens.js" */
/** @import { Position } from "./types.js" */

export class DocumentStrings {
  /**
   * @param {string} path
   * @param {UnicodeTable} unicode
   * @param {NamesScope} names
   * @param {(offset:number)=>Position} position
   */
  constructor(path, unicode, names, position) {
    this.path = path;
    this.unicode = unicode;
    this.names = names;
    this.position = position;
  }

  /** @param {Token[]} tokens */
  inspect(tokens) {
    for (const token of tokens) {
      if (token.tags.has("String") || token.tags.has("Include-Path")) this.decode(token, token.tags.has("Include-Path"));
    }
  }

  /** @param {Token} token @param {boolean} [path] @returns {string} */
  decode(token, path = false) {
    const source = [...token.text];
    let result = "", literal = "";
    const flush = () => {
      result += path ? literal : this.unicode.decompose(literal);
      literal = "";
    };
    for (let index = 1; index < source.length - 1; index++) {
      const character = source[index];
      if (character !== "‹") { literal += character; continue; }
      flush();
      const opening = index;
      const fail = () => {
        const [line, column] = this.position(token.source[0] + opening);
        throw new GencmuError("grammar", `${this.path}:${line}:${column}: an invalid or unknown string escape`, {document:this.path, line, column});
      };
      let name = "";
      while (++index < source.length - 1 && source[index] !== "›") {
        if (["\"", "\n", "\r"].includes(source[index])) fail();
        name += source[index];
      }
      if (source[index] !== "›" || name === "") fail();
      let code;
      if (name.startsWith("U+")) {
        if (!/^U\+[0-9A-Fa-f]{4,6}$/.test(name)) fail();
        code = Number.parseInt(name.slice(2), 16);
        if (code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) fail();
      } else code = this.names.lookup(name);
      if (code === undefined) fail();
      result += String.fromCodePoint(/** @type {number} */ (code));
    }
    flush();
    return result;
  }
}
