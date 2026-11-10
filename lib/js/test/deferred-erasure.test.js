import {test} from 'node:test';
import assert from 'node:assert/strict';
import {caseTokens,loadEngineCase,runEngineCase} from './shared.js';
import {ParseContext,recognize,rootItems,workingStructure} from '../src/earley.js';
import {Ranker,derivationTree} from '../src/rank.js';
import {restorationForest} from '../src/restoration-forest.js';
import {RankedAdmission} from '../src/ranked-admission.js';
import {derivationIdentity,treeStep,TreeIdentities} from '../src/tree-identities.js';

function rank(grammar,tags=['A']){
  const loaded=loadEngineCase({grammar});if(loaded.loadError)throw loaded.loadError;
  const lowered=loaded.pipeline.stages[0].grammar.lower(new Set());
  const {tokens}=caseTokens(tags.map(tag=>({text:tag.toLowerCase(),tags:[tag]})));
  const context=new ParseContext(lowered,tokens,[],loaded.pipeline.loader.unicode);
  const chart=recognize(context,'text',0,tokens.length),ranker=new Ranker(tokens,lowered.resolution.steps,lowered.resolution.lean);
  ranker.erasures.closes=context.closes;ranker.restorationForest=restorationForest(chart);
  ranker.interner=context.interner;ranker.space.interner=context.interner;
  if(lowered.ranked.groups.length)ranker.admission=new RankedAdmission(ranker.restorationForest?.chart??chart,lowered.ranked);
  const ranking=ranker.rank(rootItems(chart,'text'));
  return {ranking,tree:ranking&&derivationTree(ranking.first),context,chart,ranker,stage:loaded.pipeline.stages[0]};
}
function find(root,name){const pending=[root];while(pending.length){const n=pending.pop();if(!('read'in n)){if(n.production.lhs===name)return n;for(const child of n.children)pending.push(child)}}}

// Engine §6: erase equal observable completions, including unused bindings.
test('erased interiors collapse across productions and private captures',()=>{
  for(const body of ['[A] [A] :: ∅','[$x:A] [A] :: ∅','first | second']){
    const result=rank('%rule text gone\n%rule gone '+body+'\n%erased\n%rule first A\n%rule second A');
    assert.equal(result.ranking.verdict,'unique',body);
    assert.deepEqual(result.ranking.profile.slice(0,3),[0,0,0]);
  }
});

test('the canonical channel retains prefixes until a continuation settles them',()=>{
  const result=rank('%rule text gone\n%rule gone x y\n%erased\n%rule x a | a b\n%rule a ε\n%rule b ε\n%rule y ε',[]);
  assert.equal(result.ranking.verdict,'unique');
  assert.equal(find(result.tree,'x').children.length,2);
});

test('a live and an erased parent use different choices over shared items',()=>{
  const result=rank('%ambiguity-resolution fewest #·a\n%rule text gone B live\n%rule gone choices\n%erased\n%rule live choices\n%rule choices a | b\n%rule a A\n%rule b A',['A','B','A']);
  assert.equal(result.ranking.verdict,'resolved');
  assert.ok(find(find(result.tree,'gone'),'a'));
  assert.ok(find(find(result.tree,'live'),'b'));
});

test('an erased interior chooses its measure before canonical actions',()=>{
  const result=rank('%rule text gone\n%rule gone bad | A\n%erased\n%rule bad A\n%error "bad"');
  assert.equal(result.ranking.verdict,'unique');
  assert.equal(find(result.tree,'bad'),undefined);
  assert.deepEqual(result.ranking.profile.slice(0,3),[0,0,0]);
});

test('grammar key steps see an erased root and no proper descendant',()=>{
  const body='%rule text gone | other\n%rule gone a\n%erased\n%rule a A\n%rule other A';
  assert.equal(rank('%ambiguity-resolution fewest #·a\n'+body).ranking.verdict,'tie');
  const root=rank('%ambiguity-resolution most #·gone\n'+body);
  assert.equal(root.ranking.verdict,'resolved');assert.ok(find(root.tree,'gone'));
});

test('root tags separate erased classes while sealed identities merge interiors',()=>{
  assert.equal(rank('%ambiguity-resolution fewest #·never\n%rule text gone\n%rule gone A :: One | A :: Two\n%erased\n%rule never B').ranking.verdict,'tie');
  const grammar='%ambiguity-resolution fewest #·never\n%rule text $x:gone $y:gone\n%conditions $x ≅ $y\n%rule gone a | b\n%erased\n%rule a A\n%rule b A\n%rule never B';
  assert.equal(rank(grammar,['A','A']).ranking.verdict,'unique');
});

test('erased and live extensions never collapse together',()=>{
  assert.equal(rank('%ambiguity-resolution fewest #·never\n%rule text gone\n%rule gone A\n%erased\n%extend-rule gone A\n%rule never B').ranking.verdict,'tie');
});

test('erased collapse preserves same-span cycle exclusion',()=>{
  const result=rank('%rule text gone\n%rule gone gone | A\n%erased');
  assert.equal(result.ranking.verdict,'unique');
  assert.equal(find(result.tree,'gone').children.length,1);
  assert.ok('read' in find(result.tree,'gone').children[0]);
});

test('reconstruction can keep a different interior of the same erased class',()=>{
  const result=runEngineCase({grammar:'%ambiguity-resolution greedy\n%elision-only\n%rule text gone\n%rule gone "a" T | "a" [+T]\n%erased',input:'a'});
  assert.equal(result.json.ok,true,JSON.stringify(result.json));
  assert.equal(result.lostWitnesses,0);
});

// Engine §7.10: an admitted reading uses its class's kept interior.
test('an elision ambiguity shows the canonical member of the witness class',()=>{
  for(const resolution of ['greedy','fewest #·gone, greedy']){
    const grammar='%ambiguity-resolution '+resolution+'\n%elision-only\n%rule text gone | competitor\n%rule gone first | second\n%erased\n%rule first "a" T\n%rule second "a" [+T]\n%rule competitor "a" T';
    const result=runEngineCase({grammar,input:'a'});
    assert.equal(result.json.error?.reason,'elision-only',JSON.stringify(result.json));
    assert.equal(result.json.error.readings[0].children[0].rule,'gone');
    assert.equal(result.json.error.readings[0].children[0].children[0].rule,'first');
    assert.equal(result.json.error.readings[1].children[0].rule,'competitor');
    assert.equal(result.lostWitnesses,0);
  }
});

test('class membership survives an interior with a better measure',()=>{
  const result=rank('%elision-only\n%rule text gone\n%rule gone "a" T | bad [+T]\n%erased\n%rule bad "a"\n%error "bad"');
  const report=result.stage.run(result.context.tokens,[],result.context.unicode,{features:new Set(),elisionOnly:false});
  const checked=result.stage.elisionCheck(result.tree,report.tree,result.context,new Set());
  assert.equal(checked.kind,'pass');
});

test('canonical erased interiors obey ranked admission and lexical frames',()=>{
  const result=rank('%rule text gone\n%rule gone A (b ≻ c) :: ∅\n%erased\n%rule b B\n%rule c B',['A','B']);
  assert.equal(result.ranking.verdict,'unique');
  assert.ok(find(result.tree,'b'));
  assert.equal(find(result.tree,'c'),undefined);
  const reset=rank('%rule text (gone ≻ live) :: ∅\n%rule gone bad\n%erased\n%rule bad A\n%error "bad"\n%rule live A');
  assert.equal(reset.ranking.verdict,'unique');
  assert.ok(find(reset.tree,'gone'));
  assert.deepEqual(reset.ranking.profile.slice(0,3),[0,0,0]);
});

test('independent erased choices share summaries instead of enumerating interiors',()=>{
  for(const count of [2,8,32]){
    const result=rank('%rule text '+Array(count).fill('gone B').join(' ')+'\n%rule gone [A] [A] :: ∅\n%erased',Array(count).fill(['A','B']).flat());
    assert.equal(result.ranking.verdict,'unique');
    assert.ok(result.ranker.memo.plain.size<100*count,result.ranker.memo.plain.size+' summaries for '+count+' units');
    for(const pair of result.ranker.memo.plain.values())assert.ok(pair.canonical.length<5);
  }
});

// Engine §4.1: post-selection local clauses keep the working view.
test('erased roots have separate working and exported observations after choice',()=>{
  const result=rank('%rule text e\n%rule e a\n%conditions $ ≅ #⁅ a ⁆\n%erased\n%rule a A');
  const node=find(result.tree,'e');
  const pattern=result.stage.grammar.rules.get('e').alternatives[0].clauses.conditions[0].right.pattern;
  assert.equal(result.context.patterns.matches(workingStructure(result.context,node.item),pattern),true);
  assert.equal(result.context.patterns.matches(node.item.structure,pattern),false);
  const exported=derivationIdentity(result.context,node);
  const working=derivationIdentity(result.context,node,true);
  assert.notEqual(exported,working);
  const identities=result.context.emissionTrees;
  const exportedKey=identities.nodes[exported].key;
  const onlyChild=identities.elements(exportedKey[2]);
  assert.equal(onlyChild.length,1);
  assert.equal(identities.nodes[onlyChild[0]].key[0],'Seal');
  assert.equal(derivationIdentity(result.context,node),exported);
});


// Engine §4.2: named closes can change a parent's cycle validity.
test('erased keys project named closes while cycle contexts exclude their invalid edges',()=>{
  const result=rank('%rule text a\n%rule a e | A\n%conditions $.without-elision.matches(w)\n%rule e a | b\n%erased\n%rule b A\n%rule w A');
  const m=result.context.closes;
  const interiors=result.chart.sets[1].items.filter(item=>item.complete&&item.production.lhs==='e'&&item.observation.valid);
  const a=interiors.find(item=>item.production.rhs[0].name==='a').observation;
  const b=interiors.find(item=>item.production.rhs[0].name==='b').observation;
  assert.equal(m.identity(a),m.identity(b));
  const first=interiors.find(item=>item.production.rhs[0].name==='a');
  const second=interiors.find(item=>item.production.rhs[0].name==='b');
  assert.equal(result.ranker.erasures.key(first),result.ranker.erasures.key(second));
  assert.notEqual(result.ranker.erasures.key(first),result.ranker.erasures.key({...first,observation:m.invalid}));
  const available=item=>m.aligned(m.closeRule(item.observation,'a',0,1),m.empty,1);
  assert.equal(available(first),false);assert.equal(available(second),true);
  const edges=[first,second].map(child=>({kind:'complete',previous:first,child}));
  assert.deepEqual(result.ranker.erasures.groups(edges,null,available).map(group=>group.indices),[[1]]);
  assert.equal(m.aligned(m.closeRule(a,'a',0,1),m.empty,1),false);
  assert.equal(m.aligned(m.closeRule(b,'a',0,1),m.empty,1),true);
});

// Engine §4.1: a completed erased identity exports its prefix too.
test('completed erased tree prefixes share the exported sequence',()=>{
  const trees=new TreeIdentities(),context={trees,treeSeals:new Map(),tokens:[{value:'a'}]};
  const production={erased:true,observesTrees:true,walksTrees:true,rhs:[{name:'a'}],lhs:'e'};
  const complete=name=>treeStep(context,production,1,{origin:0,treePrefix:0},{treeSequence:trees.append(0,trees.rule(name,0))},1,true);
  const a=complete('a'),b=complete('b');
  assert.equal(a.treePrefix,a.treeSequence);
  assert.equal(a.treePrefix,b.treePrefix);
});

// Engine §6: ranked entries observe the same projected erased prefix.
test('named closes do not split frames entered after an erased prefix',()=>{
  for(const body of ['e (e ≻ e) :: ∅','e (e ≻ e) e :: ∅']) {
    const result=rank('%rule text $p:p\n%conditions $p.without-elision.matches(w)\n%rule p '+body+'\n%rule w p\n%rule e a | b\n%erased\n%rule a A\n%rule b A',body.includes(' e ::')?['A','A','A']:['A','A']);
    assert.equal(result.ranking.verdict,'unique');
  }
});
