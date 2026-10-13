import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Loader, fnv1a64 } from "../src/node.js";
import { DOM_FORMAT } from "../src/dom.js";
import { repository, loaderWith, readGrammarFile } from "./shared.js";

// The shared engine format has no cache-load error case. Run its recipe
// diagnostics through real matching caches too (engine §8, §11.3, §11.4).
const directory = path.join(repository, "tests", "engine");
for (const file of fs.readdirSync(directory).filter(name =>
  name.startsWith("recipe-cycle-position-") || name.startsWith("ranked-recipe-export-") && !name.includes("local-type"))) {
  const fixture = JSON.parse(fs.readFileSync(path.join(directory,file),"utf8"));
  test(`recipe diagnostic cache: ${file}`, () => {
    const texts = {
      "main.md": `\`\`\`jbogenbau\n%ambiguity-resolution greedy\n${fixture.grammar}\n\`\`\`\n`,
      "pipeline.md": '```jbogenbau\n%stage main\n%include "main.md"\n```\n',
    };
    const reader = loaderWith({});
    const documents = Object.fromEntries(Object.entries(texts).map(([name,text]) =>
      [name,{ hash:fnv1a64(text),dom:reader.readDocument(text,name,true) }]));
    const compiled = JSON.stringify({format:DOM_FORMAT,bootstrap:reader.bootstrapHash,documents});
    const loader = new Loader(name => name === "compiled.json" ? compiled : texts[name] ?? readGrammarFile(name));
    // A production with no retained emission item makes its DOM malformed.
    // The cache must miss there, but source loading still reports scope first.
    const absentCarrier = file.includes("cycle-and-absent-carrier");
    assert.equal(loader.compiled.size,absentCarrier ? 1 : 2);
    let sourceReads = 0;
    const readDocument = loader.readDocument.bind(loader);
    loader.readDocument = (text,document,deferEmission) => {
      assert.ok(absentCarrier,"the matching recipe cache was bypassed");
      sourceReads++;
      return readDocument(text,document,deferEmission);
    };
    if (fixture.expect.error === "grammar") {
      assert.throws(() => loader.dialect("pipeline.md"),error => {
        assert.equal(error.kind,"grammar");
        assert.deepEqual({document:error.where.document,line:error.where.line,column:error.where.column},fixture.expect.where);
        assert.equal(error.code,fixture.expect.diagnostic);
        if (error.code === "ranked-choice-export") {
          assert.equal(error.group.rule,"text");
          assert.equal(error.option,0);
          assert.ok(error.expression);
        } else assert.match(error.message,/recipe dependency cycle:/);
        return true;
      });
    } else {
      const result = loader.dialect("pipeline.md").parse(fixture.input);
      assert.equal(result.ok,true);
      assert.equal(result.stages[0].output[0].value,"v");
      assert.equal(result.stages[0].output[0].image,"i");
    }
    assert.equal(sourceReads,absentCarrier ? 1 : 0);
  });
}
