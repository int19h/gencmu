import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadPipelineSources as loadPortable } from "../src/index.js";
import { loadPipelineSources, fnv1a64, GencmuError } from "../src/node.js";

const fixtures = JSON.parse(fs.readFileSync(new URL("../../../tests/json-keys.json", import.meta.url), "utf8"));
const bundled = fs.readFileSync(new URL("../../../data/preparsed/gencmu.json", import.meta.url), "utf8");
const unicode = fs.readFileSync(new URL("../../../data/unicode/unicode.txt", import.meta.url), "utf8");
const pipeline = '```jbogenbau\n%stage main\n%include "g.md"\n```\n';
const sources = { "p.md": pipeline, "g.md": fixtures.grammar };
function mutate(text, item) {
  assert.ok(text.includes(item.find), item.description);
  return text.replace(item.find, item.replace);
}
for (const item of fixtures.values) {
  test(item.description, () => assert.deepEqual(JSON.parse(item.json), item.expect));
}
for (const item of fixtures.bootstrap) {
  test(item.description, () => {
    const load = () => loadPipelineSources({ ...sources, "data/preparsed/gencmu.json": mutate(bundled, item) }, "p.md");
    if (item.loads) assert.ok(load().parse("a").ok);
    else assert.throws(load, (error) => {
      assert.ok(error instanceof GencmuError);
      assert.equal(error.kind, "grammar");
      assert.deepEqual(error.where, { document: "data/preparsed/gencmu.json" });
      assert.ok(error.message.startsWith("data/preparsed/gencmu.json:"));
      return true;
    });
  });
}
for (const item of fixtures.preparsed) {
  test(item.description, () => {
    const cache = mutate(fixtures.cache, item).replaceAll("@bootstrap@", fnv1a64(bundled)).replaceAll("@source@", fnv1a64(fixtures.grammar)).replaceAll("@unicode@", fnv1a64(unicode));
    const document = item.document ?? "g.md";
    const caseSources = { "grammars/test/p.md": `\`\`\`jbogenbau
%stage main
%include ${JSON.stringify(document)}
\`\`\`
`, ["grammars/test/" + document]: fixtures.grammar };
    for (const [path, value] of Object.entries(item.sources || {})) {
      const text = value === "@bundled-names@" ? fs.readFileSync(new URL("../../../data/unicode/unicode-names.txt",import.meta.url),"utf8") : value === "@unicode-16@" ? unicode.replace("unicode 15.1.0", "unicode 16.0.0") : value === "@matching-cache@" ? fixtures.cache.replaceAll("@bootstrap@",fnv1a64(bundled)).replaceAll("@source@",fnv1a64(fixtures.grammar)).replaceAll("@unicode@",fnv1a64(unicode)) : value;
      Object.defineProperty(caseSources,path,{value:text,enumerable:true,configurable:true,writable:true});
    }
    const load = () => (item.portable ? loadPortable : loadPipelineSources)({
      "data/unicode/unicode.txt": unicode, "data/preparsed/gencmu.json": bundled, ...caseSources, "data/preparsed/test.json": cache
    }, "grammars/test/p.md");
    if (item.error) {
      assert.throws(load, error => {
        assert.ok(error instanceof GencmuError);
        assert.equal(error.kind,"grammar");
        assert.equal(error.where.document,item.error.document);
        assert.equal(error.where.line,item.error.line);
        return true;
      });
      return;
    }
    const pipeline = load();
    assert.equal(pipeline.parse("a").ok, !item.cached);
    assert.equal(pipeline.parse("b").ok, item.cached);
    if (item.tags) assert.deepEqual([...pipeline.parse("b").tree.tags], item.tags);
  });
}
