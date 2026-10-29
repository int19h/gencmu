// Conservative input coverage of final stitched emissions (engine §9.3).
import { GencmuError } from "./errors.js";

/** @import { Expr } from "./types.js" */

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
    const captures = new Map();
    const pending = [alternative.expr];
    while (pending.length) {
      const expr = /** @type {Expr} */ (pending.pop());
      if ("capture" in expr) captures.set(expr.capture, captures.get(expr.capture) || consuming(expr.expr,marked));
      for (const key of ["seq","choice","ranked","and"]) for (const child of (/** @type {any} */ (expr)[key] ?? [])) pending.push(child);
      for (const key of ["expr","optional","repeat","separator"]) if (/** @type {any} */ (expr)[key]) pending.push(/** @type {any} */ (expr)[key]);
    }
    for (let left=0;left<emission.items.length;left++) for (let right=left+1;right<emission.items.length;right++) {
      const a=emission.items[left], b=emission.items[right];
      if (a.insert || b.insert || a.capture !== "" && b.capture !== "") continue;
      const other = a.capture === "" ? b : a;
      const overlap = other.capture === "" ? consuming(alternative.expr,marked)
        : [...(other.before ?? []),other.capture,...(other.after ?? [])].some(name=>captures.get(name));
      if (overlap) {
        const at = alternative.at;
        throw new GencmuError("grammar",`${at.document}:${at.line}:${at.column}: the emission of ${rule.name} overlaps input positions`,at);
      }
    }
  }
}
