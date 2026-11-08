import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadEngineCase} from './shared.js';
import {diagnosticAudit} from '../src/diagnostic-audit.js';
import {queryBody,queryCapture,queryIdentity,queryReferences} from '../src/query-forms.js';
import {assertLinearWork,countedWork} from './linear.js';

// Design, Diagnostics and debugging: audit walks count each visited node.
test('query audit closes shared rule dependencies once per alternative',()=>{
  assertLinearWork('diagnostic query union',30,n=>{
    const targets=Array.from({length:n},(_,i)=>'r'+i),chain=Array.from({length:n},(_,i)=>'%rule c'+i+' '+(i+1===n?'A':'c'+(i+1)));
    const grammar='%rule text $a:A\n%conditions $a.parse('+targets.join(' | ')+'), $a.parse('+targets.join(' | ')+').error-free\n'+targets.map(name=>'%rule '+name+' c0').join('\n')+'\n'+chain.join('\n')+'\n%error "fault"\n%erased';
    const loaded=loadEngineCase({grammar});assert.ifError(loaded.loadError);
    return ()=>{
      const notes=diagnosticAudit(loaded.pipeline.stages[0].grammar).filter(note=>note.kind==='query-error');
      assert.deepEqual(notes.map(note=>[note.target,note.filtered]),[['c'+(n-1),false],['c'+(n-1),true]]);
    };
  },['walkSteps','closures']);
});

test('query form inspections count expression work and memoized identities reuse it',()=>{
  for(const inspect of [queryBody,queryCapture,queryIdentity,queryReferences]){
    const body={seq:Array.from({length:20},(_,i)=>({ref:'r'+i}))};
    assert.ok(countedWork(()=>inspect(body)).walkSteps>0);
  }
  const body={ref:'x'};queryIdentity(body);
  assert.equal(countedWork(()=>queryIdentity(body)).walkSteps,0);
});
