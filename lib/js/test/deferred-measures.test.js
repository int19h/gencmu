import {test} from 'node:test';
import assert from 'node:assert/strict';
import {caseTokens,loadEngineCase} from './shared.js';
import {ParseContext,recognize,rootItems} from '../src/earley.js';
import {Ranker,derivationTree} from '../src/rank.js';
import {RankedAdmission} from '../src/ranked-admission.js';
import {Measures,ZERO_MEASURE,sumMeasure,compareMeasure,recordDiagnostic,diagnosticRecord,copyDiagnosticRecord} from '../src/measures.js';

function rank(grammar,input){
  const loaded=loadEngineCase({grammar});
  if(loaded.loadError)throw loaded.loadError;
  const lowered=loaded.pipeline.stages[0].grammar.lower(new Set());
  const {tokens}=caseTokens(input);
  const context=new ParseContext(lowered,tokens,[],loaded.pipeline.loader.unicode);
  const chart=recognize(context,'text',0,tokens.length);
  const ranker=new Ranker(tokens,lowered.resolution.steps,lowered.resolution.lean);
  ranker.interner=context.interner;ranker.space.interner=context.interner;
  if(lowered.ranked.groups.length)ranker.admission=new RankedAdmission(chart,lowered.ranked);
  const ranking=ranker.rank(rootItems(chart,'text'));
  return {ranking,tree:ranking&&derivationTree(ranking.first),ranker};
}
const token=(tag,source)=>({text:tag.toLowerCase(),tags:[tag],source});
const chosen=result=>result.tree.children[0].production.lhs;

// Engine §6: fixed additive blame precedes every grammar preference.
test('source blame beats a shorter error count and grammar preferences',()=>{
  const result=rank('%ambiguity-resolution most #·long\n%rule text long | short short\n%rule long A A %error "long"\n%rule short A %error "short"',[token('A',[0,1]),token('A',[1,2])]);
  assert.equal(chosen(result),'short');
  assert.equal(result.ranking.verdict,'unique');
  assert.deepEqual(result.ranking.profile.slice(0,3),[2,0,2]);
  const shorter=rank('%rule text long | short A\n%rule long A A %error "long"\n%rule short A %error "short"',[token('A',[0,1]),token('A',[1,2])]);
  assert.equal(chosen(shorter),'short');
  assert.deepEqual(shorter.ranking.profile.slice(0,3),[1,0,1]);
});

test('overlapping error sources add rather than form a union',()=>{
  const result=rank('%rule text nested | one\n%rule nested one %error "outer"\n%rule one A %error "inner"',[token('A',[3,7])]);
  assert.equal(chosen(result),'one');
  assert.deepEqual(result.ranking.profile.slice(0,3),[4,0,1]);
});

test('sourceless error tests tokens rather than their source envelope',()=>{
  const input=caseTokens([token('A',[2,2]),token('B',[9,9]),token('C',[7,8])]).tokens;
  const measures=new Measures(input);
  assert.deepEqual(measures.own(0,2),[0,1,1]);
  assert.deepEqual(measures.own(0,3),[7,0,1]);
  const result=rank('%rule text bad | good\n%rule bad A %error "bad"\n%rule good A',[token('A',[2,2])]);
  assert.equal(chosen(result),'good');
  assert.equal(result.ranking.verdict,'unique');
  assert.deepEqual(result.ranking.profile.slice(0,3),[0,0,0]);
});

test('sourceless errors lose to clean and beat any blamed source point',()=>{
  const result=rank('%rule text empty-source B | A blamed\n%rule empty-source A %error "empty source"\n%rule blamed B %error "blamed"',[token('A',[7,7]),token('B',[7,8])]);
  assert.equal(chosen(result),'empty-source');
  assert.deepEqual(result.ranking.profile.slice(0,3),[0,1,1]);
  const many=sumMeasure([0,1000,1000],[0,1000,1000]);
  assert.equal(compareMeasure(many,[1,0,1]),-1);
  assert.equal(compareMeasure(ZERO_MEASURE,many),-1);
});

test('ranked admission retains a lower option with a better measure',()=>{
  const result=rank('%rule text (long ≻ small A) :: ∅\n%rule long A A %error "long"\n%rule small A %error "small"',[token('A',[0,1]),token('A',[1,2])]);
  assert.deepEqual(result.ranking.profile.slice(0,3),[1,0,1]);
  assert.equal(result.ranking.verdict,'unique');
  const divided=rank('%rule text (long ≻ small small) :: ∅\n%rule long A A %error "long"\n%rule small A %error "small"',[token('A',[0,1]),token('A',[1,2])]);
  assert.deepEqual(divided.ranking.profile.slice(0,3),[2,0,2]);
});

test('fixed carried charges and identity survive copies and public mutation',()=>{
  const original={source:[0,4],message:'fault'},identity={};
  recordDiagnostic(original,[4,0,1],identity);
  const copy={...original,source:[100,200]};
  copyDiagnosticRecord(original,copy);
  original.source[1]=1000;
  const tokens=caseTokens([token('A',[99,100])]).tokens;
  tokens[0].errors=[copy];
  assert.deepEqual(new Measures(tokens).carried[0],[4,0,1]);
  assert.equal(diagnosticRecord(copy).identity,identity);
  assert.equal(diagnosticRecord(original),diagnosticRecord(copy));
  assert.deepEqual(Object.keys(copy),['source','message']);
});

test('measure addition keeps arbitrarily large exact counts',()=>{
  const large=Number.MAX_SAFE_INTEGER;
  assert.deepEqual(sumMeasure([large,large,large],[1,1,1]),[BigInt(large)+1n,BigInt(large)+1n,BigInt(large)+1n]);
  assert.equal(compareMeasure([0,0,4],[0,0,3]),-1);
});

// Engine §6: a direct read adds its stored charge, without new messages.
test('carried errors enter profiles and verdict totals without own errors',()=>{
  const diagnostic={source:[0,8],message:'earlier'};
  recordDiagnostic(diagnostic,[8,0,1]);
  const input={...token('A',[4,5]),errors:[diagnostic]};
  const result=rank('%ambiguity-resolution fewest #·two\n%rule text one | two\n%rule one A\n%rule two A', [input]);
  assert.deepEqual(result.ranking.profile.slice(0,3),[8,0,1]);
  assert.equal(result.ranking.verdict,'resolved');
  assert.equal(chosen(result),'one');
});

test('own charges use constant source reads after preprocessing (engine §6)',()=>{
  const input=caseTokens(Array.from({length:1000},(_,index)=>token('A',[index,index+1]))).tokens;
  let reads=0;
  for(const item of input){
    const source=item.source;
    Object.defineProperty(item,'source',{get(){reads++;return source;}});
  }
  const measures=new Measures(input);
  measures.own(0,input.length);
  reads=0;
  for(let end=1;end<=input.length;end++)assert.deepEqual(measures.own(0,end),[end,0,1]);
  assert.ok(reads<=2*input.length,reads+' source reads');
});
