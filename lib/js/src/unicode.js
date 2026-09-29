// The character data of grammars/unicode.txt: the General_Category of a
// character, the White_Space property, and the simple lowercase mapping, the
// same in every gencmu library (engine §1).

// The names a property can have (engine §1): the General_Category values in
// their short form, their one-letter groups, White_Space and Any.
export const CATEGORIES = [
  "Lu", "Ll", "Lt", "Lm", "Lo", "Mn", "Mc", "Me", "Nd", "Nl", "No", "Pc", "Pd", "Ps", "Pe", "Pi", "Pf", "Po",
  "Sm", "Sc", "Sk", "So", "Zs", "Zl", "Zp", "Cc", "Cf", "Cs", "Co", "Cn",
];
export const PROPERTY_NAMES = new Set([...CATEGORIES, "L", "M", "N", "P", "S", "Z", "C", "White_Space", "Any"]);

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
    /** @type {Map<number, number>} */
    this.lower = new Map();
    /** @type {[number, number, string][]} */
    const ranges = [];
    for (const line of text.split("\n")) {
      const fields = line.trim().split(/\s+/);
      if (fields[0] === "unicode") this.version = fields[1];
      else if (fields[0] === "category") ranges.push([parseInt(fields[2], 16), parseInt(fields[3], 16), fields[1]]);
      else if (fields[0] === "white-space") this.whiteSpace.push([parseInt(fields[1], 16), parseInt(fields[2], 16)]);
      else if (fields[0] === "lower") this.lower.set(parseInt(fields[1], 16), parseInt(fields[2], 16));
    }
    // The records can stand in any order in the file (engine §1).
    ranges.sort((a, b) => a[0] - b[0]);
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

  /**
   * Whether a scalar value has a property (engine §1), whose name must be
   * one of PROPERTY_NAMES.
   * @param {string} name
   * @param {number} code
   * @returns {boolean}
   */
  hasProperty(name, code) {
    if (name === "Any") return true;
    if (name === "White_Space") return this.isWhiteSpace(code);
    if (name.length === 1) return this.category(code)[0] === name;
    return this.category(code) === name;
  }

  /**
   * The canonical form of a sound (engine §5): each code point replaced by
   * its simple lowercase mapping, and every comma, the syllable break,
   * removed.
   * @param {string} text
   * @returns {string}
   */
  canonical(text) {
    return this.lowercase(text).replace(/,/g, "");
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
