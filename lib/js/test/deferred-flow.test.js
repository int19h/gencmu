import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadEngineCase,caseTokens} from './shared.js';
import {ParseContext,recognize,rootItems} from '../src/earley.js';
import {Ranker,derivationTree} from '../src/rank.js';
import {emit,evaluateDiagnostics} from '../src/stage.js';
import {DiagnosticFlow,tiedDiagnostics} from '../src/diagnostic-flow.js';
import {Measures,recordDiagnostic,diagnosticRecord} from '../src/measures.js';
import {GencmuError} from '../src/errors.js';
import {hooks} from '../src/testing.js';

function prepare(grammar,tags=['A'],carried=[],stage='later',order=1,input=null){
  const loaded=loadEngineCase({grammar});if(loaded.loadError)throw loaded.loadError;
  let {tokens,text}=caseTokens(tags.map(tag=>({text:tag.toLowerCase(),tags:[tag]})));
  if(input)tokens=input;
  for(const {at,errors=[],warnings=[]}of carried){tokens[at].errors=errors;tokens[at].warnings=warnings;}
  const lowered=loaded.pipeline.stages[0].grammar.lower(new Set());
  const context=new ParseContext(lowered,tokens,[...text],loaded.pipeline.loader.unicode);
  const ranker=new Ranker(tokens,lowered.resolution.steps,lowered.resolution.lean);ranker.interner=context.interner;ranker.space.interner=context.interner;
  const ranking=ranker.rank(rootItems(recognize(context,'text',0,tokens.length),'text'));
  assert.ok(ranking);
  const flow=new DiagnosticFlow(derivationTree(ranking.first),tokens);
  const features=new Set(loaded.pipeline.features.filter(f=>f.kind==='warning').map(f=>f.name));
  return {flow,context,features,stage,order,ranking};
}
function run(...args){const p=prepare(...args);evaluateDiagnostics(p.flow,p.context,p.features,p.stage,p.order);const output=emit(p.flow.root,p.context,p.flow),pending=p.flow.assign();return {...p,output,pending};}
const codes=list=>list.map(d=>d.code);
function earlier(code='earlier',kind='errors',ordinal=0){
  const diagnostic={stage:'before',code,rule:code,span:[0,1],source:[0,1],message:code};
  recordDiagnostic(diagnostic,kind==='errors'?[1,0,1]:[0,0,0],{stageOrder:0,ordinal});return diagnostic;
}

// Engine §11.5: shared counted input gives one carrier.
test('covering and merging retain fixed diagnostics from unlisted input',()=>{
  const fault=earlier();
  const result=run('%rule text $w:word\n%emits $w\n%rule word A B',['A','B'],[{at:0,errors:[fault]}]);
  assert.deepEqual(codes(result.output[0].errors),['earlier']);
  assert.equal(diagnosticRecord(result.output[0].errors[0]).measure[0],1);
  assert.deepEqual(result.output[0].span,[0,2]);
});

test('an empty own warning follows its yielding ancestor including inserted tokens',()=>{
  const result=run('%rule text note A\n%emits ε :: X\n%rule note ε\n%warning "note"');
  assert.deepEqual(codes(result.output[0].warnings),['note']);
  assert.deepEqual(result.output[0].span,[1,1]);
});

test('an unlisted gap uses the next stage token or the last stage token',()=>{
  for(const body of ['A word','word A']){
    const at=body.startsWith('A')?0:1;
    const result=run('%rule text '+body+'\n%rule word B\n%emits $',body.startsWith('A')?['A','B']:['B','A'],[{at,warnings:[earlier('gap','warnings')]}]);
    assert.deepEqual(codes(result.output[0].warnings),['gap']);
  }
});

test('erasure drops own and carried diagnostics after evaluating own messages',()=>{
  const seen=[];hooks.diagnosticMessage=node=>seen.push(node.production.lhs);
  try{
    const result=run('%rule text gone B\n%rule gone A\n%warning "gone"\n%erased',['A','B'],[{at:0,errors:[earlier()]}]);
    assert.deepEqual(seen,['gone']);assert.deepEqual(result.flow.collected(),{errors:[],warnings:[]});
    assert.deepEqual(result.pending,{errors:[],warnings:[]});
  }finally{hooks.diagnosticMessage=null;}
});

test('a successful empty output retains diagnostics at stage level',()=>{
  const result=run('%rule text A\n%error "fault"');
  assert.deepEqual(result.output,[]);assert.deepEqual(codes(result.pending.errors),['text']);
});

test('attachments display diagnostics while their ordinary carrier counts them',()=>{
  const result=run('%rule text $a:annotation $w:word\n%emits ($a) $w\n%rule annotation A\n%warning "annotation"\n%emits $\n%rule word B\n%error "word"',['A','B']);
  assert.deepEqual(codes(result.output[0].errors),['word']);
  assert.deepEqual(codes(result.output[0].warnings),['annotation']);
  assert.deepEqual(codes(result.output[0].before[0].warnings),['annotation']);
  assert.equal(diagnosticRecord(result.output[0].warnings[0]).identity,diagnosticRecord(result.output[0].before[0].warnings[0]).identity);
});

test('an attachment capture without output gives its reports to the carrier',()=>{
  const result=run('%rule text $a:annotation $w:word\n%emits ($a) $w\n%rule annotation A\n%warning "annotation"\n%rule word B',['A','B']);
  assert.deepEqual(result.output[0].before,[]);assert.deepEqual(codes(result.output[0].warnings),['annotation']);
});

test('suppression applies to own warnings and preserves carried warnings',()=>{
  const result=run('%rule text marked\n%suppress-warnings marked\n%rule marked A\n%warning "own"\n%emits $',['A'],[{at:0,warnings:[earlier('carried','warnings')]}]);
  assert.deepEqual(codes(result.output[0].warnings),['carried']);
});

test('message failure preserves the evaluated prefix and evaluates no later occurrence',()=>{
  const p=prepare('%rule text first second\n%rule first A\n%warning "first"\n%rule second B\n%warning "second"',['A','B']);
  hooks.diagnosticMessage=node=>{if(node.production.lhs==='second')throw new GencmuError('grammar','message guard');};
  try{assert.throws(()=>evaluateDiagnostics(p.flow,p.context,p.features,p.stage),GencmuError);assert.deepEqual(codes(p.flow.messages().warnings),['first']);}
  finally{hooks.diagnosticMessage=null;}
});

test('tie collection deduplicates carried identities and keeps maximum own multiplicity',()=>{
  const p=prepare('%rule text note note A\n%rule note ε\n%warning "note"',['A'],[{at:0,warnings:[earlier('carried','warnings')]}]);
  evaluateDiagnostics(p.flow,p.context,p.features,'later');
  const q=prepare('%rule text note A\n%rule note ε\n%warning "note"',['A'],[{at:0,warnings:[p.context.tokens[0].warnings[0]]}]);
  evaluateDiagnostics(q.flow,q.context,q.features,'later');
  assert.deepEqual(codes(tiedDiagnostics(p.flow.events(),q.flow.events()).warnings),['note','note','carried']);
});

test('shared counted support wins before an inserted fallback owner',()=>{
  const result=run('%rule text A\n%warning "root"\n%emits ε :: X, $');
  assert.deepEqual(result.output.map(token=>codes(token.warnings)),[[],['text']]);
});

test('a carrier without counted support keeps its actual token span',()=>{
  const result=run('%rule text $a:gone note $w:word\n%emits $a, $w\n%rule gone A\n%erased\n%rule note ε\n%warning "note"\n%rule word B',['A','B']);
  assert.deepEqual(result.output[0].span,[0,1]);
  assert.deepEqual(result.output.map(token=>codes(token.warnings)),[['note'],[]]);
});

test('carrier warnings precede attachment warnings from an earlier stage',()=>{
  const old=earlier('old','warnings');
  const first=run('%rule text $a:annotation $w:word\n%emits ($a) $w\n%rule annotation A\n%warning "annotation"\n%emits $\n%rule word B\n%warning "word"',['A','B'],[{at:0,warnings:[old]}]);
  assert.deepEqual(codes(first.output[0].warnings),['word','old','annotation']);
  const p=prepare('%rule text B\n%warning "current"\n%emits $',['B'],[],'last',2,first.output);
  evaluateDiagnostics(p.flow,p.context,p.features,p.stage,p.order);
  const output=emit(p.flow.root,p.context,p.flow);p.flow.assign();
  assert.deepEqual(codes(output[0].warnings),['word','text','old','annotation']);
  assert.deepEqual(codes(output[0].before[0].warnings),['old','annotation']);
  assert.equal(p.flow.collected().warnings.length,4);
});

test('attachment display copies add no independent charge on forwarding',()=>{
  const first=run('%rule text $a:annotation $w:word\n%emits ($a) $w\n%rule annotation A\n%error "annotation"\n%emits $\n%rule word B\n%error "word"',['A','B']);
  assert.deepEqual(new Measures(first.output).carried[0],[2,0,2]);
  const p=prepare('%rule text B\n%error "current"\n%emits $',['B'],[],'last',2,first.output);
  assert.deepEqual(p.ranking.profile.slice(0,3),[3,0,3]);
});
