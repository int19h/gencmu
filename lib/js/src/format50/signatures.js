// @ts-nocheck
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

export const methods50 = new Map([
  ...zero.map(name => [name, { min: 0, max: 0 }]),
  ...unary.map(name => [name, { min: 1, max: 1 }]),
  ...["any", "join"].map(name => [name, { min: 0, max: 1 }]),
  ...["followed-by", "preceded-by"].map(name => [name, { min: 1, max: Infinity }]),
]);

export function validProperty50(name, unicode) {
  return typeof name === "string" && (/^(?!.*--)[a-zA-Z][a-zA-Z0-9_-]*$/.test(name) ||
    (name !== "_Elided" && (unicode ? unicode.canonicalTag(name) === name :
      Object.hasOwn(PROPERTY_CATALOG.tags, name))));
}
