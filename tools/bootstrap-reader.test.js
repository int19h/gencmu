import assert from "node:assert/strict";
import { test } from "node:test";
import { readDocument } from "./bootstrap-reader.js";
import fs from "node:fs";
import { Loader } from "../lib/js/src/dialect.js";

const read = (source) => readDocument(`\x60\x60\x60jbogenbau\n${source}\n\x60\x60\x60`, "case.md");

test("a capture retains stacked tag and exact value tests", () => {
  assert.deepEqual(read('%rule r $x:A<B>="A,B"').rules[0].alternatives, [{
    guards: [],
    expr: {
      capture: "x",
      expr: {
        test: "=", value: { string: "A,B" },
        expr: {
          test: "tags", requirements: [{ negated: false, value: { tag: "B" } }],
          expr: { ref: "A" },
        },
      },
    },
  }]);
});

test("header recipes and an implicit whole emission have distinct channels", () => {
  const rule = read('%rule r := "v" :- "i" | "a" %emits').rules[0];
  assert.deepEqual(rule.value, { concat: [{ string: "v" }] });
  assert.deepEqual(rule.image, { concat: [{ string: "i" }] });
  assert.deepEqual(rule.alternatives, [{ guards: [], expr: { literal: { string: "a" } } }]);
  assert.deepEqual(rule.emit, { items: [{ capture: "" }] });
});

test("an inserted token accepts an empty tag set and a string recipe", () => {
  assert.deepEqual(read('%rule r A %emits ε :: ∅ := "x"').rules[0].emit, {
    items: [{ insert: true, tags: { emptySet: true }, value: { concat: [{ string: "x" }] } }],
  });
});

test("numeric escapes decode exact scalars and dollars remain plain text", () => {
  assert.deepEqual(read('%rule r "a$(_0301)$$"').rules[0].alternatives[0].expr, {
    literal: { string: "a$(_0301)$$" },
  });
  assert.deepEqual(read('%rule r "‹U+0041›"').rules[0].alternatives[0].expr, {
    literal: { string: "A" },
  });
});

test("feature names retain main's initial-case rule", () => {
  assert.deepEqual(read("%features Cbm Other").directives[0].args, ["Cbm", "Other"]);
  assert.deepEqual(read("%rule r Cbm? _").rules[0].alternatives[0].guards, [
    { feature: "Cbm", kind: "gate", negated: false },
  ]);
});

test("the coordinator's error examples retain their columns", () => {
  for (const [source, column] of [
    ["%rule r $x:A<B><C>", 16], ["%stage $X", 1], ["%rule Foo A", 7],
    ["%rule r ¬cbm! A", 14], ["%rule r ¬ cbm? A", 9],
    ['%const "‹U+0041›" "x"', 8], ['%rule r A := ∪ "a"', 14],
    ['%include "a.md" "b$c.md"', 1],
  ]) {
    assert.throws(() => read(source), (error) => {
      assert.equal(error.where.document, "case.md");
      assert.equal(error.where.line, 2, source);
      assert.equal(error.where.column, column, source);
      return true;
    });
  }
});

test("a later syntax failure precedes an earlier reader failure", () => {
  assert.throws(() => read('%rule Foo A\n%rule r ("a"'), (error) => {
    assert.equal(error.where.line, 3);
    return true;
  });
});

test("ranked syntax diagnostics follow the failing token and group", () => {
  for (const source of ["%rule r A ≻", "%rule r A ≻ B | C", "%rule r A | B ≻ C"]) {
    assert.throws(() => read(source), (error) => {
      assert.equal(error.where.code, "ranked-choice-syntax", source);
      return true;
    });
  }
  assert.throws(() => read("%rule r A ≻ B ]"), error => {
    assert.equal(error.where.code, undefined);
    return true;
  });
});

test("the bootstrap and engine readers agree on the notation documents", () => {
  const loader = notationLoader();
  for (const file of ["grammars/gencmu/jbogenbau/lexical.md", "grammars/gencmu/jbogenbau/syntax.md", "grammars/gencmu/jbogenbau/pipeline.md"]) {
    const text = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.deepEqual(loader.readDocument(text, file), readDocument(text, file), file);
  }
});

test("both readers admit written forms, including plain dollar text", () => {
  const loader = notationLoader();
  for (const source of [
    "%rule r $x:A≠\"x\" %conditions $x.value ≠ \"x\", \"a\" ∉ \"a b\".split(\" \"), A ⊈ $x.tags, $x ≇ #A",
    '%rule r "é$(_0301)"', '%rule r "a$(_0301)̣"', '%rule r "$(_00E9)"', '%include "café.md"',
    "%features Cbm Other", '%include "a$b.md"',
    '%rule r "a".."‹U+007A›"', '%rule r _<¬_General_Category_Uppercase_Letter>≠"x"',
    '%rule r := "v" :- "i" | "a" %emits',
    '%rule r := $.emitted.image :- "x" | _ %emits',
    '%rule r A %emits ε :: ∅ := "x"',
    '%rule r $a:A $b:B %emits ($a) $b :- $b.image',
    '%rule r $x:A %conditions $x.value = "X,Y", $x.image ≠ ""',
    '%rule r $l:A $r:B %conditions $l.value ++ $r.value ∈ "ab".split(" "), ($l.value ++ $r.value) = "ab"',
    '%rule r $x:A %conditions $x.without-elision.onward.begins(next)',
    "%rule r $x:A %conditions $x ≅ #A<B>=\"x\"",
    "%rule r $x:A %conditions $x ≅ #« A B »",
    "%rule r $x:A %conditions $x ≅ #« A « B C » »",
    '%const $S "a" ++ "‹U+0301›" ++ "$"', '%const $S "x".split("y")',
    '%const $S "ab" "bc"', '%const $S ("ab" "bc") ∩ ("bc" ∪ "cd")',
    '%const $S "ab".ngrams(2)', '%const $S "ab".ngrams(99999999999999999999)',
    '%rule r A %conditions $.begins(B | r), $.matches(r | A)',
    '%rule r A %conditions $.begins(r | r | A | A), $.matches((r))',
    '%classifier words "a" "$(KEY)" ∈ AB', '%implies A B ⟹ C D',
    '%rule r :: ($x ⟹ _General_Category_Uppercase_Letter) ∩ $x.tags | $x:A',
    '%rule r A %erased', "%rule r $x:🆓", "%rule r (A ≻ B) 🆓",
  ]) {
    const document = `\x60\x60\x60jbogenbau\n${source}\n\x60\x60\x60`;
    assert.deepEqual(loader.readDocument(document, "case.md"), readDocument(document, "case.md"), source);
  }
});

test("both readers reject invalid forms at the same specified position", () => {
  const loader = notationLoader();
  for (const source of [
    "%rule r $X:A", "%rule r $Foo:A", "%rule r \"‹U+0041›\":A", "%rule a $x:(B) %rule r $Foo:A", "%rule r $x:A<B><C>", "%stage $X", "%rule Foo A",
    "%rule r ¬cbm! A", "%rule r ¬ cbm? A", '%const "‹U+0041›" "x"',
    '%rule r A := ∪ "a"', '%include "a.md" "b$c.md"',
    "%rule r $x:A %conditions $x ≅ #(sumti=\"x\")",
    "%rule r $x:A %conditions $x ≅ #(sumti<B><C>)",
    '%rule r A="x"<B>', "%rule r (A)<B>", "%rule r $x:[A]",
    "%rule r A<\"‹U+0041›\">", "%rule r :: _General_Category_Uppercase_Letter | A", "%rule r :: ∩ Word BY | A",
    "%stage _", "%rule r A %emits _", '%classifier c "a" ∈ _',
    "%rule r $x:(A) %rule s A %emits _", '%rule r $x:(A) %classifier c "a" ∈ _',
    '%include "a.md".x', '%rule r $x:(A) %include "a.md".x', '%include "a.md".."b"',
    "%stage Cbm Su", "%stage Cbm Su.value", "%rule r $x:🆓<A><B>", "%stage $x.value", '%rule r A %emits "a"', '%rule r A %emits ($x) B',
    '%include "a$b".value', '%rule r $x:A := ($x).value',
    '%rule r $x:A %conditions $x.unknown = "x"',
    '%rule r "a‹U+D800›"', "%bad A %prefer r A",
    "%rule r A ≻", "%rule r A ≻ B | C", "%rule r A | B ≻ C",
    '%const $S "a" "b".."c"', '%const $S ("a" "b".."c")',
    '%rule r A %conditions "a" ∈ ("a" "b".."c")',
    '%const $S "ab".ngrams(0)', '%const $S "ab".ngrams(02)',
    '%const $S "ab".ngrams(-1)', '%const $S "ab".ngrams()',
    '%rule r A %conditions $.begins()', '%rule r A %conditions $.matches()',
    '%rule r A %conditions $.begins((r | A))',
    '%rule r A %conditions $.matches(r, A)',
    '%rule r A %conditions $.begins(_General_Category_Letter)', '%rule r A %conditions $.matches(_General_Category_Letter)',
    '%rule r A %conditions $.followed-by(_General_Category_Letter)', '%rule r A %conditions $.preceded-by(_General_Category_Letter)',
    '%rule r A=("a" "b")', "%rule r A %conditions $ ≅ #A=(\"a\" \"b\")",
  ]) {
    const document = `\x60\x60\x60jbogenbau\n${source}\n\x60\x60\x60`;
    const errorOf = (reader) => {
      let error;
      assert.throws(() => reader(document, "case.md"), (found) => {
        error = { kind: found.kind, ...found.where };
        return true;
      }, source);
      return error;
    };
    assert.deepEqual(errorOf(loader.readDocument.bind(loader)), errorOf(readDocument), source);
  }
});

function notationLoader() {
  return new Loader((file) => {
    if (file === "data/preparsed/lojban.json") return undefined;
    const path = new URL(`../${file}`, import.meta.url);
    return fs.existsSync(path) ? fs.readFileSync(path, "utf8") : undefined;
  });
}

test("wrong directive names and operand counts retain the directive position", () => {
  const loader = notationLoader();
  for (const source of ["%ambiguity-resolution", "%ambiguity-resolution unknown", "%ambiguity-resolution greedy lazy",
    "%ambiguity-resolution greedy elision-only extra", "%stage First", "%extend-stage First",
    "%redefine-stage First", "%features a_b"]) {
    const document = "```jbogenbau\n" + source + "\n```";
    for (const reader of [readDocument, loader.readDocument.bind(loader)]) {
      assert.throws(() => reader(document, "case.md"), error => error.kind === "grammar" &&
        error.where.document === "case.md" && error.where.line === 2 && error.where.column === 1, source);
    }
  }
});


test("a lexical failure after a ranked separator has no ranked syntax code", () => {
  const loader = notationLoader();
  const document = '```jbogenbau\n%rule r a ≻ !\n```';
  for (const reader of [readDocument, loader.readDocument.bind(loader)]) {
    assert.throws(() => reader(document, "case.md"), error => {
      assert.deepEqual(error.where, { document: "case.md", line: 2, column: 13 });
      return error.kind === "grammar";
    });
  }
});
