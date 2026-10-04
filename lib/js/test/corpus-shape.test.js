// The shape of a corpus case (tests/README.md, "Corpus cases"), which
// tools/sync.js --check requires of every case (tools/corpus-shape.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { caseShapeProblems, corpusShapeProblems, duplicateMembers, illFormedStrings, mutantShapeProblems } from "../../../tools/corpus-shape.js";

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

test("a value that is not an object, and an error that is null, are refused", () => {
  for (const value of [null, [], 3, "x", true]) assert.deepEqual(caseShapeProblems(value), ["not a JSON object"]);
  assert.ok(caseShapeProblems({ ...ambiguous, error: null }).includes("error is null"));
});

test("a member name twice in an object, at any depth, and a lone surrogate are refused", () => {
  assert.deepEqual(duplicateMembers('{"id":"x","at":2,"at":5}'), ["at"]);
  assert.deepEqual(duplicateMembers('{"error":{"kind":"a","k\\u0069nd":"b"},"words":[{"a":1,"a":2}],"x":"\\"at\\""}'), ["error.kind", "words[0].a"]);
  assert.deepEqual(duplicateMembers('{"a":{"b":1},"c":{"b":1}}'), []);
  assert.deepEqual(illFormedStrings(JSON.parse('{"text":"mi \\ud800","\\udc00":"x","words":["\\ud83d\\ude00"]}')), ['"mi \\ud800"', '"\\udc00"']);

  const base = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-shape-"));
  fs.mkdirSync(path.join(base, "tests", "corpus"), { recursive: true });
  const rejectedLine = JSON.stringify(rejected);
  fs.writeFileSync(path.join(base, "tests", "corpus", "a.jsonl"), [`${rejectedLine.slice(0, -1)},"at":5}`, "null", '{"id":"s","text":"\\ud800","dialect":"cll-ebnf","expect":"reject","stage":"syntax","at":0}', rejectedLine].join("\n") + "\n");
  fs.writeFileSync(path.join(base, "tests", "corpus", "b.jsonl"), Buffer.from([0x7b, 0xff, 0x7d, 0x0a]));
  assert.deepEqual(corpusShapeProblems(base), [
    "tests/corpus/a.jsonl:1: r: the member name at stands twice in its object",
    "tests/corpus/a.jsonl:2: not a JSON object",
    'tests/corpus/a.jsonl:3: s: the string "\\ud800" is not a sequence of Unicode scalar values',
    "tests/corpus/b.jsonl: not UTF-8",
  ]);
});

test("a result mutant has a path that every runner reads alike", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mutant-shape-"));
  fs.mkdirSync(path.join(base, "tests", "engine"), { recursive: true });
  fs.writeFileSync(path.join(base, "tests", "engine", "c.json"), "{}");
  const write = (mutants) => fs.writeFileSync(path.join(base, "tests", "result-mutants.json"), JSON.stringify({ mutants }));
  write([
    { name: "fine", case: "c.json", path: ["error", "readings", -1], set: null },
    { name: "fine too", case: "c.json", path: ["error", "reason"], remove: true },
  ]);
  assert.deepEqual(mutantShapeProblems(base), []);
  write([]);
  assert.deepEqual(mutantShapeProblems(base), ["tests/result-mutants.json: mutants is not a list with at least one mutant"]);
  write([
    { name: "a", case: "c.json", path: ["stages", -2, "output"], set: [] },
    { name: "b", case: "c.json", path: ["stages", 0], remove: true },
    { name: "c", case: "gone.json", path: ["ok"], set: true, keep: 1 },
  ]);
  assert.deepEqual(mutantShapeProblems(base), [
    "tests/result-mutants.json: mutant 0: path is not a list of member names and indices of -1 or more",
    "tests/result-mutants.json: mutant 1: remove is not true at a member name",
    "tests/result-mutants.json: mutant 2: case names no file under tests/engine",
    "tests/result-mutants.json: mutant 2: it has 2 changes, not one of set, copy, keep, remove, append",
  ]);
});
