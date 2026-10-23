import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {engineRead,handRead,withoutPositions,printPattern,prefix,recognitionRules} from './layered-reader.js';
import {layeredPatternProblem} from '../src/pattern-shapes.js';
import {hooks} from '../src/testing.js';

const cases=JSON.parse(fs.readFileSync(new URL('../../../tests/layered-pattern-reader.json',import.meta.url),'utf8')).cases;
const printing=JSON.parse(fs.readFileSync(new URL('../../../tests/layered-patterns.json',import.meta.url),'utf8')).printing;
const start=[...prefix.split('\n').at(-1)].length+1;
for(const c of cases) test('layered reader: '+c.description,()=>{
  const engine=engineRead(c.source),hand=handRead(c.source);
  if(c.pattern) {
    assert.deepEqual(withoutPositions(engine.pattern),c.pattern,JSON.stringify(engine.error));
    assert.deepEqual(hand.pattern,engine.pattern,JSON.stringify(hand.error));
    assert.equal(layeredPatternProblem(engine.pattern),null);
    const roundtrip=engineRead(printPattern(engine.pattern));
    assert.deepEqual(withoutPositions(roundtrip.pattern),c.pattern);
  } else for(const result of [engine,hand]) {
    assert.ok(result.error,'the reader accepted malformed text');
    assert.equal(result.error.phase,c.error.phase);
    assert.deepEqual([result.error.line,result.error.column],[3,start+c.error.offset]);
  }
});
for(const c of printing) test('layered reader round trip: '+c.description,()=>{
  const engine=engineRead(c.text),hand=handRead(c.text);
  assert.deepEqual(withoutPositions(engine.pattern),withoutPositions(c.pattern),JSON.stringify(engine.error));
  assert.deepEqual(hand.pattern,engine.pattern,JSON.stringify(hand.error));
  assert.equal(printPattern(engine.pattern),c.text);
});
test('layered atom positions exclude their prefix and retain the opening quote',()=>{
  const node=engineRead('#·a« b »').pattern;
  assert.deepEqual(node.at,[3,start+2]);
  assert.deepEqual(node.children[0].child.at,[3,start+5]);
  assert.deepEqual(engineRead('#"a"').pattern.at,[3,start+1]);
  assert.deepEqual(engineRead('#·a').pattern.at,[3,start+2]);
});
test('the bootstrap reader remembers child groups before trying sequences',()=>{
  const before=hooks.work;
  try {
    const counts=[];
    for(const depth of [128,256,512]) {
      hooks.work={walkSteps:0,items:0,...(counts.length ? {budget:{walkSteps:counts[0]*5}} : {})};
      const result=handRead('#« '+'('.repeat(depth)+'a'+')'.repeat(depth)+' »');
      assert.deepEqual(withoutPositions(result.pattern),{any:true,children:[{child:{name:'a'}}]},JSON.stringify(result.error));
      counts.push(hooks.work.walkSteps);
    }
    assert.ok(counts[2]<counts[0]*5,JSON.stringify(counts));
  } finally {hooks.work=before;}
});

test('the native recognition fixture matches the candidate grammar',()=>{
  const stored=JSON.parse(fs.readFileSync(new URL('../../../tests/fixtures/layered-patterns/recognition.json',import.meta.url),'utf8'));
  assert.deepEqual(stored,recognitionRules());
});

test('the engine reader handles deep groups and wide child lists within a bounded work budget',()=>{
  const before=hooks.work;
  try {
    for(const kind of ['groups','siblings']) {
      let baseline;
      for(const size of [128,256,512]) {
        const body=kind==='groups' ? '('.repeat(size)+'a'+')'.repeat(size) : Array(size).fill('a').join(' ');
        hooks.work={walkSteps:0,items:0,budget:{walkSteps:baseline ? baseline*5 : 1000000}};
        const result=engineRead('#« '+body+' »');
        assert.equal(result.pattern?.children.length,kind==='groups' ? 1 : size,JSON.stringify(result.error));
        baseline ??=hooks.work.walkSteps;
      }
    }
  } finally {hooks.work=before;}
});

for(const c of JSON.parse(fs.readFileSync(new URL('../../../tests/layered-pattern-reader.json',import.meta.url),'utf8')).constructors) {
  test('supplied layered constructors: '+c.description,()=>{
    const engine=engineRead(c.source,c.omit),hand=handRead(c.source,c.omit);
    assert.deepEqual(withoutPositions(engine.pattern),c.pattern,JSON.stringify(engine.error));
    assert.deepEqual(hand.pattern,engine.pattern,JSON.stringify(hand.error));
  });
}
