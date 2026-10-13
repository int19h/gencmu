/**
 * Children of a term, condition, recipe, emission or clause container.
 * @param {unknown} value
 * @returns {unknown[]}
 */
export declare function clauseChildren(value: unknown): unknown[];
/**
 * The clauses that query and close discovery must inspect. Written clauses
 * keep conditions deferred to a ranked frame or simplified for a capture.
 * @param {import("./types.js").Production} production
 * @returns {unknown[]}
 */
export declare function productionClauses(production: import("./types.js").Production): unknown[];
/**
 * Only the body expressions of a rule, without terminal operands.
 * @param {import("./types.js").Expr} expr
 * @returns {import("./types.js").Expr[]}
 */
export declare function expressionChildren(expr: import("./types.js").Expr): import("./types.js").Expr[];
