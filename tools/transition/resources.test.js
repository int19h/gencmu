import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createTransitionCompiler } from "../transition-compiler.js";
import { notation50Resources } from "../notation50-resources.js";
import { layoutProblems } from "../alternatives.js";

const fenced = source => "\x60\x60\x60jbogenbau\n" + source + "\n\x60\x60\x60";
const scope = name => `unicode-names 15.1.0\nname ${name} LOCAL NAME\n`;
const parents = {
  "a.md": fenced('%names "a.txt"\n%include "middle.md"'),
  "b.md": fenced('%names "b.txt"\n%include "middle.md"'),
  "middle.md": fenced('%include "shared.md"'),
  "shared.md": fenced('%rule text "‹LOCAL NAME›"'),
  "a.txt": scope("E000"),
  "b.txt": scope("E001"),
};

test("layout inspects long constructors and condition continuation in format 50", () => {
  const compiler = createTransitionCompiler();
  const source = fenced('%const $OUTPUTS\n  {One, Two,\n   Three}\n%rule text A\n%conditions\n  $ ∨\n  $');
  const messages = layoutProblems(source, compiler.compileDocument(source), "layout.md");
  assert.deepEqual(messages, [
    "layout.md:3: put one entry on each line of a long constructor",
    "layout.md:8: indent a continued condition at least two columns past its start",
  ]);
});

test("only plain strings can share a line in a long list", () => {
  const compiler = createTransitionCompiler();
  const table = entry => fenced(`%const $LEXICON
  {BAI: ["ba'i", ${entry},
         "bau", "be'i"],
   CAI: ["cai"]}`);
  const problems = entry => {
    const source = table(entry);
    return layoutProblems(source, compiler.compileDocument(source), "table.md");
  };
  assert.deepEqual(problems('"bai"'), []);
  for (const entry of ['(1 = 1)? "bai"', 'f? "bai"', '*["bai"]', '("bai")']) {
    assert.deepEqual(problems(entry), [
      "table.md:3: put one entry on each line of a long constructor",
    ], entry);
  }
});

test("a continued term belongs on a separate line past its owner", () => {
  const compiler = createTransitionCompiler();
  const bad = fenced("%rule text A → {One,\n                 Two}");
  const good = fenced("%rule text A\n               → {One,\n                  Two}");
  assert.deepEqual(layoutProblems(bad, compiler.compileDocument(bad), "terms.md"), [
    "terms.md:2: put a continued term on a line four columns past its owner",
  ]);
  assert.deepEqual(layoutProblems(good, compiler.compileDocument(good), "terms.md"), []);
});

test("an unchanged intermediate include keeps both leaf readings", () => {
  const documents = { ...parents, "p.md": fenced('%stage main\n%include "a.md"\n%include "b.md"') };
  const compiler = createTransitionCompiler(file => documents[file]);
  const reading = compiler.compilePipeline("p.md");
  assert.deepEqual(reading["shared.md"].readings.map(({ entry, inherited }) =>
    [inherited, entry.dom.rules[0].alternatives[0].expr.literal.string]), [
    [["a.txt"], "\uE000"], [["b.txt"], "\uE001"],
  ]);
  const fingerprints = reading["shared.md"].readings.map(({ entry, inherited }) =>
    Object.hasOwn(entry.names, inherited[0]));
  assert.deepEqual(fingerprints, [true, true]);
  documents["a.md"] = documents["a.md"].replace("middle.md", "shared.md");
  documents["b.md"] = documents["b.md"].replace("middle.md", "shared.md");
  assert.equal(compiler.compilePipeline("p.md")["shared.md"].readings.length, 2);
});

for (const [target, message] of [["missing.md", /was not found/], ["p.md", /includes itself/]]) {
  test(`the include of ${target} reports the directive and chain`, () => {
    const documents = { "p.md": fenced('%include "q.md"'), "q.md": fenced(`%include "${target}"`) };
    assert.throws(() => createTransitionCompiler(file => documents[file]).compilePipeline("p.md"), error => {
      assert.match(error.description, message);
      assert.ok(error.description.includes(`p.md → q.md → ${target}`));
      assert.deepEqual(error.where, { document: "q.md", line: 2, column: 1 });
      return true;
    });
  });
}

test("resource generation keeps scoped documents and separates the bootstrap family cache", t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "notation-resources-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const repository = new URL("../../", import.meta.url);
  const write = (file, text) => {
    const target = path.join(temporary, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  };
  for (const file of ["data/notation-bundles.json", "data/unicode/unicode.txt",
    "data/unicode/unicode-properties.txt", "data/unicode/unicode-names.txt"]) {
    write(file, fs.readFileSync(new URL(file, repository)));
  }
  const base = "grammars50/gencmu/";
  write(base + "jbogenbau/pipeline.md", fenced("%stage main\n%rule text ε"));
  write(base + "other/pipeline.md", fenced('%stage main\n%include "a.md"\n%include "b.md"'));
  for (const [file, source] of Object.entries(parents)) write(base + "other/" + file, source);
  for (const name of ["\u{10000}.txt", "\uE000.txt"]) {
    write(base + "other/" + name, "unicode-names 15.1.0\n");
  }
  write(base + "other/a.md", fenced('%names "a.txt"\n%names "\u{10000}.txt"\n%names "‹U+E000›.txt"\n%include "middle.md"'));
  const orphan = base + "other/orphan.md";
  write(orphan, fenced('%rule text "‹LOCAL NAME›"'));
  const resources = notation50Resources(temporary);
  const file = base + "other/shared.md";
  assert.equal(resources.sourceDocuments[file].dom.rules[0].alternatives[0].expr.literal.string, "\uE000");
  const caches = resources.cacheFiles();
  const optional = JSON.parse(caches.get("data/preparsed50/gencmu-optional.json"));
  assert.ok(Object.hasOwn(optional.documents, base + "other/pipeline.md"));
  assert.ok(resources.sources.includes(orphan));
  assert.equal(Object.hasOwn(resources.sourceDocuments, orphan), false);
  assert.equal(Object.hasOwn(optional.documents, orphan), false);
  assert.equal(Object.hasOwn(optional.documents, file), false);
  const names = Object.keys(optional.bundledNames);
  assert.ok(names.includes(base + "other/a.txt"));
  assert.ok(names.includes(base + "other/b.txt"));
  assert.ok(names.indexOf(base + "other/\uE000.txt") < names.indexOf(base + "other/\u{10000}.txt"));
});
