// Exact structural observations for compared occurrences (engine §4.1).
import {clauseChildren} from './clause-walk.js';

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

/** @type {WeakMap<object,{whole:boolean,parts:Set<number>,names:Set<string>}>} */
const local=new WeakMap();
/** @param {any} production */
export function localTreeDemand(production) {
  const base=production.baseProduction ?? production;
  const old=local.get(base);if(old)return old;
  const result={whole:false,parts:new Set(),names:new Set()};
  for(const condition of constituentComparisons([base.conditions,base.tags,base.parentTags,base.rankedConditions])) {
    for(const name of [condition.left.capture,condition.right.capture]) {
      result.names.add(name);
      if(name==='')result.whole=true;
      else {
        const capture=base.captures.find((/** @type {any} */ c)=>c.name===name);
        if(capture)result.parts.add(capture.index);
      }
    }
  }
  local.set(base,result);return result;
}

/** @param {any} lowered */
export function prepareTreeDemands(lowered) {
  const outer=new Map();
  for(const production of lowered.productions) if(production.helper) {
    const names=outer.get(production.lhs) ?? new Set();
    for(const name of localTreeDemand(production).names)if(name!=="" && !production.captureSlot.has(name))names.add(name);
    outer.set(production.lhs,names);
  }
  const whole=new Set(lowered.productions.filter((/** @type {any} */ production)=>production.helper && localTreeDemand(production).whole).map((/** @type {any} */ production)=>production.lhs));
  let changed=true;
  while(changed) {
    changed=false;
    for(const production of lowered.productions)if(production.helper)for(const symbol of production.rhs) {
      if(whole.has(symbol.name) && !whole.has(production.lhs)) {whole.add(production.lhs);changed=true;}
      for(const name of outer.get(symbol.name)??[])if(!production.captureSlot.has(name) && !outer.get(production.lhs).has(name)) {outer.get(production.lhs).add(name);changed=true;}
    }
  }
  for(const production of lowered.productions) {
    const demand=localTreeDemand(production);
    production.rhs.forEach((/** @type {any} */ symbol,/** @type {number} */ index)=> {
      if(whole.has(symbol.name))demand.whole=true;
      for(const name of outer.get(symbol.name)??[])for(const capture of production.captures)if(capture.name===name && capture.index<index)demand.parts.add(capture.index);
    });
  }
}

export class TreeIdentities {
  constructor() {
    /** @type {Map<string,number>} */ this.ids=new Map();
    /** @type {{empty:boolean}[]} */ this.nodes=[];
    /** @type {[number,number][]} */ this.sequences=[[0,-1]];
    /** @type {Map<string,number>} */ this.sequenceIds=new Map();
    /** @type {Map<string,number>} */ this.concatenations=new Map();
    this.emptyProjection=this.intern(['EmptyProjection'],true);
  }
  /** @param {any[]} key @param {boolean} [empty] */
  intern(key,empty=false) {
    const text=JSON.stringify(key), old=this.ids.get(text);if(old!==undefined)return old;
    const id=this.nodes.length;this.ids.set(text,id);this.nodes.push({empty});return id;
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
  if(!context.trees || !production.observesTrees)return null;
  const m=context.trees;
  let prefix=previous?.treePrefix ?? 0;
  if(previous) {
    const symbol=production.rhs[dot-1];
    if(symbol.slot)prefix=m.append(prefix,sealIdentity(context,child.origin,child.end));
    else if(child)prefix=m.concat(prefix,child.treeSequence);
    else prefix=m.append(prefix,terminalIdentity(context,symbol.name,end-1));
  }
  let identity=-1,sequence=prefix;
  if(dot===production.rhs.length) {
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
  const visited=new Set();
  for(const production of lowered.productions) {
    for(const comparison of constituentComparisons([production.tags,production.parentTags,production.conditions,production.rankedConditions])) {
      const key=comparison;
      if(visited.has(key))continue;visited.add(key);
      const roots=[];
      for(const name of [comparison.left.capture,comparison.right.capture]) {
        if(name==='')roots.push(production.owner);
        else for(const p of lowered.productions)if((p.logicalSource??p.source)===(production.logicalSource??production.source)) {
          for(const capture of p.captures)if(capture.name===name && !p.rhs[capture.index].terminal)roots.push(p.rhs[capture.index].name);
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
