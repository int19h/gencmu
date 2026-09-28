// The stitched text of each bundled dialect loads as a dialect of one
// document with the same features, the same stages and the same parses
// (docs/design.md, "Pipelines"); and the precompiled DOMs change nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Loader, bundledGrammarsDirectory, loaderFromDirectory, loadDialect, loadDialectSources, stitchText, resultJson } from "../src/node.js";

// A stage's stitched grammar, apart from the documents and positions its
// rules came from.
function grammarOf(stage) {
  const strip = (value) => JSON.parse(JSON.stringify(value, (key, inner) => (key === "document" || key === "at" ? undefined : inner)));
  return {
    name: stage.name,
    rules: [...stage.grammar.rules.values()].map(strip),
    elidable: [...stage.grammar.elidable],
    resolution: stage.grammar.resolution,
  };
}

const TEXTS = {
  "cll-ebnf": ["mi klama le zarci", "mi klama sa do", "ми клама ле зарши"],
  bpfk: ["lo lojbo cu tavla", "la djan. klama"],
  experimental: ["mi klama le zarci", "broda be ge mi gi do ce'e ti be'o"],
  zantufa: ["mi klama le zarci"],
  "date-words": ["ca na'a 1989 la .berlin. bitmu cu se daspo", "mi klama de'i li 1989"],
  notation: ["%rule a B | C"],
};

for (const [name, texts] of Object.entries(TEXTS)) {
  test(`the stitched ${name} dialect is the ${name} dialect`, () => {
    const dialect = loadDialect(name);
    const text = stitchText(dialect);
    assert.doesNotMatch(text, /^\s*%include\b/m);
    const stitched = loadDialectSources({ "stitched.md": "```jbogenbau\n" + text + "```\n" }, "stitched.md");
    assert.deepEqual(stitched.features, dialect.features);
    assert.deepEqual(stitched.stages.map(grammarOf), dialect.stages.map(grammarOf));
    for (const sample of texts) assert.deepEqual(resultJson(stitched.parse(sample)), resultJson(dialect.parse(sample)), sample);
  });
}

test("a bundled dialect loads the same with and without its precompiled DOMs", () => {
  const uncached = new Loader((relative) => {
    if (relative === "compiled.json") return undefined;
    const file = path.join(bundledGrammarsDirectory(), ...relative.split("/"));
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
  });
  const cached = loaderFromDirectory();
  assert.ok(cached.compiled.size > 0);
  for (const name of Object.keys(TEXTS)) {
    const a = cached.dialect(`dialects/${name}.md`);
    const b = uncached.dialect(`dialects/${name}.md`);
    assert.deepEqual(b.features, a.features);
    assert.deepEqual(b.stages.map(grammarOf), a.stages.map(grammarOf));
  }
});

test("a document's path cannot end the comment that names it in the stitched text", () => {
  const block = (...lines) => "```jbogenbau\n" + lines.join("\n") + "\n```\n";
  const dialect = loadDialectSources({
    "p.md": block("%stage main", '%include "g*)h.md"'),
    "g*)h.md": block("%ambiguity-resolution greedy", "%rule text A"),
  }, "p.md");
  const text = stitchText(dialect);
  assert.match(text, /^\(\* "g\*\\u\{29\}h\.md" \*\)$/m);
  const stitched = loadDialectSources({ "stitched.md": block(text) }, "stitched.md");
  assert.deepEqual(stitched.stages.map(grammarOf), dialect.stages.map(grammarOf));
});
