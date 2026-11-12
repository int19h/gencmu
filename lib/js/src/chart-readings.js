// Lowered, per-site qualification for answers from the main stage chart.
import {clauseChildren,expressionChildren} from './clause-walk.js';
import {bodyTarget} from './query-forms.js';

/** @type {WeakMap<object,{symbols:WeakMap<object,any>,rules:Map<string,any>}>} */
const sites=new WeakMap();

/** @param {any} expression @returns {boolean} */
function binds(expression) {
  const pending=[expression];
  while(pending.length) {
    const node=pending.pop();if(!node)continue;
    if(typeof node.capture==='string')return true;
    for(const child of expressionChildren(node))pending.push(child);
  }
  return false;
}

/** Compute properties over the active lowered grammar, including nested queries.
 * @param {any} lowered */
export function prepareChartReadings(lowered) {
  const usesLocal=lowered.checks.some((/** @type {any} */ check)=>{
    const pending=[check.conditions];while(pending.length){const node=pending.pop();if(node?.method==='local-readings')return true;for(const child of clauseChildren(node))pending.push(child);}return false;
  });
  if(!usesLocal){sites.set(lowered,{symbols:new WeakMap(),rules:new Map()});return;}
  const properties=new Map();
  for(const name of lowered.byLhs.keys())properties.set(name,{outside:false,entry:name==='text',boundary:false,parents:new Set()});
  for(const [name,productions]of lowered.byLhs) {
    const info=properties.get(name),calls=new Set();
    for(const production of productions) {
      for(const symbol of production.rhs)if(!symbol.terminal)calls.add(symbol.name);
      const pending=[production.conditions,production.tags,production.rankedConditions,production.rankedDeferred,production.parentTags,production.itemConditions];
      while(pending.length) {
        const node=pending.pop();if(!node||typeof node!=='object')continue;
        if(node.method==='preceding-tokens'||node.method==='starts-input')info.outside=true;
        if(node.method==='followed-by'||node.method==='preceded-by')info.boundary=true;
        if(node.method==='parse')calls.add(bodyTarget(lowered,node.args[0].body));
        for(const child of clauseChildren(node))pending.push(child);
      }
    }
    for(const child of calls)properties.get(child)?.parents.add(name);
  }
  const pending=[...properties.keys()],queued=new Set(pending);
  while(pending.length) {
    const name=pending.pop();queued.delete(name);const info=properties.get(name);
    for(const parent of info.parents) {
      const into=properties.get(parent);
      if((info.outside&&!into.outside)||(info.entry&&!into.entry)||(info.boundary&&!into.boundary)) {
        into.outside ||= info.outside;into.entry ||= info.entry;into.boundary ||= info.boundary;
        if(!queued.has(parent)){queued.add(parent);pending.push(parent);}
      }
    }
  }
  const rules=new Map();
  for(const [name,productions]of lowered.byLhs) {
    const info=properties.get(name);
    const helper=productions[0].helper&&!productions[0].spliceOf;
    const safe=!helper||productions.every((/** @type {any} */ p)=>{
      const expression=p.writtenExpression??lowered.elementExpressions.get(name);
      return expression!=null&&p.elided===null&&!binds(expression)
        &&p.captures.every((/** @type {any} */ c)=>c.name.startsWith('\u0000'))&&!p.conditions.length
        &&!p.rankedConditions?.length&&!p.rankedDeferred?.length&&!p.itemConditions?.length&&!p.parentTags;
    });
    rules.set(name,{symbol:{name,terminal:false},qualified:safe&&!info.outside,settlesEntry:info.entry&&info.boundary});
  }
  const symbols=new WeakMap();
  for(const production of lowered.productions)for(const symbol of production.rhs) {
    const base=symbol.terminal?{qualified:true,settlesEntry:false}:rules.get(symbol.name);
    symbols.set(symbol,{...base,symbol});
  }
  sites.set(lowered,{symbols,rules});
}

/** @param {any} lowered @param {any} symbol @returns {any} */
export function chartReadingSite(lowered,symbol) {
  if(!symbol)return null;
  const table=sites.get(lowered);
  return table?.symbols.get(symbol)??table?.rules.get(symbol.name)??null;
}
