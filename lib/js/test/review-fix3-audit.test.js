import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadEngineCase} from './shared.js';
import {diagnosticAudit} from '../src/diagnostic-audit.js';
import {assertLinearWork} from './linear.js';

// Design, Diagnostics and debugging: shared clauses cost their source size.
test('diagnostic discovery reuses common clauses beside distinct alternative tags',()=>{
  assertLinearWork('shared diagnostic clauses',40,n=>{
    const alternatives=Array.from({length:n},(_,i)=>'$c'+i+':A :: T'+i);
    const conditions=Array.from({length:n},(_,i)=>'$c'+i+'.parse(r0)');
    const rules=Array.from({length:n},(_,i)=>'%rule r'+i+' '+(i+1===n?'A':'r'+(i+1)));
    const loaded=loadEngineCase({grammar:'%rule text :: $.tags(r0) | '+alternatives.join(' | ')+'\n%conditions '+conditions.join(', ')+'\n'+rules.join('\n')+'\n%error "fault"\n%erased'});
    assert.ifError(loaded.loadError);
    return ()=>assert.deepEqual(diagnosticAudit(loaded.pipeline.stages[0].grammar).map(note=>[note.kind,note.target,note.filtered]),[['query-error','r'+(n-1),false]]);
  },['walkSteps','closures']);
});

// Engine §2: an extension has its own clauses and alternative annotations.
test('cached query discovery preserves alternative targets, filters, and extension locations',()=>{
  const loaded=loadEngineCase({grammar:'%rule text :: $.tags(common) | A :: $.tags(first) | A :: $.tags(second)\n%conditions $.parse(target), $.parse(target).error-free\n%extend-rule text A :: $.tags(first)\n%conditions $.parse(other).error-free\n'+['common','first','second','target','other'].map(name=>'%rule '+name+' A\n%error "fault"\n%erased').join('\n')});
  assert.ifError(loaded.loadError);
  const notes=diagnosticAudit(loaded.pipeline.stages[0].grammar).filter(note=>note.kind==='query-error');
  assert.deepEqual(notes.map(note=>[note.line,note.target,note.filtered]).sort(),[
    [3,'common',false],[3,'first',false],[3,'second',false],[3,'target',false],[3,'target',true],
    [5,'first',false],[5,'other',true],
  ].sort());
});
