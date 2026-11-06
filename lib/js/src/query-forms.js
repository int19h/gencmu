// Body queries (engine §3.10 and §4): the outer remainder is not a symbol.
import { expressionChildren } from "./clause-walk.js";

/** @param {any} body @returns {{body:any, mode:string, problem?:string}} */
export function queryBody(body) {
  const sequence = body?.seq;
  if (Array.isArray(sequence) && sequence.some(item => item?.remainder)) {
    const markers = sequence.map((item,index) => item?.remainder ? index : -1).filter(index => index >= 0);
    if (Object.keys(body).length !== 1 || markers.length !== 1 || sequence.length < 2 || ![0,sequence.length-1].includes(markers[0]) ||
        Object.keys(sequence[markers[0]]).length !== 1 || sequence[markers[0]].remainder !== true) {
      return {body,mode:"matches",problem:"a remainder stands at one outer edge of a parse argument"};
    }
    const parts = sequence.filter((_,index) => index !== markers[0]);
    return {body:parts.length === 1 ? parts[0] : {seq:parts},mode:markers[0] === 0 ? "ends" : "begins"};
  }
  return {body,mode:"matches"};
}

/** @param {any} body @returns {any | null} */
export function queryCapture(body) {
  const pending = [body], seen = new Set();
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    if (typeof node.capture === "string") return node;
    for(const child of expressionChildren(node).slice().reverse())pending.push(child);
  }
  return null;
}

// Keys omit source positions and expand resolved constants. The memo owns no
// input-dependent facts: a body is part of one loaded grammar.
/** @type {WeakMap<object,string>} */
const identities = new WeakMap();
/** @param {any} body @returns {string} */
export function queryIdentity(body) {
  const known = identities.get(body);
  if (known !== undefined) return known;
  /** @param {any} node @returns {any} */
  const normalized = node => {
    if (node instanceof Set) return [...node].sort();
    if (Array.isArray(node)) return node.map(normalized);
    if (!node || typeof node !== "object") return node;
    if (node.set && typeof node.set[Symbol.iterator] === "function") return {set:[...node.set].sort()};
    if (node.const && node.value !== undefined) return normalized(node.value);
    const result = {};
    for (const key of Object.keys(node).filter(key => key !== "at").sort()) {
      let value = normalized(node[key]);
      if (["seq","choice"].includes(key)) value = value.flatMap((/** @type {any} */ child) => child[key] ?? [child]);
      /** @type {any} */ (result)[key] = value;
    }
    return result;
  };
  const key = JSON.stringify(normalized(queryBody(body).body));
  identities.set(body,key);
  return key;
}

/** @param {any} body @returns {string[]} */
export function queryReferences(body) {
  const found = [], pending = [queryBody(body).body];
  while (pending.length) {
    const node = pending.pop();
    if (node.ref) found.push(node.ref);
    for (const child of expressionChildren(node).slice().reverse()) pending.push(child);
  }
  return found;
}

/** @param {any} lowered @param {any} body @returns {string} */
export function bodyTarget(lowered,body) {
  const found = lowered.queryTargets.get(queryIdentity(body));
  if (found === undefined) throw new Error("a body query has no lowered target");
  return found;
}
