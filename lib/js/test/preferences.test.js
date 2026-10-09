import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runEngineCase, loadEngineCase, repository, loaderWith, readGrammarFile } from "./shared.js";
import { hooks } from "../src/testing.js";
import { fnv1a64, Loader } from "../src/node.js";

const definitions = "%rule text a | b\n%rule a X Y\n%rule b X Y\n%prefer a > b";

test("slot groups grow with forest positions, without complete-reading signatures", () => {
  const before=hooks.slotAdmission;
  try {
    for (let length=1;length<=16;length*=2) {
      const runs=[];hooks.slotAdmission=(stats)=>runs.push(stats);
      const got=runEngineCase({grammar:"%ambiguity-resolution late-elision\n%rule text {unit}\n%rule unit a | b\n%rule a X Y\n%rule b X Y\n%prefer a > b",tokens:Array.from({length:length*2},(_,i)=>({text:i%2?"y":"x",tags:[i%2?"Y":"X"]}))});
      assert.equal(got.json.stages[0].verdict,"unique");
      assert.equal(runs[0].groups,length);
      assert.equal(runs[0].candidateEdges,length*2);
      assert.equal(runs[0].retainedEdges,length);
    }
  } finally {hooks.slotAdmission=before;}
});

test("ordinary stage ranking follows slot filtering for every directive", () => {
  for (const lean of ["lazy","greedy","late-elision"]) {
    const got=runEngineCase({grammar:`%ambiguity-resolution ${lean}\n${definitions}`,tokens:[{text:"x",tags:["X"]},{text:"y",tags:["Y"]}]});
    assert.equal(got.json.stages[0].verdict,"unique");
    assert.equal(got.json.tree.children[0].rule,"a");
  }
});

test("cached and uncached document DOMs give the same slot diagnostics", () => {
  for (const body of [definitions.replace("text a | b","text a a | b"),definitions.replace("text a | b","text $h(a) X | b X\n%emits $h")]) {
    const documents={"pipeline.md":"```jbogenbau\n%stage main\n%include \"main.md\"\n```\n","main.md":`\`\`\`jbogenbau\n%ambiguity-resolution late-elision\n${body}\n\`\`\`\n`};
    const uncached=loaderWith(documents);
    let expected;
    try {uncached.dialect("case/pipeline.md");assert.fail("invalid slot loaded");} catch(error) {expected=error.where;}
    const bootstrap=fs.readFileSync(`${repository}/grammars/notation/bootstrap.json`,"utf8");
    const compiled={format:21,bootstrap:fnv1a64(bootstrap),documents:Object.fromEntries(Object.entries(documents).map(([name,text])=>[`case/${name}`,{hash:fnv1a64(text),dom:uncached.readDocument(text,`case/${name}`,true)}]))};
    const cached=new Loader(path=>path==="compiled.json"?JSON.stringify(compiled):path.startsWith("case/")?documents[path.slice(5)]:readGrammarFile(path));
    assert.equal(cached.compiled.has("case/pipeline.md"),true);
    assert.throws(()=>cached.dialect("case/pipeline.md"),error=>assert.deepEqual(error.where,expected)===undefined);
  }
});

test("declaration cycle diagnostics retain every edge location", () => {
  const loaded=loadEngineCase({grammar:"%rule text a\n%rule a X\n%rule b X\n%rule c X\n%prefer a > b\n%prefer b > c\n%prefer c > a"});
  assert.match(loaded.loadError.message,/a > b > c > a/);
  for(const line of [7,8,9])assert.match(loaded.loadError.message,new RegExp(`main.md:${line}:1`));
});


test("tag closure diagnostics follow written inheritance order", () => {
  const loaded=loadEngineCase({grammar:"%rule text a | b\n%rule a u | v\n%rule b X\n%tags ∅\n%rule v V\n%rule u U\n%prefer a > b"});
  assert.equal(loaded.loadError.where.code,"prefer-slot-tags");
  assert.deepEqual(loaded.loadError.where.inheritance.map(part=>part.rule),["a","u"]);
});
