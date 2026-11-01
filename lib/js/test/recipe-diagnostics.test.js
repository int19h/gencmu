import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Loader, fnv1a64 } from "../src/node.js";
import { DOM_FORMAT } from "../src/dom.js";
import { validateRecipeCycles } from "../src/recipes.js";
import { repository, loaderWith, readGrammarFile } from "./shared.js";

test("an implied image shares its value recipe's active channel and cycle path", () => {
  const read = channel => ({method:channel,args:[],receiver:{method:"emitted",args:[],receiver:{capture:""}}});
  for (const channel of ["value","image"]) {
    assert.throws(() => validateRecipeCycles({concat:[{string:"prefix"},read(channel)]},undefined,"g.md"),error => {
      assert.match(error.message,/value → value$/);
      return true;
    });
  }
  // With an explicit image, the channels have distinct recipes.
  assert.throws(() => validateRecipeCycles({concat:[read("image")]},{concat:[read("value") ]},"g.md"),error => {
    assert.match(error.message,/value → image → value$/);
    return true;
  });
});

// The shared engine format has no cache-load error case. Run its recipe
// diagnostics through real matching caches too (engine §8, §11.3, §11.4).
const directory = path.join(repository, "tests", "engine");
for (const file of fs.readdirSync(directory).filter(name =>
  name.startsWith("recipe-cycle-position-") || name.startsWith("ranked-recipe-export-") && !name.includes("local-type"))) {
  const fixture = JSON.parse(fs.readFileSync(path.join(directory,file),"utf8"));
  test(`recipe diagnostic cache: ${file}`, () => {
    const sourceTexts = fixture.documents ?? {
      "main.md": `\`\`\`jbogenbau\n%ambiguity-resolution greedy\n${fixture.grammar}\n\`\`\`\n`,
      "pipeline.md": '```jbogenbau\n%stage main\n%include "main.md"\n```\n',
    };
    const texts = Object.fromEntries(Object.entries(sourceTexts).map(([name,text]) => [`grammars/test/${name}`,text]));
    const reader = loaderWith({});
    const documents = Object.fromEntries(Object.entries(texts).map(([name,text]) =>
      [name,{ hash:fnv1a64(text),dom:reader.readDocument(text,name,true) }]));
    const preparsed = JSON.stringify({format:DOM_FORMAT,bootstrap:reader.bootstrapHash, unicode: reader.unicodeHash, properties: reader.propertiesHash,documents});
    const loader = new Loader(name => name === "data/preparsed/test.json" ? preparsed : texts[name] ?? readGrammarFile(name));
    // Ranked definitions defer empty emission until after ranked validation
    // (engine §9.3), so matching caches retain these definitions too.
    loader.loadPreparsed("grammars/test/pipeline.md");
    assert.equal(loader.preparsed.size,Object.keys(texts).length);
    loader.readDocument = () => assert.fail("the matching recipe cache was bypassed");
    if (fixture.expect.error === "grammar") {
      assert.throws(() => loader.pipeline(`grammars/test/${fixture.pipelineDocument ?? "pipeline.md"}`),error => {
        assert.equal(error.kind,"grammar");
        assert.deepEqual({document:error.where.document,line:error.where.line,column:error.where.column},{...fixture.expect.where,document:`grammars/test/${fixture.expect.where.document}`});
        assert.equal(error.code,fixture.expect.diagnostic);
        if (error.code === "ranked-choice-export") {
          assert.equal(error.group.rule,"text");
          assert.equal(error.option,0);
          assert.ok(error.expression);
        } else assert.match(error.message,/recipe dependency cycle:/);
        return true;
      });
    } else {
      const result = loader.pipeline(`grammars/test/${fixture.pipelineDocument ?? "pipeline.md"}`).parse(fixture.input);
      assert.equal(result.ok,true);
      assert.equal(result.stages[0].output[0].value,"v");
      assert.equal(result.stages[0].output[0].image,"i");
    }
  });
}


test("diagnostic recovery retains the current load's DOM after cache eviction", () => {
  const block = text => '```jbogenbau\n'+text+'\n```\n';
  const main = 'grammars/test/g.md';
  const pipeline = 'grammars/test/p.md';
  const sources = {
    [pipeline]:block('%stage main\n%include "g.md"\n'+Array.from({length:257},(_,i) => `%include "d${i}.md"`).join("\n")),
    [main]:block('%ambiguity-resolution greedy\n%rule text := $.emitted.value | "a" %emits'),
  };
  for (let i=0;i<257;i++) sources[`grammars/test/d${i}.md`] = block("");
  const loader = new Loader(path => sources[path] ?? readGrammarFile(path));
  const dom = loader.readDocument(sources[main],main,true);
  loader.preparsed.set(main,{hash:fnv1a64(sources[main]),dom:JSON.parse(JSON.stringify(dom))});
  assert.throws(() => loader.pipeline(pipeline),error => {
    assert.equal(error.where.document,main);
    assert.equal(error.where.line,3);
    assert.equal(error.where.column,15);
    return true;
  });
});
