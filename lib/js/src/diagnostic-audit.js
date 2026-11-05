// Notes for diagnostic rules, suppression, and concrete tag variants.
import {clauseChildren,expressionChildren} from './clause-walk.js';
import {guardedTagVariants,neighbourGuards} from './guarded-tags.js';
import {validationCaptures,prepareClause,simplifyFor} from './dom.js';

/** @param {import('./grammar.js').Grammar} grammar @returns {any[]} */
export function diagnosticAudit(grammar) {
  const notes=[], edges=new Map(), warnings=new Map();
  for (const rule of grammar.rules.values()) {
    const references=new Set(), codes=new Set();
    for (const alternative of rule.alternatives) {
      /** @type {any[]} */
      const pending=[alternative.expr];
      while(pending.length) {
        const node=pending.pop();
        if (node && 'ref' in node && grammar.rules.has(node.ref)) references.add(node.ref);
        for (const child of expressionChildren(node)) pending.push(child);
      }
      if (alternative.clauses.warning) codes.add(rule.name);
    }
    edges.set(rule.name,references);warnings.set(rule.name,codes);
  }
  const closure=(/** @type {Iterable<string>} */ roots)=> {
    const seen=new Set(),pending=[...roots];
    while(pending.length) {
      const name=pending.pop();
      if (seen.has(name)) continue;
      seen.add(name);
      for (const child of edges.get(name) ?? []) pending.push(child);
    }
    return seen;
  };
  for (const rule of grammar.rules.values()) for (const alternative of rule.alternatives) {
    const clauses=alternative.clauses;
    const where={rule:rule.name,document:alternative.document,line:alternative.at.line,column:alternative.at.column};
    /** @type {any[]} */
    const pending=[clauses.conditions,clauses.tags,alternative.tags,clauses.emit];
    const reached=new Set();
    while(pending.length) {
      const node=pending.pop();
      if (['matches','begins','ends','tags'].includes(node?.method)) for (const arg of node.args) if (arg.rule) for (const name of closure([arg.rule])) reached.add(name);
      for (const child of clauseChildren(node)) pending.push(child);
    }
    for (const name of reached) if (grammar.rules.get(name)?.alternatives.some(a=>a.clauses.error)) notes.push({kind:'query-error',...where,target:name});
    if (clauses.suppressWarnings) {
      const roots=new Set();
      /** @type {any[]} */
      const body=[alternative.expr];
      while(body.length) {
        const node=body.pop();
        if ('ref' in node && grammar.rules.has(node.ref)) roots.add(node.ref);
        for (const child of expressionChildren(node)) body.push(child);
      }
      const possible=new Set(clauses.warning?[rule.name]:[]);
      for (const name of closure(roots)) for (const code of warnings.get(name) ?? []) possible.add(code);
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
