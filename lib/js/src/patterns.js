import { PROPERTY_NAMES } from "./unicode.js";
// Finite observations of structural trees (engine §4.1). A helper carries
// a sequence monoid: its relations concatenate without retaining trees.
import { countWork, hooks } from "./testing.js";
import { stringName } from "./tags.js";
import { run } from "./trampoline.js";
import { GencmuError } from "./errors.js";
import { layeredPatternProblem, layeredPatternText } from "./pattern-shapes.js";

/** @param {any} test @param {string} input @param {Set<string>} tags @returns {boolean} */
export function leafTest(test, input, tags) {
  if (test.test === "=") return input === test.value.string;
  if (test.test === "≠") return input !== test.value.string;
  for (const requirement of test.requirements) for (const tag of requirement.value.set) {
    if (tags.has(tag) === requirement.negated) return false;
  }
  return true;
}

/** @param {any} pattern @param {any} leaf @returns {boolean} */
function leafMatches(pattern,leaf) {
  if (!leaf) return false;
  if (pattern.test) return leafMatches(pattern.expr,leaf) && leafTest(pattern,leaf.value,leaf.tags);
  return pattern.terminal === leaf.terminal;
}

/** @param {any} node @returns {any[]} */
export function patternParts(node) {
  if (Array.isArray(node)) return node;
  if (node.union || node.intersection || node.difference) return node.union ?? node.intersection ?? node.difference;
  if (node.path) return [node.pattern];
  if (node.test) return [node.expr];
  if (node.child) return [node.child];
  if (node.choice) return node.choice.flat();
  return [...(node.children ?? []), ...(node.optional ?? node.repeat ?? []), ...(node.separator ?? [])];
}

/**
 * Shape only. Term and test typing remains in dom.js. The caller bounds
 * nesting before calling this walk.
 * @param {any} root @param {(test: any) => string | null} testFault
 * @returns {string | null}
 */
export function patternProblem(root, testFault) {
  return layeredPatternProblem(root, {test:testFault, terminal:name=>/^[A-Z][A-Za-z0-9_-]*$/.test(name) || name.startsWith('_') && PROPERTY_NAMES.has(name.slice(1))});
}

/**
 * @param {any} root
 * @param {(name:string, at:[number,number]) => any} constant
 * @param {(term:any, test:any) => any} value
 * @param {{isMark(code:number):boolean, changesInDocument?(code:number):boolean}} unicode
 * @returns {any}
 */
export function resolvePattern(root, constant, value, unicode) {
  /** @param {any} atom @param {string} message @returns {never} */
  const fault=(atom,message)=>{throw new GencmuError('grammar',message,{line:atom.at?.[0],column:atom.at?.[1]});};
  /** @param {any} node @returns {Generator<any,any,any>} */
  function* resolve(node) {
    if (Array.isArray(node)) {
      const items=[];
      for(const child of node) items.push(yield resolve(child));
      return items;
    }
    let result={...node};
    if (node.constant) {
      const resolved=constant(node.constant,node.at);
      if ('pattern' in resolved) {
        if (node.exact || node.children) return fault(node,'a pattern-valued constant cannot carry node decorations');
        return resolved.pattern;
      }
      result={terminal:stringName(resolved.string,unicode),at:node.at,...(node.exact?{exact:true}:{})};
    } else if (node.literal || node.range || node.wildcard) {
      const terminal=node.literal ? stringName(value(node.literal,node).string,unicode)
        : node.range ? node.range.map((/** @type {any} */ end)=>stringName(value(end,node).string,unicode)).join('..') : '_';
      result={terminal,at:node.at,...(node.exact?{exact:true}:{})};
    } else if (node.test) {
      let base=node.expr;
      while(base.test) base=base.expr;
      if(base.constant && 'pattern' in constant(base.constant,base.at)) return fault(base,'a tested pattern atom requires a string constant');
      result.expr=yield resolve(node.expr);
      if (node.test==='tags') result.requirements=node.requirements.map((/** @type {any} */ requirement)=>({...requirement,value:value(requirement.value,node)}));
      else result.value=value(node.value,node);
      return result;
    }
    for(const key of ['union','intersection','difference','sequence','choice','pattern','children','child','node','optional','repeat','separator']) {
      if(node[key]) result[key]=yield resolve(node[key]);
    }
    for(const key of ['union','intersection']) if(result[key]) result[key]=result[key].flatMap((/** @type {any} */ part)=>part[key]??[part]);
    return result;
  }
  return run(resolve(root));
}

/** @param {any} value @returns {any} */
function patternKey(value) {
  if (value instanceof Set) return [...value].sort();
  if (Array.isArray(value)) return value.map(patternKey);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'at').map(([key,val]) => [key,patternKey(val)]));
}

export class PatternMachine {
  /** @param {any[]} roots */
  constructor(roots) {
    /** @type {any[]} */ this.predicates = [];
    /** @type {any[]} */ this.machines = [];
    /** @type {Map<string,number>} */ this.ids = new Map();
    /** @type {any[]} */ this.states = [];
    /** @type {Map<string,number>} */ this.stateIds = new Map();
    /** @type {Map<string,number>} */ this.transitions = new Map();
    roots.forEach(n => this.compile(n));
    this.empty = this.intern({count:0, first:0n,last:0n,any:0n, relations:this.machines.map(m => m.epsilon)});
    // A seal contributes one nameless child even over an empty interval.
    this.seal = this.nodeState(0n,false);
  }
  /** @param {any} n @returns {number} */
  compile(n) {
    const key = JSON.stringify(patternKey(n));
    const old = this.ids.get(key); if (old !== undefined) return old;
    const p = {...n};
    if (n.path) p.child = this.compile(n.pattern);
    for (const k of ['union','intersection','difference']) if (n[k]) p.operands = n[k].map((/** @type {any} */ x) => this.compile(x));
    if (n.children) { const m = this.sequence(n.children); p.machine = this.machines.length; this.machines.push(m); }
    const id = this.predicates.length;
    this.predicates.push(p); this.ids.set(key,id); return id;
  }
  /** @param {any} body @returns {any} */
  sequence(body) {
    /** @type {{from:number,to:number,predicate:number | null}[]} */ const edges=[];
    let size=0;
    const state=() => size++;
    const edge=(/** @type {number} */ from,/** @type {number} */ to,/** @type {number|null} */ predicate=null) => edges.push({from,to,predicate});
    const build=(/** @type {any} */ n,/** @type {number} */ from,/** @type {number} */ to) => {
      if (Array.isArray(n)) {
        if (!n.length) edge(from,to);
        let a=from;
        n.forEach((x,i) => { const b=i===n.length-1?to:state(); build(x,a,b);a=b; });
      } else if (n.child) edge(from,to,this.compile(n.child));
      else if (n.siblings) { edge(from,to); edge(from,from,-1); }
      else if (n.choice) n.choice.forEach((/** @type {any} */ arm) => build(arm,from,to));
      else if (n.optional) { edge(from,to); build(n.optional,from,to); }
      else if (n.repeat) {
        const a=state(),b=state(); build(n.repeat,from,a); edge(a,to);
        if (n.separator) build(n.separator,a,b); else edge(a,b);
        build(n.repeat,b,a);
      }
    };
    const start=state(),end=state(); build(body,start,end);
    const epsilon=Array.from({length:size},(_,i) => 1n<<BigInt(i));
    edges.filter(e => e.predicate===null).forEach(e => epsilon[e.from] |= 1n<<BigInt(e.to));
    for (let k=0;k<size;k++) for (let i=0;i<size;i++) if (epsilon[i] & (1n<<BigInt(k))) epsilon[i] |= epsilon[k];
    return {size,start,end,edges,epsilon};
  }
  /** @param {any} s @returns {number} */
  intern(s) {
    const key = `${s.count}/${s.first}/${s.last}/${s.any}/${s.relations.map((/** @type {bigint[]} */ r) => r.join(',')).join(';')}/${s.bits??''}/${s.empty??''}`;
    const old=this.stateIds.get(key);if(old!==undefined)return old;
    if (hooks.work) countWork(hooks.work, "structuralStates");
    const id=this.states.length;this.states.push(s);this.stateIds.set(key,id);return id;
  }
  /** @param {bigint[]} a @param {bigint[]} b @returns {bigint[]} */
  compose(a,b) {
    return a.map(row => { let out=0n;for(let k=0;k<b.length;k++)if(row&(1n<<BigInt(k)))out|=b[k];return out; });
  }
  /** @param {number} left @param {number} right @returns {number} */
  concat(left,right) {
    const key=`c${left},${right}`;const old=this.transitions.get(key);if(old!==undefined)return old;
    const a=this.states[left],b=this.states[right];
    const id=this.intern({count:Math.min(2,a.count+b.count),first:a.count?a.first:b.first,last:b.count?b.last:a.last,any:a.any|b.any,
      relations:a.relations.map((/** @type {bigint[]} */ r,/** @type {number} */ i) => this.compose(r,b.relations[i]))});
    if (hooks.work) countWork(hooks.work, "structuralTransitions");
    this.transitions.set(key,id);return id;
  }
  /** @param {bigint} bits @param {boolean} empty @returns {number} */
  nodeState(bits,empty) {
    const relations=this.machines.map(m => {
      const move=Array.from({length:m.size},() => 0n);
      m.edges.forEach((/** @type {any} */ e) => { if(e.predicate!==null&&(e.predicate===-1||(bits&(1n<<BigInt(e.predicate)))))move[e.from]|=1n<<BigInt(e.to); });
      return this.compose(this.compose(m.epsilon,move),m.epsilon);
    });
    // A node state retains its own bits even when empty. Its sequence
    // contribution is empty in that case, so captures retain root names.
    const zero=this.states[this.empty];
    return this.intern({bits,empty,count:empty?0:1,first:empty?0n:bits,last:empty?0n:bits,any:empty?0n:bits,relations:empty?zero.relations:relations});
  }
  /** @param {string|null} name @param {number} children @param {any} [leaf] @returns {number} */
  node(name,children,leaf=null) {
    const key=`n${name}/${children}/${leaf?JSON.stringify([leaf.terminal,leaf.value,[...leaf.tags].sort()]):''}`;
    const old=this.transitions.get(key);if(old!==undefined)return old;
    const s=this.states[children];let bits=0n;
    this.predicates.forEach((p,i) => {
      const bit=1n<<BigInt(i);let holds=false;
      if (p.name) holds=name===p.name;
      else if(p.terminal) holds=leaf?.terminal===p.terminal;
      else if(p.test) holds=leafMatches(p,leaf);
      else if(p.any || p.children) holds=p.any ? name!==null || leaf!==null : true;
      else if(p.path) {
        holds=!!(bits&(1n<<BigInt(p.child)));
        const child=p.path==='descendant'?s.any:p.path==='first'?s.first:s.last;
        holds=holds||!!(child&bit);
      } else if(p.union) holds=p.operands.some((/** @type {number} */ j) => !!(bits&(1n<<BigInt(j))));
      else if(p.intersection) holds=p.operands.every((/** @type {number} */ j) => !!(bits&(1n<<BigInt(j))));
      else if(p.difference) holds=!!(bits&(1n<<BigInt(p.operands[0])))&&! (bits&(1n<<BigInt(p.operands[1])));
      if (p.children) {
        const m=this.machines[p.machine];
        holds=holds&&!!(s.relations[p.machine][m.start]&(1n<<BigInt(m.end)));
      }
      if ((p.name||p.terminal||p.test||p.any||p.children)&&!p.exact&&s.count===1) holds=holds||!!(s.first&bit);
      if(holds)bits|=bit;
    });
    const id=this.nodeState(bits,!leaf&&s.count===0);
    if (hooks.work) countWork(hooks.work, "structuralTransitions");
    this.transitions.set(key,id);return id;
  }
  /** @param {number} state @param {any} pattern @returns {boolean} */
  matches(state,pattern) {
    const id=this.ids.get(JSON.stringify(patternKey(pattern)));
    if(id===undefined)throw new Error('undemanded structural pattern');
    return !!((this.states[state].bits ?? 0n)&(1n<<BigInt(id)));
  }
}

/** @param {any} pattern @returns {string} */
export function patternText(pattern) {
  /** @type {(n:any) => string} */
  const value = (n) => n.name ?? n.terminal ?? (n.param ? "@"+n.param : n.requirements ? "<"+n.requirements.map((/** @type {any} */ r)=>(r.negated?"¬":"")+value(r.value)).join(" ")+">" : n.string !== undefined ? JSON.stringify(n.string) : n.const ? `$${n.const}`
    : n.tag ? n.tag : n.emptySet ? "∅" : n.set ? [...n.set].join(" ∪ ") || "∅"
    : n.union ? n.union.map(value).join(" ∪ ") : n.intersection ? n.intersection.map(value).join(" ∩ ")
    : `(${value(n.difference[0])} ∖ ${value(n.difference[1])})`);
  return layeredPatternText(pattern,value);
}
