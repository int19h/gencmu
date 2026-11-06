// The term-bearing fields of clauses. Source locations, patterns and
// lowered grammar links contain no open term or nested condition.

/**
 * Children of a term, condition, recipe, emission or clause container.
 * @param {unknown} value
 * @returns {unknown[]}
 */
export function clauseChildren(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const node = /** @type {Record<string, any>} */ (value);
  if (node.pattern) return [];
  if (node.body) return [node.body];
  if (node.seq || node.choice || node.ranked || node.and || node.optional || node.repeat || node.splice || node.expr) {
    const children = expressionChildren(/** @type {any} */ (node));
    if (node.test) children.push(...(node.test === "tags" ? node.requirements.map((/** @type {any} */ r)=>r.value) : [node.value]));
    return children;
  }
  if (node.literal) return typeof node.literal === "object" ? [node.literal] : [];
  if (node.range) return node.range;
  if (node.string !== undefined || node.tag !== undefined || node.captured !== undefined || node.rule || node.classifier) return [];
  if (typeof node.capture === "string" && !node.tags && !node.value && !node.image) return [];
  if (node.method) return [node.receiver, ...node.args];
  if (node.op) return [node.left, node.right];
  if (node.if) return [node.if, node.then];
  if (node.not) return [node.not];
  for (const key of ["any", "all", "union", "intersection", "difference", "concat", "items"]) {
    if (node[key]) return node[key];
  }
  if (node.const) return node.value === undefined ? [] : [node.value];
  if (node.condition) return [node.condition];
  if (!node.conditions && !node.tags && !node.emit && !node.value && !node.image && !node.error && !node.warning) return [];
  return [node.conditions, node.tags, node.emit, node.value, node.image, node.error, node.warning].filter(child => child !== undefined);
}

/**
 * The clauses that query and close discovery must inspect. Written clauses
 * keep conditions deferred to a ranked frame or simplified for a capture.
 * @param {import("./types.js").Production} production
 * @returns {unknown[]}
 */
export function productionClauses(production) {
  return [production.conditions, production.tags, production.emit,
    production.rankedDeferred, production.parentTags, production.itemConditions,
    production.source?.clauses];
}

/**
 * Only the body expressions of a rule, without terminal operands.
 * @param {import("./types.js").Expr} expr
 * @returns {import("./types.js").Expr[]}
 */
export function expressionChildren(expr) {
  if ("splice" in expr) return [expr.splice];
  if ("seq" in expr) return expr.seq;
  if ("choice" in expr) return expr.choice;
  if ("ranked" in expr) return expr.ranked;
  if ("and" in expr) return expr.and;
  if ("optional" in expr) return [expr.optional];
  if ("repeat" in expr) return expr.separator === undefined ? [expr.repeat] : [expr.repeat, expr.separator];
  if ("capture" in expr || "test" in expr) return [expr.expr];
  return [];
}

export const BOUNDARY_METHODS = new Set(["followed-by", "preceded-by"]);
/** @param {any} node @returns {any[]} */
export function boundaryAtoms(node) {
  const found = [], pending = [node];
  while (pending.length) {
    const part = pending.pop();
    if (part && BOUNDARY_METHODS.has(part.method)) found.push(part);
    else for (const child of clauseChildren(part).slice().reverse()) pending.push(child);
  }
  return found;
}
