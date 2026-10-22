// The character data of grammars/unicode.txt: the General_Category of a
// character, the White_Space property, the
// same in every gencmu library (engine §1).

// The names a property can have (engine §1): the General_Category values in
// their short form, their one-letter groups, White_Space.
export const CATEGORIES = [
  "Lu", "Ll", "Lt", "Lm", "Lo", "Mn", "Mc", "Me", "Nd", "Nl", "No", "Pc", "Pd", "Ps", "Pe", "Pi", "Pf", "Po",
  "Sm", "Sc", "Sk", "So", "Zs", "Zl", "Zp", "Cc", "Cf", "Cs", "Co", "Cn",
];
export const PROPERTY_NAMES = new Set([...CATEGORIES, "L", "M", "N", "P", "S", "Z", "C", "White_Space", "Emoji_Presentation", "Emoji_Component"]);

export class UnicodeTable {
  /** @param {string} text the contents of unicode.txt */
  constructor(text) {
    /** @type {string | null} */
    this.version = null;
    // The category ranges, in order: parallel arrays for a binary search.
    /** @type {number[]} */
    this.starts = [];
    /** @type {number[]} */
    this.ends = [];
    /** @type {string[]} */
    this.categories = [];
    /** @type {[number, number][]} */
    this.whiteSpace = [];
    /** @type {Map<string, [number, number][]>} */
    this.emoji = new Map([["Emoji_Presentation", []], ["Emoji_Component", []]]);
    /** @type {[number, number, string][]} */
    const ranges = [];
    /** @type {Map<number, number[]>} */
    this.decompositions = new Map();
    /** @type {[number, number, number][]} */
    this.combining = [];
    for (const line of text.split("\n")) {
      const fields = line.trim().split(/\s+/);
      if (fields[0] === "unicode") this.version = fields[1];
      else if (fields[0] === "category") ranges.push([parseInt(fields[2], 16), parseInt(fields[3], 16), fields[1]]);
      else if (fields[0] === "decompose") this.decompositions.set(parseInt(fields[1], 16), fields.slice(2).map(field => parseInt(field, 16)));
      else if (fields[0] === "combining") this.combining.push([parseInt(fields[2], 16), parseInt(fields[3], 16), Number(fields[1])]);
      else if (fields[0] === "emoji-presentation" || fields[0] === "emoji-component") this.emoji.get(fields[0] === "emoji-presentation" ? "Emoji_Presentation" : "Emoji_Component")?.push([parseInt(fields[1], 16), parseInt(fields[2], 16)]);
      else if (fields[0] === "white-space") this.whiteSpace.push([parseInt(fields[1], 16), parseInt(fields[2], 16)]);
    }
    // The records can stand in any order in the file (engine §1).
    ranges.sort((a, b) => a[0] - b[0]);
    for (const [property, ranges] of this.emoji) {
      ranges.sort((a, b) => a[0] - b[0]);
      /** @type {[number, number][]} */
      const union = [];
      for (const [start, end] of ranges) {
        const previous = union.at(-1);
        if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end);
        else union.push([start, end]);
      }
      this.emoji.set(property, union);
    }
    this.combining.sort((a, b) => a[0] - b[0]);
    for (const [start, end, category] of ranges) {
      this.starts.push(start);
      this.ends.push(end);
      this.categories.push(category);
    }
  }

  /**
   * The General_Category of a code point, in its short form (engine §1):
   * `Cs` for a surrogate, which a table does not list, and `Cn` for any
   * other code point that the table omits.
   * @param {number} code
   * @returns {string}
   */
  category(code) {
    if (code >= 0xd800 && code <= 0xdfff) return "Cs";
    let low = 0;
    let high = this.starts.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (code < this.starts[middle]) high = middle - 1;
      else if (code > this.ends[middle]) low = middle + 1;
      else return this.categories[middle];
    }
    return "Cn";
  }

  /** @param {string} property @param {number} code @returns {boolean} */
  hasEmoji(property, code) {
    const ranges = this.emoji.get(property) || [];
    let low = 0, high = ranges.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (code < ranges[middle][0]) high = middle - 1;
      else if (code > ranges[middle][1]) low = middle + 1;
      else return true;
    }
    return false;
  }

  /** @param {string} name @returns {boolean} */
  isEmojiName(name) {
    return [...name].length === 1 && this.hasEmoji("Emoji_Presentation", /** @type {number} */ (name.codePointAt(0))) && !this.hasEmoji("Emoji_Component", /** @type {number} */ (name.codePointAt(0)));
  }

  /** @param {number} code @returns {number} */
  combiningClass(code) {
    let low = 0, high = this.combining.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const [start, end, klass] = this.combining[middle];
      if (code < start) high = middle - 1;
      else if (code > end) low = middle + 1;
      else return klass;
    }
    return 0;
  }

  /** @param {number} code @returns {boolean} */
  changesInDocument(code) {
    return this.decompositions.has(code) || (code >= 0xac00 && code <= 0xd7a3) || this.combiningClass(code) !== 0;
  }

  /**
   * Canonical decomposition, with each scalar's original code point index.
   * Sorting only nonzero runs preserves class-zero barriers and equal classes.
   * @param {string} text
   * @returns {{character:string, origin:number, klass:number}[]}
   */
  decomposeWithOrigins(text) {
    const result = [];
    let origin = 0;
    for (const character of text) {
      const code = /** @type {number} */ (character.codePointAt(0));
      let scalars;
      if (code >= 0xac00 && code <= 0xd7a3) {
        const syllable = code - 0xac00;
        scalars = [0x1100 + Math.floor(syllable / 588), 0x1161 + Math.floor(syllable % 588 / 28)];
        if (syllable % 28) scalars.push(0x11a7 + syllable % 28);
      } else scalars = this.decompositions.get(code) || [code];
      for (const scalar of scalars) result.push({ character: String.fromCodePoint(scalar), origin, klass: this.combiningClass(scalar) });
      origin++;
    }
    for (let start = 0; start < result.length;) {
      if (result[start].klass === 0) { start++; continue; }
      let end = start + 1;
      while (end < result.length && result[end].klass !== 0) end++;
      const ordered = result.slice(start, end).sort((a, b) => a.klass - b.klass);
      for (let index = start; index < end; index++) result[index] = ordered[index - start];
      start = end;
    }
    return result;
  }

  /** @param {string} text @returns {string} */
  decompose(text) {
    return this.decomposeWithOrigins(text).map(item => item.character).join("");
  }

  /**
   * Whether a code point is a nonspacing mark, of General_Category Mn.
   * @param {number} code
   * @returns {boolean}
   */
  isMark(code) {
    return this.category(code) === "Mn";
  }

  /**
   * Whether a code point has the White_Space property.
   * @param {number} code
   * @returns {boolean}
   */
  isWhiteSpace(code) {
    for (const [start, end] of this.whiteSpace) if (code >= start && code <= end) return true;
    return false;
  }

}
