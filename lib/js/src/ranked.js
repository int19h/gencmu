// Written ranked groups and their local loading rules.
import { GencmuError } from "./errors.js";
import { DOM_TRUE, prepareClause, simplifyFor } from "./dom.js";

/** @typedef {{document?:string, at?:[number,number], rule:string, alternative:number, path:string}} GroupSite */
/** @typedef {{id:number, site:GroupSite, expr:any, source:any, final:boolean, parent:string, helper:string}} RankedGroup */
/** @typedef {{steps:any[], captures:Map<string,{node:any,at:number}>, ends:Map<RankedGroup,{at:number,option:number}>}} VirtualPath */

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
  for (const rule of dom.rules) for (const alternative of rule.alternatives) {
    const pending = [{expr:alternative.expr,action:0}];
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
        for (const [child] of rankedExpressionChildren(expr).reverse()) pending.push({expr:child,action:0});
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
          const group = {id:this.groups.length, site, expr, source, final, parent:rule.name, helper:`${rule.name}·ranked${this.groups.length}`};
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
    this.clauseErrors = new Map();
    for (const group of this.groups) {
      try {this.validateClauses(group);} catch (error) {
        if (!(error instanceof GencmuError)) throw error;
        this.clauseErrors.set(group,error);
      }
    }
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

  /** @param {RankedGroup} group */
  validateClauses(group) {
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
        for (const condition of source.clauses.conditions) {
          const effective = simplifyFor(prepareClause(condition), has, names);
          if (effective === DOM_TRUE || !privateRead(condition)) continue;
          const variables = [...rankedCaptureReads(effective)];
          // Missing captures remove ordinary conditions under §3.6.
          if (variables.some(name => !has(name))) continue;
          if (variables.some(name => name === "" ? !group.final : /** @type {{at:number}} */ (path.captures.get(name)).at > end.at)) {
            this.fail(group, "ranked-choice-continuation", "A private capture requires a condition ready when its ranked choice closes.", {option:end.option,expression:condition});
          }
        }
        for (const term of [source.tags, source.clauses.tags]) {
          if (term === undefined) continue;
          if (privateRead(term)) this.fail(group, "ranked-choice-export", "A tag term cannot read a private ranked capture.", {option:end.option,expression:term});
        }
        // Written emission references count before absent carriers disappear.
        if (privateRead(source.clauses.emit)) this.fail(group, "ranked-choice-export", "An emission item cannot read a private ranked capture.", {option:end.option,expression:source.clauses.emit});
      }
  }

  /** @param {import("./types.js").Production[]} productions */
  validateTags(productions) {
    const unsafe = new Set(), users = new Map(), byLhs = new Map();
    const written = new Map();
    for (const p of productions) {
      const siblings = byLhs.get(p.lhs) ?? [];
      siblings.push(p); byLhs.set(p.lhs, siblings);
      const terms = p.helper ? p.writtenTags ?? [] : [p.source?.tags,p.source?.clauses.tags].filter(term => term !== undefined);
      written.set(p,terms);
      if (terms.length) {
        if (terms.some(term => !rankedLiteralEmpty(term))) unsafe.add(p.lhs);
      } else if (p.rhs.length === 1) {
        const child = p.rhs[0];
        if (child.terminal) unsafe.add(p.lhs);
        else { const parents = users.get(child.name) ?? []; parents.push(p); users.set(child.name,parents); }
      }
    }
    const pending = [...unsafe];
    for (let index = 0; index < pending.length; index++) for (const parent of users.get(pending[index]) ?? []) {
      if (!unsafe.has(parent.lhs)) {unsafe.add(parent.lhs);pending.push(parent.lhs);}
    }
    for (const group of this.groups) {
      if (this.clauseErrors.has(group)) throw this.clauseErrors.get(group);
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
          if (terms.some((/** @type {any} */ term) => !rankedLiteralEmpty(term)) || !terms.length && p.rhs.length === 1 && p.rhs[0].terminal) {
            witness = {inheritance:inherited,...(option === undefined ? {} : {option})};break;
          }
          if (!terms.length && p.rhs.length === 1 && !p.rhs[0].terminal) {
            const child = p.rhs[0].name;
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
    for (const child of Object.values(node)) if (child && typeof child === "object") pending.push(child);
  }
  return found;
}

/** @returns {VirtualPath} */
function rankedEmptyPath() {return {steps:[],captures:new Map(),ends:new Map()};}

/** @param {VirtualPath} a @param {VirtualPath} b @returns {VirtualPath} */
function rankedJoinPaths(a,b) {
  const offset = a.steps.length, captures = new Map(a.captures), ends = new Map(a.ends);
  for (const [name,capture] of b.captures) captures.set(name,{node:capture.node,at:capture.at+offset});
  for (const [group,end] of b.ends) ends.set(group,{option:end.option,at:end.at+offset});
  return {steps:a.steps.concat(b.steps),captures,ends};
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
      path.ends.set(group,{at:path.steps.length,option});return path;
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
  if (expr.repeat) return expr.separator ? rankedVirtualProduct(rankedVirtualPaths(expr.repeat,groups),rankedVirtualPaths(expr.separator,groups)) : rankedVirtualPaths(expr.repeat,groups);
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
