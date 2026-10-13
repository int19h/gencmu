/** @param {import("./types.js").Expr} expr @returns {string[]} */
export declare function memberEdges(expr: import("./types.js").Expr): string[];
/**
 * Clauses follow the reference check's order. Shared definition clauses
 * occur only with that definition's first surviving alternative.
 * @param {Map<string,import("./grammar.js").StitchedRule>} rules
 * @returns {IterableIterator<{rule:string, alternative:import("./grammar.js").StitchedAlternative, node:any}>}
 */
export declare function familyCalls(rules: Map<string, import("./grammar.js").StitchedRule>): IterableIterator<{
    rule: string;
    alternative: import("./grammar.js").StitchedAlternative;
    node: any;
}>;
/**
 * @param {Map<string,import("./grammar.js").StitchedRule>} rules
 * @param {string} family
 * @returns {Set<string>}
 */
export declare function familyMembers(rules: Map<string, import("./grammar.js").StitchedRule>, family: string): Set<string>;
/**
 * @param {Map<string,import("./grammar.js").StitchedRule>} rules
 * @returns {Map<string,Set<string>>}
 */
export declare function closeFamilies(rules: Map<string, import("./grammar.js").StitchedRule>): Map<string, Set<string>>;
/**
 * @param {import("./types.js").Expr} expr
 * @returns {IterableIterator<import("./types.js").Expr & {optional:import("./types.js").Expr}>}
 */
export declare function ownedOptionals(expr: import("./types.js").Expr): IterableIterator<import("./types.js").Expr & {
    optional: import("./types.js").Expr;
}>;
