import { PROPERTY_NAMES } from "./unicode.js";
// Finite observations of structural trees (engine §4.1). A helper carries
// a sequence monoid: its relations concatenate without retaining trees.
import { countWork, hooks } from "./testing.js";
import { stringName } from "./tags.js";

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
  if (!node || typeof node !== 'object') return [];
  if (node.union || node.intersection || node.difference) return node.union ?? node.intersection ?? node.difference;
  if (node.sequence) return node.sequence;
  if (node.test) return [node.expr];
  return ['pattern','children','node','optional','repeat','separator'].flatMap(key => key in node ? [node[key]] : []);
}

/** @param {any} value @returns {boolean} */
function canConsume(value) {
  const stack = [value];
  while (stack.length) {
    const n = stack.pop();
    if ('node' in n || 'siblings' in n) return true;
    if (n.sequence) for (const child of n.sequence) stack.push(child);
    else stack.push(n.optional ?? n.repeat);
  }
  return false;
}

/**
 * Shape only. Term and test typing remains in dom.js. The caller bounds
 * nesting before calling this walk.
 * @param {any} root @param {(test: any) => string | null} testFault
 * @returns {string | null}
 */
export function patternProblem(root, testFault) {
  const stack = [{value:root, children:false, repeated:false, depth:0}];
  while (stack.length) {
    const {value:n, children, repeated, depth} = /** @type {any} */ (stack.pop());
    if (depth > 256) return 'nested too deeply';
    if (!n || typeof n !== 'object' || Array.isArray(n)) return 'a malformed pattern';
    const keys = Object.keys(n);
    const exact = (/** @type {string[]} */ fields) => keys.length === fields.length && fields.every(k => k in n);
    const push = (/** @type {any} */ value, /** @type {boolean} */ c = false, r = repeated) => stack.push({value,children:c,repeated:r,depth:depth+1});
    if (children) {
      if (exact(['node'])) push(n.node);
      else if (exact(['siblings'])) { if (n.siblings !== true || repeated) return 'a sibling ellipsis cannot be a repeat item or separator'; }
      else if (exact(['sequence'])) {
        if (!Array.isArray(n.sequence) || n.sequence.length < 2) return 'a malformed pattern sequence';
        n.sequence.forEach((/** @type {any} */ x) => push(x,true));
      } else if (exact(['optional'])) push(n.optional,true);
      else if (exact(['repeat']) || exact(['repeat','separator'])) {
        push(n.repeat,true,true);
        if ('separator' in n) push(n.separator,true,true);
        // Inspect after validating shapes, below.
      } else return 'a malformed pattern children expression';
    } else if (exact(['name','at']) || exact(['terminal','at']) || exact(['constant','at'])) {
      const key = 'name' in n ? 'name' : 'terminal' in n ? 'terminal' : 'constant';
      if (typeof n[key] !== 'string' || !Array.isArray(n.at) || n.at.length !== 2 || !n.at.every((/** @type {number} */ part) => Number.isInteger(part) && part >= 1)) return 'a malformed pattern atom';
      if (key === 'name' && !/^(?:[a-z][A-Za-z0-9_-]*|[^\x00-\x7f])$/u.test(n.name)) return 'a malformed pattern rule name';
      if (key === "constant" && !/^[A-Z][A-Za-z0-9_-]*$/.test(n.constant)) return "a malformed pattern constant";
      if (key === "terminal" && !(/^[A-Z][A-Za-z0-9_-]*$/.test(n.terminal) || n.terminal.startsWith("_") && PROPERTY_NAMES.has(n.terminal.slice(1)))) return "a malformed pattern terminal";
    } else if (exact(['literal', 'at']) || exact(['range', 'at']) || exact(['wildcard', 'at'])) {
      if (!Array.isArray(n.at) || n.at.length !== 2 || !n.at.every((/** @type {number} */ part) => Number.isInteger(part) && part >= 1)) return 'a malformed pattern position';
      if ('wildcard' in n && n.wildcard !== true) return 'a malformed pattern wildcard';
      if ('literal' in n && (!n.literal || !['string', 'const'].some(key => key in n.literal))) return 'a malformed pattern literal';
      if ('range' in n && (!Array.isArray(n.range) || n.range.length !== 2)) return 'a malformed pattern range';
    } else if (exact(['test','value','expr']) || exact(['test','requirements','expr'])) {
      const base = (/** @type {any} */ value) => value && ['terminal', 'literal', 'range', 'wildcard', 'constant'].some(key => key in value);
      if (n.test === 'tags') {
        if (!base(n.expr) || !Array.isArray(n.requirements)) return 'a pattern tag test requires a terminal atom';
        for (const requirement of n.requirements) {
          if (!requirement || Object.keys(requirement).length !== 2 || typeof requirement.negated !== 'boolean' || !requirement.value || !('tag' in requirement.value || 'const' in requirement.value)) return 'a malformed pattern requirement';
        }
      } else if (!['=', '≠'].includes(n.test) || !(base(n.expr) || n.expr?.test === 'tags' && base(n.expr.expr))) return 'a pattern value test requires a terminal atom';
      const fault = testFault(n);
      if (fault) return fault;
      push(n.expr);
    } else if (exact(['children'])) push(n.children,true);
    else if (exact(['path','pattern'])) {
      if (!['descendant','first','last'].includes(n.path)) return 'a malformed pattern path';
      push(n.pattern);
    } else {
      const key = ['union','intersection','difference'].find(k => exact([k]));
      if (!key || !Array.isArray(n[key]) || n[key].length < 2 || (key === 'difference' && n[key].length !== 2)) return 'a malformed pattern';
      n[key].forEach((/** @type {any} */ x) => push(x));
    }
  }
  const todo = [root];
  while (todo.length) {
    const n = todo.pop();
    if (n.repeat && !canConsume(n.repeat)) return 'a pattern repeat cannot match only empty sequences';
    for (const child of patternParts(n)) todo.push(child);
  }
  return null;
}

/**
 * @param {any} root
 * @param {(name:string, at:[number,number]) => any} constant
 * @param {(term:any, test:any) => any} value
 * @param {{isMark(code:number):boolean, changesInDocument?(code:number):boolean}} unicode
 * @returns {any}
 */
export function resolvePattern(root, constant, value, unicode) {
  if (root.constant) {
    const resolved = constant(root.constant,root.at);
    return "string" in resolved ? {terminal:stringName(resolved.string,unicode),at:root.at} : resolved.pattern;
  }
  if (root.literal) return {terminal:stringName(value(root.literal,root).string,unicode),at:root.at};
  if (root.range) return {terminal:root.range.map((/** @type {any} */ end) => stringName(value(end,root).string,unicode)).join(".."),at:root.at};
  if (root.wildcard) return {terminal:"_",at:root.at};
  if (root.test) {
    const expr = resolvePattern(root.expr,constant,value,unicode);
    if (root.test === "tags") return {...root,expr,requirements:root.requirements.map((/** @type {any} */ requirement) => ({...requirement,value:value(requirement.value,root)}))};
    return {...root,expr,value:value(root.value,root)};
  }
  const result = {...root};
  for (const key of ["union","intersection","difference","sequence"]) if (root[key]) result[key] = root[key].map((/** @type {any} */ n) => resolvePattern(n,constant,value,unicode));
  for (const key of ["pattern","children","node","optional","repeat","separator"]) if (root[key]) result[key] = resolvePattern(root[key],constant,value,unicode);
  return result;
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
      if (n.node) edge(from,to,this.compile(n.node));
      else if (n.siblings) { edge(from,to); edge(from,from,-1); }
      else if (n.sequence) {
        let a=from;
        n.sequence.forEach((/** @type {any} */ x,/** @type {number} */ i) => { const b=i===n.sequence.length-1?to:state(); build(x,a,b);a=b; });
      } else if (n.optional) { edge(from,to); build(n.optional,from,to); }
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
      else if(p.children) { const m=this.machines[p.machine];holds=!!(s.relations[p.machine][m.start]&(1n<<BigInt(m.end))); }
      else if(p.path) {
        holds=!!(bits&(1n<<BigInt(p.child)));
        const child=p.path==='descendant'?s.any:p.path==='first'?s.first:s.last;
        holds=holds||!!(child&bit);
      } else if(p.union) holds=p.operands.some((/** @type {number} */ j) => !!(bits&(1n<<BigInt(j))));
      else if(p.intersection) holds=p.operands.every((/** @type {number} */ j) => !!(bits&(1n<<BigInt(j))));
      else if(p.difference) holds=!!(bits&(1n<<BigInt(p.operands[0])))&&! (bits&(1n<<BigInt(p.operands[1])));
      if ((p.name||p.terminal||p.test||p.children)&&s.count===1) holds=holds||!!(s.first&bit);
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
  const value = (n) => n.string !== undefined ? JSON.stringify(n.string) : n.const ? `$${n.const}`
    : n.tag ? n.tag : n.emptySet ? "∅" : n.set ? [...n.set].join(" ∪ ") || "∅"
    : n.union ? n.union.map(value).join(" ∪ ") : n.intersection ? n.intersection.map(value).join(" ∩ ")
    : `(${value(n.difference[0])} ∖ ${value(n.difference[1])})`;
  /** @type {(n:any) => string} */
  const node = (n) => n.name ?? n.terminal ?? (n.constant ? `$${n.constant}` :
    n.test ? `${node(n.expr)}${n.test}(${value(n.value)})` :
    n.children ? `@(${children(n.children)})` :
    n.path ? n.path === "first" ? `(${node(n.pattern)}) ⋰` : `${n.path === "descendant" ? "⋮" : "⋱"} (${node(n.pattern)})` :
    `(${(n.union ?? n.intersection ?? n.difference).map(node).join(n.union ? " ∪ " : n.intersection ? " ∩ " : " ∖ ")})`);
  /** @type {(n:any) => string} */
  const children = (n) => n.node ? node(n.node) : n.siblings ? "⋯" : n.sequence ? n.sequence.map(children).join(" ")
    : n.optional ? `[${children(n.optional)}]` : `{${children(n.repeat)}${n.separator ? ` \\ ${children(n.separator)}` : ""}}`;
  return pattern.children ? `@(${children(pattern.children)})` : `@(${node(pattern)})`;
}
