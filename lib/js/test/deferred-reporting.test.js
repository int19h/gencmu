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
