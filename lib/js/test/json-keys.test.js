import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadDialectSources, fnv1a64, GencmuError } from "../src/node.js";

const fixtures = JSON.parse(fs.readFileSync(new URL("../../../tests/json-keys.json", import.meta.url), "utf8"));
const bundled = fs.readFileSync(new URL("../../../grammars/notation/bootstrap.json", import.meta.url), "utf8");
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
    const load = () => loadDialectSources({ ...sources, "notation/bootstrap.json": mutate(bundled, item) }, "p.md");
    if (item.loads) assert.ok(load().parse("a").ok);
    else assert.throws(load, (error) => {
      assert.ok(error instanceof GencmuError);
      assert.equal(error.kind, "grammar");
      assert.deepEqual(error.where, { document: "notation/bootstrap.json" });
      assert.ok(error.message.startsWith("notation/bootstrap.json:"));
      return true;
    });
  });
}
for (const item of fixtures.compiled) {
  test(item.description, () => {
    const cache = mutate(fixtures.cache, item).replaceAll("@bootstrap@", fnv1a64(bundled)).replaceAll("@source@", fnv1a64(fixtures.grammar));
    const document = item.document ?? "g.md";
    const caseSources = { "p.md": `\`\`\`jbogenbau\n%stage main\n%include ${JSON.stringify(document)}\n\`\`\`\n`, [document]: fixtures.grammar };
    const dialect = loadDialectSources({ ...caseSources, "compiled.json": cache }, "p.md");
    assert.equal(dialect.parse("a").ok, !item.cached);
    assert.equal(dialect.parse("b").ok, item.cached);
  });
}
