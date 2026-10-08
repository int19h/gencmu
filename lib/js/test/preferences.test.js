import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runEngineCase, loadEngineCase, parseEngineCase, repository, loaderWith, readGrammarFile } from "./shared.js";
import { compareOccurrences, occurrencesOfRope } from "../src/prefer-rank.js";
import { internals } from "../src/rank.js";
import { hooks } from "../src/testing.js";
import { fnv1a64, Loader } from "../src/node.js";

const definitions = "%rule text a | b\n%rule a X\n%rule b X\n%prefer a > b";
const preferences = loadEngineCase({grammar: definitions}).dialect.stages[0].grammar.preferences;
const key = (name,p=0,q=1) => JSON.stringify([name,p,q]);

test("occurrence cancellation preserves exact multiplicities and common additions", () => {
  const large = 2n ** 70n;
  const left = new Map([[key("a"),large+1n]]);
  const right = new Map([[key("a"),large],[key("b"),1n]]);
  assert.deepEqual(compareOccurrences(preferences,left,right).forward[0].residualCounts,["1","1"]);
  assert.equal(compareOccurrences(preferences,new Map([[key("a"),1n]]),new Map([[key("b",1,2),1n]])).forward.length,0);
  let state = 131;
  const next = () => state = (Math.imul(state,1664525)+1013904223)>>>0;
  for (let round=0; round<10000; round++) {
    const x=new Map(),y=new Map(),common=new Map();
    for (const name of ["a","b"]) for (const [p,q] of [[0,1],[1,2],[0,2]]) {
      const k=key(name,p,q);x.set(k,BigInt(next()%5));y.set(k,BigInt(next()%5));common.set(k,BigInt(next()%5));
    }
    const add=(map)=>new Map([...map].map(([k,n])=>[k,n+common.get(k)]));
    assert.deepEqual(compareOccurrences(preferences,x,y),compareOccurrences(preferences,add(x),add(y)));
  }
});

test("the slow path retains every independent root signature", () => {
  const before=hooks.preferenceRanking;
  try {
    for (let length=1;length<=8;length++) {
      const runs=[];hooks.preferenceRanking=(stats)=>runs.push(stats);
      const got=runEngineCase({grammar:"%ambiguity-resolution late-elision\n%rule text {unit}\n%rule unit a | b\n%rule a X\n%rule b X\n%prefer a > b",tokens:Array.from({length},()=>({text:"x",tags:["X"]}))});
      assert.equal(got.json.stages[0].verdict,"resolved");
      assert.equal(runs[0].slow,true);
      assert.equal(runs[0].largestSet,2**length);
    }
  } finally {hooks.preferenceRanking=before;}
});

test("returned contest paths cannot change the loaded preference graph", () => {
  const x=new Map([[key("a"),1n]]),y=new Map([[key("b"),1n]]);
  const expected=structuredClone(compareOccurrences(preferences,x,y));
  const first=compareOccurrences(preferences,x,y);
  first.forward[0].path.splice(0,2,"changed");
  assert.deepEqual(compareOccurrences(preferences,x,y),expected);
  const reverse=compareOccurrences(preferences,y,x);
  reverse.reverse[0].path.splice(0,2,"changed");
  assert.deepEqual(compareOccurrences(preferences,x,y),expected);
});

test("the whole-forest fast path keeps the previous ranker's complete result", () => {
  const grammar="%rule text a | n [+T]\n%rule a X\n%rule b Y\n%rule n X";
  const tokens=[{text:"x",tags:["X"]}];
  const before=hooks.preferenceRanking;const runs=[];
  try {
    hooks.preferenceRanking=(stats)=>runs.push(stats);
    for (const lean of ["lazy","greedy","late-elision"]) {
      const plain=runEngineCase({grammar:`%ambiguity-resolution ${lean}\n${grammar}`,tokens});
      const preferred=runEngineCase({grammar:`%ambiguity-resolution ${lean}\n${grammar}\n%prefer a > b`,tokens});
      assert.deepEqual(preferred.json,plain.json);
      assert.equal(runs.at(-1).slow,false);
    }
  } finally {hooks.preferenceRanking=before;}
});

test("cached and uncached document DOMs give the same load diagnostics", () => {
  const documents={"pipeline.md":"```jbogenbau\n%stage main\n%include \"main.md\"\n```\n","main.md":"```jbogenbau\n%ambiguity-resolution late-elision\n%rule text a a | b\n%rule a X\n%rule b X\n%prefer a > b\n```\n"};
  const uncached=loaderWith(documents);const dialect=uncached.dialect("case/pipeline.md");
  const bootstrap=fs.readFileSync(`${repository}/grammars/notation/bootstrap.json`,"utf8");
  const compiled={format:21,bootstrap:fnv1a64(bootstrap),documents:Object.fromEntries(Object.entries(documents).map(([name,text])=>[`case/${name}`,{hash:fnv1a64(text),dom:uncached.readDocument(text,`case/${name}`)}]))};
  const cachedLoader=new Loader((path)=>path === "compiled.json" ? JSON.stringify(compiled) : path.startsWith("case/") ? documents[path.slice(5)] : readGrammarFile(path));
  assert.equal(cachedLoader.compiled.size,2);
  const cached=cachedLoader.dialect("case/pipeline.md");
  assert.deepEqual(cached.loadWarnings,dialect.loadWarnings);
  const saved=structuredClone(cached.loadWarnings);
  for(let i=0;i<3;i++)parseEngineCase(cached,{tokens:[{text:"x",tags:["X"]}]});
  assert.deepEqual(cached.loadWarnings,saved);
});

test("declaration cycle diagnostics include every rule and source position", () => {
  const loaded=loadEngineCase({grammar:"%rule text a\n%rule a X\n%rule b X\n%rule c X\n%prefer a > b\n%prefer b > c\n%prefer c > a"});
  assert.match(loaded.loadError.message,/a > b > c > a/);
  for(const line of [7,8,9])assert.match(loaded.loadError.message,new RegExp(`main.md:${line}:1`));
});


test("projection preserves repeated occurrences from distinct reconstruction spans", () => {
  const close=(name,origin,end)=>internals.leaf({kind:"close",item:{origin,end,production:{helper:false,lhs:name,rhs:[{}],flags:[],id:1}}});
  const left=internals.concat(close("a",0,1),close("a",0,2));
  const right=internals.concat(close("a",0,1),close("b",0,2));
  const project=[0,1,1];
  const x=occurrencesOfRope(left,preferences,project),y=occurrencesOfRope(right,preferences,project);
  assert.equal(x.get(key("a")),2n);
  assert.deepEqual(compareOccurrences(preferences,x,y).forward[0].residualCounts,["1","1"]);
  assert.equal(occurrencesOfRope(close("a",1,2),preferences,project).size,0);
});
