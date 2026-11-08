// Static reports for node-pattern steps (docs/design.md).
import { patternParts } from './patterns.js';
import { stringName } from './tags.js';
import { canonicalArgument } from './templates.js';
import { hooks,countWork } from './testing.js';

/** @param {any} grammar @returns {any} */
function observations(grammar) {
  const rules=new Map(),terminals=new Set(),omitted=new Set();
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
        if(head.ref) {omitted.add(head.ref);}
      }
      for(const key of ['seq','choice','ranked','and']) if(expr[key]) for (const child of expr[key]) pending.push(child);
      for(const key of ['expr','splice','optional','repeat','separator']) if(expr[key]) pending.push(expr[key]);
    }
  };
  for(const rule of grammar.rules.values()) {
    const refs=new Set();
    for(const alternative of rule.alternatives) body(alternative.expr,refs);
    rules.set(rule.name,{refs});
  }
  const reachable=new Set(),pending=['text'];
  while(pending.length) {
    const name=pending.pop();
    if(reachable.has(name) || !rules.has(name)) continue;
    reachable.add(name);
    for (const child of rules.get(name).refs) pending.push(child);
  }
  // Keep terminal reachability separate from query-only references.
  const reachedTerminals=new Set(),reachedOmitted=new Set();
  const allTerminals=new Set(terminals),allOmitted=new Set(omitted);
  terminals.clear();omitted.clear();
  for(const name of reachable) for(const alternative of grammar.rules.get(name).alternatives) body(alternative.expr,new Set());
  for(const terminal of terminals) reachedTerminals.add(terminal);
  for(const terminal of omitted) reachedOmitted.add(terminal);
  return {rules,reachable,terminals:reachedTerminals,omitted:reachedOmitted,allTerminals,allOmitted};
}

/** @param {any} pattern @param {any} data @returns {boolean} */
function dead(pattern,data) {
  if(pattern.union) return pattern.union.every((/** @type {any} */ p)=>dead(p,data));
  if(pattern.intersection) return pattern.intersection.some((/** @type {any} */ p)=>dead(p,data));
  if(pattern.difference) return dead(pattern.difference[0],data);
  if(pattern.test) return pattern.any?false:dead(pattern.expr,data);
  if(pattern.name) return !data.reachable.has(pattern.name);
  if(pattern.terminal) return pattern.terminal === '_' ? !data.terminals.size && !data.omitted.size : !data.terminals.has(pattern.terminal) && !data.omitted.has(pattern.terminal);
  return false;
}

/** @param {any} grammar @returns {any} */
export function rankingAudit(grammar) {
  const steps=grammar.resolution?.steps??[];
  if (!steps.length) return {keySteps:[],countedChanges:[]};
  const data=observations(grammar);
  const reports=[],changes=[];
  for(let index=0;index<steps.length;index++) {
    const step=steps[index],named=new Set(),pending=[step.pattern];
    while(pending.length) {
      const pattern=pending.pop();
      if(pattern.name)named.add(pattern.name);
      for (const child of patternParts(pattern)) pending.push(child);
    }
    reports.push({step:index,pattern:canonicalArgument({pattern:step.pattern},grammar.unicode),...(dead(step.pattern,data)?{status:'impossible'}:{})});
    for(const change of grammar.changes)if(named.has(change.rule))changes.push({...change,step:index});
  }
  return {keySteps:reports,countedChanges:changes};
}
