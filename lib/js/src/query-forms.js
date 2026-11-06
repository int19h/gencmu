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
    pending.push(...expressionChildren(node).slice().reverse());
  }
  return null;
}
