import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runEngineCase,resultProblems,checkEngineOutcome} from './shared.js';
import {explainError} from '../src/diagnostics.js';

const fixture=name=>JSON.parse(fs.readFileSync(new URL('../../../tests/engine/deferred-rejection-'+name+'.json',import.meta.url),'utf8'));

// Engine §12.1: no non-error competitor entry means no rejection member.
test('ranked diagnostic evidence distinguishes an empty slice from empty expectations',()=>{
  for(const name of ['all-error-empty-slice','extension-is-another-definition','gated-competitor','descendant-error','spliced-error','plain-error']){
    const c=fixture(name),outcome=runEngineCase(c);checkEngineOutcome(c.expect,outcome,name);
    assert.equal(Object.hasOwn(outcome.json.error.errors[0],'rejection'),false,name);
  }
  const evidence=runEngineCase(fixture('empty-expected')).json.error.errors[0].rejection;
  assert.equal(evidence.token,0);assert.deepEqual(evidence.expected,[]);
});

test('competitor slices use descendant origins, cap advances, and preserve tests',()=>{
  for(const name of ['descendant-origin','nonzero-origin','capped-boundary','all-error-with-sibling','tested-lookahead','no-error-advance']){
    const c=fixture(name),outcome=runEngineCase(c);checkEngineOutcome(c.expect,outcome,name);
    assert.ok(outcome.json.error.errors[0].rejection,name);
  }
});

test('carried evidence keeps raising coordinates and owns its canonical arrays',()=>{
  const {grammar,tokens}=fixture('descendant-origin');
  const c={tokens,documents:{'p.md':'```jbogenbau\n%stage before\n%ambiguity-resolution greedy\n'+grammar.replace('%error "bad"','%error "bad"\n%emits $ :: Word')+'\n%stage last\n%ambiguity-resolution greedy\n%rule text Word\n%emits $\n```\n'},pipelineDocument:'p.md'};
  const {result,json}=runEngineCase(c),native=result.error.errors[0].rejection;
  const before=json.stages[0].output[0].errors[0],last=json.error.errors[0];
  assert.equal(last.stage,'before');assert.equal(json.error.stage,'last');assert.deepEqual(last.rejection,native);
  assert.deepEqual(Object.keys(last.rejection),['token','source','line','column','expected']);
  assert.equal(json.stages[1].output[0].errors.length,1);
  last.rejection.source[0]=999;last.rejection.expected[0].rules[0]='changed';
  assert.notEqual(before.rejection.source[0],999);assert.deepEqual(native.expected,[{terminal:'C',rules:['part']}]);
});

test('nested diagnostic evidence rejects malformed fields and warning evidence',()=>{
  const {json}=runEngineCase(fixture('descendant-origin'));
  assert.deepEqual(resultProblems(json),[]);
  for(const change of [d=>delete d.rejection.token,d=>d.rejection.line=0,d=>d.rejection.expected=[{terminal:'C',rules:1}],d=>d.rejection.extra=true]) {
    const altered=structuredClone(json);change(altered.error.errors[0]);assert.ok(resultProblems(altered).length);
  }
  const altered=structuredClone(json);altered.warnings=[altered.error.errors[0]];assert.ok(resultProblems(altered).length);
});


test('explanations retain competitor evidence and failed-envelope diagnostics',()=>{
  const {result}=runEngineCase(fixture('descendant-origin'));
  const explanation=explainError(result);
  assert.match(explanation,/Error bad in the main stage/);assert.match(explanation,/competing readings reach token 2/);assert.match(explanation,/C: part/);
  const failed={...result,error:{kind:'rejected',stage:'main',token:0,expected:[],errors:result.error.errors,message:'stopped'}};
  assert.match(explainError(failed),/Error bad in the main stage/);
});
