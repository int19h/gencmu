import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repository, runEngineCase, checkEngineOutcome, loaderWith } from "./shared.js";
import { readDocument } from "../../../tools/bootstrap-reader.js";

const cases=JSON.parse(fs.readFileSync(path.join(repository,"tests/parameters.json"),"utf8"));
for(const fixture of cases) test(`parameters: ${fixture.name}`,()=>{
  const outcome=runEngineCase(fixture);
  checkEngineOutcome(fixture.expect,outcome,fixture.name);
});
for(const fixture of cases.filter(c=>!c.expect.error)) test(`parameter readers: ${fixture.name}`,()=>{
  const document="```jbogenbau\n"+fixture.grammar+"\n```";
  const engine=loaderWith({}).readDocument(document,"parameters.md");
  assert.deepEqual(engine,readDocument(document,"parameters.md"));
});

function grammarOf(grammar) {
  const {loadError,dialect}=loadEngineCase({grammar});
  if(loadError) throw loadError;
  return dialect.stages[0].grammar;
}

import { loadEngineCase } from "./shared.js";
import { templateAudit, canonicalArgument, expandTemplates } from "../src/templates.js";
import { domProblem } from "../src/dom.js";

test("expanded order retains binding slots and the source discovery order",()=>{
  const grammar=grammarOf('%rule atom(@X) @X\n%rule text atom("a") named\n%rule named = atom("b")\n%redefine-rule named = atom("c")');
  assert.deepEqual([...grammar.rules.keys()],["text","named",'atom("a")','atom("b")']);
  assert.deepEqual(templateAudit(grammar).instances.map(i=>i.name),["named",'atom("a")','atom("b")']);
});

test("closed inner calls precede outer calls and source calls precede the queue",()=>{
  const grammar=grammarOf('%rule atom(@X) @X\n%rule outer(@X) atom(@X) @X\n%rule text outer(atom("a")) atom("b")');
  assert.deepEqual([...grammar.rules.keys()],["text",'atom("a")','outer(atom("a"))','atom("b")','atom(atom("a"))']);
});

test("public edits stay on their source key across rebinding",()=>{
  const grammar=grammarOf('%rule atom(@X) @X\n%rule text item atom("a")\n%rule item = atom("a")\n%extend-rule item "b"\n%redefine-rule item = atom("c")\n%extend-rule item "d"');
  assert.equal(grammar.rules.get('atom("a")').alternatives.length,2);
  assert.equal(grammar.rules.get("item").alternatives.length,2);
  assert.deepEqual(grammar.rules.get('atom("a")').alternatives.map(a=>a.expr.literal.string),['a','b']);
  assert.deepEqual(grammar.rules.get("item").alternatives.map(a=>a.expr.literal.string),['c','d']);
});

test("template flags and instance redefinitions follow source order",()=>{
  const grammar=grammarOf('%rule(fewest) atom(@X) @X\n%rule text atom("a") atom("b")\n%redefine-rule atom("a") "c"\n%extend-rule atom(@Y) "d"');
  assert.deepEqual(grammar.rules.get('atom("a")').flags,[]);
  assert.deepEqual(grammar.rules.get('atom("b")').flags,['fewest']);
  assert.deepEqual(templateAudit(grammar).instances[0].events.map(e=>[e.scope,e.op,e.flagsAfter]),[['template','define',['fewest']],['instance','redefine',[]],['template','extend',[]]]);
});

test("parenthesized symbols share keys and constants retain nominal identity",()=>{
  const grammar=grammarOf('%const $A "a"\n%rule atom(@X) @X\n%rule text atom("a") atom(("a")) atom($A)');
  assert.deepEqual([...grammar.rules.keys()],["text",'atom("a")','atom($A)']);
});

test("binding adds no tree node and later calls use the public name",()=>{
  const {dialect}=loadEngineCase({grammar:'%rule atom(@X) @X\n%rule text atom("a")\n%rule named = atom("a")'});
  const tree=dialect.parse('a').tree;
  assert.equal(tree.children[0].rule,'named');
  assert.equal(tree.children[0].children[0].kind,'token');
});

test("audit reports unused parameters, uncalled templates, and alias twins",()=>{
  const grammar=grammarOf('%rule atom(@X) @X\n%rule unused(@A,@B) @A\n%rule outer(@X) @X\n%rule text outer(named) outer(atom("a"))\n%rule named = atom("a")');
  const audit=templateAudit(grammar);
  assert.deepEqual(audit.templates[1].notes,[{kind:'unused-parameter',parameter:'B'},{kind:'uncalled-template'}]);
  const outer=audit.instances.filter(i=>i.template==='outer');
  assert.deepEqual(outer.map(i=>i.notes),[[{kind:'argument-alias-twin',instances:['outer(atom("a"))']}],[{kind:'argument-alias-twin',instances:['outer(named)']}]]);
});

test("substituted elidable optionals belong to their concrete instance",()=>{
  const grammar=grammarOf('%rule tail(@T) "a" [+@T]\n%rule text tail(KU)');
  const lowered=grammar.lower(new Set());
  const owned=lowered.productions.filter(p=>p.elided==='KU');
  assert.ok(owned.length);
  assert.ok(owned.every(p=>p.owner==='tail(KU)'));
});

test("the canonical printer preserves literal and structural identities",()=>{
  const unicode=loaderWith({}).unicode;
  const argument={call:'f',args:[{string:'a\n\t\u0301'},{concat:[{string:'a'},{string:''}]}],at:[1,1]};
  assert.equal(canonicalArgument(argument,unicode),'f("a‹LF›‹HT›‹U+0301›", "a" ++ "")');
  assert.equal(canonicalArgument({body:{seq:[{ref:'a'},{seq:[{ref:'b'},{ref:'c'}]}]}},unicode),'(a (b c))');
});

test("supplied DOMs reject malformed parameter categories and captures in arguments",()=>{
  const loader=loaderWith({});
  const doc=loader.readDocument('```jbogenbau\n%rule atom(@X) @X\n%rule text atom("a")\n```','test.md');
  for(const bad of [{param:'X'},{param:'Y',at:[1,1]},{param:'X',at:[0,1]}]) {
    const copy=structuredClone(doc);copy.rules[0].alternatives[0].expr=bad;
    assert.ok(domProblem(copy,loader.unicode));
  }
  for(const arg of [{capture:"x"},{method:"value",receiver:{capture:""},args:[]},{body:{capture:"x",expr:{ref:"A"}}}]) {
    const copy=structuredClone(doc);copy.rules[1].alternatives[0].expr.args=[arg];
    assert.ok(domProblem(copy,loader.unicode));
  }
});

test("supplied single-symbol body arguments normalize before keys and substitution",()=>{
  const loader=loaderWith({});
  const doc=loader.readDocument('```jbogenbau\n%ambiguity-resolution greedy\n%rule atom(@X) @X\n%rule text atom("a") atom("a")\n```','test.md');
  doc.rules[1].alternatives[0].expr.seq[1].args=[{body:{literal:{string:'a'}}}];
  assert.equal(domProblem(doc,loader.unicode),null);
  const expansion=expandTemplates([{path:'test.md',dom:doc}],loader.unicode);
  assert.equal(expansion.instances.length,1);
});

import { readGrammarFile } from "./shared.js";
import { Loader, fnv1a64 } from "../src/node.js";
import { DOM_FORMAT } from "../src/dom.js";

test("valid cached arguments normalize and malformed cached parameters cause a cache miss",()=>{
  const text='```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%rule atom(@X) @X\n%rule text = atom("a")\n```';
  const base=loaderWith({});
  const dom=base.readDocument(text,'p.md');
  for(const valid of [true,false]) {
    const copy=structuredClone(dom);
    if(valid) copy.rules[1].instance.args=[{body:{literal:{string:'a'}}}];
    else copy.rules[0].alternatives[0].expr={param:'Other',at:[4,16]};
    const cache=JSON.stringify({format:DOM_FORMAT,bootstrap:base.bootstrapHash,unicode:base.unicodeHash,documents:{'p.md':{hash:fnv1a64(text),dom:copy}}});
    const loader=new Loader(relative=>relative==='p.md'?text:relative==='compiled.json'?cache:readGrammarFile(relative));
    assert.equal(loader.dialect('p.md').parse('a').ok,true);
    assert.equal(loader.compiled.has('p.md'),valid);
  }
});

test("ordinary stage directives do not trigger template expansion",()=>{
  const loader=loaderWith({});
  const dom=loader.readDocument('```jbogenbau\n%ambiguity-resolution greedy\n%rule text "a"\n%extend-rule text "b"\n```','plain.md');
  const documents=[{path:'plain.md',dom}];
  const expanded=expandTemplates(documents,loader.unicode);
  assert.equal(expanded.documents,documents);
  assert.equal(expanded.order,null);
});

test("template stages retain the ordinary source edit history",()=>{
  const grammar=grammarOf('%rule atom(@X) @X\n%rule text "a"\n%extend-rule text "b"\n%redefine-rule text "c"');
  assert.deepEqual(grammar.changes.map(change=>[change.kind,change.rule]),[['extended','text'],['replaced','text']]);
  assert.equal(grammar.rules.get('text').alternatives[0].expr.literal.string,'c');
});


import { rankedLocations, restoreRankedLocations } from "../src/ranked.js";

test("ranked body arguments retain their source location after normalization",()=>{
  const loader=loaderWith({});
  const dom=loader.readDocument('```jbogenbau\n%rule choose(@X) @X :: ∅\n%rule text choose(("a" ≻ "b"))\n```','locations.md');
  const ranked=dom.rules[1].alternatives[0].expr.args[0].body;
  rankedLocations.set(ranked,[3,25]);
  const expansion=expandTemplates([{path:'locations.md',dom}],loader.unicode);
  assert.deepEqual(rankedLocations.get(expansion.instances[0].definitions[0].rule.alternatives[0].expr),[3,25]);
});

test("diagnostic location recovery keeps argument and body arrays unchanged",()=>{
  const loader=loaderWith({});
  const dom=loader.readDocument('```jbogenbau\n%rule pair(@X,@Y) @X @Y\n%rule text pair("a","b") ("c" ≻ "d") :: ∅\n```','locations.md');
  const before=structuredClone(dom);
  restoreRankedLocations(dom,[{text:'≻'}],()=>[3,42]);
  assert.deepEqual(dom,before);
});

test("audit twins follow nested references and expanded order",()=>{
  for(const source of ["%rule atom(@X) @X\n%rule outer(@X) @X\n%rule public \"a\"\n%rule text outer((named named)) outer((atom(\"a\") atom(\"a\"))) outer((named atom(\"a\"))) outer((atom(\"a\") named))\n%rule named = atom(\"a\")\n%redefine-rule public = outer((atom(\"a\") named))","%rule atom(@X) @X\n%rule outer(@P) $x:named %conditions $x ≅ @P\n%rule text outer(#named) outer(#atom(\"a\"))\n%rule named = atom(\"a\")"]) {
    const instances=templateAudit(grammarOf(source)).instances.filter(i=>i.template==='outer');
    assert.equal(instances.length,source.includes('public')?4:2);
    for(const instance of instances) assert.deepEqual(instance.notes,[{kind:'argument-alias-twin',instances:instances.filter(other=>other!==instance).map(other=>other.name)}]);
  }
});

const structureCases=JSON.parse(fs.readFileSync(path.join(repository,'tests/parameter-structure.json'),'utf8'));
for(const c of structureCases) test(`parameter structure: ${c.name}`,()=>{
  const loader=loaderWith({});
  const dom=c.dom??loader.readDocument('```jbogenbau\n'+c.grammar+'\n```','review.md');
  if(c.cacheFallback) {
    assert.ok(domProblem(dom,loader.unicode));
    const source='```jbogenbau\n'+c.grammar+'\n```';
    const sources={'g.md':source,'p.md':'```jbogenbau\n%stage main\n%ambiguity-resolution greedy\n%include "g.md"\n```'};
    const cache={format:DOM_FORMAT,bootstrap:loader.bootstrapHash,unicode:loader.unicodeHash,documents:{'g.md':{hash:fnv1a64(source),dom}}};
    sources['compiled.json']=JSON.stringify(cache);
    const cached=new Loader(relative=>sources[relative]??readGrammarFile(relative));
    assert.equal(cached.compiled.has('g.md'),false);
    assert.equal(cached.dialect('p.md').parse(c.input).ok,true);
    return;
  }
  assert.equal(domProblem(dom,loader.unicode),null);
  if(c.argument) assert.deepEqual(dom.rules.at(-1).alternatives[0].expr.args[0],c.argument);
  const x=expandTemplates([{path:'review.md',dom}],loader.unicode);
  if(c.order) assert.deepEqual(x.order,c.order);
  if(c.instances) assert.equal(x.instances.length,c.instances);
  if(c.flags) {
    const grammar=grammarOf(c.grammar);
    for(const [name,flags] of Object.entries(c.flags)) assert.deepEqual(grammar.rules.get(name).flags,flags);
  }
});

test('over-deep supplied templates fail before recursive expansion',()=>{
  const loader=loaderWith({});
  const dom=loader.readDocument('```jbogenbau\n%rule use(@X) @X\n```','depth.md');
  let expr={param:'X',at:[1,1]};
  for(let i=0;i<20000;i++) expr={optional:expr};
  dom.rules[0].alternatives[0].expr=expr;
  assert.equal(domProblem(dom,loader.unicode),'nested too deeply');
});
