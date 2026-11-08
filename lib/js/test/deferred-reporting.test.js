import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runEngineCase} from './shared.js';
import fs from 'node:fs';
import {hooks} from '../src/testing.js';
import {GencmuError} from '../src/errors.js';
import {caseOutcome,caseDifference} from '../src/cases.js';

const fixture=name=>JSON.parse(fs.readFileSync(new URL('../../../tests/engine/deferred-report-'+name+'.json',import.meta.url),'utf8'));

// Engine §7: errors on carriers or at stage level bar reconstruction.
test('counted errors bar elision-only including pending empty-output errors',()=>{
  let calls=0;hooks.elisionCheck=()=>{calls++;throw new Error('a counted error entered reconstruction');};
  try{for(const name of ['pending-skips-elision','carried-skips-elision'])assert.equal(runEngineCase(fixture(name)).json.error.kind,'reported');}
  finally{hooks.elisionCheck=null;}
  assert.equal(calls,0);
});

test('a failed tie message retains its verdict, evaluated prefix, and carried facts',()=>{
  const c=fixture('tie-carried-and-multiplicity');
  let calls=0;hooks.diagnosticMessage=node=>{if(node.production.lhs==='note'&&++calls===2)throw new GencmuError('grammar','message guard');};
  try{
    const {json,result}=runEngineCase(c);
    assert.equal(result.error.kind,'grammar');assert.equal(json.stages.at(-1).verdict,'tie');
    assert.equal(json.stages.at(-1).output,undefined);assert.equal(json.tree,null);
    assert.deepEqual(json.error.errors.map(d=>d.code),['fault']);
    assert.deepEqual(json.warnings.map(d=>d.code),['note','carrier']);
    assert.deepEqual(json.error.warnings,json.warnings);
  }finally{hooks.diagnosticMessage=null;}
});

test('canonical diagnostic lists own their arrays independently of the native result',()=>{
  const {json,result}=runEngineCase(fixture('forward'));
  const native=result.error.errors[0];
  json.error.errors[0].source[0]=999;json.stages[0].output[0].errors[0].span[0]=999;
  assert.deepEqual(native.source,[0,1]);assert.deepEqual(native.span,[0,1]);
  assert.notEqual(json.stages[0].output[0].errors[0].source,json.stages[1].output[0].errors[0].source);
});

test('corpus pins can require the raising stage on any failed envelope',()=>{
  const {result}=runEngineCase(fixture('rejected')),got=caseOutcome(result);
  assert.deepEqual(got.errors,[{stage:'before',code:'fault',at:0}]);
  const expected={expect:'reject',stage:'last',at:0,errors:[{code:'fault',at:0}]};
  assert.equal(caseDifference(expected,got),null);
  assert.equal(caseDifference({...expected,errors:[{stage:'before',code:'fault',at:0}]},got),null);
  assert.notEqual(caseDifference({...expected,errors:[{stage:'last',code:'fault',at:0}]},got),null);
});

// Output, Renderings: diagnostic displays do not alter the chosen tree.
test('reported trees retain every rendering and identify attachment display owners once',async()=>{
  const {toBrackets,toTree,displayValue}=await import('../src/output.js');
  const {explainError,explainWarnings}=await import('../src/diagnostics.js');
  const c=JSON.parse(fs.readFileSync(new URL('../../../tests/engine/deferred-owner-attachment-display.json',import.meta.url),'utf8'));
  const reported=runEngineCase(c).result,clean=runEngineCase({...c,grammar:c.grammar.replaceAll('%error "annotation"','').replaceAll('%error "word"','')}).result;
  assert.equal(reported.error.kind,'reported');assert.equal(clean.ok,true);
  assert.equal(toBrackets(reported),toBrackets(clean));assert.equal(toTree(reported),toTree(clean));assert.deepEqual(displayValue(reported),displayValue(clean));
  const explained=explainError(reported);assert.equal(explained.match(/Error annotation/g).length,1);assert.match(explained,/Display owner: before attachment 0 of token 0 in the main stage/);
  const carried=JSON.parse(fs.readFileSync(new URL('../../../tests/engine/deferred-owner-attachment-group-order.json',import.meta.url),'utf8'));
  const warnings=explainWarnings(runEngineCase(carried).result);
  assert.ok(warnings.indexOf('Warning old')<warnings.indexOf('Warning word'));assert.equal(warnings.match(/Warning old/g).length,1);assert.match(warnings,/in the last stage/);
});
