// Conservative input coverage of final stitched emissions (engine §9.3).
import { GencmuError } from "./errors.js";

/** @import { Expr } from "./types.js" */
/** @typedef {{parts:Expr[],captures:Map<string,Expr>}} Route */

/** @param {Expr} expr @param {Set<string>} rules @returns {boolean} */
function consuming(expr,rules) {
  if ("literal" in expr || "range" in expr || "wildcard" in expr) return true;
  if ("ref" in expr) return /^[A-Z_]/.test(expr.ref) || rules.has(expr.ref);
  if ("empty" in expr) return false;
  if ("test" in expr || "capture" in expr) return consuming(expr.expr,rules);
  if ("optional" in expr) return consuming(expr.optional,rules);
  if ("repeat" in expr) return consuming(expr.repeat,rules) || expr.separator !== undefined && consuming(expr.separator,rules);
  return (/** @type {any} */ (expr).seq ?? /** @type {any} */ (expr).choice ?? /** @type {any} */ (expr).ranked ?? /** @type {any} */ (expr).and).some((/** @type {Expr} */ child) => consuming(child,rules));
}

/** @param {Expr} expr @returns {boolean} */
function expandedCapture(expr) {
  if ("capture" in expr) return true;
  if ("ranked" in expr || "repeat" in expr) return false;
  if ("optional" in expr) return expr.elidable !== true && expandedCapture(expr.optional);
  if ("test" in expr) return expandedCapture(expr.expr);
  const children = /** @type {any} */ (expr).seq ?? /** @type {any} */ (expr).choice ?? /** @type {any} */ (expr).and ?? [];
  return children.some(expandedCapture);
}

/** @param {Route[]} left @param {Route[]} right @returns {Route[]} */
function overlapProduct(left,right) {
  return left.flatMap(a => right.map(b => ({parts:[...a.parts,...b.parts],captures:new Map([...a.captures,...b.captures])})));
}

/** @param {Expr} expr @returns {Route[]} */
function routes(expr) {
  if ("empty" in expr) return [{parts:[],captures:new Map()}];
  if ("capture" in expr) return [{parts:[expr.expr],captures:new Map([[expr.capture,expr.expr]])}];
  if ("choice" in expr) return expr.choice.flatMap(routes);
  if ("seq" in expr) {
    /** @type {Route[]} */
    let all = [{parts:[],captures:new Map()}];
    for (const child of expr.seq) all = overlapProduct(all,routes(child));
    return all;
  }
  if ("and" in expr) {
    const choices = expr.and.map(routes);
    const all = [];
    for (let mask=1;mask<1<<choices.length;mask++) {
      /** @type {Route[]} */
      let selected = [{parts:[],captures:new Map()}];
      choices.forEach((choice,index) => { if (mask & (1<<index)) selected = overlapProduct(selected,choice); });
      all.push(...selected);
    }
    return all;
  }
  if ("optional" in expr && expr.elidable !== true && expandedCapture(expr.optional)) return [{parts:[],captures:new Map()},...routes(expr.optional)];
  return [{parts:[expr],captures:new Map()}];
}

/** @param {Map<string,import("./grammar.js").StitchedRule>} definitions */
export function validateEmissionOverlap(definitions) {
  const marked = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of definitions.values()) if (!marked.has(rule.name) && rule.alternatives.some(alternative => consuming(alternative.expr,marked))) {
      marked.add(rule.name);
      changed = true;
    }
  }
  for (const rule of definitions.values()) for (const alternative of rule.alternatives) {
    const emission = alternative.clauses.emit;
    if (!emission || emission.items.length < 2) continue;
    for (const route of routes(alternative.expr)) {
      const whole = route.parts.some(part => consuming(part,marked));
      const kept = emission.items.filter(item => item.insert || item.capture === "" || route.captures.has(/** @type {string} */ (item.capture)));
      const parts = kept.map(item => item.insert ? [] : [...(item.before ?? []),/** @type {string} */ (item.capture),...(item.after ?? [])].filter(name => name === "" || route.captures.has(name)));
      const consumes = (/** @type {string} */ name) => name === "" ? whole : consuming(/** @type {Expr} */ (route.captures.get(name)),marked);
      for (let left=0;left<parts.length;left++) for (let right=left+1;right<parts.length;right++) {
        for (const a of parts[left]) for (const b of parts[right]) if ((a === "" || b === "") && consumes(a) && consumes(b)) {
          const at = alternative.at;
          throw new GencmuError("grammar",`${at.document}:${at.line}:${at.column}: the emission of ${rule.name} overlaps input positions`,at);
        }
      }
    }
  }
}
