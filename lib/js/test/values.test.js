// Values and occurrence-based recipes (engine §§1, 3, 9, 10, 11).
import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {Loader, Token, resultJson} from "../src/index.js";
import {characterTokens} from "../src/tokens.js";
import {UnicodeTable} from "../src/unicode.js";

const root = new URL("../../../grammars/",import.meta.url);
const load = body => new Loader(path => path === "case.md" ? "```jbogenbau\n"+body+"\n```" : fs.readFileSync(new URL(path,root),"utf8")).dialect("case.md");
const grammar = body => load("%stage test\n%ambiguity-resolution greedy\n"+body);
const token = (value,image=value,tags=[]) => new Token(new Set(tags),[0,1],[0,1],"a",value,undefined,image);
const supplied = tags => [...tags].map((tag,i) => new Token(new Set([tag]),[i,i+1],[i,i+1],tag.toLowerCase()));
const output = (body,text="a",options={}) => {
  const result = grammar(body).parse(text,options);
  assert.equal(result.ok,true,result.error?.message);
  return result.stages[0].output;
};

test("stage zero stores configured categories and character strings",() => {
  const [a,b] = characterTokens("AB",new UnicodeTable("unicode test\ncategory Lu 0041 0041\nwhite-space 0041 0041"));
  assert.deepEqual([...a.tags].sort(),["_L","_Lu","_White_Space"]);
  assert.deepEqual([...b.tags].sort(),["_C","_Cn"]);
  assert.deepEqual([a.value,a.image,a.text],["A","A","A"]);
});

test("terminals read exact stored values or stored tags",() => {
  assert.equal(grammar('%rule text "ab"').parse("ab").ok,false);
  const [item] = output('%rule text "ab" %emits',"a",{tokens:[token("ab","AB")]});
  assert.deepEqual([item.value,item.image,[...item.tags]],["ab","AB",[]]);
  assert.equal(grammar('%rule text "a"').parse("a",{tokens:[token("A,")]}).ok,false);
  assert.equal(grammar('%rule text "A".."Z"').parse("a",{tokens:[token("B")]}).ok,true);
  assert.equal(grammar('%rule text "A".."Z"').parse("a",{tokens:[token("BB")]}).ok,false);
  assert.equal(grammar('%rule text _Lu').parse("a",{tokens:[token("x","x",["_Lu"])]}).ok,true);
  assert.equal(grammar('%rule text _Lu').parse("A",{tokens:[new Token(new Set(),[0,1],[0,1],"A")]}).ok,false);
});

test("caller strings default independently and reject invalid fields",() => {
  const dialect = grammar('%rule text _ %emits');
  for (const [fields,value,image] of [[{},"a","a"],[{value:""},"","a"],[{image:""},"a",""],[{value:"v",image:"i"},"v","i"]]) {
    const result = dialect.parse("a",{tokens:[{text:"a",tags:[],span:[0,1],source:[0,1],...fields}]});
    assert.equal(result.ok,true);
    assert.deepEqual([result.stages[0].output[0].value,result.stages[0].output[0].image],[value,image]);
  }
  for (const fields of [{value:null},{image:"\ud800"},{text:"\udfff"},{tags:["_Any"]},{tags:["/a/"]},{tags:{}},{tags:42},{tags:null},{tags:{[Symbol.iterator]:42}},{source:[0,1.5]},{span:[1,0]},{before:[{}]}]) {
    assert.throws(() => dialect.parse("a",{tokens:[{text:"a",tags:[],span:[0,1],source:[0,1],...fields}]}),e => e.kind === "usage");
  }
});

test("signed tests, stacked tests and omission predicates keep exact values",() => {
  const dialect = grammar('%const $T B C\n%rule text _<A $T ¬D>="A,B"');
  assert.equal(dialect.parse("a",{tokens:[token("A,B","i",["A","B","C"])]}).ok,true);
  assert.equal(dialect.parse("a",{tokens:[token("A,B","i",["A","B","C","D"])]}).ok,false);
  assert.equal(grammar('%rule text _<A ¬A>').parse("a",{tokens:[token("a","a",["A"])]}).ok,false);
  for (const [head,accept] of [['T<T>="x"',true],['T<¬T>',false],['T<B>="x"',false],['T≠""',false],['T≠"x"',true]]) {
    const result = grammar('%rule text X [+'+head+']').parse("x",{tokens:supplied("X")});
    assert.equal(result.ok,accept,head);
    if (accept && head.includes('="x"')) assert.equal(resultJson(result).tree.children[1].value,"x");
  }
});

test("methods observe value, image, source and classes separately",() => {
  const body = '%rule text $x:_ %conditions $x.value="v", $x.image="i", $x.source-text="a", $x.first-token.value="v", $x.tokens-after-first.value="", $x.last-token.value="v", $x.onward.starts-input, $x.following-tokens.value="" %emits';
  assert.equal(grammar(body).parse("a",{tokens:[token("v","i")]}).ok,true);
  const [item] = output('%rule text $x:_ :: $x.classes %emits',"a",{tokens:[token("a","a",["Word","WORD","A","_L"])]});
  assert.deepEqual([...item.tags].sort(),["A","WORD"]);
  const [classified] = output('%const $X "A,B"\n%const $SET $X.split(",")\n%classifier words "A,B" ∈ WORD\n%rule text _ :: $.value.classify(words) %conditions "A" ∈ $SET %emits',"a",{tokens:[token("A,B")]});
  assert.deepEqual([...classified.tags],["WORD"]);
});

test("tag provenance checks complete filters and patterns use terminal identity",() => {
  const [item] = output('%rule text $x:_ :: $x.tags ∩ _Ll %emits');
  assert.deepEqual([...item.tags],["_Ll"]);
  assert.doesNotThrow(() => grammar('%rule text _ :: _Lu ∩ Word'));
  assert.throws(() => grammar('%rule text _ :: Word ∪ _Lu'),e => e.kind === "grammar");
  assert.throws(() => grammar('%const $T _Lu ∩ Word\n%rule text _'),e => e.kind === "grammar");
  assert.equal(grammar("%const $A \"a\"\n%rule text \"‹U+0061›\" %conditions $ ≅ #\"a\"<_Ll>=\"a\", $ ≅ #$A, $ ≅ #\"‹U+0061›\"").parse("a").ok,true);
  assert.equal(grammar("%rule text _ %conditions $ ≅ #\"a\"").parse("a").ok,false);
});

test("captured optionals retain logical arity and query priority",() => {
  for (const [body,text,tags,children] of [['[$a:"a"]',"a",["_L","_Ll"],1],['"a" [$b:"b"]',"a",[],1],['[$a:"a" $b:"b"]',"ab",[],2],['[[$a:"a"]]',"a",["_L","_Ll"],1]]) {
    const result = grammar('%rule text '+body).parse(text);
    assert.equal(result.ok,true);
    assert.deepEqual([...result.tree.tags].sort(),tags);
    assert.equal(result.tree.children.length,children);
  }
  for (const captured of [false,true]) {
    const body = '%rule text {_} %conditions $.begins(r)\n%rule r B ['+(captured?'$x:':'')+'c] [+T] D T\n%rule c D';
    assert.equal(grammar(body).parse("bdt",{tokens:supplied("BDT")}).ok,false);
  }
});

test("constituent and item recipes follow channel precedence",() => {
  for (const [body,value,image] of [
    ['%rule text := "d" :- "i" | "a" := "v" %emits',"v","i"],
    ['%rule text := "d" :- "i" | "a" := "v" :- "j" %emits $ := "q"',"q","q"],
    ['%rule text := "d" | "a" %emits $ :- "j"',"d","j"],
    ['%rule text := $.emitted.image :- "x" | "a" %emits',"x","x"],
    ['%rule text := "x" :- $.emitted.value | "a" %emits',"x","x"],
    ['%rule text := "a" | "a" %emits $ := $.emitted.value ++ "b"',"ab","ab"],
    ['%rule text child %emits\n%rule child := "c" | "a" %emits $ := "i"',"c","c"],
    ['%rule text $c:child %emits $c := $.value\n%rule child := "c" | "a"',"a","a"],
  ]) assert.deepEqual(output(body).map(t => [t.value,t.image]),[[value,image]],body);
  const dialect = grammar('%rule text := "x" | "a" %emits\n%extend-rule text := "y" | "b" %emits');
  assert.equal(dialect.parse("a").stages[0].output[0].value,"x");
  assert.equal(dialect.parse("b").stages[0].output[0].value,"y");
});

test("cycles and selected missing captures are loading errors at their specified positions",() => {
  for (const body of ['%rule text := $.emitted.value | "a" %emits $ := "x"','%rule text := $.emitted.image | "a" %emits']) {
    assert.throws(() => grammar(body),e => e.kind === "grammar" && e.where.line === 4 && e.where.column === 15);
  }
  assert.doesNotThrow(() => grammar('%rule text := $.emitted.value | "a" := "x" %emits'));
  assert.throws(() => grammar('%rule text := "prefix" ++ $x.value | "a" | $x:"b" %emits'),e => e.kind === "grammar" && e.where.line === 4 && e.where.column === 1);
  assert.doesNotThrow(() => grammar('%rule text := $x.value | "a" := "x" | $x:"b" %emits'));
  assert.throws(() => grammar('%rule text ("a" ≻ $x:"b") := $x.value'),e => e.code === "ranked-choice-export");
});

test("erasure stops counted parts and insertions preserve empty spans",() => {
  const [item] = output('%rule text $a:gone "b" %emits\n%rule gone "a" %erased',"ab");
  assert.deepEqual([item.value,item.image,item.text,item.source],["b","b","ab",[0,2]]);
  const [retained] = output('%rule text $a:gone %emits $a := "x"\n%rule gone "a" %erased');
  assert.deepEqual([retained.value,retained.image,retained.text],["x","x","a"]);
  const items = output('%rule text "a" %emits ε := "x", $, ε');
  assert.deepEqual(items.map(t => [t.value,t.image,t.span,t.source,t.insertedBy]),[
    ["x","x",[0,0],[0,0],"text"],["a","a",[0,1],[0,1],undefined],["","",[1,1],[1,1],"text"],
  ]);
  assert.equal(items[0].tags.size,0);
});

test("overlap analysis ignores productivity, feature gates, erasure and recipes",() => {
  for (const body of ['%rule text "a" %emits $, $','%rule text $x:"a" %emits $, $x','%rule text off? "a" z %emits $, $\n%rule z z','%rule text $x:gone %emits $, $x\n%rule gone "a" %erased']) {
    assert.throws(() => grammar(body),e => e.kind === "grammar" && e.where.line === 4 && e.where.column === 1);
  }
  assert.doesNotThrow(() => grammar('%rule text z %emits $, $\n%rule z z'));
  assert.equal(output('%rule text ε %emits $, $',"").length,2);
});

test("verbatim claims extend images independently of source envelopes",() => {
  const [item] = output('%rule text :- $.verbatim-text | _ %emits',",a,",{tokens:[new Token(new Set(),[0,1],[1,2],"a")]});
  assert.deepEqual([item.value,item.image,item.text,item.source],["a",",a,","a",[1,2]]);
  const [shared] = output('%rule text := $.verbatim-text :- $.verbatim-text | _ %emits',",a,",{tokens:[new Token(new Set(),[0,1],[1,2],"a")]});
  assert.equal(shared.value,shared.image);
  const tokens = [new Token(new Set(),[0,1],[2,3],"b"),new Token(new Set(),[1,2],[0,1],"a")];
  const result = grammar('%rule text {unit}\n%rule unit :- $.verbatim-text | _ %emits').parse("a,b",{tokens});
  assert.equal(result.error.kind,"grammar");
  assert.equal(result.stages[0].verdict,"unique");
  assert.equal(result.stages[0].output,null);
  const [overridden] = output('%rule text :- "x" | {unit} %emits\n%rule unit :- $.verbatim-text | _',"a,b",{tokens});
  assert.deepEqual([overridden.value,overridden.image],["ba","x"]);
});

test("ownership counts input leaves even when recipes replace both strings",() => {
  const first = '%stage a\n%ambiguity-resolution greedy\n%rule text $a:a $w:w $z:z %emits ($a) $w, $z\n%rule a "a" :: A %emits\n%rule w "w" :: W\n%rule z "z" :: Z\n';
  const failed = load(first+'%stage b\n%ambiguity-resolution greedy\n%rule text W Z %emits := "x" :- ""').parse("awz");
  assert.equal(failed.error.kind,"grammar");
  assert.equal(failed.error.stage,"b");
  const result = load(first+'%stage b\n%ambiguity-resolution greedy\n%rule text W $z:gone %emits\n%rule gone Z %erased').parse("awz");
  assert.equal(result.ok,true,result.error?.message);
  const item = result.stages[1].output[0];
  assert.deepEqual([item.value,item.image,item.text,item.source],["w","w","wz",[1,3]]);
  assert.equal(item.before[0].value,"a");
  assert.equal("span" in item.before[0],false);
});

test("logical optional tag safety follows content arity",() => {
  const dialect = grammar('%rule text [("a" ≻ "b") $x:"c"]');
  const result = dialect.parse("ac");
  assert.equal(result.ok,true,result.error?.message);
  assert.deepEqual([...result.tree.tags],[]);
  assert.throws(() => grammar('%rule text [("a" ≻ "b")]'),error => error.code === "ranked-choice-tags");
});

test("restored queries compare close identity while ignoring saved equality values",() => {
  const beginning = '%rule text $c:c %conditions $c.without-elision.matches(r)\n%rule c X [+T="v"] :: ∅\n%rule r ';
  for (const [body,accept] of [['X [+T="q"] :: ∅',true],['X [+U] [+T] :: ∅',false],['X T :: ∅',false]]) {
    const result = grammar(beginning+body).parse("x",{tokens:supplied("X")});
    assert.equal(result.ok,accept,body);
    if (accept) assert.equal(resultJson(result).tree.children[0].children[1].value,"v");
  }
});

test("result format 15 uses scalar terminal spellings and saved values",() => {
  const result = grammar('%const $S "a" ++ "‹U+0301›" ++ "$"\n%rule text $S %emits').parse("a",{tokens:[token("a\u0301$")]});
  assert.equal(result.ok,true,result.error?.message);
  const json = resultJson(result);
  assert.equal(json.format,15);
  assert.equal(json.tree.children[0].terminal,'"a‹U+0301›$"');
  assert.equal(json.stages[0].output[0].value,"a\u0301$");
  assert.equal("phonemes" in json.stages[0].output[0],false);
});

test("capture guards simplify query and position methods as conditions",() => {
  for (const predicate of ['$.onward.begins(q)','$x.starts-input']) {
    const body = '%rule text Q ($x:a ≻ b) %conditions $x ⟹ '+predicate+'\n%rule q Q\n%rule a X Y\n%rule b U V';
    const dialect = grammar(body);
    assert.equal(dialect.parse('qxy',{tokens:supplied('QXY')}).ok,predicate !== '$x.starts-input');
    assert.equal(dialect.parse('quv',{tokens:supplied('QUV')}).ok,true);
  }
});
