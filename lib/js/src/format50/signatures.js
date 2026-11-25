import { PROPERTY_CATALOG } from "../unicode-property-catalog.js";

// Method arities from Engine §10, including short map selectors.
const zero = [
  "span", "children", "present", "without-elision", "tokens", "flags", "classes",
  "first-token", "last-token", "tokens-after-first", "onward", "following-tokens",
  "preceding-tokens", "starts-input", "ends-input", "source-text",
  "decomposed-source-text", "verbatim-text", "keys", "union", "error-free",
];
const unary = [
  "without-elision-except", "parse", "has", "has-value", "select", "overlaps",
  "classify", "all", "split", "ngrams", "at-most",
];

/**
 * The arity of each of these methods.
 * @param {string[]} names
 * @param {number} min
 * @param {number} max
 * @returns {[string, {min: number, max: number}][]}
 */
const arity = (names, min, max) => names.map(name => [name, { min, max }]);

export const methods50 = new Map([
  ...arity(zero, 0, 0),
  ...arity(unary, 1, 1),
  ...arity(["any", "join"], 0, 1),
  ...arity(["followed-by", "preceded-by"], 1, Infinity),
]);

/**
 * @param {any} name
 * @param {any} unicode
 */
export function validProperty50(name, unicode) {
  return typeof name === "string" && (/^(?!.*--)[a-zA-Z][a-zA-Z0-9_-]*$/.test(name) ||
    (name !== "_Elided" && (unicode ? unicode.canonicalTag(name) === name :
      Object.hasOwn(PROPERTY_CATALOG.tags, name))));
}
