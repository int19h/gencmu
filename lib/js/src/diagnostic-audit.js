import {countWork,hooks} from "./testing.js";
import {queryReferences} from './query-forms.js';
// Notes for diagnostic rules, suppression, and concrete tag variants.
import {clauseChildren,expressionChildren} from './clause-walk.js';
import {guardedTagVariants,neighbourGuards} from './guarded-tags.js';
import {validationCaptures,prepareClause,simplifyFor} from './dom.js';

/** @param {import('./grammar.js').Grammar} grammar @returns {any[]} */
export function diagnosticAudit(grammar) {
  const notes=[], edges=new Map(), warnings=new Map(), errors=new Set();
  for (const rule of grammar.rules.values()) {
    const references=new Set(), codes=new Set();
    for (const alternative of rule.alternatives) {
      if(hooks.work)countWork(hooks.work,"closures");
      if(alternative.clauses.error)errors.add(rule.name);
      /** @type {any[]} */
      const pending=[alternative.expr];
      while(pending.length) {
        if(hooks.work)countWork(hooks.work,"walkSteps");
        const node=pending.pop();
        if (node && 'ref' in node && grammar.rules.has(node.ref)) references.add(node.ref);
        for (const child of expressionChildren(node)) pending.push(child);
      }
      if (alternative.clauses.warning) codes.add(rule.name);
    }
    edges.set(rule.name,references);warnings.set(rule.name,codes);
  }
  // Each bit follows the rule graph once: ordinary and filtered queries.
  const closure=(/** @type {Iterable<[string,number]>} */ roots)=> {
    const seen=new Map(),pending=[...roots];
    while(pending.length) {
      if(hooks.work)countWork(hooks.work,"closures");
      const [name,bits]=/** @type {[string,number]} */(pending.pop());
      const old=seen.get(name)??0,added=bits&~old;
      if(!added)continue;
      seen.set(name,old|bits);
      for(const child of edges.get(name)??[]) {
        if(hooks.work)countWork(hooks.work,"closures");
        pending.push([child,added]);
      }
    }
    return seen;
  };
  for (const rule of grammar.rules.values()) for (const alternative of rule.alternatives) {
    const clauses=alternative.clauses;
    const where={rule:rule.name,document:alternative.document,line:alternative.at.line,column:alternative.at.column};
    /** @type {{node:any,filtered:boolean}[]} */
    const pending=[clauses.conditions,clauses.tags,alternative.tags,clauses.emit].map(node=>({node,filtered:false}));
    /** @type {Map<string,number>} */ const targets=new Map();
    while(pending.length) {
      if(hooks.work)countWork(hooks.work,"walkSteps");
      const {node,filtered}=/** @type {NonNullable<ReturnType<typeof pending.pop>>} */(pending.pop());
      const names=['matches','begins','ends','tags'].includes(node?.method)?node.args.flatMap((/** @type {any} */ arg)=>arg.rule?[arg.rule]:[]):node?.method==='parse'?queryReferences(node.args[0].body):[];
      for(const name of names)targets.set(name,(targets.get(name)??0)|(filtered?2:1));
      for(const child of clauseChildren(node))pending.push({node:child,filtered:filtered||node?.method==='error-free'});
    }
    for(const [name,bits]of closure(targets))if(errors.has(name))for(const filtered of [false,true]) {
      if(bits&(filtered?2:1))notes.push({kind:'query-error',...where,target:name,filtered});
    }
    if (clauses.suppressWarnings) {
      const roots=new Set();
      /** @type {any[]} */
      const body=[alternative.expr];
      while(body.length) {
        if(hooks.work)countWork(hooks.work,"walkSteps");
        const node=body.pop();
        if ('ref' in node && grammar.rules.has(node.ref)) roots.add(node.ref);
        for (const child of expressionChildren(node)) body.push(child);
      }
      const possible=new Set(clauses.warning?[rule.name]:[]);
      for (const name of closure([...roots].map(name=>[name,1])).keys()) for (const code of warnings.get(name) ?? []) possible.add(code);
      for (const code of new Set(clauses.suppressWarnings)) if (code==='_' ? !possible.size : !possible.has(code)) notes.push({kind:'unused-suppression',...where,code});
    }
    const terms=[clauses.tags,alternative.tags].filter(term=>term!==undefined);
    if (neighbourGuards(terms).length) {
      const owner={name:rule.name,...clauses,alternatives:[alternative]};
      for (const captures of validationCaptures(owner,alternative)) {
        const terms=[clauses.tags,alternative.tags].filter(term=>term!==undefined).map(term=>simplifyFor(prepareClause(term),name=>captures.has(name),captures));
        const count=guardedTagVariants(terms.length===1?terms[0]:{union:terms}).length;
        if (count>8) notes.push({kind:'guarded-tag-variants',...where,variants:count,captures:[...captures.keys()].filter(Boolean)});
      }
    }
  }
  // Shared definition clauses can supply one note through several alternatives.
  const seen=new Set();
  return notes.filter(note=>{const key=JSON.stringify(note);if(seen.has(key)) return false;seen.add(key);return true;});
}
