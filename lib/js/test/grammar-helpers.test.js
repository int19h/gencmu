// The corpus brackets hide omitted terminators and pass no elisionOnly.
// These checks also inspect emitted tags, phonemes, and source positions.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { someNode } from "../src/walk.js";
import { bundledGrammarsDirectory, loadDialect, loadDialectSources, toBrackets } from "../src/node.js";

// The corpus's brackets hide elided terminators, so these check the elided
// boi of the experimental grammar directly (grammars/lojban/experimental/syntax.md, "Free
// modifiers, vocatives and indicators").
test("an elided boi after a number or a lerfu string is a node of the tree", () => {
  const dialect = loadDialect("lojban/experimental");
  const shown = (text, options = {}) => {
    const result = dialect.parse(text, options);
    assert.ok(result.ok, text);
    return toBrackets(result, { showElided: true });
  };
  assert.match(shown("li pa"), /pa ⟨boi⟩/);
  assert.match(shown("by klama"), /by ⟨boi⟩/);
  assert.doesNotMatch(shown("li pa boi"), /⟨boi⟩/);
  // A resolved parse, so elision-only writes the terminators back.
  const resolved = dialect.parse("li pa sei broda se'u");
  assert.equal(resolved.stages[resolved.stages.length - 1].verdict, "resolved");
  assert.ok(dialect.parse("li pa sei broda se'u", { elisionOnly: true }).ok);
  assert.match(shown("li pa sei broda se'u", { elisionOnly: true }), /pa \(⟨boi⟩/);
});

// grammars/lojban/experimental/syntax.md, "Selbri and tanru": a preposed group of linked
// arguments comes before a whole tanru-unit-1, and a condition removes the
// reading in which the whole unit takes a trailing group that the unit inside
// can take. So elision-only finds no other reading, and the tree stays.
test("preposed linked arguments keep their trees with elision-only", () => {
  const dialect = loadDialect("lojban/experimental");
  const texts = [
    "be mi klama be do be ti",
    "mi jai be do broda be ti be ta",
    "be mi klama be do",
    "be mi be'o klama be do be'o",
    "se be mi klama be do",
    "broda gi'e be mi ke klama ke'e be do be ti",
  ];
  for (const text of texts) {
    const plain = dialect.parse(text);
    const checked = dialect.parse(text, { elisionOnly: true });
    assert.ok(plain.ok, text);
    assert.ok(checked.ok, text);
    assert.equal(toBrackets(checked), toBrackets(plain), text);
  }
  const explicit = dialect.parse("be mi be'o klama be do be'o", { elisionOnly: true });
  assert.equal(explicit.stages[explicit.stages.length - 1].verdict, "unique");
});

// grammars/lojban/experimental/syntax.md, "Numbers, lerfu strings and mekso": a connective
// operator has one slot of free modifiers, so the xi after joi has one place.
test("a free modifier after a connective operator has one parse", () => {
  const dialect = loadDialect("lojban/experimental");
  const result = dialect.parse("li pa joi xi re boi re", { elisionOnly: true });
  assert.ok(result.ok);
  assert.equal(result.stages[result.stages.length - 1].verdict, "unique");
});

// A complete quote hides its contents' classes but retains their tree.
test("a Zantufa quote hides attached hesitation classes and retains its tree", () => {
  const dialect = loadDialect("lojban/zantufa");
  for (const text of ["lo'u miyy le'u", "lo'ai miyy le'ai"]) {
    const result = dialect.parse(text);
    assert.ok(result.ok, text);
    const words = result.stages.find((stage) => stage.name === "words");
    assert.equal(words.output.length, 1);
    assert.ok(!words.output[0].tags.has("Y"));
    assert.ok(someNode(words.tree, node => node.kind === "token" && words.input[node.token].value === "yy"));
  }
});

/** The output of the stage NAME of a parse of TEXT, which must succeed. */
function stageOutput(dialect, text, name) {
  const result = dialect.parse(text);
  assert.ok(result.ok, text);
  return result.stages.find((stage) => stage.name === name).output;
}

// grammars/lojban/common/stream.md gives an empty zoi body empty concatenation. Compound gaps
// retain surviving spaces without an opaque placeholder.
test("an empty zoi body has empty strings, and its letter word retains quote spacing", () => {
  const dialect = loadDialect("lojban/cll");
  const words = stageOutput(dialect, "zoi gy gy", "words");
  assert.equal(words.length, 1);
  assert.equal(words[0].value, "zoi gy gy");
  assert.equal(words[0].image, "zoi gy gy");
  assert.equal(words[0].insertedBy, undefined);
  const [letter] = stageOutput(dialect, "zoi gy gy bu", "words");
  assert.equal(letter.value, "zoi gy gy bu");
  assert.equal(letter.image, "zoi gy gy bu");
});

// grammars/lojban/common/zbalermorna.md: the token of the vowel after the shorthand mark
// covers the mark, so a word that begins with the shorthand begins at it.
test("the zbalermorna shorthand's vowel token covers its mark", () => {
  const dialect = loadDialect("lojban/bpfk");
  const text = "\u{ED8B}\u{EDA4}\u{EDA2}";
  const [vowel] = stageOutput(dialect, text, "phonemes");
  assert.equal(vowel.text, "\u{ED8B}\u{EDA4}");
  assert.deepEqual(vowel.source, [0, 2]);
  const [word] = stageOutput(dialect, text, "forms");
  assert.equal(word.text, text);
  assert.deepEqual(word.source, [0, 3]);
  assert.equal(word.value, "u'i");
});

// grammars/lojban/cll/morphology.md and grammars/lojban/common/forms.md: a Cy letter is never continued. So the
// general join of run-words, a continued word before an onset, never joins
// a Cy letter to the word after it, and only the Cy rule joins two letters.
test("a Cy letter carries cy and never continued", () => {
  const letters = stageOutput(loadDialect("lojban/cll"), "cyky", "forms");
  assert.deepEqual(letters.map((token) => token.image), ["cy", "ky"]);
  for (const letter of letters) assert.ok(letter.tags.has("Cy") && !letter.tags.has("Continued"), letter.image);
});

// grammars/lojban/cll/indicators.md: the greedy ranking reads a nai after a leading
// attitudinal into the leading run, with or without a ba'e before it, and
// after a text opener as at the start of the text. No condition decides it,
// so each of these texts has the verdict resolved in the indicator stage.
test("the ranking reads a nai after a leading attitudinal into the run", () => {
  const dialect = loadDialect("lojban/cll");
  for (const [text, labels] of [
    ["ui nai mi klama", ["ui", "nai", "mi", "klama"]],
    ["ui ba'e nai mi klama", ["ui", "nai", "mi", "klama"]],
    ["lu ui nai mi li'u", ["lu", "ui", "nai", "mi", "li'u"]],
  ]) {
    const result = dialect.parse(text);
    assert.ok(result.ok, text);
    const stage = result.stages.find((each) => each.name === "indicators");
    assert.equal(stage.verdict, "resolved", text);
    assert.deepEqual(stage.output.map((token) => token.image), labels, text);
  }
});

// grammars/lojban/experimental/syntax.md: the grammar reads no LA, since no word of the
// experimental lexicon has it. A probe document after the lexicon moves la
// from LE to LA, and then no rule reads la mlatu ku.
test("the experimental syntax reads no LA", () => {
  const root = bundledGrammarsDirectory();
  const sources = {};
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith(".md")) sources["grammars/" + path.relative(root, file).split(path.sep).join("/")] = fs.readFileSync(file, "utf8");
    }
  };
  walk(root);
  const include = '%include "../lojban/experimental/lexicon.md"';
  assert.ok(sources["grammars/lojban/experimental/pipeline.md"].includes(include));
  sources["grammars/lojban/experimental/pipeline.md"] = sources["grammars/lojban/experimental/pipeline.md"].replace(include, `${include}
  %include "../words/la-probe.md"`);
  sources["grammars/words/la-probe.md"] = '```jbogenbau\n%classifier lexicon\n  "la" ∉ LE\n  "la" ∈ LA\n```\n';
  const probe = loadDialectSources(sources, "grammars/lojban/experimental/pipeline.md");
  const result = probe.parse("la mlatu ku cu klama");
  const [la] = result.stages.find((stage) => stage.name === "forms").output;
  assert.ok(la.tags.has("LA") && !la.tags.has("LE"));
  assert.equal(result.ok, false);
  assert.equal(result.error.stage, "syntax");
  assert.equal(probe.parse("lo mlatu ku cu klama").ok, true);
});

// A quoted run cannot also pass through unread. The longest-form flag
// resolves competing quoted lengths, so that choice need not be unique.
// The selected tokens also pin the quoted form and its continuation.
test("a Zantufa ra'oi run emits its longest form rather than unread text", () => {
  const dialect = loadDialect("lojban/zantufa");
  for (const [text, verdict, form, images] of [
    ["ra'oibroda", "unique", "broda", ["ra'oi", "broda"]],
    ["mi ra'oibrodami", "resolved", "brod", ["mi", "ra'oi", "brod", "a", "mi"]],
  ]) {
    const result = dialect.parse(text, { until: "forms", elisionOnly: true });
    assert.ok(result.ok, text);
    const stage = result.stages[result.stages.length - 1];
    assert.equal(stage.verdict, verdict, text);
    assert.deepEqual(stage.output.filter((token) => !token.tags.has("PAUSE")).map((token) => token.image), images, text);
    assert.deepEqual(stage.output.filter((token) => token.tags.has("Rafsi-Form")).map((token) => token.value), [form], text);
  }
});
