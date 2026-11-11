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
  // Definition clauses and terms stay shared across their alternatives.
  // Cache discovery by source object, not by a simplified production.
  /** @typedef {Map<string,number>} Targets */
  /** @type {Targets} */ const emptyTargets=new Map();
  /** @type {Map<any,Targets>} */ const queryTargets=new Map();
  const targetsOf=(/** @type {any} */ root)=>{
    const known=queryTargets.get(root);if(known)return known;
    /** @type {Targets} */ const found=new Map();
    const pending=[{node:root,filtered:false}];
    while(pending.length) {
      if(hooks.work)countWork(hooks.work,"walkSteps");
      const {node,filtered}=/** @type {NonNullable<ReturnType<typeof pending.pop>>} */(pending.pop());
      const names=node?.method==='parse'?queryReferences(node.args[0].body):[];
      for(const name of names)found.set(name,(found.get(name)??0)|(filtered?2:1));
      for(const child of clauseChildren(node))pending.push({node:child,filtered:filtered||node?.method==='error-free'});
    }
    const result=found.size?found:emptyTargets;
    queryTargets.set(root,result);return result;
  };
  /** @type {Map<import('./grammar.js').RuleClauses,Map<Targets,Targets>>} */ const queryClosures=new Map();
  const queriesOf=(/** @type {import('./grammar.js').RuleClauses} */ clauses,/** @type {any} */ tags)=>{
    const own=targetsOf(tags);
    let cache=queryClosures.get(clauses);if(!cache)queryClosures.set(clauses,cache=new Map());
    const known=cache.get(own);if(known)return known;
    /** @type {Targets} */ const targets=new Map();
    // Preserve the clause walk's discovery order for the audit notes.
    for(const part of [targetsOf(clauses.emit),own,targetsOf(clauses.tags),targetsOf(clauses.conditions)]) {
      for(const [name,bits]of part)targets.set(name,(targets.get(name)??0)|bits);
    }
    const reached=closure(targets);cache.set(own,reached);return reached;
  };
  /** @type {Map<any,boolean>} */ const guards=new Map();
  const guarded=(/** @type {any} */ term)=>{
    const known=guards.get(term);if(known!==undefined)return known;
    const found=neighbourGuards(term).length!==0;guards.set(term,found);return found;
  };
  for (const rule of grammar.rules.values()) for (const alternative of rule.alternatives) {
    const clauses=alternative.clauses;
    const where={rule:rule.name,document:alternative.document,line:alternative.at.line,column:alternative.at.column};
    for(const [name,bits]of queriesOf(clauses,alternative.tags))if(errors.has(name))for(const filtered of [false,true]) {
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
      const possible=new Set([...(clauses.warning?[rule.name]:[]),...grammar.checks.filter(entry=>entry.check.warning).map(entry=>entry.check.name)]);
      for (const name of closure([...roots].map(name=>[name,1])).keys()) for (const code of warnings.get(name) ?? []) possible.add(code);
      for (const code of new Set(clauses.suppressWarnings)) if (code==='_' ? !possible.size : !possible.has(code)) notes.push({kind:'unused-suppression',...where,code});
    }
    const terms=[clauses.tags,alternative.tags].filter(term=>term!==undefined);
    if (terms.some(guarded)) {
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
