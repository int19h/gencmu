import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadEngineCase} from './shared.js';

const load=grammar=>loadEngineCase({grammar});

// Engine §3.6: the test ignores reachability, gates, conditions, and tests.
test('nullable error alternatives fail before feature filtering',()=>{
  for(const body of ['ε','[A]','[+A]','empty','*empty','$x:empty','empty<Wrong>','A | empty',
      'empty ≻ A','A & empty']){
    const outcome=load('%rule text A\n%rule empty ε\n%rule bad '+body+' :: ∅\n%error "bad"');
    assert.equal(outcome.loadError?.kind,'grammar',body);
    assert.match(outcome.loadError.message,/error production of bad can match no tokens/,body);
  }
  for(const clause of ['\n%conditions ∅ = A','\n%erased','', '\n%conditions $.ends-input']){
    const outcome=load('%rule text A\n%rule bad ε'+(clause==='\n%erased'?'\n%error "bad"'+clause:clause+'\n%error "bad"'));
    assert.match(outcome.loadError?.message??'',/error production of bad/,clause);
  }
  const gated=load('%features hidden\n%rule text A\n%rule bad hidden? ε\n%error "bad"');
  assert.match(gated.loadError?.message??'',/error production of bad/);
});

test('the nullable fixed point handles recursive and spliced calls',()=>{
  for(const body of ['one','*one']){
    const rejected=load('%rule text A\n%rule bad '+body+' :: ∅\n%error "bad"\n%rule one two\n%rule two one | ε');
    assert.match(rejected.loadError?.message??'',/error production of bad/);
    const accepted=load('%rule text A\n%rule bad '+body+' :: ∅\n%error "bad"\n%rule one two\n%rule two one');
    assert.equal(accepted.loadError,undefined,body);
  }
});

test('warnings and positive-width errors remain legal',()=>{
  for(const body of ['A','""','_','"a".."z"','[A] B','{A}','A & B','A ≻ B']){
    assert.equal(load('%rule text A\n%rule bad '+body+' :: ∅\n%error "bad"').loadError,undefined,body);
  }
  assert.equal(load('%rule text note A\n%rule note ε\n%warning "note"').loadError,undefined);
});

test('stitching controls the error alternatives and their diagnostic order',()=>{
  assert.equal(load('%rule text A\n%rule bad ε\n%error "old"\n%redefine-rule bad A').loadError,undefined);
  const extended=load('%rule text A\n%rule bad A\n%extend-rule bad [A]\n%error "bad"');
  assert.match(extended.loadError?.message??'',/error production of bad/);
  const ordered=load('%rule text A\n%rule first A\n%rule second ε\n%error "second"\n%extend-rule first ε\n%error "first"');
  assert.match(ordered.loadError?.message??'',/error production of first/);
});

test('ordinary grammar errors precede the nullable error test',()=>{
  const result=load('%rule text A\n%rule bad ε\n%error "bad"\n%rule missing $x:A\n%emits $absent');
  assert.ok(result.loadError);
  assert.doesNotMatch(result.loadError.message,/can match no tokens/);
});

test('nullable-error dependencies do not recurse through a long call chain',()=>{
  const rules=['%rule text A','%rule bad r0\n%error "bad"'];
  for(let index=0;index<1200;index++)rules.push('%rule r'+index+' '+(index===1199?'ε':'r'+(index+1)));
  assert.match(load(rules.join('\n')).loadError?.message??'',/error production of bad/);
});
