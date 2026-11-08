// Ranking forgets named-close bookkeeping only after recognition (§6).
import {countWork,hooks} from './testing.js';
/** @typedef {import('./types.js').Item} Item */
/** @typedef {import('./types.js').Edge} Edge */
/** @param {import('./earley.js').Chart} chart */
export function restorationForest(chart) {
  const closes=chart.context.closes;
  if(!closes || !chart.context.lowered.productions.some(p=>p.erased))return null;
  const identity=(/** @type {any} */ observation)=>observation ? closes.identity(observation) : null;
  /** @type {Map<Item,Item>} */ const plain=new Map();
  /** @type {Map<Item,number[]>} */ const indices=new Map();
  /** @type {Map<Item,number>} */ const numbers=new Map();
  /** @type {WeakMap<object,number>} */ const captures=new WeakMap();
  /** @type {Map<string,number>} */ const captureIds=new Map();
  /** @param {any} part */
  const capture=(part)=> {
    const pending=[];
    for(let at=part;at&&!captures.has(at);at=at.parent)pending.push(at);
    for(const at of pending.reverse()) {
      if(hooks.work)countWork(hooks.work,'groups');
      const key=JSON.stringify([at.parent?captures.get(at.parent):null,at.index,at.start,at.end,at.tags,at.structure,identity(at.observation),at.treeIdentity]);
      if(!captureIds.has(key))captureIds.set(key,captureIds.size);
      captures.set(at,/** @type {number} */(captureIds.get(key)));
    }
    return part?captures.get(part):null;
  };
  const sets=chart.sets.map(set=>set?{...set,items:/** @type {Item[]} */([])}:set);
  /** @type {Map<string,Item>} */ const byKey=new Map();
  /** @type {Map<Item,Edge[]>} */ const edges=new Map();
  for(const set of chart.sets)if(set)for(const raw of set.items) {
    if(hooks.work)countWork(hooks.work,'groups');
    const p=raw.production;
    const key=JSON.stringify([p.id,raw.dot,raw.origin,raw.end,raw.tagId,capture(raw.slots),raw.prefix,raw.structure,
      identity(raw.observationPrefix),identity(raw.observation),raw.familySummary?.id,
      /** @type {any} */(raw).treePrefix,/** @type {any} */(raw).treeIdentity,/** @type {any} */(raw).treeSequence,
      p.closeRequested,p.treeRequested,p.lexicalFrame?.restorationKey(),raw.boundary?.id,raw.strict,raw.restores]);
    let item=byKey.get(key);
    if(!item) {
      item=/** @type {Item} */(Object.setPrototypeOf({...raw},Object.getPrototypeOf(raw)));
      Object.defineProperty(item,'edges',{value:[],writable:true});
      /** @type {any} */(item).restorationFrame=p.lexicalFrame?.restorationKey();
      byKey.set(key,item);numbers.set(item,numbers.size);edges.set(item,[]);sets[raw.end].items.push(item);
    }
    plain.set(raw,item);
  }
  /** @type {Map<Item,Map<string,number>>} */ const edgeIds=new Map();
  for(const set of chart.sets)if(set)for(const raw of set.items) {
    const item=/** @type {Item} */(plain.get(raw)),list=/** @type {Edge[]} */(edges.get(item));
    let found=edgeIds.get(item);if(!found)edgeIds.set(item,found=new Map());
    const positions=[];
    for(const edge of raw.edges) {
      if(hooks.work)countWork(hooks.work,'groups');
      const previous='previous'in edge?/** @type {Item} */(plain.get(edge.previous)):null;
      const child=edge.kind==='complete'?/** @type {Item} */(plain.get(edge.child)):null;
      const key=JSON.stringify([edge.kind,previous?numbers.get(previous):null,child?numbers.get(child):null,
        'token'in edge?edge.token:null,'terminal'in edge?edge.terminal:null]);
      let index=found.get(key);
      if(index===undefined) {
        index=list.length;found.set(key,index);
        list.push(edge.kind==='complete'?{...edge,previous:/** @type {Item} */(previous),child:/** @type {Item} */(child)}:edge.kind==='scan'?{...edge,previous:/** @type {Item} */(previous)}:edge);
      }
      positions.push(index);
    }
    indices.set(raw,positions);
  }
  for(const [item,list]of edges)Object.defineProperty(item,'edges',{value:list});
  return {chart:{...chart,sets},plain,indices,
    /** @param {Map<Item,Set<number>>} marks */
    projectMarks(marks) {
      /** @type {Map<Item,Set<number>>} */ const result=new Map();
      for(const [raw,marked]of marks) {
        const item=plain.get(raw);if(!item)continue;
        let out=result.get(item);if(!out)result.set(item,out=new Set());
        for(const index of marked)out.add(/** @type {number[]} */(indices.get(raw))[index]);
      }
      return result;
    }};
}
