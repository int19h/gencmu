import assert from "node:assert/strict";
import { after, test } from "node:test";
import { operandFields50, recordKind50, recordKinds50 } from "../../lib/js/src/format50/records.js";
import { validateDocument50 } from "../../lib/js/src/format50/validate.js";
import { createDifferential } from "./differential.js";

const differential = createDifferential();
after(() => differential.finish("record forms"));

const sources = [
  `%names "data/unicode/unicode-names.txt"
%stage main
%extend-stage main
%redefine-stage main
%include "rules.md"
%features f %conditions {Yes}
%elision-only
%ambiguity-resolution leftmost-longest #·text
%rule family(@X) @X
%rule bound = family(A)
%extend-rule family(A) B
%rule text ^$x:A %emit $x, ${"$"}{K}, ε{New}
%rule alternatives f? A | B → {K}
%rule sequence (A | B) C
%rule subset A & B
%rule ranked A ≻ B
%rule optional [A]
%rule elidable [+T<T>="t"≝"t" B]
%rule repeat {A / B}
%rule chain {... A / B}
%rule lex "" "a".."z" _ *text
%rule arguments family(text, A, "q", "a".."z", _, *text, A<T>, A="q", (A B), A | text, <T ¬U>, = "v")
%rule target A %conditions $.followed-by(text | A)
%rule query A %conditions $.without-elision-except(text).parse(… A …)`,
  `%const $TRUTH (1 = 1 ∧ 2 ≠ 3) ∨ ¬(1 = 2)
%const $IMPLIES 1 = 1 ⟹ 2 = 2
%const $IF (1 = 1 ? "a" | "b")
%const $BAG {A, B: "v", ¬C, *{D}}
%const $COPY $n ↦ {$n'k}
%const $MAP [["a"]]!.join()
%const $SELECT [{k: "a"}]!'k
%const $FUNCTION ["a"]!($x ↦ $x)
%const $IMPLICIT [{A}].all('A)
%const $UNION {A} ∪ {B}
%const $INTERSECTION {A} ∩ {B}
%const $DIFFERENCE {A} ∖ {B}
%const $CONCAT "a" ++ "b"
%const $FLAT [["a"]]↓
%const $APPLICATION $F("a")
%const $REFERENCE $BAG
%const $EMPTY ∅
%const $KEY {A}.has(A)
%const $LIST ["a", *["b"]]`,
  `%const $ATOMS #⁅ some-rule f(A) f(A)⁅ A ⁆ A "a" "a".."z" _ $L A<T> A="a" ⁆
%const $PATHS #⁅ ⋮A ⋱B C⋰ ⁆
%const $CHILDREN #·⁅ [A] {A} {(B | C) / D} ⋯ ⁆
%const $SET #(A ∪ B ∩ C ∖ d)
%rule patterns(@X) "a" %conditions $ ≅ #@X, $ ≅ #@X⁅ A ⁆
%rule empty ε`,
];

test("source and supplied DOM cover every written record form", () => {
  const compiler = differential.compiler();
  const visited = [new Set(), new Set()];
  function walk(dom, kinds, rejectUnknown = false) {
    const pending = [[dom, "document", []]];
    while (pending.length) {
      const [node, slot, path] = pending.pop();
      if (Array.isArray(node)) {
        for (const [key, child, childSlot] of operandFields50(node, slot)) {
          pending.push([child, childSlot, [...path, key]]);
        }
        continue;
      }
      const kind = recordKind50(node, slot);
      assert.ok(kind, `${slot} at ${path.join("/")}`);
      if (!kinds.has(kind) && rejectUnknown && slot !== "directives") {
        node.annotation = "unknown member";
        assert.throws(() => validateDocument50(dom, { unicode: compiler.unicode }), /unknown member "annotation"/, kind);
        delete node.annotation;
      }
      kinds.add(kind);
      for (const [key, child, childSlot] of operandFields50(node, slot)) {
        pending.push([child, childSlot, [...path, key]]);
      }
    }
  }

  for (const source of sources) {
    const fence = "```";
    const dom = compiler.compileDocument(`${fence}jbogenbau
${source}
${fence}`, "forms.md");
    walk(dom, visited[0]);
    const supplied = JSON.parse(JSON.stringify(dom));
    assert.equal(validateDocument50(supplied, { unicode: compiler.unicode }), supplied);
    walk(supplied, visited[1], true);
  }
  for (const kinds of visited) assert.deepEqual([...kinds].sort(), [...recordKinds50].sort());
  console.log(JSON.stringify({ recordForms: recordKinds50.length, sourceDocuments: sources.length }));
});
