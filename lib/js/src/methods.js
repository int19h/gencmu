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
  const types = args.map((/** @type {any} */ arg) =>
    object(arg) && ["rule", "classifier", "terminal", "integer", "body"].some(key => key in arg) ? "name" : shapeType(arg));
  return signatureProblem(name, receiver, args, shapeType(receiver), types, recipe, true);
}

/** @param {any} value @returns {string} */
function shapeType(value) {
  if (!value || typeof value !== "object") return "any";
  if (FOREST_METHODS.has(value.method)) return "forest";
  if (value.method === "preceding-element") return "element";
  if (typeof value.capture === "string" || value.param || value.call || NODE_METHODS.has(value.method)) return "node";
  if (SPAN_METHODS.has(value.method)) return "span";
  return value.method === "emitted" ? "emitted" : "any";
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
  return signatureProblem(name,receiver,args,type,argumentTypes,recipe,false);
}

/**
 * @param {string} name
 * @param {any} receiver
 * @param {any[]} args
 * @param {string} type
 * @param {string[]} argumentTypes
 * @param {boolean} recipe
 * @param {boolean} shape
 * @returns {string|null}
 */
function signatureProblem(name,receiver,args,type,argumentTypes,recipe,shape) {
  if (!METHODS.has(name)) return `unknown method ${name}`;
  const bare = typeof receiver.capture === "string" && Object.keys(receiver).length === 1 || shape && (receiver.param || receiver.call);
  const node = type === "node";
  const element = type === "element";
  const span = type === "span" || node || element;
  const string = shape || type === "string" || type === "any" || type === "span" || node;
  const rule = (/** @type {number} */ index) => args[index] && (typeof args[index].rule === "string" || shape && (args[index].param || args[index].call));
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
    if (args.length || !bare) {
      return shape ? METHOD_SIGNATURE_PROBLEM : "without-elision requires a bare capture: write $x.without-elision.onward";
    }
  } else if (name === "without-elision-except") {
    if (!bare) {
      return shape ? METHOD_SIGNATURE_PROBLEM : "without-elision-except requires a bare capture: write $x.without-elision-except(family).onward";
    }
    if (args.length !== 1 || !rule(0)) return shape ? METHOD_SIGNATURE_PROBLEM : "without-elision-except requires one rule name";
  } else if (SPAN_METHODS.has(name)) {
    if (!span || args.length) return METHOD_SIGNATURE_PROBLEM;
  } else if (name === "followed-by" || name === "preceded-by") {
    if (!node && (typeof receiver.capture !== "string" || Object.keys(receiver).length !== 1)) return `${name} requires a bare capture`;
    if (!args.length || args.some((arg, index) => !(rule(index) || typeof arg.terminal === "string" && /^[A-Z][A-Za-z0-9_-]*$/.test(arg.terminal)))) return METHOD_SIGNATURE_PROBLEM;
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
    if (args[0].string === "") {
      if (!shape) return "split has an empty delimiter";
      if (hasUnresolved([receiver, args])) return METHOD_SIGNATURE_PROBLEM;
    }
  } else if (name === "classify") {
    if (!string || args.length !== 1 || typeof args[0].classifier !== "string") return METHOD_SIGNATURE_PROBLEM;
  } else if (name === "emitted") {
    if ((!shape && !recipe) || args.length || !bare) return METHOD_SIGNATURE_PROBLEM;
  } else if (name === "verbatim-text") {
    if (!recipe || (shape ? !bare : !span) || args.length) return METHOD_SIGNATURE_PROBLEM;
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
