// What the shared corpus cannot test in the bundled grammars. Some helper
// rules are one: the rest of the grammar reads the same texts either way, so
// each check loads a bundled dialect with one more syntax document, whose
// `text` is the helper, and parses a text with it. Elided terminators are
// another, since the corpus's brackets hide them. The corpus also passes no
// elisionOnly and compares no emitted tags, phonemes or sources, so the last
// checks here do that.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Loader, bundledGrammarsDirectory, loadDialect, loadDialectSources, toBrackets } from "../src/node.js";

// The dialect NAME, with its syntax stage read as the helper RULE.
function helperDialect(name, rule) {
  const pipeline = `dialects/${name}.md`;
  const probe = "syntax/helper-probe.md";
  const loader = new Loader((relative) => {
    if (relative === probe) return "```jbogenbau\n%redefine-rule text\n  " + rule + "\n```\n";
    const file = path.join(bundledGrammarsDirectory(), ...relative.split("/"));
    if (!fs.existsSync(file)) return undefined;
    const text = fs.readFileSync(file, "utf8");
    if (relative !== pipeline) return text;
    // The syntax stage is the pipeline's last, so an %include at the end of
    // the pipeline adds the helper to it.
    assert.match(text, /^%stage syntax$/m);
    return text + `\n\`\`\`jbogenbau\n%include "../${probe}"\n\`\`\`\n`;
  });
  return loader.dialect(pipeline);
}

function reads(dialect, text) {
  const result = dialect.parse(text);
  return result.ok;
}

test("camxes-exp's tag_bo_ke_bridi_tail takes free modifiers only after its optional cu", () => {
  const helper = helperDialect("experimental", "tag-bo-ke-bridi-tail");
  assert.equal(reads(helper, "pu ke sei brodi se'u cu brode"), false);
  assert.equal(reads(helper, "pu ke cu sei brodi se'u brode"), true);
  assert.equal(reads(helper, "pu ke sei brodi se'u brode"), true);
  assert.equal(reads(helper, "pu bo brode"), true);
});

test("camxes-exp's tag_bo_subsentence takes no free modifier before .i", () => {
  const helper = helperDialect("experimental", "tag-bo-subsentence");
  assert.equal(reads(helper, "pu bo sei brodi se'u .i"), false);
  assert.equal(reads(helper, "pu bo .i"), true);
});

// The corpus's brackets hide elided terminators, so these check the elided
// boi of the experimental grammar directly (syntax/experimental.md, "Free
// modifiers, vocatives and indicators").
test("an elided boi after a number or a lerfu string is a node of the tree", () => {
  const dialect = loadDialect("experimental");
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

// syntax/experimental.md, "Selbri and tanru": a preposed group of linked
// arguments comes before a whole tanru-unit-1, and a condition removes the
// reading in which the whole unit takes a trailing group that the unit inside
// can take. So elision-only finds no other reading, and the tree stays.
test("preposed linked arguments keep their trees with elision-only", () => {
  const dialect = loadDialect("experimental");
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

// syntax/experimental.md, "Numbers, lerfu strings and mekso": a connective
// operator has one slot of free modifiers, so the xi after joi has one place.
test("a free modifier after a connective operator has one parse", () => {
  const dialect = loadDialect("experimental");
  const result = dialect.parse("li pa joi xi re boi re", { elisionOnly: true });
  assert.ok(result.ok);
  assert.equal(result.stages[result.stages.length - 1].verdict, "unique");
});

// words/zantufa-stream.md: a hesitation attached to the word before it is a
// word of class Y, but inside a lo'u or lo'ai quote it is tagged word only,
// as the other words of the quote are.
test("an attached hesitation in a Zantufa quote carries only the tag word", () => {
  const dialect = loadDialect("zantufa");
  for (const text of ["lo'u miyy le'u", "lo'ai miyy le'ai"]) {
    const result = dialect.parse(text);
    assert.ok(result.ok, text);
    const words = result.stages.find((stage) => stage.name === "words").output;
    const yy = words.find((token) => token.phonemes === "yy");
    assert.ok(yy, text);
    assert.deepEqual([...yy.tags], ["word"], text);
  }
});

/** The output of the stage NAME of a parse of TEXT, which must succeed. */
function stageOutput(dialect, text, name) {
  const result = dialect.parse(text);
  assert.ok(result.ok, text);
  return result.stages.find((stage) => stage.name === name).output;
}

// words/stream.md: the body of an empty zoi quote is an empty opaque part.
// So it sounds ?, and a letter word over the quote keeps the ?, with no pause
// after it, since the one pause between the delimiters comes before the body.
test("an empty zoi body sounds ?, and so does a letter word over it", () => {
  const dialect = loadDialect("cll-ebnf");
  const body = stageOutput(dialect, "zoi gy gy", "words").find((token) => token.tags.has("quoted-text"));
  assert.ok(body);
  assert.equal(body.phonemes, "?");
  assert.equal(body.insertedBy, undefined);
  const [letter] = stageOutput(dialect, "zoi gy gy bu", "words");
  assert.equal(letter.phonemes, "zoi.gy.?gy.bu");
});

// phonemes/zbalermorna.md: the token of the vowel after the shorthand mark
// covers the mark, so a word that begins with the shorthand begins at it.
test("the zbalermorna shorthand's vowel token covers its mark", () => {
  const dialect = loadDialect("bpfk");
  const text = "\u{ED8B}\u{EDA4}\u{EDA2}";
  const [vowel] = stageOutput(dialect, text, "phonemes");
  assert.equal(vowel.text, "\u{ED8B}\u{EDA4}");
  assert.deepEqual(vowel.source, [0, 2]);
  const [word] = stageOutput(dialect, text, "forms");
  assert.equal(word.text, text);
  assert.deepEqual(word.source, [0, 3]);
  assert.equal(word.phonemes, "u'i");
});

// words/cll.md and words/forms.md: a Cy letter is never continued. So the
// general join of run-words, a continued word before an onset, never joins
// a Cy letter to the word after it, and only the Cy rule joins two letters.
test("a Cy letter carries cy and never continued", () => {
  const letters = stageOutput(loadDialect("cll-ebnf"), "cyky", "forms");
  assert.deepEqual(letters.map((token) => token.label), ["cy", "ky"]);
  for (const letter of letters) assert.ok(letter.tags.has("cy") && !letter.tags.has("continued"), letter.label);
});

// indicators/cll.md: the greedy ranking reads a nai after a leading
// attitudinal into the leading run, with or without a ba'e before it, and
// after a text opener as at the start of the text. No condition decides it,
// so each of these texts has the verdict resolved in the indicator stage.
test("the ranking reads a nai after a leading attitudinal into the run", () => {
  const dialect = loadDialect("cll-ebnf");
  for (const [text, labels] of [
    ["ui nai mi klama", ["ui", "nai", "mi", "klama"]],
    ["ui ba'e nai mi klama", ["ui", "nai", "mi", "klama"]],
    ["lu ui nai mi li'u", ["lu", "ui", "nai", "mi", "li'u"]],
  ]) {
    const result = dialect.parse(text);
    assert.ok(result.ok, text);
    const stage = result.stages.find((each) => each.name === "indicators");
    assert.equal(stage.verdict, "resolved", text);
    assert.deepEqual(stage.output.map((token) => token.label), labels, text);
  }
});

// syntax/experimental.md: the grammar reads no LA, since no word of the
// experimental lexicon has it. A probe document after the lexicon moves la
// from LE to LA, and then no rule reads la mlatu ku.
test("the experimental syntax reads no LA", () => {
  const root = bundledGrammarsDirectory();
  const sources = {};
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith(".md")) sources[path.relative(root, file).split(path.sep).join("/")] = fs.readFileSync(file, "utf8");
    }
  };
  walk(root);
  const include = '%include "../words/lexicon-experimental.md"';
  assert.ok(sources["dialects/experimental.md"].includes(include));
  sources["dialects/experimental.md"] = sources["dialects/experimental.md"].replace(include, `${include}\n  %include "../words/la-probe.md"`);
  sources["words/la-probe.md"] = '```jbogenbau\n%classifier lexicon\n  "la" ∉ LE\n  "la" ∈ LA\n```\n';
  const probe = loadDialectSources(sources, "dialects/experimental.md");
  const result = probe.parse("la mlatu ku cu klama");
  const [la] = result.stages.find((stage) => stage.name === "forms").output;
  assert.ok(la.tags.has("LA") && !la.tags.has("LE"));
  assert.equal(result.ok, false);
  assert.equal(result.error.stage, "syntax");
  assert.equal(probe.parse("lo mlatu ku cu klama").ok, true);
});

// words/forms.md and words/zantufa.md: a run that reads as words is never
// unread too, and Zantufa's ra'oi forms are such a run. So the forms
// stage has one parse of a ra'oi quote glued to its ra'oi, which the corpus
// cannot see, since it pins the verdict of the last stage only.
test("a Zantufa ra'oi run is not also unread in the forms stage", () => {
  const dialect = loadDialect("zantufa");
  for (const text of ["ra'oibroda", "mi ra'oibrodami"]) {
    const result = dialect.parse(text, { until: "forms", elisionOnly: true });
    assert.ok(result.ok, text);
    assert.equal(result.stages[result.stages.length - 1].verdict, "unique", text);
  }
});
