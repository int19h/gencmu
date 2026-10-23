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

/** @param {any} value @param {((source:any,target:any)=>void)|null} [copyLocation] @param {Set<string>} [patterns] @returns {any} */
export function normalizeArgument(value, copyLocation = null, patterns = new Set()) {
  if(!value || typeof value!=="object") return value;
  if(Array.isArray(value)) return value.map(item => normalizeArgument(item,copyLocation,patterns));
  if(value.body) {
    const converted=argumentOfExpression(normalizeArgument(value.body,copyLocation,patterns));
    return converted;
  }
  /** @type {Record<string,any>} */
  const result={};
  for(const [key,item] of Object.entries(value)) {
    result[key]=normalizeArgument(item,copyLocation,patterns);
    if(["union","concat"].includes(key) && Array.isArray(result[key])) result[key]=result[key].flatMap((/** @type {any} */ n)=>n[key]??[n]);
  }
  if(result.intersection && patternTerm(result,patterns)) result.intersection=result.intersection.flatMap((/** @type {any} */ n)=>n.intersection??[n]);
  if(copyLocation) copyLocation(value,result);
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

/** @param {any} root @param {Set<string>} patterns @returns {boolean} */
export function patternTerm(root, patterns) {
  const pending=[root];
  while(pending.length) {
    const n=pending.pop();
    if(n?.pattern || patterns.has(n?.const)) return true;
    for(const key of ['union','intersection','difference']) if(n?.[key]) pending.push(...n[key]);
  }
  return false;
}

/** @param {any[]} definitions @returns {Set<string>} */
export function patternConstantNames(definitions) {
  // All versions of a valid constant share its type, including self redefinitions.
  const patterns=new Set(), users=new Map();
  for(const definition of definitions) {
    const pending=[definition.value];
    while(pending.length) {
      const n=pending.pop();
      if(n?.pattern) patterns.add(definition.name);
      if(n?.const) {
        if(!users.has(n.const)) users.set(n.const,new Set());
        users.get(n.const).add(definition.name);
      }
      for(const key of ['union','intersection','difference']) if(n?.[key]) pending.push(...n[key]);
    }
  }
  const queue=[...patterns];
  for(let i=0;i<queue.length;i++) for(const user of users.get(queue[i])??[]) if(!patterns.has(user)) {patterns.add(user);queue.push(user);}
  return patterns;
}
