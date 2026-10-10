// The stitched text of each bundled dialect loads as a dialect of one
// document with the same features, the same stages and the same parses
// (docs/design.md, "Pipelines"); and the precompiled DOMs change nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Loader, bundledGrammarsDirectory, loaderFromDirectory, loadDialect, loadDialectSources, stitchText, resultJson, Token, fnv1a64 } from "../src/node.js";
import { DOM_FORMAT } from "../src/dom.js";

// A stage's stitched grammar, apart from the documents and positions its
// rules came from.
function grammarOf(stage) {
  const strip = (value) => JSON.parse(JSON.stringify(value, (key, inner) => (key === "document" || key === "at" ? undefined : inner instanceof Set ? [...inner].sort() : inner)));
  return {
    name: stage.name,
    rules: [...stage.grammar.rules.values()].map(strip),
    resolution: stage.grammar.resolution,
    // Each constant's final type and value (engine §2).
    constants: [...stage.grammar.constants].map(([name, constant]) =>
      [name, constant.type, "pattern" in constant.value ? strip(constant.value.pattern) : "string" in constant.value ? constant.value.string : [...constant.value.set].sort()]),
    // Each classifier's items as written, and each implication's values
    // (engine §2).
    classifiers: stage.grammar.classifierItems.map((item) => strip(item.classifier)),
    implications: stage.grammar.implications.map((implication) => [[...implication.if].sort(), [...implication.then].sort()]),
  };
}

const TEXTS = {
  "cll-ebnf": ["mi klama le zarci", "mi klama sa do", "ми клама ле зарши"],
  kihei: ["ki'ei ko'a .i broda", "broda .i ki'ei ko'a sa ki'ei ko'e .i brode"],
  bpfk: ["lo lojbo cu tavla", "la djan. klama"],
  experimental: ["mi klama le zarci", "broda be ge mi gi do ce'e ti be'o"],
  zantufa: ["mi klama le zarci"],
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
    const file = path.join(bundledGrammarsDirectory(), relative.split("/").join(path.sep));
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

test("the stitched text keeps each constant's definitions in their places, so every stage gets its own values", () => {
  const block = (...lines) => "```jbogenbau\n" + lines.join("\n") + "\n```\n";
  const dialect = loadDialectSources({
    "p.md": block("%stage first", '%include "a.md"', '%include "shared.md"', "%stage second", '%include "b.md"', '%include "shared.md"'),
    "a.md": block("%ambiguity-resolution greedy", "%const $K ~a", "%rule thing '\\p{Any}'"),
    "b.md": block("%ambiguity-resolution greedy", "%const $K ~b", "%redefine-const $K $K ∪ ~c", "%rule thing ~a"),
    "shared.md": block("%rule text [{item}]", "%rule item $t(thing) <$K>", "%emits", "  $"),
  }, "p.md");
  const text = stitchText(dialect);
  assert.match(text, /^%redefine-const \$K \$K ∪ ~c$/m);
  const stitched = loadDialectSources({ "stitched.md": block(text) }, "stitched.md");
  assert.deepEqual(stitched.stages.map(grammarOf), dialect.stages.map(grammarOf));
  const tags = (result) => result.stages.map((stage) => stage.output.map((token) => [...token.tags].sort()));
  assert.deepEqual(tags(dialect.parse("x")), [[["a"]], [["b", "c"]]]);
  assert.deepEqual(resultJson(stitched.parse("x")), resultJson(dialect.parse("x")));
});

test("the stitched text keeps each classifier's entries as written, and a classifier and an implication survive the compiled cache", () => {
  const block = (...lines) => "```jbogenbau\n" + lines.join("\n") + "\n```\n";
  const sources = {
    "p.md": block("%stage main", '%include "a.md"', '%include "b.md"'),
    "a.md": block("%ambiguity-resolution greedy", "%const $I UI", "%implies $I ⟹ ~indicator", "%classifier lex", '  "mi" "do" ∈ KOhA',
      '  f? "ui"', '    ∈ UI', "%rule text [{word}]", "%rule word $w(W) <~w ∪ classify(phonemes($w), lex)>", "%emits", "  $"),
    "b.md": block("%classifier lex", '  f? "mi" ∉ KOhA', "%redefine-const $I $I ∪ KOhA"),
  };
  const dialect = loadDialectSources(sources, "p.md");
  const text = stitchText(dialect);
  // The entries stand as their author wrote them, line breaks included,
  // and not as the table that they make.
  assert.match(text, /^%classifier lex\n  "mi" "do" ∈ KOhA\n  f\? "ui"\n    ∈ UI$/m);
  assert.match(text, /^%classifier lex\n  f\? "mi" ∉ KOhA$/m);
  const stitched = loadDialectSources({ "stitched.md": block(text) }, "stitched.md");
  assert.deepEqual(stitched.features, dialect.features);
  assert.deepEqual(stitched.stages.map(grammarOf), dialect.stages.map(grammarOf));
  const tokens = ["mi", "ui"].map((word, index) => new Token(new Set(["W"]), [index, index + 1], [index * 3, index * 3 + 2], word, word, undefined));
  const tags = (result) => result.stages[0].output.map((token) => [...token.tags].sort());
  for (const features of [[], ["f"]]) {
    const expected = resultJson(dialect.parse("mi ui", { tokens, features, autoFeatures: false }));
    assert.deepEqual(resultJson(stitched.parse("mi ui", { tokens, features, autoFeatures: false })), expected);
  }
  assert.deepEqual(tags(dialect.parse("mi ui", { tokens, autoFeatures: false })), [["KOhA", "indicator", "w"], ["w"]]);
  assert.deepEqual(tags(dialect.parse("mi ui", { tokens, features: ["f"], autoFeatures: false })), [["w"], ["UI", "indicator", "w"]]);
  // A precompiled DOM of each document serves the same parses.
  const compiled = JSON.stringify({ format: DOM_FORMAT, bootstrap: dialect.loader.bootstrapHash, documents: Object.fromEntries(["a.md", "b.md"].map((file) =>
    [file, { hash: fnv1a64(sources[file]), dom: dialect.loader.documentDom(file) }])) });
  const cached = loadDialectSources({ ...sources, "compiled.json": compiled }, "p.md");
  assert.equal(cached.loader.compiled.size, 2);
  assert.deepEqual(cached.stages.map(grammarOf), dialect.stages.map(grammarOf));
  for (const features of [[], ["f"]]) {
    assert.deepEqual(resultJson(cached.parse("mi ui", { tokens, features, autoFeatures: false })), resultJson(dialect.parse("mi ui", { tokens, features, autoFeatures: false })));
  }
});

test("a chain of 20,000 includes loads and stitches on an ordinary stack", () => {
  // The splice and the stitch keep the chain in a stack of their own, so
  // the call stack does not bound its length. A recursion stops near 6,000.
  const block = (...lines) => "```jbogenbau\n" + lines.join("\n") + "\n```\n";
  const depth = 20000;
  /** @type {Record<string, string>} */
  const sources = {};
  for (let index = 0; index < depth; index++) sources[`d${index}.md`] = block(`%include "d${index + 1}.md"`);
  sources[`d${depth}.md`] = block("%stage main", "%ambiguity-resolution greedy", "%rule text A");
  // Precompiled DOMs spare the test a read of each document, which would
  // cost most of its time. A DOM of one link serves for every link.
  const link = loadDialectSources({ "d0.md": sources["d0.md"], "d1.md": sources[`d${depth}.md`] }, "d0.md").loader;
  const linkDom = link.documentDom("d0.md");
  const documents = Object.fromEntries(Array.from({ length: depth }, (_, index) => [`d${index}.md`, {
    hash: fnv1a64(sources[`d${index}.md`]),
    dom: { ...linkDom, directives: linkDom.directives.map((directive) => ({ ...directive, args: [`d${index + 1}.md`] })) },
  }]));
  sources["compiled.json"] = JSON.stringify({ format: DOM_FORMAT, bootstrap: link.bootstrapHash, documents });
  const dialect = loadDialectSources(sources, "d0.md");
  assert.equal(dialect.loader.compiled.size, depth);
  assert.deepEqual(dialect.stages.map((stage) => stage.name), ["main"]);
  const text = stitchText(dialect);
  assert.match(text, new RegExp(`^\\(\\* "d${depth}\\.md" \\*\\)$`, "m"));
  const stitched = loadDialectSources({ "stitched.md": block(text) }, "stitched.md");
  assert.deepEqual(stitched.stages.map(grammarOf), dialect.stages.map(grammarOf));
});

test("stage extensions and replacements survive textual stitching", () => {
  const body = "%features global\n%stage a\n%ambiguity-resolution greedy\n%rule text 'x' <X> %emits $\n" +
    "%stage b\n%ambiguity-resolution greedy\n%rule text X\n" +
    "%extend-stage a\n%extend-rule text 'b' <X> %emits $\n" +
    "%redefine-stage a\n%ambiguity-resolution greedy\n%rule text 'a' <X> %emits $\n" +
    "%extend-stage a\n%extend-rule text 'c' <X> %emits $";
  const original = loadDialectSources({ "p.md": `\`\`\`jbogenbau\n${body}\n\`\`\`` }, "p.md");
  const text = stitchText(original);
  assert.match(text, /%extend-stage a/);
  assert.match(text, /%redefine-stage a/);
  const stitched = loadDialectSources({ "all.md": `\`\`\`jbogenbau\n${text}\n\`\`\`` }, "all.md");
  assert.deepEqual(stitched.features, original.features);
  for (const input of ["a", "b", "c", "x"])
    assert.deepEqual(resultJson(stitched.parse(input)), resultJson(original.parse(input)));
});
