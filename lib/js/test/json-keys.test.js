import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadDialectSources as loadPortable } from "../src/index.js";
import { loadDialectSources, fnv1a64, GencmuError } from "../src/node.js";

const fixtures = JSON.parse(fs.readFileSync(new URL("../../../tests/json-keys.json", import.meta.url), "utf8"));
const bundled = fs.readFileSync(new URL("../../../grammars/notation/bootstrap.json", import.meta.url), "utf8");
const unicode = fs.readFileSync(new URL("../../../grammars/unicode.txt", import.meta.url), "utf8");
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
    const cache = mutate(fixtures.cache, item).replaceAll("@bootstrap@", fnv1a64(bundled)).replaceAll("@source@", fnv1a64(fixtures.grammar)).replaceAll("@unicode@", fnv1a64(unicode));
    const document = item.document ?? "g.md";
    const caseSources = { "p.md": `\`\`\`jbogenbau
%stage main
%include ${JSON.stringify(document)}
\`\`\`
`, [document]: fixtures.grammar };
    for (const [path, value] of Object.entries(item.sources || {})) {
      caseSources[path] = value === "@bundled-names@" ? fs.readFileSync(new URL("../../../grammars/unicode-names.txt",import.meta.url),"utf8") : value === "@unicode-16@" ? unicode.replace("unicode 15.1.0", "unicode 16.0.0") : value;
    }
    const load = () => (item.portable ? loadPortable : loadDialectSources)({
      "unicode.txt": unicode, "notation/bootstrap.json": bundled, ...caseSources, "compiled.json": cache
    }, "p.md");
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
    const dialect = load();
    assert.equal(dialect.parse("a").ok, !item.cached);
    assert.equal(dialect.parse("b").ok, item.cached);
    if (item.tags) assert.deepEqual([...dialect.parse("b").tree.tags], item.tags);
  });
}
