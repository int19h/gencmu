// The shape of a corpus case (tests/README.md, "Corpus cases"), which
// tools/sync.js --check requires of every case (tools/corpus-shape.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { caseShapeProblems } from "../../../tools/corpus-shape.js";

const accepted = { id: "a", text: "mi klama", dialect: "cll-ebnf", expect: "accept", verdict: "unique", words: ["mi", "klama"], brackets: "(mi klama)" };
const rejected = { id: "r", text: "mi ku", dialect: "cll-ebnf", expect: "reject", stage: "syntax", at: 3, words: ["mi", "ku"] };
const ambiguous = { id: "t", text: "x", dialect: "cll-ebnf", expect: "reject", stage: "syntax", error: { kind: "ambiguous", reason: "tie" } };

test("the cases of the format pass", () => {
  for (const c of [accepted, rejected, ambiguous, { ...accepted, features: ["cbm"], seeded: "reject", reason: "why" }]) assert.deepEqual(caseShapeProblems(c), [], c.id);
});

test("a null, an unknown field and a misplaced position are refused", () => {
  assert.deepEqual(caseShapeProblems({ ...rejected, at: null }), ["at is null", "a rejected case has no at, a position counted from 0"]);
  assert.deepEqual(caseShapeProblems({ ...accepted, verdict: null }), ["verdict is null", "an accepted case has no verdict or no brackets"]);
  assert.deepEqual(caseShapeProblems({ ...accepted, note: "x" }), ["an unknown field note"]);
  assert.deepEqual(caseShapeProblems({ ...accepted, at: 0 }), ["an accepted case has at"]);
  assert.deepEqual(caseShapeProblems({ ...ambiguous, at: 0 }), ["an ambiguous case has at"]);
  assert.deepEqual(caseShapeProblems({ ...rejected, at: undefined }), ["a rejected case has no at, a position counted from 0"]);
  assert.deepEqual(caseShapeProblems({ ...rejected, seeded: "accept" }), ["seeded and reason come together"]);
  assert.deepEqual(caseShapeProblems({ ...rejected, expect: "maybe" }), ["expect is neither accept nor reject"]);
});
