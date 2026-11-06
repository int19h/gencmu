import {lineIndex,positionAt} from "./source-lines.js";
/** @type {WeakMap<string[],import("./source-lines.js").LineIndex>} */
const sourceLines=new WeakMap();
// Default rejection evidence for a diagnostic that is itself a ranked option (§12.1).
import {ChartSet,expectedAt,skippedProductions} from './earley.js';
import {rankedFrameTable} from './ranked-frame.js';

/** @typedef {import('./earley.js').Item} Item */
/** @typedef {import('./types.js').Production} Production */
/** @typedef {{next:Item,child:Item|null}} Advance */

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
  const frames=rankedFrameTable(chart.context);
  /** @type {Map<number,Map<string,Item[]>>} */ const entries=new Map();
  /** @type {Map<Item,Advance[]>} */ const advances=new Map();
  /** @type {Map<Item,{previous:Item,next:Item}[]>} */ const completions=new Map();
  /** @type {Map<number,Map<Production,boolean>>} */ const skipped=new Map();
  /** @param {number} at @param {(production:Production)=>boolean} accept @param {string} [name] */
  const omissions=(at,accept,name)=>{
    let cache=skipped.get(at);if(!cache)skipped.set(at,cache=new Map());
    return skippedProductions(chart,at,{name,accept:production=>!production.error&&accept(production),cache});
  };
  /** @type {Map<number,ChartSet>} */ const sets=new Map();
  /** @type {Set<Item>} */ const reached=new Set();
  /** @type {Item[]} */ const queue=[];
  /** @param {number} at */
  const setAt=at=>{let set=sets.get(at);if(!set)sets.set(at,set=new ChartSet(at));return set;};
  /** @param {Production} production */
  const competitor=production=> {
    if(production.rankedGroup===group)return production.rankedOption!==option.rankedOption&&production.lexicalFrame===option.lexicalFrame;
    const source=production.logicalSource;
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
  /** @param {number} at @param {Production} production */
  const omit=(at,production)=>{const set=setAt(at);if(!set.skipped.includes(production))set.skipped.push(production);};
  for(const set of chart.sets) {
    if(set.position<start||set.position>cap)continue;
    const byName=new Map();entries.set(set.position,byName);
    for(const item of set.items) {
      if(item.production.error)continue;
      if(item.dot===0) {
        const list=byName.get(item.production.lhs)??[];list.push(item);byName.set(item.production.lhs,list);
        if(item.origin===start&&set.position===start&&competitor(item.production))add(item);
      }
      for(const edge of item.edges)if('previous'in edge) {
        const child=edge.kind==='complete'?edge.child:null;
        const list=advances.get(edge.previous)??[];list.push({next:item,child});advances.set(edge.previous,list);
        if(child){const uses=completions.get(child)??[];uses.push({previous:edge.previous,next:item});completions.set(child,uses);}
      }
    }
  }
  for(const production of omissions(start,competitor))omit(start,production);
  for(let index=0;index<queue.length;index++) {
    const item=queue[index],symbol=item.production.rhs[item.dot];
    if(symbol&&!symbol.terminal) {
      const frame=frames.entry(item,symbol.name);
      for(const entry of entries.get(item.end)?.get(symbol.name)??[])if((entry.production.lexicalFrame??null)===frame)add(entry);
      for(const production of omissions(item.end,p=>(p.lexicalFrame??null)===frame,symbol.name))omit(item.end,production);
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
