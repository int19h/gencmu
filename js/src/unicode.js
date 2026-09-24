// The character data of grammars/unicode.txt: the class of a character and
// the simple lowercase mapping, the same in every gencmu library.

export class UnicodeTable {
  /** @param {string} text the contents of unicode.txt */
  constructor(text) {
    /** @type {string | null} */
    this.version = null;
    /** @type {[number, number][]} */
    this.marks = [];
    /** @type {[number, number][]} */
    this.alphas = [];
    /** @type {Map<number, number>} */
    this.lower = new Map();
    for (const line of text.split("\n")) {
      const fields = line.trim().split(/\s+/);
      if (fields[0] === "unicode") this.version = fields[1];
      else if (fields[0] === "mark") this.marks.push([parseInt(fields[1], 16), parseInt(fields[2], 16)]);
      else if (fields[0] === "alpha") this.alphas.push([parseInt(fields[1], 16), parseInt(fields[2], 16)]);
      else if (fields[0] === "lower") this.lower.set(parseInt(fields[1], 16), parseInt(fields[2], 16));
    }
  }

  /**
   * The class tag of a code point (engine §1).
   * @param {number} code
   * @returns {"space" | "digit" | "mark" | "alpha" | "other"}
   */
  classOf(code) {
    if ((code >= 0x09 && code <= 0x0d) || code === 0x20 || code === 0x85 || code === 0xa0 || code === 0x1680 ||
        (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029 || code === 0x202f ||
        code === 0x205f || code === 0x3000) {
      return "space";
    }
    if (code >= 0x30 && code <= 0x39) return "digit";
    if (inRanges(this.marks, code)) return "mark";
    if (inRanges(this.alphas, code)) return "alpha";
    return "other";
  }

  /**
   * @param {string} text
   * @returns {string}
   */
  lowercase(text) {
    let result = "";
    for (const character of text) {
      const mapped = this.lower.get(/** @type {number} */ (character.codePointAt(0)));
      result += mapped === undefined ? character : String.fromCodePoint(mapped);
    }
    return result;
  }
}

/**
 * @param {[number, number][]} ranges
 * @param {number} code
 */
function inRanges(ranges, code) {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [start, end] = ranges[middle];
    if (code < start) high = middle - 1;
    else if (code > end) low = middle + 1;
    else return true;
  }
  return false;
}
