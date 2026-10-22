// Shared unresolved template nodes. This module has no loader dependencies.

/** @param {any} root @returns {boolean} */
export function hasUnresolved(root) {
  const pending=[root];
  while(pending.length) {
    const n=pending.pop();
    if(!n || typeof n!=="object") continue;
    if(n.param || n.call || n.params || n.instance || n.args && n.name && n.op) return true;
    for(const value of Object.values(n)) if(value && typeof value==="object") pending.push(value);
  }
  return false;
}

/** @param {any} expr @returns {any} */
export function argumentOfExpression(expr) {
  if(expr.ref) return /^[A-Z_]/.test(expr.ref)?{tag:expr.ref}:{rule:expr.ref};
  if(expr.literal) return expr.literal;
  if(expr.param || expr.call || expr.test || expr.range || expr.wildcard) return expr;
  return {body:expr};
}

/** @param {any} value @returns {any} */
export function normalizeArgument(value) {
  if(!value || typeof value!=="object") return value;
  if(Array.isArray(value)) return value.map(normalizeArgument);
  if(value.body) {
    const converted=argumentOfExpression(normalizeArgument(value.body));
    return converted;
  }
  /** @type {Record<string,any>} */
  const result={};
  for(const [key,item] of Object.entries(value)) {
    result[key]=normalizeArgument(item);
    if(["union","concat","any","all"].includes(key) && Array.isArray(result[key])) result[key]=result[key].flatMap((/** @type {any} */ n)=>n[key]??[n]);
  }
  return result;
}

/** @param {any} root @returns {boolean} */
export function argumentReadsCapture(root) {
  const pending=[root];
  while(pending.length) {
    const node=pending.pop();
    if(!node || typeof node!=='object') continue;
    if('capture' in node || 'captured' in node) return true;
    for(const value of Object.values(node)) if(value && typeof value==='object') pending.push(value);
  }
  return false;
}
