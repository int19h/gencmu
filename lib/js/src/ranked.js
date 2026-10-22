import { inheritedIndex } from "./logical.js";
import { clauseChildren } from "./clause-walk.js";
import { boundaryAtoms } from "./boundary.js";
// Written ranked groups and their local loading rules.
import { GencmuError } from "./errors.js";
import { DOM_TRUE, prepareClause, simplifyFor } from "./dom.js";

/** @typedef {{document?:string, at?:[number,number], rule:string, alternative:number, path:string}} GroupSite */
/** @typedef {{id:number, site:GroupSite, expr:any, source:any, final:boolean, parent:string, helper:string, captures:Set<string>}} RankedGroup */
/** @typedef {{steps:any[], captures:Map<string,{node:any,at:number}>, ends:Map<RankedGroup,{start:number,at:number,option:number}>, bindings:Map<string,RankedGroup>}} VirtualPath */

// Source locations stay outside the document DOM.
/** @type {WeakMap<object,[number,number]>} */
export const rankedLocations = new WeakMap();
/** @type {WeakMap<object,object>} */
const writtenOrigins = new WeakMap();

/** @param {object} source @param {object} target */
export function copyRankedLocation(source,target) {
  const at = rankedLocations.get(source);
  if (at) rankedLocations.set(target,at);
  writtenOrigins.set(target,writtenOrigins.get(source) ?? source);
}

/** @param {import("./types.js").GrammarDom} dom @param {{text:string}[]} tokens @param {(token:any)=>[number,number]} positionOf */
export function restoreRankedLocations(dom,tokens,positionOf) {
  const separators = tokens.filter(token => token.text === "≻");
  /** @type {{expr:object,at:[number,number]}[]} */
  const locations = [];
  let index = 0;
  const roots=dom.rules.flatMap(rule=>[
    ...(rule.args??[]),rule.instance,rule.tags,rule.value,rule.image,
    ...(rule.alternatives??[]).flatMap(alternative=>[alternative.expr,alternative.tags,alternative.value,alternative.image]),
    rule.conditions,rule.emit,
  ]).filter(Boolean);
  for (const root of roots) {
    /** @type {{expr:any,action:number}[]} */
    const pending = [{expr:root,action:0}];
    while (pending.length) {
      const item = pending.pop();
      if (!item) break;
      const {expr,action} = item;
      if (action === 1) {
        if (index < separators.length) locations.push({expr,at:positionOf(separators[index])});
      } else if (action === 2) index++;
      else if ("ranked" in expr) {
        for (let option = expr.ranked.length - 1; option > 0; option--) {
          pending.push({expr:expr.ranked[option],action:0},{expr,action:2});
        }
        pending.push({expr,action:1},{expr:expr.ranked[0],action:0});
      } else {
        const children=Array.isArray(expr)?expr.slice():Object.entries(expr).filter(([key])=>key!=="at").map(([,value])=>value);
        for (const child of children.reverse()) if(child && typeof child==="object") pending.push({expr:child,action:0});
      }
    }
  }
  // A caller can supply a DOM unrelated to the source, with no locations.
  if (index === separators.length) for (const {expr,at} of locations) rankedLocations.set(expr,at);
}

/** @param {{text:string}[]} tokens @param {number} at */
export function rankedSyntaxFailure(tokens,at) {
  if (tokens[at]?.text === "≻" || tokens[at-1]?.text === "≻") return true;
  if (tokens[at]?.text !== "|") return false;
  const levels = [false];
  for (let index = 0; index < at; index++) {
    const word = tokens[index].text;
    if (["(","[","{"].includes(word)) levels.push(false);
    else if ([")","]","}"].includes(word)) levels.pop();
    else if (word === "≻") levels[levels.length-1] = true;
    else if (word.startsWith("%")) levels[levels.length-1] = false;
  }
  return levels[levels.length-1];
}

export class RankedGroups {
  /** @param {Map<string,import("./grammar.js").StitchedRule>} rules */
  constructor(rules) {
    /** @type {RankedGroup[]} */
    this.groups = [];
    /** @type {WeakMap<object,RankedGroup>} */
    this.byExpression = new WeakMap();
    /** @type {WeakMap<object,RankedGroup>} */
    this.owners = new WeakMap();
    /** @type {WeakMap<object,string>} */
    this.paths = new WeakMap();
    this.sourceSites = new WeakMap();
    for (const rule of rules.values()) rule.alternatives.forEach((source, alternative) => {
      this.sourceSites.set(source,{document:source.document,at:[source.at.line,source.at.column],rule:rule.name,alternative,path:""});
      /** @param {any} expr @param {string} path @param {boolean} final @param {RankedGroup|null} owner */
      const visit = (expr, path, final, owner) => {
        this.paths.set(expr, path);
        if (expr.ranked) {
          const site = { document: source.document, ...(rankedLocations.has(expr) ? {at:rankedLocations.get(expr)} : {}), rule:rule.name, alternative, path };
          const group = {id:this.groups.length, site, expr, source, final, parent:rule.name, captures:rankedDeclaredCaptures(expr), helper:`${rule.name}·ranked${this.groups.length}`};
          this.groups.push(group);
          this.byExpression.set(expr, group);
          expr.ranked.forEach((/** @type {any} */ child, /** @type {number} */ index) => visit(child, `${path}/ranked/${index}`, final, group));
          return;
        }
        if (typeof expr.capture === "string" && owner) this.owners.set(expr, owner);
        for (const [child, component] of rankedExpressionChildren(expr)) {
          const last = expr.seq || expr.and ? component.endsWith(`/${(expr.seq ?? expr.and).length - 1}`) : true;
          visit(child, `${path}${component}`, final && last && !expr.repeat, owner);
        }
      };
      visit(source.expr, "", true, null);
    });
  }

  /** @param {RankedGroup} group @param {string} code @param {string} message @param {any} [fields] @returns {never} */
  fail(group, code, message, fields = {}) {
    const {document,at} = group.site;
    const location = document === undefined ? "" : at === undefined ? `${document}: ` : `${document}:${at[0]}:${at[1]}: `;
    throw new GencmuError("grammar", `${location}${code}: ${message}`, {
      ...(document === undefined ? {} : {document}),
      ...(at === undefined ? {} : {line:at[0],column:at[1]}),
      code, group:group.site,
      ...(fields.option === undefined ? {} : {option:fields.option}),
      ...(fields.expression === undefined ? {} : {expression:writtenOrigins.get(fields.expression) ?? fields.expression}),
      ...(fields.inheritance === undefined ? {} : {inheritance:fields.inheritance}),
    });
  }

  /** @param {RankedGroup} group @param {(steps:any[])=>boolean} prefixCanRead */
  validateClauses(group, prefixCanRead) {
      const source = group.source;
      const paths = rankedVirtualPaths(source.expr, this.byExpression);
      for (const path of paths) {
        const end = path.ends.get(group);
        if (!end) continue;
        const names = new Set(["", ...path.captures.keys()]);
        /** @param {string} name */
        const has = name => names.has(name);
        /** @param {any} value */
        const privateRead = value => [...rankedCaptureReads(value)].some(name => {
          const capture = path.captures.get(name);
          return capture && this.owners.get(capture.node) === group;
        });
        /** @param {any} value */
        const bindingRead = value => [...rankedCaptureReads(value)].some(name => path.bindings.get(name) === group);
        for (const [index,condition] of source.clauses.conditions.entries()) {
          const effective = simplifyFor(prepareClause(condition), has, names);
          if (effective === DOM_TRUE || !bindingRead(condition)) continue;
          const variables = [...rankedCaptureReads(effective)];
          // Missing captures remove ordinary conditions under §3.6.
          if (variables.some(name => !has(name))) continue;
          if (variables.some(name => name === "" ? !group.final : /** @type {{at:number}} */ (path.captures.get(name)).at > end.at)) {
            this.fail(group, "ranked-choice-continuation", "A private capture requires a condition ready when its ranked choice closes.", {option:end.option,expression:condition});
          }
          const atom = boundaryAtoms(effective).find(atom => atom.method === "preceded-by" && atom.receiver.capture === "");
          if (atom && prefixCanRead(path.steps.slice(0,end.start))) {
            const test = `$.preceded-by(${atom.args.map((/** @type {any} */ target) => target.rule ?? target.terminal).join(" | ")})`;
            this.fail(group,"ranked-choice-boundary",
              `Condition ${index+1} of ${group.parent} combines ${test} with a private capture in option ${end.option+1}. `+
              "That option can start after the rule starts. "+
              "Move the condition into a rule that starts with the ranked group, or test the private capture itself.",
              {option:end.option,expression:condition});
          }
        }
        for (const term of [source.tags, source.clauses.tags]) {
          if (term === undefined) continue;
          if (privateRead(term)) this.fail(group, "ranked-choice-export", "A tag term cannot read a private ranked capture.", {option:end.option,expression:term});
        }
        for (const recipe of [source.value,source.image,source.clauses.value,source.clauses.image]) {
          if (recipe && privateRead(recipe)) this.fail(group,"ranked-choice-export","A recipe cannot read a private ranked capture.",{option:end.option,expression:recipe});
        }
        // Written emission references count before absent carriers disappear.
        if (privateRead(source.clauses.emit)) this.fail(group, "ranked-choice-export", "An emission item cannot read a private ranked capture.", {option:end.option,expression:source.clauses.emit});
      }
  }

  /** @param {import("./types.js").Production[]} productions */
  validate(productions) {
    /** @type {{productive:Set<string>,nonempty:Set<string>}|undefined} */
    let spans;
    /** @param {any[]} steps */
    const prefixCanRead = steps => {
      if (!steps.length) return false;
      const facts = spans ??= rankedSymbolSpans(productions);
      const symbols = steps.map(step => {
        while (step.expr) step = step.expr;
        return step.ref;
      });
      return symbols.every(name => name === undefined || facts.productive.has(name)) &&
        symbols.some(name => name === undefined || facts.nonempty.has(name));
    };
    const unsafe = new Set(), users = new Map(), byLhs = new Map();
    const written = new Map();
    for (const p of productions) {
      const siblings = byLhs.get(p.lhs) ?? [];
      siblings.push(p); byLhs.set(p.lhs, siblings);
      const terms = p.helper ? p.writtenTags ?? [] : [p.source?.tags,p.source?.clauses.tags].filter(term => term !== undefined);
      written.set(p,terms);
      if (terms.length) {
        if (terms.some(term => !rankedLiteralEmpty(term))) unsafe.add(p.lhs);
      } else if (p.logical ? inheritedIndex(p.logical) !== null : p.rhs.length === 1) {
        const child = p.rhs[p.logical ? /** @type {number} */ (inheritedIndex(p.logical)) : 0];
        if (child.terminal) unsafe.add(p.lhs);
        else { const parents = users.get(child.name) ?? []; parents.push(p); users.set(child.name,parents); }
      }
    }
    const pending = [...unsafe];
    for (let index = 0; index < pending.length; index++) for (const parent of users.get(pending[index]) ?? []) {
      if (!unsafe.has(parent.lhs)) {unsafe.add(parent.lhs);pending.push(parent.lhs);}
    }
    for (const group of this.groups) {
      this.validateClauses(group,prefixCanRead);
      if (!unsafe.has(group.helper)) continue;
      const outward = [group.helper], seen = new Set(outward);
      let escapes = false;
      for (let index = 0; index < outward.length && !escapes; index++) for (const parent of users.get(outward[index]) ?? []) {
        if (parent.lhs === group.parent) {escapes = true;break;}
        if (parent.helper && parent.owner === group.parent && !seen.has(parent.lhs)) {seen.add(parent.lhs);outward.push(parent.lhs);}
      }
      if (!escapes) continue;
      const queue = [{name:group.helper,inheritance:[group.site],option:undefined}], visited = new Set([group.helper]);
      /** @type {any} */
      let witness;
      for (let index = 0; index < queue.length && !witness; index++) {
        const current = queue[index];
        for (const p of byLhs.get(current.name) ?? []) {
          const option = current.option ?? p.rankedOption;
          const inherited = p.lhs === group.helper ? current.inheritance : current.inheritance.concat({
            ...this.sourceSites.get(p.source),path:this.paths.get(p.writtenExpression) ?? "",
          });
          const terms = written.get(p);
          const inheritedAt = p.logical ? inheritedIndex(p.logical) : p.rhs.length === 1 ? 0 : null;
          if (terms.some((/** @type {any} */ term) => !rankedLiteralEmpty(term)) || !terms.length && inheritedAt !== null && p.rhs[inheritedAt].terminal) {
            witness = {inheritance:inherited,...(option === undefined ? {} : {option})};break;
          }
          if (!terms.length && inheritedAt !== null && !p.rhs[inheritedAt].terminal) {
            const child = p.rhs[/** @type {number} */ (inheritedAt)].name;
            if (unsafe.has(child) && !visited.has(child)) {visited.add(child);queue.push({name:child,inheritance:inherited,option});}
          }
        }
      }
      this.fail(group, "ranked-choice-tags", "A ranked choice must discard its returned tags or return provably empty tags.", {expression:group.expr,...witness});
    }
  }
}

/** @param {any} expr @returns {[any,string][]} */
function rankedExpressionChildren(expr) {
  /** @type {[any,string][]} */
  const children = [];
  for (const key of ["seq","choice","ranked","and"]) if (expr[key]) expr[key].forEach((/** @type {any} */ child, /** @type {number} */ index) => children.push([child,`/${key}/${index}`]));
  for (const key of ["expr","optional","repeat","separator"]) if (expr[key]) children.push([expr[key],`/${key}`]);
  return children;
}

/** @param {any} value @returns {Set<string>} */
export function rankedCaptureReads(value) {
  const found = new Set(), pending = [value];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (typeof node.capture === "string") found.add(node.capture);
    if (typeof node.captured === "string") found.add(node.captured);
    // Emission carriers and attachments use capture names as strings.
    if (typeof node.take === "string") found.add(node.take);
    for (const key of ["before","after"]) if (Array.isArray(node[key])) for (const name of node[key]) if (typeof name === "string") found.add(name);
    for (const child of clauseChildren(node)) if (child && typeof child === "object") pending.push(child);
  }
  return found;
}

/** The selection binds absent descendants unless an active nested group does.
 * @param {RankedGroup} group @param {Iterable<RankedGroup>} nested */
export function rankedBoundCaptures(group,nested) {
  const names = new Set(group.captures);
  for (const child of nested) for (const name of child.captures) names.delete(name);
  return names;
}

/** @param {any} expr */
function rankedDeclaredCaptures(expr) {
  const names = new Set(), pending = [expr];
  while (pending.length) {
    const node = pending.pop();
    if (typeof node.capture === "string") names.add(node.capture);
    for (const [child] of rankedExpressionChildren(node)) pending.push(child);
  }
  return names;
}

/** @returns {VirtualPath} */
function rankedEmptyPath() {return {steps:[],captures:new Map(),ends:new Map(),bindings:new Map()};}

/** @param {VirtualPath} a @param {VirtualPath} b @returns {VirtualPath} */
function rankedJoinPaths(a,b) {
  const offset = a.steps.length, captures = new Map(a.captures), ends = new Map(a.ends), bindings = new Map(a.bindings);
  for (const [name,capture] of b.captures) captures.set(name,{node:capture.node,at:capture.at+offset});
  for (const [group,end] of b.ends) ends.set(group,{option:end.option,start:end.start+offset,at:end.at+offset});
  for (const [name,group] of b.bindings) bindings.set(name,group);
  return {steps:a.steps.concat(b.steps),captures,ends,bindings};
}

/** @param {VirtualPath[]} left @param {VirtualPath[]} right */
function rankedVirtualProduct(left,right) {
  const out = [];
  for (const a of left) for (const b of right) out.push(rankedJoinPaths(a,b));
  return out;
}

/** @param {any} expr @param {WeakMap<object,RankedGroup>} groups @returns {VirtualPath[]} */
function rankedVirtualPaths(expr,groups) {
  if (expr.empty) return [rankedEmptyPath()];
  if (expr.seq) {
    let paths = [rankedEmptyPath()];
    for (const child of expr.seq) paths = rankedVirtualProduct(paths,rankedVirtualPaths(child,groups));
    return paths;
  }
  if (expr.choice) return expr.choice.flatMap((/** @type {any} */ child) => rankedVirtualPaths(child,groups));
  if (expr.ranked) {
    const group = /** @type {RankedGroup} */ (groups.get(expr));
    return expr.ranked.flatMap((/** @type {any} */ child, /** @type {number} */ option) => rankedVirtualPaths(child,groups).map(path => {
      for (const name of rankedBoundCaptures(group,path.ends.keys())) path.bindings.set(name,group);
      path.ends.set(group,{start:0,at:path.steps.length,option});return path;
    }));
  }
  if (expr.and) {
    const paths = [];
    for (let mask = 1; mask < 1 << expr.and.length; mask++) {
      let route = [rankedEmptyPath()];
      expr.and.forEach((/** @type {any} */ child, /** @type {number} */ index) => {if (mask & (1 << index)) route = rankedVirtualProduct(route,rankedVirtualPaths(child,groups));});
      for (const path of route) paths.push(path);
    }
    return paths;
  }
  if (expr.optional) return [rankedEmptyPath(),...rankedVirtualPaths(expr.optional,groups)];
  if (expr.repeat) {
    const items = rankedVirtualPaths(expr.repeat,groups);
    return expr.separator ? items.concat(rankedVirtualProduct(items,rankedVirtualPaths(expr.separator,groups))) : items;
  }
  const path = rankedEmptyPath();
  path.steps.push(expr);
  if (typeof expr.capture === "string") path.captures.set(expr.capture,{node:expr,at:1});
  return [path];
}

/** @param {any} value @returns {boolean} */
function rankedLiteralEmpty(value) {
  if (value?.const && value.value !== undefined) return rankedLiteralEmpty(value.value);
  return value?.emptySet === true || value?.set instanceof Set && value.set.size === 0;
}

/** Finite structural derivations, with and without a token (engine §2.1).
 * @param {import("./types.js").Production[]} productions
 */
function rankedSymbolSpans(productions) {
  const productive = new Set(), nonempty = new Set();
  /** @type {Map<string,number[]>} */
  const users = new Map();
  const remaining = productions.map(production => production.rhs.length);
  for (const [index,production] of productions.entries()) {
    if (!production.rhs.length) productive.add(production.lhs);
    for (const symbol of production.rhs) {
      const parents = users.get(symbol.name) ?? [];
      parents.push(index); users.set(symbol.name,parents);
      if (symbol.terminal) {productive.add(symbol.name); nonempty.add(symbol.name);}
    }
  }
  const pending = [...productive];
  for (let index = 0; index < pending.length; index++) for (const parent of users.get(pending[index]) ?? []) {
    if (--remaining[parent] !== 0) continue;
    const name = productions[parent].lhs;
    if (!productive.has(name)) {productive.add(name); pending.push(name);}
  }
  const reading = [...nonempty];
  for (let index = 0; index < reading.length; index++) for (const parent of users.get(reading[index]) ?? []) {
    const name = productions[parent].lhs;
    if (remaining[parent] === 0 && !nonempty.has(name)) {nonempty.add(name); reading.push(name);}
  }
  return {productive,nonempty};
}
