import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Loader,GencmuError} from '../src/node.js';
import {formatCondition} from '../src/diagnostics.js';
import {domProblem} from '../src/dom.js';
import {readDocument} from '../../../tools/bootstrap-reader.js';

const loader=new Loader(path=>{try{return fs.readFileSync(new URL('../../../'+path,import.meta.url),'utf8')}catch{return undefined}});
const document=condition=>'```jbogenbau\n%ambiguity-resolution greedy\n%rule text A\n%conditions '+condition+'\n```\n';

test('body query DOMs agree through the source and bootstrap readers (engine §9)',()=>{
  for(const target of ['A','A …','… A','… A …','A="x"','"a".."z"','_','A | B','A ≻ B','[A]','{A}','ε']){
    const source=document(`$.parse(${target}).error-free`);
    const native=loader.readDocument(source,'probe.md'), hand=readDocument(source,'probe.md');
    assert.deepEqual(native,hand,target);
    assert.equal(domProblem(native,loader.unicode),null,target);
    const condition=native.rules[0].conditions[0];
    assert.equal(condition.method,'error-free');
    assert.equal(condition.receiver.method,'parse');
    assert.ok(condition.receiver.args[0].body);
    const printed=formatCondition(condition,loader.unicode);
    assert.deepEqual(loader.readDocument(document(printed),'probe.md'),native,target);
  }
});

test('body query shape restrictions apply on both source routes (engine §4)',()=>{
  for(const condition of ['$.parse($x:A)','$.parse({$x:A})','$.parse(…)','$.parse(A … B)',
      '$.parse((A …))','$.parse(A).value="x"','$.parse(A) = $.parse(A)','$ .error-free',
      '$.without-elision.parse(… A)']){
    for(const read of [source=>loader.readDocument(source,'probe.md'),source=>readDocument(source,'probe.md')]){
      assert.throws(()=>read(document(condition)),GencmuError,condition);
    }
  }
});

test('preparsed body queries reject nested remainders and capture binders (engine §9)',()=>{
  const valid=loader.readDocument(document('$.parse(A …).error-free'),'probe.md');
  const body=valid.rules[0].conditions[0].receiver.args[0];
  body.body={seq:[{remainder:true},{ref:'A'},{remainder:true}]};
  assert.equal(domProblem(valid,loader.unicode),null,'a remainder at both edges');
  for(const bad of [{remainder:true},
      {seq:[{ref:'A'},{optional:{remainder:true}}]}, {capture:'x',expr:{ref:'A'}},
      {seq:[{ref:'A'},{remainder:true}],extra:true}]){
    body.body=bad;
    assert.notEqual(domProblem(valid,loader.unicode),null,JSON.stringify(bad));
  }
});
