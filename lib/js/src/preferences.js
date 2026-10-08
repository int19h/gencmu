// Stage-wide preference declarations and conservative authoring diagnostics.
import { GencmuError } from "./errors.js";
import { compareCodePoints } from "./tags.js";

/** @typedef {{document: string, at: [number, number], rule: string, alternative: number, path: string}} ReferenceSite */
/** @typedef {{kind: string, stage: string, rule?: string, higher?: string, lower?: string, container?: string, contained?: string, references: ReferenceSite[], message: string}} LoadWarning */
/** @typedef {{higher: string, lower: string, at: import("./types.js").ErrorLocation}} PreferenceDeclaration */

export class Preferences {
  /** @param {string} stage @param {Map<string, import("./grammar.js").StitchedRule>} rules @param {PreferenceDeclaration[]} declarations */
  constructor(stage, rules, declarations) {
    /** @type {Map<string, Map<string, string[]>>} */
    this.paths = new Map();
    /** @type {Map<string, Set<string>>} */
    const edges = new Map();
    for (const { higher, lower, at } of declarations) {
      for (const name of [higher, lower]) {
        if (/^[A-Z]/.test(name) || !rules.has(name)) throw new GencmuError("grammar", `%prefer requires an existing rule: ${name}`, at);
        if (!edges.has(name)) edges.set(name, new Set());
      }
      if (higher === lower) throw new GencmuError("grammar", `%prefer cannot prefer ${higher} to itself`, at);
      required(edges, higher).add(lower);
    }
    this.names = new Set(edges.keys());
    // Breadth-first traversal gives shortest paths, with code point ties.
    for (const start of [...edges.keys()].sort(compareCodePoints)) {
      const found = new Map();
      const queue = [[start]];
      for (let i = 0; i < queue.length; i++) {
        const path = queue[i];
        for (const next of [...required(edges, path[path.length - 1])].sort(compareCodePoints)) {
          if (next === start) {
            const cycle = [...path, next];
            const locations = cycle.slice(1).map((name, j) => {
              const edge = /** @type {PreferenceDeclaration} */ (declarations.find((entry) => entry.higher === cycle[j] && entry.lower === name));
              return `${edge.at.document}:${edge.at.line}:${edge.at.column}`;
            });
            throw new GencmuError("grammar", `preference cycle: ${cycle.join(" > ")} (${locations.join(", ")})`, /** @type {PreferenceDeclaration} */ (declarations.find((d) => d.higher === start)).at);
          }
          if (!found.has(next)) {
            const reached = [...path, next];
            found.set(next, reached);
            queue.push(reached);
          }
        }
      }
      this.paths.set(start, found);
    }
    /** @type {LoadWarning[]} */
    this.warnings = [];
    if (this.names.size === 0) return;
    /** @type {Map<string, ReferenceSite[]>} */
    const sites = new Map([...this.names].map((name) => [name, []]));
    const restorable = new Set();
    for (const rule of rules.values()) rule.alternatives.forEach((alternative, index) => {
      visit(alternative.expr, "", (expr, path) => {
        if (expr.ref && sites.has(expr.ref)) required(sites, expr.ref).push(site(rule.name, alternative, index, path));
        if (expr.elidable) {
          let head = expr.optional;
          if (head.seq) head = head.seq[0];
          if (head.test) head = head.expr;
          if (head.ref || head.terminal) restorable.add(head.ref || head.terminal);
        }
      });
    });
    for (const name of [...sites.keys()].sort(compareCodePoints)) {
      const references = required(sites, name).sort(siteOrder);
      if (references.length > 1) this.warnings.push({ kind: "prefer-multiple-references", stage, rule: name, references,
        message: `Preference rule ${name} has several written construction sites.` });
    }
    // Facts are [nullable, productive, nonempty]. Restorable terminal reads
    // remain productive and nonempty as well as projectably nullable.
    const facts = new Map([...rules.keys()].map((name) => [name, [false, false, false]]));
    let changed = true;
    while (changed) {
      changed = false;
      for (const rule of rules.values()) {
        const value = alternatives(rule.alternatives.map((a) => properties(a.expr, facts, restorable)));
        const before = required(facts, rule.name);
        for (let i = 0; i < 3; i++) if (value[i] && !before[i]) { before[i] = true; changed = true; }
      }
    }
    /** @type {Map<string, {to: string, site: ReferenceSite}[]>} */
    const containment = new Map();
    for (const rule of rules.values()) {
      /** @type {{to: string, site: ReferenceSite}[]} */
      const children = [];
      rule.alternatives.forEach((alternative, index) => {
        containedReferences(alternative.expr, "", facts, restorable, (name, path) => {
          children.push({ to: name, site: site(rule.name, alternative, index, path) });
        });
      });
      containment.set(rule.name, children.sort((a, b) => siteOrder(a.site, b.site)));
    }
    for (const [higher, lowerPaths] of this.paths) for (const lower of lowerPaths.keys()) {
      for (const [container, contained] of [[higher, lower], [lower, higher]]) {
        if (!required(facts, contained)[2]) continue;
        const references = containmentPath(container, contained, containment);
        if (references) this.warnings.push({ kind: "prefer-same-span-containment", stage, higher, lower, container, contained, references,
          message: `Rule ${container} can contain rival ${contained} over the same original words.` });
      }
    }
    this.warnings.sort((a, b) => {
      for (const key of /** @type {(keyof Omit<LoadWarning, "references" | "message" | "stage">)[]} */ (["kind", "rule", "higher", "lower", "container", "contained"])) {
        const order = compareCodePoints(a[key] || "", b[key] || "");
        if (order) return order;
      }
      return 0;
    });
  }
}

/** @param {any} expr @param {string} path @param {(expr: any, path: string) => void} call */
function visit(expr, path, call) {
  call(expr, path);
  for (const key of ["seq", "choice", "and"]) if (expr[key]) expr[key].forEach((/** @type {any} */ child, /** @type {number} */ i) => visit(child, `${path}/${key}/${i}`, call));
  for (const key of ["expr", "optional", "repeat", "separator"]) if (expr[key]) visit(expr[key], `${path}/${key}`, call);
}

/** @param {string} rule @param {import("./grammar.js").StitchedAlternative} alternative @param {number} index @param {string} path @returns {ReferenceSite} */
function site(rule, alternative, index, path) {
  return { document: alternative.document, at: [/** @type {number} */ (alternative.at.line), /** @type {number} */ (alternative.at.column)], rule, alternative: index, path };
}
/** @param {ReferenceSite} a @param {ReferenceSite} b */
function siteOrder(a, b) {
  // The traversal insertion order resolves expression paths. Numeric array
  // indices must not sort lexically (10 before 2).
  return compareCodePoints(a.rule, b.rule) || a.alternative - b.alternative;
}
/** @param {boolean[][]} values */
function alternatives(values) { return [0, 1, 2].map((i) => values.some((value) => value[i])); }
/** @param {any} expr @param {Map<string, boolean[]>} facts @param {Set<string>} restorable @returns {boolean[]} */
function properties(expr, facts, restorable) {
  if (expr.expr) return properties(expr.expr, facts, restorable);
  if (expr.empty) return [true, true, false];
  if (expr.ref && !/^[A-Z]/.test(expr.ref)) return facts.get(expr.ref) || [false, false, false];
  if (expr.ref || expr.terminal || expr.range || expr.property) return [restorable.has(expr.ref || expr.terminal), true, true];
  if (expr.optional) { const v = properties(expr.optional, facts, restorable); return [true, true, v[2]]; }
  if (expr.repeat) {
    const body = properties(expr.repeat, facts, restorable);
    const sep = expr.separator ? properties(expr.separator, facts, restorable) : [true, true, false];
    return [body[0], body[1], body[2] || (body[1] && sep[1] && sep[2])];
  }
  if (expr.choice || expr.and) return alternatives((expr.choice || expr.and).map((/** @type {any} */ e) => properties(e, facts, restorable)));
  /** @type {boolean[][]} */
  const parts = expr.seq.map((/** @type {any} */ e) => properties(e, facts, restorable));
  return [parts.every((v) => v[0]), parts.every((v) => v[1]), parts.every((v) => v[1]) && parts.some((v) => v[2])];
}
/** @param {any} expr @param {string} path @param {Map<string, boolean[]>} facts @param {Set<string>} restorable @param {(name: string, path: string) => void} call */
function containedReferences(expr, path, facts, restorable, call) {
  if (expr.ref && !/^[A-Z]/.test(expr.ref)) { call(expr.ref, path); return; }
  if (expr.expr) return containedReferences(expr.expr, `${path}/expr`, facts, restorable, call);
  if (expr.optional) return containedReferences(expr.optional, `${path}/optional`, facts, restorable, call);
  if (expr.repeat) {
    containedReferences(expr.repeat, `${path}/repeat`, facts, restorable, call);
    if (expr.separator && properties(expr.repeat, facts, restorable)[0]) containedReferences(expr.separator, `${path}/separator`, facts, restorable, call);
  }
  for (const key of ["seq", "choice", "and"]) if (expr[key]) expr[key].forEach((/** @type {any} */ child, /** @type {number} */ i, /** @type {any[]} */ children) => {
    if (key !== "seq" || children.every((other, j) => j === i || properties(other, facts, restorable)[0])) containedReferences(child, `${path}/${key}/${i}`, facts, restorable, call);
  });
}
/** @param {string} from @param {string} to @param {Map<string, {to: string, site: ReferenceSite}[]>} edges @returns {ReferenceSite[] | null} */
function containmentPath(from, to, edges) {
  const seen = new Set([from]);
  /** @type {{name: string, path: ReferenceSite[]}[]} */
  const queue = [{ name: from, path: [] }];
  for (let i = 0; i < queue.length; i++) for (const edge of edges.get(queue[i].name) || []) {
    const path = [...queue[i].path, edge.site];
    if (edge.to === to) return path;
    if (!seen.has(edge.to)) { seen.add(edge.to); queue.push({ name: edge.to, path }); }
  }
  return null;
}

/** @template K, V @param {Map<K, V>} map @param {K} key @returns {V} */
function required(map, key) {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Missing preference graph entry: ${key}`);
  return value;
}
