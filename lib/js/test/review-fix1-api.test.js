import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadEngineCase} from './shared.js';
import {resultJson} from '../src/output.js';
const pipeline=()=>loadEngineCase({grammar:'%rule text A\n%emits $'}).pipeline;
const diagnostic=()=>({stage:'main',code:'fault',rule:'fault',span:[0,1],source:[0,1],message:'fault',rejection:{token:0,source:[0,1],line:1,column:1,expected:[]}});

// API caller tokens: tags are any iterable, including a one-shot iterator.
test('caller tag iterables are materialized once and retain their tags',()=>{
  let reads=0,iterations=0;
  function* tags(){iterations++;yield 'A';}
  const once=tags(),token={text:'a',span:[0,1],source:[0,1],get tags(){reads++;return once;}};
  const result=pipeline().parse('a',{tokens:[token]});
  assert.equal(result.ok,true);assert.equal(reads,1);assert.equal(iterations,1);assert.deepEqual([...result.stages[0].input[0].tags],['A']);
});

test('a supplied token collection must be an array even when it is null or false',()=>{
  const p=pipeline();
  for(const tokens of [null,false,0,1,'a',{},new Set()])assert.throws(()=>p.parse('a',{tokens}),error=>error.kind==='usage');
  assert.throws(()=>p.parse('a',{tokens:Array(1)}),error=>error.kind==='usage');
  assert.equal(p.parse('a').ok,false); // Character tokens carry no user tag A.
});

// Output diagnostic envelopes: no empty arrays or out-of-schema members.
test('reported diagnostics require a nonempty serialized list and grammar order stays canonical',()=>{
  const result=pipeline().parse('a',{tokens:[{text:'a',tags:['A'],span:[0,1],source:[0,1]}]});
  const empty=resultJson({...result,ok:false,error:{kind:'reported',stage:'main',errors:[],message:'invalid caller shape'}});
  assert.equal(Object.hasOwn(empty.error,'errors'),false);
  const error={kind:'grammar',stage:'main',code:'elision-witness-lost',document:'g.md',errors:[diagnostic()],warnings:[diagnostic()],message:'guard',chosen:result.tree,completion:[]};
  const json=resultJson({...result,ok:false,error});
  assert.deepEqual(Object.keys(json.error),['kind','stage','code','errors','warnings','message','chosen','completion']);
  assert.ok(json.error.errors[0].rejection);assert.equal(Object.hasOwn(json.error.warnings[0],'rejection'),false);
});

test('only errors serialize rejection evidence at every diagnostic location',()=>{
  const result=pipeline().parse('a',{tokens:[{text:'a',tags:['A'],span:[0,1],source:[0,1]}]});
  const d=diagnostic(),token=result.stages[0].output[0];
  token.errors=[d];token.warnings=[d];const {span,...attached}=token;token.before=[attached];
  result.warnings=[d];result.stages[0].errors=[d];result.stages[0].warnings=[d];
  const json=resultJson(result),stage=json.stages[0];
  for(const owner of [stage,stage.output[0],stage.output[0].before[0]]){
    assert.ok(owner.errors[0].rejection);assert.equal(Object.hasOwn(owner.warnings[0],'rejection'),false);
  }
  assert.equal(Object.hasOwn(json.warnings[0],'rejection'),false);
});
