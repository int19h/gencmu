import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadEngineCase,parseEngineCase,runEngineCase} from './shared.js';
import {audit,formatAudit,GencmuError,explainWarnings,loadPipelineSources,fnv1a64} from '../src/node.js';
import {caseOutcome,caseDifference} from '../src/cases.js';
import {hooks} from '../src/testing.js';
import {countedWork} from './linear.js';

const fixture=name=>JSON.parse(fs.readFileSync(new URL(`../../../tests/engine/i276-${name}.json`,import.meta.url),'utf8'));

test('guard occurrence sites survive preparsed loading and normalization',()=>{
  for(const [name,index] of [['guard-duplicate-alternatives',1],['guard-header-first',0],['guard-simplified-origin',1]]){
    const c=fixture(name), path='grammars/test/p.md', grammar='grammars/test/g.md';
    const sources={
      [path]:'```jbogenbau\n%stage main\n%include "g.md"\n```\n',
      [grammar]:'```jbogenbau\n'+c.grammar+'\n```\n',
    };
    const fresh=loadPipelineSources(sources,path);
    const dom=fresh.loader.readDocument(sources[grammar],grammar);
    const cache=JSON.stringify({format:dom.format,bootstrap:fresh.loader.bootstrapHash,unicode:fresh.loader.unicodeHash,
      properties:fresh.loader.propertiesHash,documents:{[grammar]:{hash:fnv1a64(sources[grammar]),dom}}});
    const cached=loadPipelineSources({...sources,'data/preparsed/test.json':cache},path);
    const plain=parseEngineCase(fresh,c), prepared=parseEngineCase(cached,c);
    assert.equal(plain.result.error.boundary.condition,index,name);
    assert.equal(prepared.result.error.boundary.condition,index,name);
    assert.deepEqual(prepared.json,plain.json,name);
    if(name==='guard-duplicate-alternatives'){
      const changed=cache.replace('"string":"x"','"string":"a"');
      assert.notEqual(changed,cache);
      const control=loadPipelineSources({...sources,'data/preparsed/test.json':changed},path);
      assert.equal(parseEngineCase(control,c).result.error.boundary.condition,0,'the preparsed route must use its DOM');
    }
  }
});

test('a scoped splice retains its logical cycle key through ranked admission',()=>{
  const c=fixture('splice-ranked-cycle');
  const {pipeline}=loadEngineCase(c);
  countedWork(()=>{
    const {result}=parseEngineCase(pipeline,c);
    assert.equal(result.ok,true);
    assert.equal(result.stages[0].verdict,'unique');
  },{traversal:10000});
});

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
