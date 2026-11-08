import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadEngineCase,caseTokens} from './shared.js';
import {ParseContext,recognize} from '../src/earley.js';
import {competitorSlice} from '../src/competitor-rejection.js';

// Engine §12.1: each chart retains the frame table that bound its helpers.
test('competitor evidence uses the original frames after another recognition on the context',()=>{
  const {pipeline,loadError}=loadEngineCase({grammar:'%rule text :: ∅ | bad ≻ good\n%rule bad A\n%error "bad"\n%rule good inner B\n%rule inner :: ∅ | A ≻ C'});
  assert.ifError(loadError);
  const lowered=pipeline.stages[0].grammar.lower(new Set()),{tokens,text}=caseTokens([{text:'a',tags:['A']}]);
  const context=new ParseContext(lowered,tokens,[...text],pipeline.loader.unicode);
  const first=recognize(context,'text',0,1),second=recognize(context,'text',0,1);
  assert.notEqual(first.frames,second.frames);
  for(const chart of [first,second]){
    const option=chart.setAt(0).items.find(item=>item.production.rankedGroup?.parent==='text'&&item.production.rankedOption===0).production;
    assert.deepEqual(competitorSlice(chart,0,1,option),{token:1,source:[1,1],line:1,column:2,expected:[{terminal:'B',rules:['good']}]});
  }
});
