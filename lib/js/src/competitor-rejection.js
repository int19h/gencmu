import {countWork,hooks} from "./testing.js";
import {lineIndex,positionAt} from "./source-lines.js";
/** @type {WeakMap<string[],import("./source-lines.js").LineIndex>} */
const sourceLines=new WeakMap();
// Default rejection evidence for a diagnostic that is itself a ranked option (§12.1).
import {ChartSet,expectedAt,skippedProductions} from './earley.js';

/** @typedef {import('./earley.js').Item} Item */
/** @typedef {import('./types.js').Production} Production */
/** @typedef {{next:Item,child:Item|null}} Advance */

/** @template T @param {Map<string,Map<any,T[]>>} index @param {string} name @param {any} frame @param {T} candidate */
function indexCandidate(index,name,frame,candidate){
  if(hooks.work)countWork(hooks.work,"walkSteps");
  let frames=index.get(name);if(!frames)index.set(name,frames=new Map());
  let list=frames.get(frame);if(!list)frames.set(frame,list=[]);
  list.push(candidate);
}
/** @template T @param {Map<string,Map<any,T[]>>|undefined} index @param {string} name @param {any} frame @returns {T[]} */
function candidatesAt(index,name,frame){
  if(hooks.work)countWork(hooks.work,"walkSteps");
  return index?.get(name)?.get(frame)??[];
}

/** @param {import('./diagnostic-flow.js').DiagnosticFlow} flow @param {import('./earley.js').Chart} chart */
export function competitorRejections(flow,chart) {
  for(const event of flow.evaluated) {
    if(event.kind!=='errors'||'read'in event.node||event.node.production.spliceOf)continue;
    const parent=flow.info(event.node).parent;
    if(!parent||'read'in parent||!parent.production.rankedGroup||parent.children.length!==1||parent.children[0]!==event.node)continue;
    const result=competitorSlice(chart,event.node.start,event.node.end,parent.production);
    if(result)event.diagnostic.rejection=result;
  }
}

/** @param {import('./earley.js').Chart} chart @param {number} start @param {number} cap @param {Production} option
 * @returns {import('./types.js').CompetitorRejection|null} */
export function competitorSlice(chart,start,cap,option) {
  const group=/** @type {NonNullable<Production['rankedGroup']>} */(option.rankedGroup);
  const frames=chart.frames;
  /** @type {Map<number,Map<string,Map<any,Item[]>>>} */ const entries=new Map();
  /** @type {Map<Item,Advance[]>} */ const advances=new Map();
  /** @type {Map<Item,{previous:Item,next:Item}[]>} */ const completions=new Map();
  /** @type {Map<number,Map<Production,boolean>>} */ const skipped=new Map();
  /** @type {Map<number,Map<string,Map<any,(string|Production)[]>>>} */ const skippedCandidates=new Map();
  /** @param {number} at */
  const skippedAt=at=>{
    if(hooks.work)countWork(hooks.work,"walkSteps");
    let index=skippedCandidates.get(at);
    if(!index){
      skippedCandidates.set(at,index=new Map());
      for(const candidate of chart.setAt(at).skipped)indexCandidate(index,typeof candidate==='string'?candidate:candidate.lhs,typeof candidate==='string'?null:candidate.lexicalFrame??null,candidate);
    }
    return index;
  };
  /** @param {number} at @param {(production:Production)=>boolean} accept @param {Iterable<string|Production>} candidates */
  const omissions=(at,accept,candidates)=>{
    let cache=skipped.get(at);if(!cache)skipped.set(at,cache=new Map());
    return skippedProductions(chart,at,{candidates,accept:production=>!production.error&&accept(production),cache});
  };
  /** @type {Map<number,Map<string,Set<any>>>} */ const predictions=new Map();
  /** @param {number} at @param {string} name @param {any} frame */
  const firstPrediction=(at,name,frame)=>{
    if(hooks.work)countWork(hooks.work,"walkSteps");
    let names=predictions.get(at);if(!names)predictions.set(at,names=new Map());
    let seen=names.get(name);if(!seen)names.set(name,seen=new Set());
    if(seen.has(frame))return false;
    seen.add(frame);return true;
  };
  /** @type {Map<number,ChartSet>} */ const sets=new Map();
  /** @type {Set<Item>} */ const reached=new Set();
  /** @type {Item[]} */ const queue=[];
  /** @param {number} at */
  const setAt=at=>{let set=sets.get(at);if(!set)sets.set(at,set=new ChartSet(at));return set;};
  /** @param {Production} production */
  const competitor=production=> {
    if(production.rankedGroup===group)return production.rankedOption!==option.rankedOption&&production.lexicalFrame===option.lexicalFrame;
    const source=production.elementSource;
    return !production.helper&&production.lhs===group.parent&&source!==group.source&&source?.clauses===group.source.clauses;
  };
  /** @param {Item} item */
  const add=item=>{
    if(item.production.error||reached.has(item))return;
    reached.add(item);queue.push(item);
    // A ranked helper around one call is the entry of that called option,
    // not an independent non-error attempt when the call carries %error.
    const transparent=item.dot===0&&item.production.rankedGroup&&item.production.rhs.length===1&&!item.production.rhs[0].terminal;
    if(!transparent)setAt(item.end).items.push(item);
  };
  /** @type {Map<number,Set<Production>>} */ const omitted=new Map();
  /** @param {number} at @param {Production} production */
  const omit=(at,production)=>{
    if(hooks.work)countWork(hooks.work,"walkSteps");
    let seen=omitted.get(at);if(!seen)omitted.set(at,seen=new Set());
    if(!seen.has(production)){seen.add(production);setAt(at).skipped.push(production);}
  };
  for(const set of chart.sets) {
    if(set.position<start||set.position>cap)continue;
    const byName=new Map();entries.set(set.position,byName);
    for(const item of set.items) {
      if(item.production.error)continue;
      if(item.dot===0) {
        indexCandidate(byName,item.production.lhs,item.production.lexicalFrame??null,item);
        if(item.origin===start&&set.position===start&&competitor(item.production))add(item);
      }
      for(const edge of item.edges)if('previous'in edge) {
        const child=edge.kind==='complete'?edge.child:null;
        const list=advances.get(edge.previous)??[];list.push({next:item,child});advances.set(edge.previous,list);
        if(child){const uses=completions.get(child)??[];uses.push({previous:edge.previous,next:item});completions.set(child,uses);}
      }
    }
  }
  for(const production of omissions(start,competitor,chart.setAt(start).skipped))omit(start,production);
  for(let index=0;index<queue.length;index++) {
    const item=queue[index],symbol=item.production.rhs[item.dot];
    if(symbol&&!symbol.terminal) {
      const frame=frames?.entry(item,symbol.name)??null;
      if(firstPrediction(item.end,symbol.name,frame)){
        for(const entry of candidatesAt(entries.get(item.end),symbol.name,frame)){
          if(hooks.work)countWork(hooks.work,"walkSteps");
          add(entry);
        }
        const candidates=candidatesAt(skippedAt(item.end),symbol.name,frame);
        for(const production of omissions(item.end,p=>(p.lexicalFrame??null)===frame,candidates))omit(item.end,production);
      }
    }
    for(const advance of advances.get(item)??[])if(!advance.child||reached.has(advance.child))add(advance.next);
    for(const completion of completions.get(item)??[])if(reached.has(completion.previous))add(completion.next);
  }
  if(!sets.size)return null;
  let position=start;for(const at of sets.keys())position=Math.max(position,at);
  const slice={...chart,furthest:position,setAt};
  const tokens=chart.context.tokens,end=tokens[tokens.length-1]?.source[1]??0;
  const source=position<tokens.length?tokens[position].source:[end,end];
  let lines=sourceLines.get(chart.context.sourceText);
  if(!lines)sourceLines.set(chart.context.sourceText,lines=lineIndex(chart.context.sourceText));
  const {line,column}=positionAt(lines,source[0]);
  return {token:position,source:[source[0],source[1]],line,column,expected:expectedAt(slice,position,/** @type {Production[]} */(setAt(position).skipped))};
}
