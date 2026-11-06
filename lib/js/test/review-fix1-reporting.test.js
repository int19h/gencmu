import {test} from 'node:test';
import assert from 'node:assert/strict';
import {caseTokens,loadEngineCase} from './shared.js';
import {ParseContext,recognize} from '../src/earley.js';
import {competitorSlice} from '../src/competitor-rejection.js';
import {explainError,sourceExcerpt} from '../src/diagnostics.js';
import {lineIndex,positionAt} from '../src/source-lines.js';
import {assertLinearWork,countedWork} from './linear.js';

// Engine §12.1: only reached competitors evaluate their skipped predictions.
test('competitor evidence evaluates reached predictions once and reuses its source index',()=>{
  const grammar='%rule text :: ∅ | (good ≻ bad) C\n%extend-rule text unrelated\n%rule good A wanted\n%rule wanted K\n%rule bad A B\n%error "bad"\n%rule unrelated A B unwanted\n%rule unwanted Z';
  const {pipeline,loadError}=loadEngineCase({grammar});assert.ifError(loadError);
  const lowered=pipeline.stages[0].grammar.lower(new Set()),{tokens}=caseTokens([{text:'a',tags:['A']},{text:'b',tags:['B']},{text:'c',tags:['C']}]);
  const context=new ParseContext(lowered,tokens,[...'a\r\nb\nc'+'\nx'.repeat(2000)],pipeline.loader.unicode);
  const chart=recognize(context,'text',0,tokens.length);
  let wanted=0,unwanted=0;
  for(const production of new Set([...lowered.productions,...chart.sets.flatMap(set=>set.items.map(item=>item.production))])){
    if(!['wanted','unwanted'].includes(production.lhs))continue;
    const conditions=production.conditionsAt;
    Object.defineProperty(production,'conditionsAt',{get(){if(production.lhs==='wanted')wanted++;else unwanted++;return conditions;}});
  }
  const option=chart.sets[2].items.find(i=>i.production.rankedGroup&&i.production.rankedOption===1).production;
  let evidence;
  const first=countedWork(()=>evidence=competitorSlice(chart,0,2,option));
  assert.deepEqual(evidence.expected,[{terminal:'K',rules:['wanted']}]);
  assert.equal(wanted,1);assert.equal(unwanted,0);
  const second=countedWork(()=>competitorSlice(chart,0,2,option));
  assert.ok(first.text>8000);assert.ok(second.text<20);
});

// Output, Renderings: all diagnostic excerpts share one index of the text.
test('error explanations scan the text once across named errors and rejection evidence',()=>{
  assertLinearWork('named error excerpts',300,n=>{
    const errors=Array.from({length:n},(_,i)=>({code:'fault',stage:'main',rule:'bad',span:[i,i+1],source:[2*i,2*i+1],message:'bad',rejection:{token:i,source:[2*i,2*i+1],line:i+1,column:1,expected:[]}}));
    const result={text:'x\n'.repeat(n),stages:[],error:{kind:'reported',stage:'main',errors,message:'bad'}};
    return ()=>assert.match(explainError(result),/Error fault/);
  },['text']);
});

test('source positions and excerpts agree for scalar offsets and line endings',()=>{
  const text='🙂\r\nx\ry\nz',index=lineIndex(text);
  for(const offset of [0,3,5,7]){
    const {line,column}=positionAt(index,offset);
    assert.deepEqual({line,column},(({line,column})=>({line,column}))(sourceExcerpt(text,[offset,offset+1])));
  }
  assert.deepEqual(positionAt(index,3),{line:2,column:1,lineStart:3});
});
