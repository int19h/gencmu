import assert from "node:assert/strict";
import { test } from "node:test";
import { readDocument } from "./bootstrap-reader.js";

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

test("scalar references and interpolation remain unresolved with their positions", () => {
  assert.deepEqual(read('%rule r "a$(_0301)$$"').rules[0].alternatives[0].expr, {
    literal: { interpolate: [{ string: "a" }, { const: "_0301", at: [2, 11] }, { string: "$" }] },
  });
  assert.deepEqual(read('%rule r $_0041').rules[0].alternatives[0].expr, {
    literal: { const: "_0041", at: [2, 9] },
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
    ["%rule r ¬cbm! A", 13], ["%rule r ¬ cbm? A", 9],
    ['%const $_0041 "x"', 8], ['%rule r A := ∪ "a"', 14],
    ['%include "a.md" "b$c.md"', 19],
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
