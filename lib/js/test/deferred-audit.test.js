import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadEngineCase} from './shared.js';
import {audit,formatAudit} from '../src/diagnostics.js';

function inspect(grammar){const loaded=loadEngineCase({grammar});if(loaded.loadError)throw loaded.loadError;return audit(loaded.pipeline)[0];}

// Design, Diagnostics and debugging: erasure is semantic beyond emission.
test('the audit classifies counted input, diagnostics, choices, and inert empty erasure',()=>{
  const stage=inspect('%rule text gone empty choice warning inserted\n%rule gone A\n%erased\n%rule empty ε\n%erased\n%rule choice (ε | ε)\n%erased\n%rule warning ε\n%warning "note"\n%erased\n%rule inserted producer\n%erased\n%rule producer ε\n%emits ε :: X');
  const kinds=Object.fromEntries(stage.erasures.map(entry=>[entry.rule,entry]));
  assert.equal(kinds.empty.kind,'inert');assert.deepEqual(stage.idleErasures,[{rule:'empty',document:'case/main.md'}]);
  assert.ok(kinds.gone.effects.includes('counted-parts'));assert.ok(kinds.gone.effects.includes('diagnostics'));
  assert.ok(kinds.choice.effects.includes('derivation-choice'));assert.ok(kinds.warning.effects.includes('diagnostics'));
  assert.ok(kinds.inserted.effects.includes('emission'));
  const text=formatAudit([stage]);assert.match(text,/semantic erasure: gone/);assert.match(text,/inert erasure: empty/);
});

test('the audit lists every erased alternative and respects nested erasure and executed emissions',()=>{
  const stage=inspect('%rule text outer multi closed\n%rule outer inner\n%erased\n%rule inner A\n%erased\n%rule multi ε | A\n%erased\n%rule closed producer\n%erased\n%rule producer child\n%emits\n%rule child ε\n%emits ε :: X');
  assert.equal(stage.erasures.filter(entry=>entry.rule==='multi').length,2);
  assert.equal(stage.erasures.find(entry=>entry.rule==='outer').kind,'inert');
  assert.equal(stage.erasures.find(entry=>entry.rule==='closed').kind,'semantic');
  assert.ok(!stage.idleErasures.some(entry=>entry.rule==='multi'));
});

test('query audit notes distinguish structural and filtered body queries through erased errors',()=>{
  const stage=inspect('%rule text $a:A\n%conditions\n $a.parse(target),\n $a.parse(target …).error-free\n%rule target hidden\n%rule hidden A\n%error "fault"\n%erased\n%check query-only #·target %warning "note"\n%check live #·text %warning "note"');
  const notes=stage.diagnosticNotes.filter(note=>note.kind==='query-error');
  assert.deepEqual(notes.map(note=>[note.target,note.filtered]).sort(),[['hidden',false],['hidden',true]]);
  assert.ok(!stage.unreachable.includes('target'));assert.ok(!stage.unreachable.includes('hidden'));
  assert.ok(stage.unreachable.includes('query-only'));assert.ok(!stage.unreachable.includes('live'));
  const text=formatAudit([stage]);assert.match(text,/allow carried errors/);assert.match(text,/carried errors outside erased parts/);
  assert.doesNotMatch(text,/cannot supply/);
});

test('the erasure effect closure shares dependencies in a long chain',()=>{
  const clauses=Array.from({length:200},(_,index)=>'%rule r'+index+' '+(index===199?'A':'r'+(index+1))).join('\n');
  const stage=inspect('%rule text gone\n%rule gone r0\n%erased\n'+clauses);
  assert.ok(stage.erasures[0].effects.includes('counted-parts'));
});
