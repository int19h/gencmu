// Receiver-first method signatures (engine §10).
import { queryBody } from "./query-forms.js";
import { hasUnresolved } from "./template-nodes.js";

const METHOD_SIGNATURE_PROBLEM = "a method has the wrong receiver or arguments";

export const SPAN_METHODS = new Set(["first-token", "tokens-after-first", "last-token", "onward", "following-tokens", "preceding-tokens", "without-elision", "without-elision-except"]);
export const NODE_METHODS = new Set(["parent", "preceding-node", "following-node"]);
export const CHECK_METHODS = new Set([...NODE_METHODS, "preceding-element", "local-readings", "terminal"]);
export const FOREST_METHODS = new Set(["parse", "error-free", "ending-after", "local-readings"]);
export const QUERY_METHODS = new Set(["starts-input", "ends-input", ...FOREST_METHODS, "followed-by", "preceded-by"]);
export const INPUT_STRINGS = new Set(["value", "image", "source-text", "decomposed-source-text"]);
export const TARGET_METHODS = new Set(["followed-by", "preceded-by"]);
export const METHODS = new Set([...SPAN_METHODS, ...QUERY_METHODS, ...CHECK_METHODS, ...INPUT_STRINGS, "tags", "classes", "split", "ngrams", "classify", "verbatim-text", "emitted"]);

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
  const bare = typeof receiver.capture === "string" && Object.keys(receiver).length === 1 || "param" in receiver || "call" in receiver;
  const node = bare || NODE_METHODS.has(receiver.method);
  const element = receiver.method === "preceding-element";
  const span = node || element || SPAN_METHODS.has(receiver.method);
  const named = (/** @type {any} */ arg, /** @type {string} */ key) => object(arg) && Object.keys(arg).length === 1 && typeof arg[key] === "string";
  const rule = (/** @type {any} */ arg) => named(arg,"rule") || object(arg) && ("param" in arg || "call" in arg);
  const term = (/** @type {any} */ arg) => object(arg) && !["rule", "classifier", "terminal", "integer"].some(key => key in arg);
  let valid;
  if (NODE_METHODS.has(name) || name === "preceding-element" || name === "terminal") valid = node && args.length === 0;
  else if (name === "local-readings") valid = (node || element) && args.length === 0;
  else if (name === "parse") {
    if (args.length !== 1 || !object(args[0]) || Object.keys(args[0]).length !== 1 || !object(args[0].body)) return METHOD_SIGNATURE_PROBLEM;
    if (restored(receiver) && ["suffix","part"].includes(queryBody(args[0].body).mode)) return "suffix parse requires an ordinary span, not a restored span";
    valid = span;
  } else if (name === "error-free") valid = FOREST_METHODS.has(receiver.method) && args.length === 0;
  else if (name === "ending-after") valid = FOREST_METHODS.has(receiver.method) && args.length === 1 && (typeof args[0]?.capture === "string" || SPAN_METHODS.has(args[0]?.method) || NODE_METHODS.has(args[0]?.method) || args[0]?.method === "preceding-element");
  else if (name === "ngrams") valid = args.length === 1 && named(args[0], "integer") && /^[1-9][0-9]*$/.test(args[0].integer);
  else if (name === "split") valid = args.length === 1 && term(args[0]) && !(hasUnresolved([receiver,args]) && args[0].string === "");
  else if (name === "classify") valid = args.length === 1 && named(args[0], "classifier");
  else if (name === "tags") valid = (span || FOREST_METHODS.has(receiver.method)) && args.length === 0;
  else if (name === "followed-by" || name === "preceded-by") valid = node && args.length > 0 && args.every(arg => rule(arg) || named(arg, "terminal"));
  else if (name === "without-elision-except") valid = bare && args.length === 1 && rule(args[0]);
  else if (name === "without-elision") valid = bare && args.length === 0;
  else if (name === "verbatim-text") valid = recipe && bare && args.length === 0;
  else if (name === "emitted") valid = bare && args.length === 0;
  else valid = args.length === 0 && (span || receiver.method === "emitted" && (name === "value" || name === "image"));
  return valid ? null : METHOD_SIGNATURE_PROBLEM;
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
  const node = type === "node";
  const element = type === "element";
  const span = type === "span" || node || element;
  const string = type === "string" || type === "any" || type === "span" || node;
  const rule = (/** @type {number} */ index) => args[index] && typeof args[index].rule === "string";
  if (NODE_METHODS.has(name) || name === "preceding-element" || name === "terminal") {
    if (!node || args.length) return METHOD_SIGNATURE_PROBLEM;
  } else if (name === "local-readings") {
    if (!(node || element) || args.length) return METHOD_SIGNATURE_PROBLEM;
  } else if (name === "parse") {
    if (element || !span || args.length !== 1 || !args[0]?.body) return METHOD_SIGNATURE_PROBLEM;
    if (restored(receiver) && ["suffix","part"].includes(queryBody(args[0].body).mode)) return "suffix parse requires an ordinary span, not a restored span";
  } else if (name === "error-free") {
    if (type !== "forest" || args.length) return METHOD_SIGNATURE_PROBLEM;
  } else if (name === "ending-after") {
    if (type !== "forest" || args.length !== 1 || !["span","node","element"].includes(argumentTypes[0])) return METHOD_SIGNATURE_PROBLEM;
  } else if (name === "without-elision") {
    if (args.length || typeof receiver.capture !== "string" || Object.keys(receiver).length !== 1) {
      return "without-elision requires a bare capture: write $x.without-elision.onward";
    }
  } else if (name === "without-elision-except") {
    if (typeof receiver.capture !== "string" || Object.keys(receiver).length !== 1) {
      return "without-elision-except requires a bare capture: write $x.without-elision-except(family).onward";
    }
    if (args.length !== 1 || !rule(0)) return "without-elision-except requires one rule name";
  } else if (SPAN_METHODS.has(name)) {
    if (!span || args.length) return METHOD_SIGNATURE_PROBLEM;
  } else if (name === "followed-by" || name === "preceded-by") {
    if (!node && (typeof receiver.capture !== "string" || Object.keys(receiver).length !== 1)) return `${name} requires a bare capture`;
    if (!args.length || args.some(arg => !(typeof arg.rule === "string" || typeof arg.terminal === "string" && /^[A-Z][A-Za-z0-9_-]*$/.test(arg.terminal)))) return METHOD_SIGNATURE_PROBLEM;
  } else if (name === "starts-input" || name === "ends-input") {
    if (!span || args.length) return METHOD_SIGNATURE_PROBLEM;
  } else if (name === "tags") {
    if (type === "forest") { if (args.length) return METHOD_SIGNATURE_PROBLEM; }
    else if (element || !span || args.length) return METHOD_SIGNATURE_PROBLEM;
  } else if (name === "classes") {
    if (element || !span || args.length) return METHOD_SIGNATURE_PROBLEM;
  } else if (name === "ngrams") {
    if (!string || args.length !== 1 || typeof args[0].integer !== "string" || !/^[1-9][0-9]*$/.test(args[0].integer)) return METHOD_SIGNATURE_PROBLEM;
  } else if (name === "split") {
    if (!string || args.length !== 1 || !["string", "span", "node", "any"].includes(argumentTypes[0])) return METHOD_SIGNATURE_PROBLEM;
    if (args[0].string === "") return "split has an empty delimiter";
  } else if (name === "classify") {
    if (!string || args.length !== 1 || typeof args[0].classifier !== "string") return METHOD_SIGNATURE_PROBLEM;
  } else if (name === "emitted") {
    if (!recipe || args.length || typeof receiver.capture !== "string" || Object.keys(receiver).length !== 1) return "emitted requires a bare capture in a recipe";
  } else if (name === "verbatim-text") {
    if (!recipe || !span || args.length) return METHOD_SIGNATURE_PROBLEM;
  } else if (!span && !(type === "emitted" && (name === "value" || name === "image"))) {
    return METHOD_SIGNATURE_PROBLEM;
  } else if (args.length) return METHOD_SIGNATURE_PROBLEM;
  return null;
}

/** @param {string} name @returns {string} */
export function methodType(name) {
  if (NODE_METHODS.has(name)) return "node";
  if (name === "preceding-element") return "element";
  if (FOREST_METHODS.has(name)) return "forest";
  if (SPAN_METHODS.has(name)) return "span";
  if (QUERY_METHODS.has(name)) return "condition";
  if (name === "emitted") return "emitted";
  if (name === "split" || name === "ngrams") return "strings";
  if (name === "tags" || name === "classes" || name === "classify") return "tags";
  return "string";
}

/** @param {any} receiver @returns {boolean} */
function restored(receiver) {
  const seen = new Set();
  while (receiver?.method === "onward") {
    if (seen.has(receiver)) return false;
    seen.add(receiver);
    receiver = receiver.receiver;
  }
  return receiver?.method === "without-elision" || receiver?.method === "without-elision-except";
}
