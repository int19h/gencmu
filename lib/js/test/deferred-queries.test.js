import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadEngineCase,caseTokens} from './shared.js';
import {ParseContext,recognize,rootItems} from '../src/earley.js';
import {eligibleWitnesses} from '../src/eligible.js';
import {hooks} from '../src/testing.js';

const diagnostic=(message='fault')=>({stage:'earlier',code:'fault',rule:'fault',span:[0,1],source:[0,1],message});
const pipeline=grammar=>{const loaded=loadEngineCase({grammar});if(loaded.loadError)throw loaded.loadError;return loaded.pipeline;};
const context=(p,tokens)=>new ParseContext(p.stages[0].grammar.lower(new Set()),tokens,[...tokens.map(t=>t.text).join('')],p.loader.unicode);
const tokens=(tags,dirty=[])=>caseTokens(tags.map((tag,index)=>({tags:[tag],text:tag.toLowerCase(),source:[index,index+1],span:[index,index+1]}))).tokens
  .map((token,index)=>{if(dirty.includes(index))token.errors=[diagnostic()];return token});
const accepts=(p,input)=>rootItems(recognize(context(p,input),'text',0,input.length),'text').length!==0;

// Engine §3.10: anonymous bodies retain their symbols and tests.
test('body queries execute whole, prefix, suffix, tested, and anonymous targets',()=>{
  for(const [target,input,expected] of [['A',['A'],true],['A="a"',['A'],true],['A="b"',['A'],false],
      ['A B',['A','B'],true],['A',['A','B'],false],['A …',['A','B'],true],['… B',['A','B'],true],
      ['"a"',['A'],true],['"a".."z"',['A'],true],['_',['A'],true],['A | B',['B'],true],
      ['A ≻ B',['B'],true],['[A]',['A'],true],['{A}',['A','A'],true],['*a',['A'],true],['ε',[],true]]){
    const p=pipeline('%rule text [_] [{_}]\n%conditions $.parse('+target+')\n%rule a A');
    assert.equal(accepts(p,tokens(input)),expected,target);
  }
});

// Engine §4: E, P, and F concern one proof, including erased own errors.
test('query eligibility distinguishes own errors, carried errors, and erased interiors',()=>{
  for(const [body,extra,dirty,ordinary,clean] of [
    ['A','',[],true,true],['A','',[0],true,false],
    ['bad','%rule bad A\n%error "bad"',[],false,false],
    ['erased','%rule erased bad\n%erased\n%rule bad A\n%error "bad"',[],true,true],
    ['erased','%rule erased A\n%erased',[0],true,true],
    ['note A','%rule note ε\n%warning "note"',[],true,true],
    ['cycle','%rule cycle cycle',[],false,false],
    ['erased','%rule erased cycle\n%erased\n%rule cycle cycle',[],false,false],
  ]){
    const p=pipeline('%rule text A\n%rule probe '+body+'\n'+extra),input=tokens(['A'],dirty),c=context(p,input);
    const chart=recognize(c,'probe',0,input.length),witnesses=rootItems(chart,'probe');
    assert.equal(eligibleWitnesses(chart,witnesses).length!==0,ordinary,body+' ordinary');
    assert.equal(eligibleWitnesses(chart,witnesses,true).length!==0,clean,body+' filtered');
  }
});

test('clean forbidden and dirty permitted proofs cannot combine (engine §4)',()=>{
  for(const initial of ['A','clean-a']){
    const p=pipeline('%rule text A B C T U\n%rule probe ['+initial+'] y [+T] C T U\n'+
      '%rule y clean-a B | clean-a B C | B z\n%rule z ε | C T\n%rule clean-a A\n%erased');
    const input=tokens(['A','B','C','T','U'],[0]),c=context(p,input),chart=recognize(c,'probe',0,input.length),witnesses=rootItems(chart,'probe');
    assert.ok(eligibleWitnesses(chart,witnesses).length);
    assert.equal(eligibleWitnesses(chart,witnesses,true).length!==0,initial==='clean-a',initial);
  }
});

test('the filter counts only a prefix or suffix witness (engine §4)',()=>{
  for(const [body,dirty,expected] of [['A …',[1],true],['A …',[0],false],['… B',[0],true],['… B',[1],false],['A B',[1],false]]){
    const p=pipeline('%rule text A B\n%conditions $.parse('+body+').error-free');
    assert.equal(accepts(p,tokens(['A','B'],dirty)),expected,body+' '+dirty);
  }
});

test('equivalent old and body queries share targets and recursive checks (engine §3.10)',()=>{
  const p=pipeline('%rule text A\n%conditions $.matches(a), $.parse((a)), $.parse(a …), $.begins(a)\n%rule a A');
  const lowered=p.stages[0].grammar.lower(new Set());
  assert.deepEqual([...new Set(lowered.queryTargets.values())],['a']);
  const inserted=[];hooks.memoInsert=key=>inserted.push(JSON.parse(key));
  try{assert.ok(accepts(p,tokens(['A'])))}finally{hooks.memoInsert=null}
  assert.equal(inserted.filter(key=>key[2]==='a').length,2);
  const recursive=pipeline('%rule text A\n%conditions $.matches(a)\n%rule a A\n%conditions $.parse(a …)');
  assert.throws(()=>accepts(recursive,tokens(['A'])),/own span parses as a/);
});

test('nested filtered dependencies distinguish shared ordinary answers (engine §4.3)',()=>{
  for(const order of [[false,true],[true,false]]){
    const p=pipeline('%rule text A\n%conditions $.matches(wrapper)\n%rule wrapper A\n%conditions $.parse(A).error-free');
    for(const dirty of [...order,...order])assert.equal(accepts(p,tokens(['A'],dirty?[0]:[])),!dirty,String(dirty));
  }
});

test('an error in a body choice remains reachable after a successful option (engine §4)',()=>{
  const p=pipeline('%rule text A\n%conditions $.parse(A | broken)\n%rule broken A\n%conditions $.parse(broken)');
  assert.throws(()=>accepts(p,tokens(['A'])),/own span parses as broken/);
});

test('resolved constants and grouping share structural targets (engine §3.10)',()=>{
  const p=pipeline('%const $V "a"\n%rule text A B\n%conditions $.parse(A=$V B …), $.parse((A="a" B) …)');
  const grammar=p.stages[0].grammar,lowered=grammar.lower(new Set());
  assert.equal(grammar.queryRules.size,1);
  assert.equal(new Set(lowered.queryTargets.values()).size,1);
  assert.ok(accepts(p,tokens(['A','B'])));
});

test('query-only guard targets include body queries (engine §4.2)',()=>{
  const p=pipeline('%rule text _\n%conditions $.parse(a b)\n%rule a ε :: ($.followed-by(b) ⟹ T)\n%rule b A');
  assert.ok(accepts(p,tokens(['A'])));
});

test('error-free suffixes retain their input window (engine §4.4)',()=>{
  const p=pipeline('%rule text A B\n%conditions $.parse(… tail).error-free\n%rule tail B\n%conditions $.preceding-tokens.parse(A)');
  assert.ok(accepts(p,tokens(['A','B'],[0])));
  assert.equal(accepts(p,tokens(['A','B'],[1])),false);
});
