// Static reports for node-pattern steps (docs/design.md).
import { patternParts } from './patterns.js';
import { stringName } from './tags.js';
import { canonicalArgument } from './templates.js';
import { hooks,countWork } from './testing.js';

/** @param {any} grammar @param {Iterable<string>} roots @param {any} [expr] @returns {any} */
export function patternReach(grammar,roots,expr) {
  const reachable=new Set(),terminals=new Set(),omitted=new Set(),pending=[...roots];
  const body=(/** @type {any} */ root)=>{
    const nodes=[root];
    while(nodes.length) {
      const expr=nodes.pop();
      if(hooks.work) countWork(hooks.work,"clauses");
      if(expr.ref) {
        if(grammar.rules.has(expr.ref)) pending.push(expr.ref);
        else terminals.add(expr.ref);
      } else if(expr.literal) {
        const value=grammar.evaluateClosed('',expr.literal,[1,1]);
        if('string' in value) terminals.add(stringName(value.string,grammar.unicode));
      } else if(expr.range) terminals.add(expr.range.map((/** @type {any} */ end)=>stringName(grammar.evaluateClosed('',end,[1,1]).string,grammar.unicode)).join('..'));
      else if(expr.wildcard) terminals.add('_');
      if(expr.optional && expr.elidable) {
        let head=expr.optional;
        while(head.seq || head.capture || head.test) head=head.seq?.[0] ?? head.expr;
        if(head.ref) omitted.add(head.ref);
      }
      for(const key of ['seq','choice','ranked','and']) if(expr[key]) for(const child of expr[key])nodes.push(child);
      for(const key of ['expr','splice','optional','repeat','separator']) if(expr[key]) nodes.push(expr[key]);
    }
  };
  if(expr)body(expr);
  while(pending.length) {
    const name=pending.pop(),rule=grammar.rules.get(name);
    if(reachable.has(name) || !rule)continue;
    reachable.add(name);
    for(const alternative of rule.alternatives)body(alternative.expr);
  }
  return {reachable,terminals,omitted};
}

/** @param {any} pattern @param {any} data @returns {boolean} */
export function dead(pattern,data) {
  if(pattern.never)return true;
  if(pattern.union) return pattern.union.every((/** @type {any} */ p)=>dead(p,data));
  if(pattern.intersection) return pattern.intersection.some((/** @type {any} */ p)=>dead(p,data));
  if(pattern.difference) return dead(pattern.difference[0],data);
  if(pattern.test) return pattern.any?false:dead(pattern.expr,data);
  if(pattern.name) return !data.reachable.has(pattern.name);
  if(pattern.terminal) return pattern.terminal === '_' ? !data.terminals.size && !data.omitted.size : !data.terminals.has(pattern.terminal) && !data.omitted.has(pattern.terminal);
  return false;
}

/** @param {any} grammar @returns {string[]} */
export function unreachableChecks(grammar) {
  if (!grammar.checks.length) return [];
  const data=patternReach(grammar,['text']);
  return grammar.checks.filter((/** @type {any} */ entry)=>dead(entry.check.pattern,data)).map((/** @type {any} */ entry)=>entry.check.name);
}

/** @param {any} grammar @returns {any} */
export function rankingAudit(grammar) {
  const steps=grammar.resolution?.steps??[];
  if (!steps.length) return {keySteps:[],countedChanges:[]};
  const data=patternReach(grammar,['text']);
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
