// Receiver-first method signatures (engine §10).

export const SPAN_METHODS = new Set(["first-token", "tokens-after-first", "last-token", "onward", "following-tokens", "without-elision", "without-elision-except"]);
export const QUERY_METHODS = new Set(["matches", "begins", "starts-input", "ends-input", "followed-by", "preceded-by"]);
export const INPUT_STRINGS = new Set(["value", "image", "source-text", "decomposed-source-text"]);
export const TARGET_METHODS = new Set(["matches", "begins", "followed-by", "preceded-by"]);
export const METHODS = new Set([...SPAN_METHODS, ...QUERY_METHODS, ...INPUT_STRINGS, "tags", "classes", "split", "ngrams", "classify", "verbatim-text", "emitted"]);

/**
 * Structural signatures do not read operand types or stage bindings (engine §9).
 * @param {unknown} name
 * @param {any} receiver
 * @param {any} args
 * @param {boolean} [recipe]
 * @returns {string | null}
 */
export function methodShapeProblem(name, receiver, args, recipe = false) {
  if (typeof name !== "string") return "unknown method name";
  if (!METHODS.has(name)) return `unknown method ${name}`;
  const object = (/** @type {any} */ value) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!object(receiver) || !Array.isArray(args)) return "a malformed method";
  const bare = typeof receiver.capture === "string" && Object.keys(receiver).length === 1;
  const span = bare || SPAN_METHODS.has(receiver.method);
  const named = (/** @type {any} */ arg, /** @type {string} */ key) => object(arg) && Object.keys(arg).length === 1 && typeof arg[key] === "string";
  const term = (/** @type {any} */ arg) => object(arg) && !["rule", "classifier", "terminal"].some(key => key in arg);
  let valid;
  if (name === "ngrams") valid = args.length === 1 && named(args[0], "integer") && /^[1-9][0-9]*$/.test(args[0].integer);
  else if (name === "split") valid = args.length === 1 && term(args[0]);
  else if (name === "classify") valid = args.length === 1 && named(args[0], "classifier");
  else if (name === "tags") valid = span && (args.length === 0 || args.length === 1 && named(args[0], "rule"));
  else if (name === "matches" || name === "begins") valid = span && args.length > 0 && args.every(arg => named(arg, "rule") || named(arg, "terminal"));
  else if (name === "followed-by" || name === "preceded-by") valid = bare && args.length > 0 && args.every(arg => named(arg, "rule") || named(arg, "terminal"));
  else if (name === "without-elision-except") valid = bare && args.length === 1 && named(args[0], "rule");
  else if (name === "without-elision") valid = bare && args.length === 0;
  else if (name === "verbatim-text" || name === "emitted") valid = recipe && bare && args.length === 0;
  else valid = args.length === 0 && (span || recipe && receiver.method === "emitted" && (name === "value" || name === "image"));
  return valid ? null : "a method has the wrong receiver or arguments";
}

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
    if (!span || !args.length || args.some(arg => !(typeof arg.rule === "string" || typeof arg.terminal === "string" && /^[A-Z][A-Za-z0-9_-]*$/.test(arg.terminal)))) return `${name} requires a span and rule names or tag terminals`;
  } else if (name === "followed-by" || name === "preceded-by") {
    if (typeof receiver.capture !== "string" || Object.keys(receiver).length !== 1) return `${name} requires a bare capture`;
    if (!args.length || args.some(arg => !(typeof arg.rule === "string" || typeof arg.terminal === "string" && /^[A-Z][A-Za-z0-9_-]*$/.test(arg.terminal)))) return `${name} requires rule names or tag terminals`;
  } else if (name === "starts-input" || name === "ends-input") {
    if (!span || args.length) return `${name} requires a span and no arguments`;
  } else if (name === "tags") {
    if (!span || args.length > 1 || (args.length === 1 && !rule(0))) return "tags requires a span and optionally one rule name";
  } else if (name === "classes") {
    if (!span || args.length) return "classes requires a span and no arguments";
  } else if (name === "ngrams") {
    if (!string || args.length !== 1 || typeof args[0].integer !== "string" || !/^[1-9][0-9]*$/.test(args[0].integer)) return "ngrams requires a string and one positive integer literal";
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
  if (name === "split" || name === "ngrams") return "strings";
  if (name === "tags" || name === "classes" || name === "classify") return "tags";
  return "string";
}
