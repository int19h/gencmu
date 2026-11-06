// Conservative effects of removing one written erasure (design, Diagnostics and debugging).
import {expressionChildren} from './clause-walk.js';
import {countWork,hooks} from './testing.js';

const READ=1,EMIT=2,DIAGNOSTIC=4,CHOICE=8,ALL=15;

/** @param {import('./grammar.js').Grammar} grammar
 * @param {(alternative:import('./grammar.js').StitchedAlternative)=>boolean} emits
 * @returns {{rule:string,document:string,line:number,column:number,alternative:number,kind:'semantic'|'inert',effects:string[]}[]} */
export function erasureAudit(grammar,emits) {
  /** @type {Map<object,{bits:number,mask:number,references:Set<string>}>} */ const alternatives=new Map();
  /** @type {Map<string,number>} */ const effects=new Map();
  /** @type {Map<string,{parent:string,mask:number}[]>} */ const dependents=new Map();
  /** @type {string[]} */ const pending=[];
  /** @param {string} name @param {number} bits */
  const add=(name,bits)=>{const old=effects.get(name)??0;if((old|bits)!==old){effects.set(name,old|bits);pending.push(name);}};
  for(const rule of grammar.rules.values()) {
    if(rule.alternatives.length>1)add(rule.name,CHOICE);
    for(const alternative of rule.alternatives) {
      if(hooks.work)countWork(hooks.work,'closures');
      let bits=(alternative.clauses.error||alternative.clauses.warning?DIAGNOSTIC:0)|(emits(alternative)?EMIT:0);
      const references=new Set(),stack=[alternative.expr];
      while(stack.length) {
        if(hooks.work)countWork(hooks.work,'walkSteps');
        const node=stack.pop();
        if(!node)continue;
        if('ref'in node){if(grammar.rules.has(node.ref))references.add(node.ref);else bits|=READ|DIAGNOSTIC;}
        if('literal'in node||'range'in node||'wildcard'in node)bits|=READ|DIAGNOSTIC;
        if('optional'in node||'repeat'in node||'choice'in node||'ranked'in node||'and'in node)bits|=CHOICE;
        for(const child of expressionChildren(node))stack.push(child);
      }
      const mask=alternative.clauses.emit?ALL&~EMIT:ALL;
      alternatives.set(alternative,{bits,mask,references});
      if(alternative.clauses.erased)continue;
      add(rule.name,bits);
      for(const target of references){const list=dependents.get(target)??[];list.push({parent:rule.name,mask});dependents.set(target,list);}
    }
  }
  for(let index=0;index<pending.length;index++)for(const edge of dependents.get(pending[index])??[]) {
    if(hooks.work)countWork(hooks.work,'closures');
    add(edge.parent,(effects.get(pending[index])??0)&edge.mask);
  }
  /** @type {ReturnType<typeof erasureAudit>} */ const result=[];
  for(const rule of grammar.rules.values())rule.alternatives.forEach((alternative,index)=>{
    if(!alternative.clauses.erased)return;
    const local=/** @type {NonNullable<ReturnType<typeof alternatives.get>>} */(alternatives.get(alternative));
    let bits=local.bits|(rule.alternatives.length>1?CHOICE:0);
    for(const target of local.references)bits|=(effects.get(target)??0)&local.mask;
    const names=[];
    if(bits&READ)names.push('counted-parts');if(bits&EMIT)names.push('emission');
    if(bits&DIAGNOSTIC)names.push('diagnostics');if(bits&CHOICE)names.push('derivation-choice');
    result.push({rule:rule.name,document:alternative.document,line:alternative.at.line??1,column:alternative.at.column??1,alternative:index,kind:/** @type {'semantic'|'inert'} */(bits?'semantic':'inert'),effects:names});
  });
  return result;
}
