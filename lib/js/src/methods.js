// Receiver-first method signatures (engine §10).

export const SPAN_METHODS = new Set(["first-token", "tokens-after-first", "last-token", "onward", "following-tokens", "without-elision", "without-elision-except"]);
export const QUERY_METHODS = new Set(["matches", "begins", "starts-input"]);
export const INPUT_STRINGS = new Set(["value", "image", "source-text", "decomposed-source-text"]);
export const METHODS = new Set([...SPAN_METHODS, ...QUERY_METHODS, ...INPUT_STRINGS, "tags", "classes", "split", "classify", "verbatim-text", "emitted"]);

/**
 * @param {string} name
 * @param {any} receiver
 * @param {any[]} args
 * @param {string} type
 * @param {string[]} argumentTypes
 * @param {boolean} [recipe]
 * @returns {string | null}
 */
export function methodProblem(name, receiver, args, type, argumentTypes, recipe = false) {
  if (!METHODS.has(name)) return `unknown method ${name}`;
  const span = type === "span";
  const string = type === "string" || type === "any" || span;
  const rule = (/** @type {number} */ index) => args[index] && typeof args[index].rule === "string";
  if (name === "without-elision") {
    if (args.length || typeof receiver.capture !== "string" || Object.keys(receiver).length !== 1) {
      return "without-elision requires a bare capture: write $x.without-elision.onward";
    }
  } else if (name === "without-elision-except") {
    if (typeof receiver.capture !== "string" || Object.keys(receiver).length !== 1) {
      return "without-elision-except requires a bare capture: write $x.without-elision-except(family).onward";
    }
    if (args.length !== 1 || !rule(0)) return "without-elision-except requires one rule name";
  } else if (SPAN_METHODS.has(name)) {
    if (!span || args.length) return `${name} requires a span and no arguments`;
  } else if (name === "matches" || name === "begins") {
    if (!span || args.length !== 1 || !rule(0)) return `${name} requires a span and one rule name`;
  } else if (name === "starts-input") {
    if (!span || args.length) return "starts-input requires a span and no arguments";
  } else if (name === "tags") {
    if (!span || args.length > 1 || (args.length === 1 && !rule(0))) return "tags requires a span and optionally one rule name";
  } else if (name === "classes") {
    if (!span || args.length) return "classes requires a span and no arguments";
  } else if (name === "split") {
    if (!string || args.length !== 1 || !["string", "span", "any"].includes(argumentTypes[0])) return "split requires a string and one string delimiter";
    if (args[0].string === "") return "split has an empty delimiter";
  } else if (name === "classify") {
    if (!string || args.length !== 1 || typeof args[0].classifier !== "string") return "classify requires a string and one classifier name";
  } else if (name === "emitted") {
    if (!recipe || args.length || typeof receiver.capture !== "string" || Object.keys(receiver).length !== 1) return "emitted requires a bare capture in a recipe";
  } else if (name === "verbatim-text") {
    if (!recipe || !span || args.length) return "verbatim-text requires a capture in a recipe";
  } else if (!span && !(recipe && type === "emitted" && (name === "value" || name === "image"))) {
    return `${name} requires a span`;
  } else if (args.length) return `${name} takes no arguments`;
  return null;
}

/** @param {string} name @returns {string} */
export function methodType(name) {
  if (SPAN_METHODS.has(name)) return "span";
  if (QUERY_METHODS.has(name)) return "condition";
  if (name === "emitted") return "emitted";
  if (name === "split") return "strings";
  if (name === "tags" || name === "classes" || name === "classify") return "tags";
  return "string";
}
