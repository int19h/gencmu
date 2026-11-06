import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runEngineCase} from './shared.js';

// Engine §7.10: competitor order differs from a tie's divergence order.
test('reconstruction picks the T-first competitor rather than earliest divergence',()=>{
  const grammar='%ambiguity-resolution greedy\n%elision-only\n%rule text head tail | other\n%rule head "a"\n%rule tail [+T] | T\n%rule other "a" T';
  const result=runEngineCase({grammar,input:'a'});
  assert.equal(result.json.error?.reason,'elision-only',JSON.stringify(result.json));
  assert.equal(result.json.error.readings[0].children[0].rule,'head');
  assert.equal(result.json.error.readings[1].children[0].rule,'head');
  assert.equal(result.json.error.readings[1].children[1].rule,'tail');
  assert.equal(result.lostWitnesses,0);
});

test('competitor substitution preserves the witness prefix and suffix',()=>{
  const grammar='%ambiguity-resolution greedy\n%elision-only\n%rule text start middle end | other\n%rule start "a"\n%rule middle head tail\n%rule head "b"\n%rule tail [+T] | T\n%rule end "c"\n%rule other start elsewhere end\n%rule elsewhere "b" T';
  const result=runEngineCase({grammar,input:'abc'});
  assert.equal(result.json.error?.reason,'elision-only',JSON.stringify(result.json));
  assert.deepEqual(result.json.error.readings[1].children.map(node=>node.rule),['start','middle','end']);
  assert.deepEqual(result.json.error.readings[1].children[1].children.map(node=>node.rule),['head','tail']);
  assert.equal(result.lostWitnesses,0);
});

test('competitor substitution keeps contextual ranked frames',()=>{
  const grammar='%ambiguity-resolution greedy\n%elision-only\n%rule text (group ≻ other) :: ∅\n%rule group head tail\n%rule head "a"\n%rule tail [+T] | T\n%rule other "a" T';
  const result=runEngineCase({grammar,input:'a'});
  assert.equal(result.json.error?.reason,'elision-only',JSON.stringify(result.json));
  assert.equal(result.json.error.readings[1].children[0].rule,'group');
  assert.deepEqual(result.json.error.readings[1].children[0].children.map(node=>node.rule),['head','tail']);
  assert.equal(result.lostWitnesses,0);
});
