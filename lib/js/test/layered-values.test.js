import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Grammar} from '../src/grammar.js';
import {loaderWith} from './shared.js';

const cases=JSON.parse(fs.readFileSync(new URL('../../../tests/layered-pattern-values.json',import.meta.url),'utf8'));
const loader=loaderWith({});
const dom=loader.readDocument('```jbogenbau\n%ambiguity-resolution greedy\n%rule text A\n```','values.md');
const grammar=new Grammar('main',[{path:'values.md',dom}],loader.unicode);
const normalize=value=>JSON.parse(JSON.stringify(value,(_key,value)=>value instanceof Set ? [...value].sort() : value));
for(const [name,value] of Object.entries(cases.constants)) grammar.constants.set(name,{type:'pattern' in value?'pattern':'set' in value?'tags':'string',value:'set' in value?{set:new Set(value.set)}:value,document:'values.md'});
for(const c of cases.cases) test('layered value binding: '+c.description,()=>{
  if(c.error) assert.throws(()=>grammar.evaluateClosed('values.md',{pattern:c.pattern},[1,1]),error=>{
    assert.deepEqual([error.where.line,error.where.column],c.error.at);
    return true;
  });
  else assert.deepEqual(normalize(grammar.evaluateClosed('values.md',{pattern:c.pattern},[1,1]).pattern),c.resolved);
});
