import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadEngineCase,parseEngineCase,runEngineCase} from './shared.js';
import {audit,formatAudit,GencmuError,explainWarnings} from '../src/node.js';
import {caseOutcome,caseDifference} from '../src/cases.js';
import {hooks} from '../src/testing.js';
import {Ranker} from '../src/rank.js';

const fixture=name=>JSON.parse(fs.readFileSync(new URL(`../../../tests/engine/i276-${name}.json`,import.meta.url),'utf8'));

test('a failing message preserves earlier stages and clears all current reports',()=>{
  const c=fixture('message-guard');
  const {pipeline}=loadEngineCase(c);
  let calls=0;
  hooks.diagnosticMessage=(node)=>{
    calls++;
    if ((node.production.spliceOf ?? node.production.lhs)==='bad') throw new GencmuError('grammar','injected message failure');
  };
  try {
    const {result,json}=parseEngineCase(pipeline,c);
    assert.equal(calls,3);
    assert.equal(result.error.kind,'grammar');
    assert.equal(result.tree,null);
    assert.equal(result.stages[1].verdict,'unique');
    assert.equal(result.stages[1].output,null);
    assert.equal(result.error.errors,undefined);
    assert.deepEqual(result.warnings.map(w=>w.code),['early']);
    assert.deepEqual(result.stages[1].warnings,[]);
    assert.equal(json.stages[0].output[0].value,'a');
    assert.equal(json.stages[1].output,undefined);
  } finally {hooks.diagnosticMessage=null;}
});

test('disabled and suppressed warnings evaluate no message',()=>{
  let calls=0;
  hooks.diagnosticMessage=()=>{calls++;throw new Error('a disabled message ran');};
  try {
    assert.equal(runEngineCase(fixture('warning-suppression-descendant')).json.ok,true);
    const c=fixture('warning-erased');c.options={};
    assert.equal(runEngineCase(c).json.ok,true);
    assert.equal(calls,0);
  } finally {hooks.diagnosticMessage=null;}
});

test('a surviving guarded occurrence evaluates its message once',()=>{
  let calls=0;
  hooks.diagnosticMessage=()=>{calls++;};
  try {
    const {result}=runEngineCase(fixture('tags-report-once'));
    assert.equal(calls,1);
    assert.equal(result.warnings[0].message,'warning left');
    const explained=explainWarnings(result);
    assert.match(explained,/left/);
    assert.match(explained,/warning left/);
  } finally {hooks.diagnosticMessage=null;}
});

test('the audit notes queried errors and large sets of concrete variants',()=>{
  const query=loadEngineCase(fixture('error-query-matches')).pipeline;
  assert.ok(audit(query)[0].diagnosticNotes.some(note=>note.kind==='query-error'&&note.target==='bad'));
  const variants=loadEngineCase(fixture('tags-variants-4')).pipeline;
  assert.ok(audit(variants)[0].diagnosticNotes.some(note=>note.kind==='guarded-tag-variants'&&note.variants===16));
  assert.match(formatAudit(audit(variants)),/16 guarded tag variants/);
  const c=fixture('warning-suppression-descendant');
  c.grammar=c.grammar.replace('%rule wrap *warn','%rule wrap A');
  const suppression=loadEngineCase(c).pipeline;
  assert.ok(audit(suppression)[0].diagnosticNotes.some(note=>note.kind==='unused-suppression'&&note.code==='warn'));
});

// Corpus fields compare codes and source positions independently of wording.
test('corpus projections retain the failed stage and ordered diagnostics',()=>{
  const {result}=runEngineCase(fixture('error-shape'));
  const expected={expect:'reject',verdict:'unique',stage:'main',error:{kind:'reported'},at:0,errors:[{code:'bad',at:0}],warnings:[]};
  assert.equal(caseDifference(expected,caseOutcome(result)),null);
  for (const change of [{errors:[{code:'other',at:0}]},{errors:[{code:'bad',at:1}]},{warnings:[{stage:'main',code:'warn',at:0}]}]) {
    assert.notEqual(caseDifference({...expected,...change},caseOutcome(result)),null);
  }
  const warning=runEngineCase(fixture('warning-with-errors')).result;
  assert.deepEqual(caseOutcome(warning).warnings,[{stage:'main',code:'text',at:0}]);
});


test('legacy grammars run no error-count or captured-route work',()=>{
  const grammars=[
    '%rule text {$x:A}',
    '%ambiguity-resolution fewest #·pair\n%rule text {pair}\n%rule pair $x:A',
    '%rule text :: ∅ | {(A ≻ B)}',
    '%elision-only\n%rule text {$x:A} [+JI]',
    '%rule text {a}\n%rule a A\n%conditions $.matches(b)\n%rule b A',
  ];
  let errorReads=0,routeReads=0,forwardReads=0,summaryReads=0,summaries=0,profiles=0;
  const original=Ranker.prototype.traverse;
  try {
    for (const grammar of grammars) {
      const {pipeline}=loadEngineCase({grammar,tokens:[]});
      const lowered=pipeline.stages[0].grammar.lower(new Set());
      assert.equal(lowered.hasErrors,false);
      assert.equal(lowered.capturedTerminators,false);
      for (const p of lowered.productions) {
        Object.defineProperty(p,'error',{get(){errorReads++;return undefined;}});
        for (const symbol of p.rhs) Object.defineProperty(symbol,'optionalRoute',{get(){routeReads++;return undefined;},configurable:true});
        for (const capture of p.captures) Object.defineProperty(capture,'terminal',{get(){forwardReads++;return undefined;},configurable:true});
      }
      Ranker.prototype.traverse=function(root,memo,combine,...rest){
        assert.equal(this.space.zero.length,this.space.steps.length);
        if (memo===this.summaries) profiles++;
        if (memo!==this.counts) return original.call(this,root,memo,combine,...rest);
        return original.call(this,root,memo,(item,dependency,key)=>{
          summaries++;
          const result=combine(item,other=>new Proxy(dependency(other),{get(target,key){if(key==='errors')summaryReads++;return target[key];}}),key);
          assert.equal(Object.hasOwn(result,'errors'),false);
          return result;
        },...rest);
      };
      for (const length of [10,100]) {
        const {result}=parseEngineCase(pipeline,{tokens:Array.from({length},()=>({text:'a',tags:['A']}))});
        assert.equal(result.ok,true);
      }
      Ranker.prototype.traverse=original;
    }
    assert.ok(summaries>0);
    assert.ok(profiles>0);
    assert.deepEqual({errorReads,routeReads,forwardReads,summaryReads},{errorReads:0,routeReads:0,forwardReads:0,summaryReads:0});
  } finally {Ranker.prototype.traverse=original;}
});
