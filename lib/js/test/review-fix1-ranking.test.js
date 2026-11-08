import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Measures} from '../src/measures.js';
import {Ranker} from '../src/rank.js';
import {ParseContext,recognize,rootItems} from '../src/earley.js';
import {loadEngineCase,caseTokens,runEngineCase,checkEngineOutcome} from './shared.js';
const fixture=name=>JSON.parse(fs.readFileSync(new URL('../../../tests/engine/deferred-fix1-'+name+'.json',import.meta.url),'utf8'));

// Engine §7.7: own charges use O, while carried charges still follow R.
test('projected error measures exclude synthetic anchors across gaps and unordered sources',()=>{
  for(const sources of [[[0,1],[5,6]],[[10,11],[0,1]]]){
    const original=new Measures(sources.map(source=>({source,errors:[]})));
    const restored=new Measures([{source:sources[0],errors:[]},{source:[sources[0][1],sources[0][1]],errors:[]},{source:sources[1],errors:[]}]);
    restored.original={measures:original,project:[0,1,1,2]};
    assert.deepEqual(restored.own(1,3),[1,0,1]);
    assert.deepEqual(restored.own(1,2),[0,1,1]);
    assert.deepEqual(restored.own(0,3),original.own(0,2));
  }
  const c=fixture('projected-error');checkEngineOutcome(c.expect,runEngineCase(c),'projected reconstruction');
});

// Engine §4.1 and §6: a completed local comparison is not caller demand.
test('local tree comparisons collapse but externally demanded trees stay distinct',()=>{
  const c=fixture('local-tree-demand');checkEngineOutcome(c.expect,runEngineCase(c),'local comparison');
  const demanded=JSON.parse(fs.readFileSync(new URL('../../../tests/engine/deferred-erasure-different-demanded-trees.json',import.meta.url),'utf8'));
  checkEngineOutcome(demanded.expect,runEngineCase(demanded),'caller demand');
});

// Engine §6: the count-only reconstruction path groups erased roots too.
test('erased roots count once without profiles',()=>{
  const {pipeline}=loadEngineCase({grammar:'%rule text a | b\n%erased\n%rule a A\n%rule b A'});
  const lowered=pipeline.stages[0].grammar.lower(new Set()),{tokens}=caseTokens([{text:'a',tags:['A']}]);
  const context=new ParseContext(lowered,tokens,['a'],pipeline.loader.unicode),chart=recognize(context,'text',0,1);
  const ranker=new Ranker(tokens,[], 'none');ranker.configured=true;ranker.interner=context.interner;ranker.space.interner=context.interner;
  assert.equal(ranker.profiles,false);assert.equal(ranker.rank(rootItems(chart,'text')).verdict,'unique');
});
