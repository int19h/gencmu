// Sealed slot declarations, template validation and the local tag closure.
import { GencmuError } from "./errors.js";
import { compareCodePoints } from "./tags.js";

/** @typedef {{document: string, at: [number, number], rule: string, alternative: number, path: string}} ReferenceSite */
/** @typedef {{kind: string, stage: string, rule?: string, higher?: string, lower?: string, container?: string, contained?: string, references: ReferenceSite[], message: string}} LoadWarning */
/** @typedef {{higher: string, lower: string, at: import("./types.js").ErrorLocation}} PreferenceDeclaration */

/** @typedef {ReferenceSite & {expression: any, source: import("./grammar.js").StitchedAlternative}} RankedReference */
/** @typedef {{id: number, names: Set<string>, parent: string, references: RankedReference[]}} SlotComponent */
/** @typedef {{component: SlotComponent, reference: RankedReference, roles: Map<string,string>, holeNames: Set<string>, paths: WeakMap<object,string>, body: any}} SlotVariant */

export class Preferences {
  /** @param {string} stage @param {Map<string, import("./grammar.js").StitchedRule>} rules @param {PreferenceDeclaration[]} declarations */
  constructor(stage, rules, declarations) {
    /** @type {Map<string, Map<string, string[]>>} */
    this.paths = new Map();
    this.declarations = declarations;
    /** @type {Map<string, Set<string>>} */
    const edges = new Map();
    for (const { higher, lower, at } of declarations) {
      for (const name of [higher, lower]) {
        if (/^[A-Z]/.test(name) || !rules.has(name)) throw new GencmuError("grammar", `%prefer requires an existing rule: ${name}`, at);
        if (!edges.has(name)) edges.set(name, new Set());
      }
      if (higher === lower) throw new GencmuError("grammar", `%prefer cannot prefer ${higher} to itself`, at);
      slotRequired(edges, higher).add(lower);
    }
    this.names = new Set(edges.keys());
    // Breadth-first traversal gives shortest paths, with code point ties.
    for (const start of [...edges.keys()].sort(compareCodePoints)) {
      const found = new Map();
      const queue = [[start]];
      for (let i = 0; i < queue.length; i++) {
        const path = queue[i];
        for (const next of [...slotRequired(edges, path[path.length - 1])].sort(compareCodePoints)) {
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
    this.warnings = [];
    /** @type {Map<string, SlotComponent>} */
    this.byName = new Map();
    /** @type {Map<import("./grammar.js").StitchedAlternative, SlotVariant>} */
    this.variants = new Map();
    /** @type {SlotComponent[]} */
    this.components = [];
    /** @type {Map<string,SlotVariant>} */
    this.ruleVariants = new Map();
    /** @type {Map<import("./grammar.js").StitchedAlternative,Map<number,SlotVariant>>} */
    this.sourceVariants = new Map();
    this.helperExpressions = new Map();
    this.hasHelperSlots = false;
    if (this.names.size === 0) return;
    /** @type {Map<string, RankedReference[]>} */
    const sites = new Map([...this.names].map(name => [name, []]));
    for (const rule of rules.values()) rule.alternatives.forEach((alternative, index) => {
      slotVisit(alternative.expr, "", (expr, path) => {
        if (expr.ref && sites.has(expr.ref)) slotRequired(sites, expr.ref).push({ ...slotSite(rule.name, alternative, index, path), expression: expr, source: alternative });
      });
    });
    for (const [name, references] of sites) {
      if (references.length !== 1) this.fail("prefer-slot-multiple-references", name, {references}, `Rule ${name} requires exactly one written reference site.`);
    }
    const seen = new Set();
    for (const start of this.names) {
      if (seen.has(start)) continue;
      const names = new Set([start]), pending = [start];
      for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
        seen.add(name);
        for (const other of this.names) if ((edges.get(name)?.has(other) || edges.get(other)?.has(name)) && !names.has(other)) {
          names.add(other); pending.push(other);
        }
      }
      const references = [...names].map(name => slotRequired(sites, name)[0]);
      const parent = references[0].rule;
      if (references.some(reference => reference.rule !== parent)) this.fail("prefer-slot-parent", start, {references, parent}, "Ranked references require one common parent.");
      /** @type {SlotComponent} */
      const component = {id: this.components.length, names, parent, references};
      this.components.push(component);
      let common;
      for (const name of names) {
        const reference = slotRequired(sites, name)[0];
        const variant = this.template(reference, component);
        const template = JSON.stringify(variant.body);
        if (common !== undefined && common !== template) this.fail("prefer-slot-template", name, {references, parent, expression: reference.path}, "The parent bodies differ outside the ranked hole.");
        common = template;
        this.byName.set(name, component);
        this.ruleVariants.set(name, variant);
        this.variants.set(reference.source, variant);
        let variants = this.sourceVariants.get(reference.source);
        if (!variants) this.sourceVariants.set(reference.source, variants = new Map());
        variants.set(component.id, variant);
      }
    }
  }

  /** @param {string} code @param {string} name @param {any} fields @param {string} message @returns {never} */
  fail(code, name, fields, message) {
    const declaration = /** @type {PreferenceDeclaration} */ (this.declarations.find(d => d.higher === name || d.lower === name));
    if (fields.references) fields.references = fields.references.map((/** @type {ReferenceSite} */ {document,at,rule,alternative,path}) => ({document,at,rule,alternative,path}));
    throw new GencmuError("grammar", `${code}: ${message}`, { ...declaration.at, code, declaration: {higher: declaration.higher, lower: declaration.lower}, ...fields });
  }

  /** @param {RankedReference} reference @param {SlotComponent} component @returns {SlotVariant} */
  template(reference, component) {
    const roles = new Map(), paths = new WeakMap();
    /** @type {(expr: any, path: string) => any} */
    const normalize = (expr, path) => {
      paths.set(expr, path);
      if (expr.choice) {
        const branch = expr.choice.find((/** @type {any} */ child) => slotContainsDeep(child, reference.expression));
        if (branch) return normalize(branch, path);
      }
      if (expr.capture) {
        const hole = slotContainsReference(expr.expr, reference.expression);
        roles.set(expr.capture, hole ? "hole" : path);
        const inner = normalize(expr.expr, `${path}/expr`);
        return hole ? inner : {capture: path, expr: inner};
      }
      if (expr.test && slotContainsReference(expr.expr, reference.expression)) return normalize(expr.expr, `${path}/expr`);
      if (expr === reference.expression) return {hole: true};
      /** @type {any} */
      /** @type {any} */
  const result = {};
      for (const [key, value] of Object.entries(expr)) {
        if (key === "at") continue;
        if (["seq", "choice", "and"].includes(key)) result[key] = value.map((/** @type {any} */ child, /** @type {number} */ index) => normalize(child, `${path}/${key}/${index}`));
        else if (["expr", "optional", "repeat", "separator"].includes(key)) result[key] = normalize(value, `${path}/${key}`);
        else result[key] = slotCanonical(value);
      }
      return result;
    };
    const body = normalize(reference.source.expr, "");
    const holeNames = new Set([...roles].filter(([,role]) => role === "hole").map(([name]) => name));
    // Inspect exports before per-production absent-carrier pruning.
    if (slotMentions(reference.source.clauses.emit, holeNames)) this.fail("prefer-slot-template", reference.expression.ref,
      {parent: component.parent, references: component.references, expression: "emits"}, "An emission item cannot name or read a ranked hole capture.");
    return {component, reference, roles, holeNames, paths, body};
  }

  /** @param {import("./types.js").Production[]} productions */
  validate(productions) {
    if (!this.names.size) return;
    this.helperExpressions = new Map(productions.filter(p=>p.helper).map(p=>[p.lhs,p.writtenExpression]));
    this.hasHelperSlots = productions.some(p=>p.helper && p.rhs.some(s=>this.names.has(s.name)));
    const unsafe = new Set(), users = new Map();
    /** @type {(name: string) => void} */
    const mark = name => { unsafe.add(name); };
    for (const p of productions) {
      const terms = p.writtenTags;
      if (terms?.length) {
        if (terms.some(term => !slotLiteralEmpty(term))) mark(p.lhs);
      } else if (p.rhs.length === 1) {
        const symbol = p.rhs[0];
        if (symbol.terminal) mark(p.lhs);
        else {
          const list = users.get(symbol.name) ?? []; list.push(p.lhs); users.set(symbol.name, list);
        }
      }
    }
    const pending = [...unsafe.keys()];
    for (let i=0;i<pending.length;i++) for (const parent of users.get(pending[i]) ?? []) {
      if (!unsafe.has(parent)) { mark(parent); pending.push(parent); }
    }
    for (const component of this.components) {
      const signatures = new Map();
      const gates = [];
      for (const p of productions) {
        const variant = this.variant(p, component);
        if (!variant || variant.component !== component) continue;
        const hole = p.rhs.findIndex(symbol => component.names.has(symbol.name) || slotContainsDeep(this.helperExpressions.get(symbol.name) ?? {}, variant.reference.expression));
        const direct = hole !== -1;
        const boundary = hole < 0 ? false : component.names.has(p.rhs[hole].name) || slotEndsAtHole(this.helperExpressions.get(p.rhs[hole].name), variant.reference.expression);
        const holeNames = new Set(p.captures.filter(capture => capture.index === hole).map(capture => capture.name));
        // The implicit unary capture also reads the private constituent tags.
        const actualHole = direct && component.names.has(p.rhs[hole].name);
        const privateNames = new Set([...variant.holeNames, ...(actualHole ? holeNames : [])]);
        const privateTags = new Set([...privateNames, ...(direct && unsafe.has(p.rhs[hole].name) ? holeNames : [])]);
        /** @type {(value: any) => any} */
        const normalize = value => slotCanonical(value, variant.roles, p, hole);
        /** @type {(condition: import("./types.js").ReadyCondition) => boolean} */
        const ready = condition => direct && (condition.readyAt < hole || condition.readyAt === hole && boundary);
        const commonConditions = [];
        const candidateGates = [];
        for (const condition of p.conditions) {
          if (slotStructuralRead(condition.condition, privateNames) && !ready(condition)) this.fail("prefer-slot-continuation", variant.reference.expression.ref,
            {parent:component.parent, references:component.references, expression:normalize(condition.condition)}, "A private hole pattern requires a ready condition gate.");
          if (slotTagRead(condition.condition, privateTags) && !ready(condition)) this.requireEmpty(component, unsafe, condition.condition, productions);
          if (ready(condition)) candidateGates.push(normalize(condition.condition));
          else commonConditions.push(normalize(condition.condition));
        }
        for (const term of p.writtenTags ?? []) {
          if (slotStructuralRead(term, privateNames)) this.fail("prefer-slot-continuation", variant.reference.expression.ref,
            {parent:component.parent, references:component.references, expression:normalize(term)}, "A tag term cannot read private hole structure.");
          if (slotTagRead(term, privateTags)) this.requireEmpty(component, unsafe, term, productions);
        }
        if (!p.helper && !p.writtenTags?.length && p.rhs.length === 1 && direct && (component.names.has(p.rhs[hole].name) || unsafe.has(p.rhs[hole].name))) this.requireEmpty(component, unsafe, {inherit: true}, productions);
        const key = JSON.stringify({
          role:p.helper ? variant.paths.get(/** @type {object} */ (p.writtenExpression)) : "written-parent",
          symbols:p.rhs.map((symbol,index) => index === hole ? {hole:true} : {name:slotSymbolRole(symbol, variant, this.helperExpressions), terminal:symbol.terminal, test:normalize(symbol.test)}),
          captures:p.captures.filter(capture => capture.index !== hole && capture.name !== "\u0000child").map(capture => ({name:variant.roles.get(capture.name), index:capture.index})),
        });
        const signature = JSON.stringify({tags:normalize(p.writtenTagClauses), emit:normalize(p.emit)});
        const previous = signatures.get(key);
        if (previous !== undefined && previous !== signature) this.fail("prefer-slot-template", variant.reference.expression.ref,
          {parent:component.parent, references:component.references, expression:"clauses"}, "The effective parent tag, emission or continuation clauses differ.");
        signatures.set(key, signature);
        if (direct) gates.push({p, variant, commonConditions, candidateGates, normalize, hole, key});
      }
      // A condition that differs across variants cannot remain after the hole.
      const byTemplate = new Map();
      for (const entry of gates) {
        const conditions = JSON.stringify(entry.commonConditions);
        const previous = byTemplate.get(entry.key);
        if (previous !== undefined && previous !== conditions) this.fail("prefer-slot-continuation", entry.variant.reference.expression.ref,
          {parent:component.parent, references:component.references, expression:entry.commonConditions}, "Differing conditions must be ready at the ranked hole boundary.");
        byTemplate.set(entry.key, conditions);
      }
    }
  }

  /** @param {import("./types.js").Production} p @param {SlotComponent} component @returns {SlotVariant | undefined} */
  variant(p, component) {
    for (const symbol of p.rhs) {
      const variant = this.ruleVariants.get(symbol.name);
      if (variant?.component === component) return variant;
    }
    for (const reference of component.references) if (reference.source === p.source) {
      const variant = this.ruleVariants.get(reference.expression.ref);
      if (p.rhs.some(symbol => slotContainsDeep(this.helperExpressions.get(symbol.name) ?? {}, reference.expression))) return variant;
    }
    return p.source && this.sourceVariants.get(p.source)?.get(component.id);
  }

  /** @param {SlotComponent} component @param {Set<string>} unsafe @param {any} expression @param {import("./types.js").Production[]} productions */
  requireEmpty(component, unsafe, expression, productions) {
    for (const name of component.names) if (unsafe.has(name)) this.fail("prefer-slot-tags", name,
      {parent:component.parent, references:component.references, expression:slotCanonical(expression), inheritance:slotInheritancePath(name,unsafe,productions)}, "Private hole tags are neither dead nor provably empty.");
  }
}

/** @param {import("./types.js").GrammarSymbol} symbol @param {SlotVariant} variant @param {Map<string, object | undefined>} helpers */
export function slotSymbolRole(symbol, variant, helpers) {
  if (!helpers.has(symbol.name)) return symbol.name;
  const expression = helpers.get(symbol.name);
  const path = expression && variant.paths.get(expression);
  if (path === undefined) throw new Error("A slot helper requires its written expression path.");
  return `${variant.reference.rule}:${path}`;
}

/** @param {any} expr @param {any} reference @returns {boolean} */
function slotContainsReference(expr, reference) {
  if (expr === reference) return true;
  return expr.expr ? slotContainsReference(expr.expr, reference) : false;
}

/** @param {any} value @param {Map<string,string>} [roles] @param {import("./types.js").Production | null} [production] @param {number} [hole] @returns {any} */
function slotCanonical(value, roles = new Map(), production = null, hole = -1) {
  if (value?.const && value.value !== undefined) return slotCanonical(value.value, roles, production, hole);
  if (value?.set instanceof Set) {
    const tags=[...value.set].sort(compareCodePoints).map(tag=>({tag}));
    return tags.length===0 ? {emptySet:true} : tags.length===1 ? tags[0] : {union:tags};
  }
  if (value instanceof Set) return {set:[...value].sort(compareCodePoints)};
  if (Array.isArray(value)) return value.map(child => slotCanonical(child, roles, production, hole));
  if (!value || typeof value !== "object") return value;
  /** @type {any} */
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "at" || key === "source" || key === "document") continue;
    if (key === "capture" || key === "captured") result[key] = child === "" ? "" : roles.get(child) ?? child;
    else if (key === "before" || key === "after") result[key] = child.map((/** @type {string} */ name) => roles.get(name) ?? name);
    else result[key] = slotCanonical(child, roles, production, hole);
  }
  return result;
}

/** @param {any} value @param {Set<string>} names @returns {boolean} */
function slotMentions(value, names) {
  if (!value || typeof value !== "object") return false;
  if (typeof value.capture === "string" && names.has(value.capture)) return true;
  if (typeof value.captured === "string" && names.has(value.captured)) return true;
  if ((value.before ?? []).some((/** @type {string} */ name) => names.has(name)) || (value.after ?? []).some((/** @type {string} */ name) => names.has(name))) return true;
  return Object.values(value).some(child => Array.isArray(child) ? child.some(part => slotMentions(part, names)) : slotMentions(child, names));
}

/** @param {any} value @param {Set<string>} names @returns {boolean} */
function slotStructuralRead(value, names) {
  if (!value || typeof value !== "object") return false;
  if ((value.op === "≅" || value.op === "≇") && slotMentions(value.left, names)) return true;
  return Object.values(value).some(child => Array.isArray(child) ? child.some(part => slotStructuralRead(part, names)) : slotStructuralRead(child, names));
}

/** @param {any} value @param {Set<string>} names @returns {boolean} */
function slotTagRead(value, names) {
  if (!value || typeof value !== "object") return false;
  if (["tags", "classes"].includes(value.call) && value.args.length === 1 && names.has(value.args[0]?.capture)) return true;
  return Object.values(value).some(child => Array.isArray(child) ? child.some(part => slotTagRead(part, names)) : slotTagRead(child, names));
}

/** @param {any} value @returns {boolean} */
function slotLiteralEmpty(value) {
  if (value?.const && value.value !== undefined) return slotLiteralEmpty(value.value);
  return value?.emptySet === true || value?.set instanceof Set && value.set.size === 0;
}

/** @param {any} expr @param {string} path @param {(expr: any, path: string) => void} call */
function slotVisit(expr, path, call) {
  call(expr, path);
  for (const key of ["seq", "choice", "and"]) if (expr[key]) expr[key].forEach((/** @type {any} */ child, /** @type {number} */ i) => slotVisit(child, `${path}/${key}/${i}`, call));
  for (const key of ["expr", "optional", "repeat", "separator"]) if (expr[key]) slotVisit(expr[key], `${path}/${key}`, call);
}

/** @param {string} rule @param {import("./grammar.js").StitchedAlternative} alternative @param {number} index @param {string} path @returns {ReferenceSite} */
function slotSite(rule, alternative, index, path) {
  return { document: alternative.document, at: [/** @type {number} */ (alternative.at.line), /** @type {number} */ (alternative.at.column)], rule, alternative: index, path };
}
/** @template K, V @param {Map<K, V>} map @param {K} key @returns {V} */
function slotRequired(map, key) {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Missing preference graph entry: ${key}`);
  return value;
}

/** @param {any} expr @param {any} reference @returns {boolean} */
function slotContainsDeep(expr, reference) {
  let found = false;
  slotVisit(expr, "", node => { if (node === reference) found = true; });
  return found;
}

// The worklist proves emptiness. Only a failed closure needs a diagnostic
// walk, which follows productions in source order instead of seed arrival.
/** @param {string} name @param {Set<string>} unsafe @param {import("./types.js").Production[]} productions @returns {any[]} */
function slotInheritancePath(name,unsafe,productions) {
  /** @type {Map<string,import("./types.js").Production[]>} */
  const byRule = new Map();
  for (const p of productions) {const list=byRule.get(p.lhs)??[];list.push(p);byRule.set(p.lhs,list);}
  const visited = new Set();
  /** @type {{rule?:string,end?:boolean,path:any}[]} */
  const stack = [{rule:name,path:null}];
  while (stack.length) {
    const part = stack.pop();
    if (!part) break;
    if (part.end) {const path=[];for(let step=part.path;step;step=step.parent) path.push(step.value);return path.reverse();}
    if (visited.has(part.rule)) continue;
    visited.add(part.rule);
    for (const p of [...(byRule.get(part.rule??"")??[])].reverse()) {
      if (p.writtenTags?.some(term=>!slotLiteralEmpty(term))) stack.push({end:true,path:{parent:part.path,value:{rule:p.lhs,expression:"tags",source:p.source?.at}}});
      else if (!p.writtenTags?.length && p.rhs.length===1) {
        const symbol=p.rhs[0];
        if (symbol.terminal) stack.push({end:true,path:{parent:part.path,value:{rule:p.lhs,terminal:symbol.name,source:p.source?.at}}});
        else if (unsafe.has(symbol.name)) stack.push({rule:symbol.name,path:{parent:part.path,value:{rule:p.lhs}}});
      }
    }
  }
  throw new Error("An unsafe tag source requires an inheritance path.");
}

/** @param {any} expr @param {any} reference @returns {boolean} */
function slotEndsAtHole(expr, reference) {
 if (expr === reference) return true;
 if (!expr) return false;
 if (expr.expr) return slotEndsAtHole(expr.expr, reference);
 if (expr.optional) return slotEndsAtHole(expr.optional, reference);
 if (expr.seq) return slotEndsAtHole(expr.seq.at(-1), reference);
 if (expr.choice) return expr.choice.some((/** @type {any} */ child)=>slotEndsAtHole(child, reference));
 return false;
}
