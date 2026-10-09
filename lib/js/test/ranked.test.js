import {test} from "node:test";
import assert from "node:assert/strict";
import {Loader,fnv1a64} from "../src/node.js";
import {DOM_FORMAT} from "../src/dom.js";
import {loadEngineCase,loaderWith,readGrammarFile} from "./shared.js";

test("ranked diagnostics retain written paths and first separators through constants and the cache", () => {
  const document = '```jbogenbau\n%const $K ~k\n%ambiguity-resolution late-elision\n%rule text Q (($x(a) ≻ b) ≻ c) Z\n%tags $K\n%emits $x\n%rule a X Y\n%rule b U V\n%rule c R S\n```\n';
  const pipeline = '```jbogenbau\n%stage main\n%include "g.md"\n```\n';
  const reader = loaderWith({});
  const documents = Object.fromEntries(Object.entries({"p.md":pipeline,"g.md":document}).map(([name,text]) => [name,{hash:fnv1a64(text),dom:reader.readDocument(text,name,true)}]));
  const cache = JSON.stringify({format:DOM_FORMAT,bootstrap:reader.bootstrapHash,documents});
  const diagnostics = [];
  for (const compiled of [undefined,cache]) {
    const loader = new Loader(name => name === "g.md" ? document : name === "p.md" ? pipeline : name === "compiled.json" ? compiled : readGrammarFile(name));
    assert.throws(() => loader.dialect("p.md"), error => {
      assert.equal(error.where.code,"ranked-choice-export");
      assert.deepEqual(error.where.group,{document:"g.md",at:[4,22],rule:"text",alternative:0,path:"/seq/1/ranked/0"});
      diagnostics.push(error.where);
      return true;
    });
  }
  assert.deepEqual(diagnostics[0],diagnostics[1]);
});

test("ranked inheritance witnesses choose the shortest source path", () => {
  const {loadError} = loadEngineCase({grammar:'%ambiguity-resolution late-elision\n%rule text a ≻ b\n%rule a u | v\n%rule u deeper\n%rule deeper X\n%rule v Y\n%rule b Z\n%tags ∅'});
  assert.equal(loadError.where.code,"ranked-choice-tags");
  assert.deepEqual(loadError.where.inheritance.map(site => site.rule),["text","a","v"]);
});

test("ranked error expressions preserve the written DOM before constant binding", () => {
  const {loadError} = loadEngineCase({grammar:'%ambiguity-resolution late-elision\n%const $K ~k\n%rule text Q ($x(a) ≻ b) Z\n%tags $x ⟹ (tags($x) ∪ $K)\n%rule a X Y\n%rule b U V'});
  assert.equal(loadError.where.code,"ranked-choice-export");
  const term = loadError.where.expression;
  assert.deepEqual(term.then.union[1],{const:"K",at:[5,24]});
});

test("mixed rank separators carry the syntax code without changing unrelated errors", () => {
  const reader = loaderWith({});
  for (const body of ["a | b ≻ c","a ≻ b | c","| a ≻ b","a ≻","≻ a"]) {
    assert.throws(() => reader.readDocument(`\`\`\`jbogenbau\n%rule text ${body}\n\`\`\`\n`,"g.md"),error => error.where.code === "ranked-choice-syntax");
  }
  assert.throws(() => reader.readDocument('```jbogenbau\n%rule text (a ≻ b)\n%rule other )\n```\n',"g.md"),error => error.where.code === undefined);
});
