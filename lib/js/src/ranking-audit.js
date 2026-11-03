// Static reports for node-pattern steps (docs/design.md).
import { patternParts } from './patterns.js';
import { knownTags, possibleNodeMatch } from './ranking-patterns.js';
import { stringName, compareCodePoints } from './tags.js';
import { canonicalArgument } from './templates.js';
import { hooks,countWork } from './testing.js';

/** @param {any} term @param {any} grammar @returns {Set<string>} */
function literals(term,grammar) {
  const result=new Set(),pending=[term],seen=new Set();
  while(pending.length) {
    const n=pending.pop();
    if(!n || typeof n!=='object' || seen.has(n)) continue;
    seen.add(n);
    if(n.const) pending.push(grammar.constants.get(n.const)?.value);
    if(n.tag) result.add(n.tag);
    if(n.set instanceof Set) for(const tag of n.set) result.add(tag);
    for(const value of Object.values(n)) if(value && typeof value==='object') pending.push(value);
  }
  return result;
}

/** @param {number} a @param {number} b @returns {number} */
function rankingWidthsTogether(a,b) {
  let result=0;
  for(let i=0;i<3;i++) for(let j=0;j<3;j++) if(a & (1<<i)) if(b & (1<<j)) result |= 1<<Math.min(2,i+j);
  return result;
}
/** @param {any} expr @returns {number} */
function rankingWidths(expr) {
  if(expr.empty) return 1;
  if(expr.capture || expr.test) return rankingWidths(expr.expr);
  if(expr.seq) return expr.seq.reduce((/** @type {number} */ mask,/** @type {any} */ part)=>rankingWidthsTogether(mask,rankingWidths(part)),1);
  if(expr.choice || expr.ranked) return (expr.choice??expr.ranked).reduce((/** @type {number} */ mask,/** @type {any} */ part)=>mask | rankingWidths(part),0);
  if(expr.and) return 7;
  return 2;
}
/** @param {any} expr @returns {any|null} */
function sole(expr) {
  if(!(rankingWidths(expr)&2)) return null;
  if(expr.capture || expr.test) return sole(expr.expr);
  if(expr.seq) {
    const parts=expr.seq.filter((/** @type {any} */ part)=>rankingWidths(part)!==1);
    return parts.length===1?sole(parts[0]):undefined;
  }
  return expr.choice || expr.ranked || expr.and ? undefined : expr;
}

/** @param {any} grammar @returns {any} */
function observations(grammar) {
  const rules=new Map(),terminals=new Set(),omitted=new Set(),vocabulary=new Set(['_Elided']);
  const body=(/** @type {any} */ root,/** @type {Set<string>} */ refs)=>{
    const pending=[root];
    while(pending.length) {
      const expr=pending.pop();
      if(hooks.work) countWork(hooks.work,"clauses");
      if(expr.ref) {
        if(grammar.rules.has(expr.ref)) refs.add(expr.ref);
        else terminals.add(expr.ref);
      } else if(expr.literal) {
        const value=grammar.evaluateClosed('',expr.literal,[1,1]);
        if('string' in value) terminals.add(stringName(value.string,grammar.unicode));
      } else if(expr.range) terminals.add(expr.range.map((/** @type {any} */ end)=>stringName(grammar.evaluateClosed('',end,[1,1]).string,grammar.unicode)).join('..'));
      else if(expr.wildcard) terminals.add('_');
      if(expr.optional && expr.elidable) {
        let head=expr.optional;
        while(head.seq || head.capture || head.test) head=head.seq?.[0] ?? head.expr;
        if(head.ref) {omitted.add(head.ref);vocabulary.add(head.ref);}
      }
      for(const key of ['seq','choice','ranked','and']) if(expr[key]) pending.push(...expr[key]);
      for(const key of ['expr','optional','repeat','separator']) if(expr[key]) pending.push(expr[key]);
    }
  };
  for(const rule of grammar.rules.values()) {
    const refs=new Set(),own=new Set(),sets=[],unary=[];
    let unknown=false;
    for(const alternative of rule.alternatives) {
      body(alternative.expr,refs);
      const terms=[alternative.tags,alternative.clauses.tags].filter((/** @type {any} */ term)=>term!==undefined);
      for(const term of terms) for(const tag of literals(term,grammar)) {own.add(tag);vocabulary.add(tag);}
      for(const item of alternative.clauses.emit?.items??[]) for(const tag of literals(item.tags,grammar)) vocabulary.add(tag);
      const child=sole(alternative.expr);
      if(child !== null) unary.push({child:child??{},terms,alternative});
      if(terms.length) {
        const tags=knownTags(terms.length===1?terms[0]:{union:terms});
        if(tags) sets.push(tags);else unknown=true;
      } else if(child !== null) unknown=true;
      else sets.push(new Set());
    }
    rules.set(rule.name,{refs,own,sets,unknown,unary});
  }
  for(const {implication} of grammar.implicationItems) for(const tag of literals(implication.then,grammar)) vocabulary.add(tag);
  for(const {classifier} of grammar.classifierItems) for(const entry of classifier.entries) vocabulary.add(entry.class);
  const reachable=new Set(),pending=['text'];
  while(pending.length) {
    const name=pending.pop();
    if(reachable.has(name) || !rules.has(name)) continue;
    reachable.add(name);
    pending.push(...rules.get(name).refs);
  }
  // Keep terminal reachability separate from query-only references.
  const reachedTerminals=new Set(),reachedOmitted=new Set();
  const allTerminals=new Set(terminals),allOmitted=new Set(omitted);
  terminals.clear();omitted.clear();
  for(const name of reachable) for(const alternative of grammar.rules.get(name).alternatives) body(alternative.expr,new Set());
  for(const terminal of terminals) reachedTerminals.add(terminal);
  for(const terminal of omitted) reachedOmitted.add(terminal);
  return {rules,reachable,terminals:reachedTerminals,omitted:reachedOmitted,vocabulary,allTerminals,allOmitted};
}

/** @param {any} pattern @param {any} data @returns {boolean} */
function dead(pattern,data) {
  if(pattern.union) return pattern.union.every((/** @type {any} */ p)=>dead(p,data));
  if(pattern.intersection) return pattern.intersection.some((/** @type {any} */ p)=>dead(p,data));
  if(pattern.difference) return dead(pattern.difference[0],data);
  if(pattern.test) return pattern.any?false:dead(pattern.expr,data);
  if(pattern.name) return !data.reachable.has(pattern.name);
  if(pattern.terminal) return !data.terminals.has(pattern.terminal) && !data.omitted.has(pattern.terminal);
  return false;
}

/** @param {any} grammar @param {Set<string>} [previous] @returns {any} */
export function rankingAudit(grammar,previous=new Set()) {
  const data=observations(grammar),steps=grammar.resolution?.steps??[];
  const vocabulary=new Set([...previous,...data.vocabulary]);
  const reports=[],changes=[],inherited=[],dropped=[],warnings=[];
  for(let index=0;index<steps.length;index++) {
    const step=steps[index],positive=new Set(),tested=new Set(),named=new Set(),pending=[step.pattern];
    while(pending.length) {
      const p=pending.pop();
      if(p.name) named.add(p.name);
      for(const r of p.requirements??[]) for(const tag of r.value.set) {tested.add(tag);if(!r.negated) positive.add(tag);}
      pending.push(...patternParts(p));
    }
    let possible=false,unknown=false;
    const observe=(/** @type {any} */ node)=>{
      const answer=possibleNodeMatch(step.pattern,node);
      possible ||= answer===true;
      unknown ||= answer===null;
    };
    const counted=new Set();
    for(const [name,rule] of data.rules) {
      if(named.has(name) || [...rule.own].some(tag=>tested.has(tag))) counted.add(name);
      const forwarded=[...tested].filter(tag=>tag!=='_Elided' && !rule.own.has(tag));
      const carried=forwarded.filter(tag=>rule.unknown || rule.sets.some((/** @type {Set<string>} */ tags)=>tags.has(tag)));
      if(carried.length) inherited.push({rule:name,step:index,tags:carried,unknown:rule.unknown});
      for(const {child,terms,alternative} of rule.unary) {
        if(!terms.some((/** @type {any} */ term)=>[...literals(term,grammar)].some(tag=>tested.has(tag)))) continue;
        const source=child.ref && data.rules.get(child.ref);
        const explicit=knownTags(terms.length===1?terms[0]:{union:terms});
        const lost=new Set();
        if(source && explicit) for(const tags of source.sets) for(const tag of tags) if(!explicit?.has(tag)) lost.add(tag);
        dropped.push({rule:name,step:index,tags:[...lost],unknown:!source || source.unknown || explicit===null,document:alternative.document,...alternative.at});
      }
      if(!data.reachable.has(name)) continue;
      for(const tags of rule.sets) observe({name,tags});
      if(rule.unknown) observe({name});
    }
    for(const terminal of data.terminals) observe({terminal});
    for(const terminal of data.omitted) observe({terminal,tags:new Set([terminal,'_Elided']),value:''});
    reports.push({step:index,pattern:canonicalArgument({pattern:step.pattern},grammar.unicode),status:dead(step.pattern,data)?'impossible':unknown?'unknown':possible?'possible':'impossible'});
    for(const change of grammar.changes) {
      if(counted.has(change.rule)) changes.push({...change,step:index});
    }
    for(const tag of [...positive].sort(compareCodePoints)) if(!vocabulary.has(tag) && !(tag.startsWith('_') && grammar.unicode.canonicalTag(tag)===tag)) warnings.push({kind:'ranking-tag-vocabulary',stage:grammar.stageName,step:index,tag});
  }
  return {keySteps:reports,countedChanges:changes,inheritedRankingTags:inherited,droppedRankingTags:dropped,vocabularyWarnings:warnings,vocabulary};
}
