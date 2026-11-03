// Exact structural observations for compared occurrences (engine §4.1).
import {clauseChildren} from './clause-walk.js';
import {boundaryLocations} from './boundary.js';
import {rankedFrameTable} from './ranked-frame.js';

/** @param {any} root @returns {any[]} */
export function constituentComparisons(root) {
  const result=[], pending=[root], seen=new Set();
  while(pending.length) {
    const node=pending.pop();
    if(!node || typeof node!=='object' || seen.has(node)) continue;
    seen.add(node);
    if((node.op==='≅' || node.op==='≇') && typeof node.right?.capture==='string') result.push(node);
    else pending.push(...clauseChildren(node).slice().reverse());
  }
  return result;
}

/**
 * @typedef {object} TreeDemand
 * @property {boolean} whole
 * @property {Set<number>} parts
 * @property {Set<string>} names
 * @property {Set<string>} outer
 * @property {boolean} parentPrefix
 * @property {number} prefixUntil
 */
/** @type {WeakMap<object,Map<string,TreeDemand>>} */
const local=new WeakMap();
/** @type {WeakMap<object,string>} */
const frameKeys=new WeakMap();
/** @param {any} frame */
function frameKey(frame) {
  if(!frame)return '';
  let key=frameKeys.get(frame);
  if(key===undefined) {key=JSON.stringify([[...frame.present].sort(),[...frame.captures.keys()].sort(),[...frame.knownPrivate].sort(),!!frame.inside]);frameKeys.set(frame,key);}
  return key;
}
/** @param {any} production @returns {TreeDemand} */
export function localTreeDemand(production) {
  const found=local.get(production.baseProduction ?? production)?.get(frameKey(production.lexicalFrame));
  if(!found)throw new Error('a production has no tree demand case');
  return found;
}

/** @param {any} lowered */
export function prepareTreeDemands(lowered) {
  const frames=rankedFrameTable({lowered}), byKey=new Map();
  /** @type {any[]} */
  const states=[];
  let nextFrame=0;
  const contextual=new Set(lowered.productions.filter((/** @type {any} */ p)=>p.contextual).map((/** @type {any} */ p)=>p.lhs));
  const state=(/** @type {any} */ p,/** @type {any} */ frame)=> {
    const key=p.id+'/'+frameKey(frame);
    if(byKey.has(key))return byKey.get(key);
    const bound=frame ? frames.production(p,frame) : p;
    const result={whole:false,parts:new Set(),names:new Set(),outer:new Set(),parentPrefix:false,prefixUntil:0};
    for(const comparison of constituentComparisons([bound.conditions,bound.tags,bound.parentTags]))for(const name of [comparison.left.capture,comparison.right.capture]) {
      result.names.add(name);
      if(name==='') {result.whole=true;result.parentPrefix=!!p.helper;}
      else {
        const capture=p.captures.find((/** @type {any} */ c)=>c.name===name);
        if(capture)result.parts.add(capture.index);else result.outer.add(name);
      }
    }
    const entry={p,frame,demand:result,edges:[]};
    const demands=local.get(p)??new Map();demands.set(frameKey(frame),result);local.set(p,demands);
    states.push(entry);byKey.set(key,entry);return entry;
  };
  for(const p of lowered.productions)if(!p.contextual)state(p,null);
  for(let at=0;at<states.length;at++) {
    const entry=states[at],{p,frame}=entry;
    const present=new Set([...frame?.present??[],...p.captures.map((/** @type {any} */ c)=>c.name)]);
    const knownPrivate=new Set([...frame?.knownPrivate??[],...p.rankedPrivate??[]]);
    const inside=!!frame?.inside||!!p.rankedGroup;
    p.rhs.forEach((/** @type {any} */ symbol,/** @type {number} */ index)=> {
      if(symbol.terminal||!contextual.has(symbol.name))return;
      const captures=new Map(frame?.captures??[]);
      for(const capture of p.captures)if(capture.index<index)captures.set(capture.name,null);
      const child={id:nextFrame++,present,knownPrivate,captures,inside};
      for(const q of lowered.byLhs.get(symbol.name)??[])entry.edges.push({index,child:state(q,child)});
    });
  }
  let changed=true;
  while(changed) {
    changed=false;
    for(const entry of states)for(const edge of entry.edges) {
      const d=entry.demand, child=edge.child.demand;
      if(child.parentPrefix) {
        if(entry.p.helper&&!d.parentPrefix) {d.parentPrefix=true;changed=true;}
        if(!entry.frame?.inside&&!entry.p.rankedGroup&&edge.index>d.prefixUntil) {d.prefixUntil=edge.index;changed=true;}
      }
      for(const name of child.outer) {
        const capture=entry.p.captures.find((/** @type {any} */ c)=>c.name===name&&c.index<edge.index);
        if(capture) {if(!d.parts.has(capture.index)) {d.parts.add(capture.index);changed=true;}}
        else if(entry.frame?.captures.has(name)&&!d.outer.has(name)) {d.outer.add(name);changed=true;}
      }
    }
  }
}

export class TreeIdentities {
  constructor() {
    /** @type {Map<string,number>} */ this.ids=new Map();
    /** @type {{key:any[],empty:boolean}[]} */ this.nodes=[];
    /** @type {Map<number,string>} */ this.semanticNodes=new Map();
    /** @type {Map<number,string>} */ this.semanticSequences=new Map();
    /** @type {[number,number][]} */ this.sequences=[[0,-1]];
    /** @type {Map<string,number>} */ this.sequenceIds=new Map();
    /** @type {Map<string,number>} */ this.concatenations=new Map();
    this.emptyProjection=this.intern(['EmptyProjection'],true);
  }
  /** @param {any[]} key @param {boolean} [empty] */
  intern(key,empty=false) {
    const text=JSON.stringify(key), old=this.ids.get(text);if(old!==undefined)return old;
    const id=this.nodes.length;this.ids.set(text,id);this.nodes.push({key,empty});return id;
  }
  /** @param {number} prefix @param {number} node */
  append(prefix,node) {
    if(this.nodes[node].empty)return prefix;
    const key=`${prefix}/${node}`,old=this.sequenceIds.get(key);if(old!==undefined)return old;
    const id=this.sequences.length;this.sequences.push([prefix,node]);this.sequenceIds.set(key,id);return id;
  }
  /** @param {number} left @param {number} right */
  concat(left,right) {
    if(!left)return right;if(!right)return left;
    const key=`${left}/${right}`,old=this.concatenations.get(key);if(old!==undefined)return old;
    const pending=[];for(let at=right;at;at=this.sequences[at][0])pending.push(this.sequences[at][1]);
    let result=left;while(pending.length)result=this.append(result,/** @type {number} */(pending.pop()));
    this.concatenations.set(key,result);return result;
  }
  /** @param {number} sequence @returns {number[]} */
  elements(sequence) {
    const nodes=[];
    for(let at=sequence;at;at=this.sequences[at][0])nodes.push(this.sequences[at][1]);
    return nodes.reverse();
  }
  /** @param {number|undefined} identity @returns {string|null} */
  semantic(identity) {
    if(identity === undefined || identity < 0)return null;
    const pending=[identity];
    while(pending.length) {
      const node=pending[pending.length-1];
      if(this.semanticNodes.has(node)) {pending.pop();continue;}
      const key=this.nodes[node].key;
      if(key[0] !== 'Rule') {this.semanticNodes.set(node,JSON.stringify(key));continue;}
      const children=this.elements(key[2]);
      const missing=children.find(child=>!this.semanticNodes.has(child));
      if(missing!==undefined) {pending.push(missing);continue;}
      this.semanticNodes.set(node,'["Rule",'+JSON.stringify(key[1])+',['+children.map(child=>this.semanticNodes.get(child)).join(',')+']]');
    }
    return /** @type {string} */ (this.semanticNodes.get(identity));
  }
  /** @param {number} sequence @returns {string} */
  sequenceSemantic(sequence) {
    let value=this.semanticSequences.get(sequence);
    if(value===undefined) {value='['+this.elements(sequence).map(node=>this.semantic(node)).join(',')+']';this.semanticSequences.set(sequence,value);}
    return value;
  }
  /** @param {string} name @param {number} children */
  rule(name,children) {return this.intern(['Rule',name,children],children===0);}
  /** @param {string} terminal @param {string} value */
  written(terminal,value) {return this.intern(['Written',terminal,value]);}
  /** @param {string} terminal */
  omitted(terminal) {return this.intern(['Omitted',terminal]);}
  /** @param {string[]} values */
  seal(values) {return this.intern(['Seal',values]);}
}

/** @param {any} context @param {string} terminal @param {number} at */
export function terminalIdentity(context,terminal,at) {
  if(context.recon && !context.recon.raw) {
    if(context.synthetic?.[at])return context.trees.emptyProjection;
    return context.trees.written(terminal,context.recon.observed.tokens[context.recon.project[at]].value);
  }
  return context.trees.written(terminal,context.tokens[at].value);
}

/** @param {any} context @param {number} start @param {number} end */
export function sealIdentity(context,start,end) {
  const key=`${start}/${end}`;
  const old=context.treeSeals.get(key);if(old!==undefined)return old;
  const observed=context.recon && !context.recon.raw ? context.recon.observed : context;
  if(observed!==context) { start=context.recon.project[start];end=context.recon.project[end]; }
  const values=[];for(let i=start;i<end;i++)values.push(observed.tokens[i].value);
  const result=context.trees.seal(values);context.treeSeals.set(key,result);return result;
}

/** @param {any} context @param {any} production @param {number} dot @param {any} previous @param {any} child @param {number} end */
export function treeStep(context,production,dot,previous,child,end) {
  if(!context.trees || !production.observesTrees || !production.walksTrees && dot>production.treePrefixUntil)return null;
  const m=context.trees;
  let prefix=previous?.treePrefix ?? 0;
  if(previous) {
    const symbol=production.rhs[dot-1];
    if(symbol.slot)prefix=m.append(prefix,sealIdentity(context,child.origin,child.end));
    else if(child)prefix=m.concat(prefix,child.treeSequence);
    else prefix=m.append(prefix,terminalIdentity(context,symbol.name,end-1));
  }
  let identity=-1,sequence=prefix;
  if(dot===production.rhs.length && production.walksTrees) {
    if(!production.helper) { identity=m.rule(production.lhs,prefix);sequence=m.append(0,identity); }
    else if(production.elided!==null && production.rhs.length===0) { identity=m.omitted(production.elided);sequence=m.append(0,identity); }
  }
  return {treePrefix:prefix,treeIdentity:identity,treeSequence:sequence};
}

/** @param {any} lowered @returns {{comparison:any,production:any,cycle:string[]}|null} */
export function treeIdentityCycle(lowered) {
  const rows=lowered.structural, byName=new Map(), nullable=new Set();
  for(const row of rows) {const list=byName.get(row.lhs) ?? [];list.push(row);byName.set(row.lhs,list);}
  let changed=true;
  while(changed) {
    changed=false;
    for(const row of rows)if(!nullable.has(row.lhs) && row.rhs.every((/** @type {any} */ s)=>!s.terminal && nullable.has(s.name))) {nullable.add(row.lhs);changed=true;}
  }
  const seals=new Set(lowered.grammar.ranked.groups.map((/** @type {any} */ g)=>g.helper));
  const edges=new Map();
  for(const [name,productions] of byName) {
    /** @type {any[]} */ const out=[];
    for(const production of productions) production.rhs.forEach((/** @type {any} */ symbol,/** @type {number} */ index)=> {
      if(!symbol.terminal && !seals.has(symbol.name))out.push({name:symbol.name,marked:production.rhs.every((/** @type {any} */ other,/** @type {number} */ i)=>i===index || !other.terminal && nullable.has(other.name))});
    });
    edges.set(name,out);
  }
  const sites=[...lowered.treeSites];
  for(const production of lowered.productions) {
    const bindings=new Map(production.captures.map((/** @type {any} */ c)=>[c.name,[production.rhs[c.index].terminal,production.rhs[c.index].name]]));
    for(const comparison of constituentComparisons([production.tags,production.parentTags,production.conditions]))sites.push({comparison,production,bindings,prefix:[]});
  }
  const order=new Map(), hints=new Map();
  let nextOrder=0;
  for(const rule of lowered.grammar.rules.values()) {
    const definitions=new Map();
    for(const source of rule.alternatives) {
      const alternatives=definitions.get(source.clauses)??[];alternatives.push(source);definitions.set(source.clauses,alternatives);
    }
    for(const [clauses,alternatives] of definitions)for(const root of [clauses.tags,...alternatives.map((/** @type {any} */ a)=>a.tags),clauses.conditions]) {
      for(const comparison of constituentComparisons(root)) {
        const number=nextOrder++;
        order.set(comparison,number);
        const key=JSON.stringify([alternatives[0].document,boundaryLocations.get(comparison)?.at,comparison]);
        if(!hints.has(key))hints.set(key,number);
      }
    }
  }
  const ordinal=(/** @type {any} */ site)=>order.get(site.comparison)??hints.get(JSON.stringify([(site.production.logicalSource??site.production.source)?.document,boundaryLocations.get(site.comparison)?.at,site.comparison]))??nextOrder;
  sites.sort((a,b)=>ordinal(a)-ordinal(b)||a.production.id-b.production.id);
  for(const {comparison,production,bindings,prefix} of sites) {
      const roots=[];
      for(const name of [comparison.left.capture,comparison.right.capture]) {
        if(name==='') {
          roots.push(...prefix);
          if(!production.helper)roots.push(...production.rhs.filter((/** @type {any} */ s)=>!s.terminal && !seals.has(s.name)).map((/** @type {any} */ s)=>s.name));
        } else {
          const binding=bindings.get(name);
          if(binding && !binding[0])roots.push(binding[1]);
        }
      }
      const reachable=[],known=new Set(),todo=roots.slice().reverse();
      while(todo.length) {const name=todo.pop();if(known.has(name))continue;known.add(name);reachable.push(name);for(const edge of (edges.get(name)??[]).slice().reverse())todo.push(edge.name);}
      const done=new Set(),active=new Map();
      /** @type {string[]} */ const path=[];
      for(const root of reachable) {
        if(done.has(root))continue;
        const stack=[{name:root,next:0}];
        while(stack.length) {
          const frame=stack[stack.length-1];
          if(!active.has(frame.name)) {active.set(frame.name,path.length);path.push(frame.name);}
          const out=edges.get(frame.name)??[];
          const edge=out[frame.next++];
          if(!edge) {path.pop();active.delete(frame.name);done.add(frame.name);stack.pop();continue;}
          if(!edge.marked || done.has(edge.name))continue;
          if(active.has(edge.name)) {
            const cycle=path.slice(active.get(edge.name)).concat(edge.name).filter(name=>!name.startsWith('\u0000'));
            return {comparison,production,cycle};
          }
          stack.push({name:edge.name,next:0});
        }
      }
  }
  return null;
}

/** @param {any} context @param {any} root @returns {number} */
export function derivationIdentity(context,root) {
  context.emissionTrees ??= new TreeIdentities();
  context.emissionTreeValues ??= new WeakMap();
  const m=context.emissionTrees, memo=context.emissionTreeValues,pending=[root];
  while(pending.length) {
    const node=pending[pending.length-1];
    if(memo.has(node)) {pending.pop();continue;}
    if(node.read) {const identity=m.written(node.read.terminal,context.tokens[node.start].value);memo.set(node,{identity,sequence:m.append(0,identity)});continue;}
    const child=node.children.find((/** @type {any} */ c,/** @type {number} */ i)=>!node.production.rhs[i]?.slot && !memo.has(c));
    if(child) {pending.push(child);continue;}
    let sequence=0;
    node.children.forEach((/** @type {any} */ c,/** @type {number} */ i)=> {
      if(node.production.rhs[i]?.slot) sequence=m.append(sequence,m.seal(context.tokens.slice(c.start,c.end).map((/** @type {any} */ token)=>token.value)));
      else sequence=m.concat(sequence,memo.get(c).sequence);
    });
    let identity=-1;
    if(!node.production.helper) {identity=m.rule(node.production.lhs,sequence);sequence=m.append(0,identity);}
    else if(!node.children.length && node.production.elided!==null) {identity=m.omitted(node.production.elided);sequence=m.append(0,identity);}
    memo.set(node,{identity,sequence});
  }
  return memo.get(root).identity;
}
