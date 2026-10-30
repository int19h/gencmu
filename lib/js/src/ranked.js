import { clauseChildren } from "./clause-walk.js";
import { boundaryAtoms } from "./boundary.js";
// Written ranked groups and their local loading rules.
import { GencmuError } from "./errors.js";
import { DOM_TRUE, prepareClause, simplifyFor } from "./dom.js";

/** @typedef {{document?:string, at?:[number,number], rule:string, alternative:number, path:string}} GroupSite */
/** @typedef {{id:number, site:GroupSite, expr:any, source:any, final:boolean, parent:string, helper:string, captures:Set<string>}} RankedGroup */
/** @typedef {{productive:boolean,nonempty:boolean}} Span */
/** @typedef {{length:number,span:Span,captures:Map<string,{owner:RankedGroup|null,at:number}>,ends:Map<RankedGroup,{start:Span,at:number,option:number}>,bindings:Map<string,RankedGroup>}} ProjectedPath */

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
    this.rules = rules;
    /** @type {WeakMap<object,{conditions:Set<string>[],exports:Set<string>,paths:Map<string,ProjectedPath[]>}>} */
    this.clauseAnalyses = new WeakMap();
    /** @type {ReturnType<typeof rankedWrittenSpans>|undefined} */
    this.spans = undefined;
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

  /** @param {RankedGroup} group */
  validateClauses(group) {
      const source = group.source;
      let analysis = this.clauseAnalyses.get(source);
      if (!analysis) {
        const exports = [source.tags,source.clauses.tags,source.value,source.image,source.clauses.value,source.clauses.image,source.clauses.emit];
        analysis = {conditions:source.clauses.conditions.map(rankedCaptureReads),exports:rankedCaptureReads(exports),paths:new Map()};
        this.clauseAnalyses.set(source,analysis);
      }
      const needed = new Set([...analysis.exports].filter(name=>group.captures.has(name)));
      for (const names of analysis.conditions) if ([...names].some(name=>group.captures.has(name))) for (const name of names) needed.add(name);
      needed.delete("");
      if (!needed.size) return;
      const key = JSON.stringify([...needed].sort());
      let paths = analysis.paths.get(key);
      if (!paths) {
        paths = rankedProjectedPaths(source.expr,this,needed,this.spans ??= rankedWrittenSpans(this.rules));
        analysis.paths.set(key,paths);
      }
      for (const path of paths) {
        const end = path.ends.get(group);
        if (!end) continue;
        const names = new Set(["", ...path.captures.keys()]);
        /** @param {string} name */
        const has = name => names.has(name);
        /** @param {any} value */
        const privateRead = value => [...rankedCaptureReads(value)].some(name => {
          const capture = path.captures.get(name);
          return capture && capture.owner === group;
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
          if (atom && end.start.nonempty) {
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

  validate() {
    const graph = rankedTagGraph(this.rules,this);
    const unsafe = new Set(), users = new Map();
    for (const node of graph.nodes) for (const route of node.routes) {
      if (route.tagged) {
        if (route.unsafe) unsafe.add(node);
      } else for (const child of route.children) {
        if (child === null) unsafe.add(node);
        else {
          const parents = users.get(child) ?? [];
          parents.push(node); users.set(child,parents);
        }
      }
    }
    const pending = [...unsafe];
    for (let i=0;i<pending.length;i++) for (const parent of users.get(pending[i]) ?? []) {
      if (!unsafe.has(parent)) { unsafe.add(parent); pending.push(parent); }
    }
    for (const group of this.groups) {
      this.validateClauses(group);
      const helper = graph.groups.get(group);
      if (!unsafe.has(helper)) continue;
      const outward = [helper], seen = new Set(outward);
      let escapes = false;
      for (let i=0;i<outward.length && !escapes;i++) for (const parent of users.get(outward[i]) ?? []) {
        if (!parent.helper && parent.owner === group.parent) { escapes = true; break; }
        if (parent.helper && parent.owner === group.parent && !seen.has(parent)) { seen.add(parent); outward.push(parent); }
      }
      if (!escapes) continue;
      const queue = [{node:helper,inheritance:[group.site],option:undefined}], visited = new Set([helper]);
      /** @type {any} */ let witness;
      for (let i=0;i<queue.length && !witness;i++) {
        const current = queue[i];
        for (const route of current.node.routes) {
          const option = current.option ?? route.option;
          const inheritance = current.node === helper ? current.inheritance : current.inheritance.concat({
            ...this.sourceSites.get(route.source),path:this.paths.get(route.expr) ?? "",
          });
          if (route.unsafe || !route.tagged && route.children.includes(null)) {
            witness = {inheritance,...(option === undefined ? {} : {option})}; break;
          }
          if (!route.tagged) for (const child of route.children) if (unsafe.has(child) && !visited.has(child)) {
            visited.add(child); queue.push({node:child,inheritance,option});
          }
        }
      }
      this.fail(group,"ranked-choice-tags","A ranked choice must discard its returned tags or return provably empty tags.",{expression:group.expr,...witness});
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

/** @param {Span} a @param {Span} b @returns {Span} */
function rankedJoinSpans(a,b) {
  const productive = a.productive && b.productive;
  return {productive,nonempty:productive && (a.nonempty || b.nonempty)};
}

/** @returns {ProjectedPath} */
function rankedEmptyPath() {
  return {length:0,span:{productive:true,nonempty:false},captures:new Map(),ends:new Map(),bindings:new Map()};
}

/** @param {ProjectedPath} a @param {ProjectedPath} b @returns {ProjectedPath} */
function rankedJoinPaths(a,b) {
  const captures = new Map(a.captures), ends = new Map(a.ends), bindings = new Map(a.bindings);
  for (const [name,capture] of b.captures) captures.set(name,{owner:capture.owner,at:capture.at+a.length});
  for (const [group,end] of b.ends) ends.set(group,{option:end.option,start:rankedJoinSpans(a.span,end.start),at:end.at+a.length});
  for (const [name,group] of b.bindings) bindings.set(name,group);
  return {length:a.length+b.length,span:rankedJoinSpans(a.span,b.span),captures,ends,bindings};
}

/** @param {ProjectedPath} path @returns {string} */
function rankedPathKey(path) {
  return JSON.stringify([path.length,path.span.productive,path.span.nonempty,
    [...path.captures].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,c])=>[name,c.owner?.id??-1,c.at]),
    [...path.ends].sort(([a],[b])=>a.id-b.id).map(([g,e])=>[g.id,e.at,e.option,e.start.productive,e.start.nonempty]),
    [...path.bindings].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,g])=>[name,g.id])]);
}

/** @param {Iterable<ProjectedPath>} paths @returns {ProjectedPath[]} */
function rankedUniquePaths(paths) {
  const seen = new Set(), out = [];
  for (const path of paths) { const key = rankedPathKey(path); if (!seen.has(key)) { seen.add(key); out.push(path); } }
  return out;
}

/** @param {ProjectedPath[]} left @param {ProjectedPath[]} right @returns {ProjectedPath[]} */
function rankedProjectedProduct(left,right) {
  /** @returns {Generator<ProjectedPath>} */
  function* joined() { for (const a of left) for (const b of right) yield rankedJoinPaths(a,b); }
  return rankedUniquePaths(joined());
}

/** @param {any} expr @param {RankedGroups} groups @param {Set<string>} needed @param {ReturnType<typeof rankedWrittenSpans>} spans @returns {ProjectedPath[]} */
function rankedProjectedPaths(expr,groups,needed,spans) {
  /** @param {any} child */ const visit = child => rankedProjectedPaths(child,groups,needed,spans);
  if (expr.empty) return [rankedEmptyPath()];
  if (expr.seq) {
    let paths = [rankedEmptyPath()];
    for (const child of expr.seq) paths = rankedProjectedProduct(paths,visit(child));
    return paths;
  }
  if (expr.choice) return rankedUniquePaths(expr.choice.flatMap(visit));
  if (expr.ranked) {
    const group = /** @type {RankedGroup} */ (groups.byExpression.get(expr));
    const names = [...group.captures].filter(name=>needed.has(name));
    return rankedUniquePaths(expr.ranked.flatMap((/** @type {any} */ child,/** @type {number} */ option)=>visit(child).map(path=> {
      if (names.length) {
        for (const name of names) if (!path.bindings.has(name)) path.bindings.set(name,group);
        path.ends.set(group,{start:{productive:true,nonempty:false},at:path.length,option});
      }
      return path;
    })));
  }
  if (expr.and) {
    let states = [{mask:0,order:/** @type {number[]} */([]),path:rankedEmptyPath()}];
    expr.and.forEach((/** @type {any} */ child,/** @type {number} */ bit)=> {
      const parts = visit(child), candidates = states.slice();
      for (const state of states) parts.forEach((path,index)=>candidates.push({mask:state.mask | (1<<bit),order:state.order.concat(index),path:rankedJoinPaths(state.path,path)}));
      candidates.sort((a,b)=>a.mask-b.mask || rankedOrder(a.order,b.order));
      const seen = new Set(); states = candidates.filter(state=> {
        const key = `${state.mask!==0}:${rankedPathKey(state.path)}`;
        if (seen.has(key)) return false; seen.add(key); return true;
      });
    });
    return rankedUniquePaths(states.filter(state=>state.mask!==0).map(state=>state.path));
  }
  if (expr.optional) return rankedUniquePaths([rankedEmptyPath(),...visit(expr.optional)]);
  if (expr.repeat) {
    const items = visit(expr.repeat);
    return expr.separator ? rankedUniquePaths(items.concat(rankedProjectedProduct(items,visit(expr.separator)))) : items;
  }
  const path = rankedEmptyPath();
  if (typeof expr.capture === "string" && needed.has(expr.capture)) {
    path.length = 1;
    path.captures.set(expr.capture,{owner:groups.owners.get(expr)??null,at:1});
  }
  while (expr.expr) expr = expr.expr;
  const rule = expr.ref && groups.rules.has(expr.ref);
  path.span = {productive:!rule || spans.productive.has(expr.ref),nonempty:!rule || spans.nonempty.has(expr.ref)};
  return [path];
}

/** @param {number[]} a @param {number[]} b @returns {number} */
function rankedOrder(a,b) {
  for (let i=0;i<Math.min(a.length,b.length);i++) if (a[i]!==b[i]) return a[i]-b[i];
  return a.length-b.length;
}

/** @param {any} value @returns {boolean} */
function rankedLiteralEmpty(value) {
  if (value?.const && value.value !== undefined) return rankedLiteralEmpty(value.value);
  return value?.emptySet === true || value?.set instanceof Set && value.set.size === 0;
}

/** Logical empty routes and unary inheritance, without products.
 * @param {Map<string,import("./grammar.js").StitchedRule>} rules
 * @param {RankedGroups} ranked
 */
function rankedTagGraph(rules,ranked) {
  /** @type {any[]} */ const nodes = [];
  const named = new Map(), groups = new Map();
  /** @param {string} owner @param {boolean} helper */
  const node = (owner,helper) => { const n = {owner,helper,routes:/** @type {any[]} */([])}; nodes.push(n); return n; };
  for (const rule of rules.values()) named.set(rule.name,node(rule.name,false));
  /** @type {WeakMap<object,boolean>} */ const captures = new WeakMap();
  /** @param {any} expr @returns {boolean} */
  const captured = expr => {
    if (captures.has(expr)) return /** @type {boolean} */(captures.get(expr));
    const has = !expr.ranked && (typeof expr.capture === "string" || rankedExpressionChildren(expr).some(([child]) => captured(child)));
    captures.set(expr,has); return has;
  };
  for (const rule of rules.values()) for (const source of rule.alternatives) {
    /** @type {WeakMap<object,{zero:boolean,children:any[]}>} */ const memo = new WeakMap();
    /** @param {any} expr @returns {{zero:boolean,children:any[]}} */
    const describe = expr => {
      const known = memo.get(expr); if (known) return known;
      let result;
      if (expr.empty) result = {zero:true,children:[]};
      else if (expr.seq) {
        const parts = expr.seq.map(describe), blocking = parts.filter((/** @type {any} */ p)=>!p.zero).length;
        result = {zero:blocking===0,children:parts.flatMap((/** @type {any} */ p)=>blocking-(p.zero?0:1)===0?p.children:[])};
      } else if (expr.choice || expr.and) {
        const parts = (expr.choice ?? expr.and).map(describe);
        result = {zero:parts.some((/** @type {any} */ p)=>p.zero),children:parts.flatMap((/** @type {any} */ p)=>p.children)};
      } else if (expr.ranked || expr.optional || expr.repeat) {
        if (expr.optional && !expr.elidable && captured(expr.optional)) {
          result = {zero:false,children:describe(expr.optional).children};
        } else {
          const helper = node(rule.name,true);
          result = {zero:false,children:[helper]};
          memo.set(expr,result);
          if (expr.ranked) {
            groups.set(ranked.byExpression.get(expr),helper);
            expr.ranked.forEach((/** @type {any} */ child,/** @type {number} */ option) => helper.routes.push({source,expr,option,tagged:false,unsafe:false,children:describe(child).children}));
          } else helper.routes.push({source,expr,tagged:false,unsafe:false,children:describe(expr.optional ?? expr.repeat).children});
          // The recursive repetition route can only add a self edge.
          if (expr.separator) describe(expr.separator);
        }
      } else if (expr.expr) result = describe(expr.expr);
      else result = {zero:false,children:[expr.ref && named.has(expr.ref)?named.get(expr.ref):null]};
      memo.set(expr,result); return result;
    };
    const expr = /** @type {any} */ (source.expr);
    const body = expr.chain ? describe(expr.repeat) : describe(expr);
    if (expr.chain && expr.separator) describe(expr.separator);
    const terms = [source.tags,source.clauses.tags].filter(t=>t!==undefined);
    named.get(rule.name).routes.push({source,expr:source.expr,tagged:terms.length>0,unsafe:terms.some(t=>!rankedLiteralEmpty(t)),children:body.children});
  }
  return {nodes,groups};
}

/** Finite structural derivations over a compact graph of written branches.
 * @param {Map<string,import("./grammar.js").StitchedRule>} rules
 */
function rankedWrittenSpans(rules) {
  const named = new Map(), memo = new WeakMap();
  /** @type {{lhs:number,rhs:number[]}[]} */ const branches = [];
  let count = 0;
  const terminal = count++;
  for (const rule of rules.values()) named.set(rule.name,count++);
  /** @param {any} expr @returns {number} */
  const expression = expr => {
    const known = memo.get(expr); if (known !== undefined) return known;
    let id;
    if (expr.expr) id = expression(expr.expr);
    else if (expr.ref) id = named.get(expr.ref) ?? terminal;
    else if (expr.literal || expr.range || expr.wildcard) id = terminal;
    else {
      id = count++;
      if (expr.empty || expr.optional) branches.push({lhs:id,rhs:[]});
      if (expr.seq) branches.push({lhs:id,rhs:expr.seq.map(expression)});
      for (const child of expr.choice ?? expr.ranked ?? expr.and ?? []) branches.push({lhs:id,rhs:[expression(child)]});
      if (expr.optional) branches.push({lhs:id,rhs:[expression(expr.optional)]});
      if (expr.repeat) {
        const item = expression(expr.repeat);
        branches.push({lhs:id,rhs:[item]});
        if (expr.separator) branches.push({lhs:id,rhs:[item,expression(expr.separator),item]});
      }
    }
    memo.set(expr,id); return id;
  };
  for (const rule of rules.values()) for (const source of rule.alternatives) branches.push({lhs:named.get(rule.name),rhs:[expression(source.expr)]});
  /** @type {number[][]} */ const users = Array.from({length:count},()=>[]);
  const remaining = branches.map(b=>b.rhs.length), productive = new Set([terminal]), nonempty = new Set([terminal]);
  branches.forEach((b,i)=> { if (!b.rhs.length) productive.add(b.lhs); for(const child of b.rhs) users[child].push(i); });
  const pending = [...productive];
  for (let i=0;i<pending.length;i++) for (const branch of users[pending[i]]) if (--remaining[branch]===0 && !productive.has(branches[branch].lhs)) {
    productive.add(branches[branch].lhs); pending.push(branches[branch].lhs);
  }
  branches.forEach((b,i)=> { if (!remaining[i] && b.rhs.some(child=>nonempty.has(child))) nonempty.add(b.lhs); });
  const reading = [...nonempty];
  for (let i=0;i<reading.length;i++) for (const branch of users[reading[i]]) if (!remaining[branch] && !nonempty.has(branches[branch].lhs)) {
    nonempty.add(branches[branch].lhs); reading.push(branches[branch].lhs);
  }
  return {productive:new Set([...named].filter(([,id])=>productive.has(id)).map(([name])=>name)),nonempty:new Set([...named].filter(([,id])=>nonempty.has(id)).map(([name])=>name))};
}
