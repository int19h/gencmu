import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureShapes } from "../../../tools/fixture-shapes.js";
import { fixtureFiles, fixtureKind, fixtureProblems, fixtureShapeProblems, shapeProblems } from "../../../tools/check-fixtures.js";
import { duplicateMembers, illFormedStrings } from "../../../tools/fixture-json.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const files = fixtureFiles(root);
const read = (relative) => fs.readFileSync(path.join(root, "tests", relative));
const errors = (relative, value) => fixtureProblems(relative, JSON.stringify(value));

// One focused refusal test for each registered fixture kind. Mutate a copy
// of a real fixture, so every description must accept its actual input too.
for (const [kind, description] of Object.entries(fixtureShapes)) test(`${kind} refuses a mutated copy`, () => {
  const relative = files.find((file) => fixtureKind(file) === kind);
  assert.ok(relative, `no representative of ${kind}`);
  const bytes = read(relative);
  assert.deepEqual(fixtureProblems(relative, bytes), []);
  if (description.format === "text") {
    const bad = kind === "core.txt" ? `${bytes.toString()}\nnot an id\n`
      : kind === "quoted-allow.txt" ? `${bytes.toString()}\nnot an entry\n`
      : kind === "unicode/NormalizationTest.txt" ? `${bytes.toString()}\n0041;0041;\n` : Buffer.from([0xff]);
    assert.ok(fixtureProblems(relative, bad).length, "invalid text passed");
    return;
  }
  const text = bytes.toString(), jsonl = description.format === "jsonl";
  const lines = text.split("\n"), index = lines.findIndex((line) => line.trim());
  const value = JSON.parse(jsonl ? lines[index] : text);
  const target = Array.isArray(value) ? value[0] : value;
  if (target && typeof target === "object" && !Array.isArray(target)) target.misspelledControl = true;
  else value[0] = null;
  if (jsonl) lines[index] = JSON.stringify(value);
  const bad = jsonl ? lines.join("\n") : JSON.stringify(value);
  assert.match(fixtureProblems(relative, bad).join("\n"), /unknown member|expected string/);
});

test("each registered fixture and directory passes without executing cases", () => {
  assert.deepEqual(fixtureShapeProblems(root), []);
});

test("unknown files and absent fixture kinds cannot bypass the contract", () => {
  assert.match(fixtureProblems("misspelled.json", "{}").join("\n"), /no fixture shape/);
  assert.equal(fixtureKind("engine/nested/case.json"), undefined);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-shape-"));
  try {
    fs.mkdirSync(path.join(base, "tests"));
    fs.writeFileSync(path.join(base, "tests", "unknown.txt"), "x");
    const problems = fixtureShapeProblems(base);
    assert.ok(problems.some((message) => message.includes("unknown.txt: no fixture shape")));
    assert.ok(problems.some((message) => message.includes("engine/*.json: required fixture is missing")));
    assert.ok(problems.some((message) => message.includes("bootstrap-errors.json: required fixture is missing")));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test("nested controls refuse unknown members and wrong types", () => {
  const mutations = [
    ["bootstrap-errors.json", ["cases", 0, "stage"], 5],
    ["disk-names.json", [0, "error", "line"], "1"],
    ["dom-depth-source.json", [0, "atLimit"], -1],
    ["dom-depth.json", [0, "atLimit"], null],
    ["dom-malformed.json", [0, "malformed"], "true"],
    ["growth.json", [0, "most"], false],
    ["notation-growth.json", [0, "open"], []],
    ["query-depth.json", [0, "count"], 1.5],
    ["query-work.json", [0, "most"], 0],
    ["places.json", ["positions", 0, "line"], "1"],
    ["recipe-diagnostics.json", ["recipes", 0, "source"], null],
    ["notation-shapes.json", ["extraParts", 0, "inputs"], "a"],
    ["notation-values.json", ["cases", 0, "expect", "unknown"], true],
    ["json-keys.json", ["preparsed", 0, "cached"], "false"],
    ["parameter-structure.json", [0, "instances"], "1"],
    ["parameters.json", [0, "options", "features"], "f"],
    ["shared-memo.json", ["runs", 0, "options"], {}],
    ["result-mutants.json", ["mutants", 0, "keep"], -1],
    ["without-elision-growth.json", ["familyCallerScope", "maxCloseStates"], null],
    ["diagnostic-notation.json", [0, "abbreviation"], false],
    ["playground-includes.json", [0, "documents"], {}],
    ["cll-footnotes.json", ["index", "sha256"], "not a digest"],
    ["unicode/property-digests.json", ["algorithm"], "sha256"],
    ["text-sources/manifest.json", ["sources", 0, "location", "rows"], "1"],
  ];
  for (const [relative, steps, replacement] of mutations) {
    const value = JSON.parse(read(relative));
    let target = value;
    for (const step of steps.slice(0, -1)) {
      if (!Object.hasOwn(target, step)) target[step] = {};
      target = target[step];
    }
    target[steps.at(-1)] = replacement;
    assert.ok(errors(relative, value).length, `${relative}: ${steps.join(".")}`);
  }
});

test("member combinations describe sources, outcomes, locations and changes", () => {
  const engine = { grammar: '%rule text "a"', input: "a", expect: { brackets: "a" } };
  const notation = { document: "", expect: { dom: {} } };
  const mutations = [
    ["engine/case.json", { ...engine, pipeline: "lojban/cll" }],
    ["engine/case.json", { documents: {}, expect: {} }],
    ["engine/case.json", { ...engine, parses: [{ expect: {} }] }],
    ["engine/case.json", { ...engine, expect: { where: { document: "a.md" } } }],
    ["engine/case.json", { ...engine, expect: { diagnostic: "code" } }],
    ["notation/case.json", { ...notation, expect: { dom: {}, error: {} } }],
    ["notation-values.json", { description: "x", cases: [{ id: "x", description: "x", aliases: [], document: "", expect: { error: { message: "nested" } } }] }],
    ["notation-values.json", { description: "x", cases: [{ id: "x", description: "x", aliases: [], document: "", expect: { dom: {}, message: "error only" } }] }],
    ["shared-memo.json", { description: "x", runs: [{ grammar: "", inputs: [], texts: [], options: [] }] }],
    ["parameter-structure.json", [{ name: "x", cacheFallback: true, grammar: "", dom: {} }]],
    ["result-mutants.json", { mutants: [{ name: "x", case: "a.json", path: ["ok"], set: true, keep: 1 }] }],
    ["result-mutants.json", { mutants: [{ name: "x", case: "a.json", path: ["stages", 0], remove: true }] }],
    ["result-mutants.json", { mutants: [{ name: "x", case: "a.json", path: ["stages", -2], set: null }] }],
    ["places.json", { description: "x", positions: [{ text: "", needle: "", line: null, column: 1 }], substitutions: [] }],
  ];
  for (const [relative, value] of mutations) assert.ok(errors(relative, value).length, JSON.stringify(value));
  assert.deepEqual(errors("engine/case.json", engine), []);
  assert.deepEqual(errors("notation/case.json", notation), []);
  assert.deepEqual(errors("result-mutants.json", { mutants: [{ name: "x", case: "a.json", path: ["error", "readings", -1], set: null }] }), []);
  assert.ok(fixtureProblems("result-mutants.json", JSON.stringify({ mutants: [{ name: "x", case: "gone.json", path: ["ok"], set: true }] }), new Set()).length);
});

test("token member checks reach attachments and memo inputs", () => {
  const unknown = { text: "a", before: [{ after: [{ misspelled: true }] }] };
  assert.ok(errors("engine/case.json", { grammar: "", tokens: [unknown], expect: { error: "usage" } }).length);
  assert.ok(errors("shared-memo.json", { description: "x", runs: [{ grammar: "", inputs: [[unknown]], options: [] }] }).length);
  const usage = { grammar: "", tokens: [{ text: null, tags: false, span: "bad", before: null }], expect: { error: "usage" } };
  assert.deepEqual(errors("engine/case.json", usage), []);
});

test("corpus outcomes retain their required and forbidden controls", () => {
  const shape = fixtureShapes["corpus/*.jsonl"].shape;
  const accepted = { id: "a", text: "mi klama", pipeline: "lojban/cll", expect: "accept", verdict: "unique", words: ["mi", "klama"], brackets: "(mi klama)" };
  const rejected = { id: "r", text: "mi ku", pipeline: "lojban/cll", expect: "reject", stage: "syntax", at: 3, words: ["mi", "ku"] };
  const ambiguous = { id: "t", text: "x", pipeline: "lojban/cll", expect: "reject", stage: "syntax", error: { kind: "ambiguous", reason: "tie" } };
  for (const value of [accepted, rejected, ambiguous, { ...rejected, reason: "pipeline policy" }, { ...accepted, features: ["cbm"], seeded: "reject", reason: "why" }]) {
    assert.deepEqual(shapeProblems(shape, value), []);
  }
  for (const value of [null, [], 3, "x", true, { ...rejected, at: null }, { ...accepted, verdict: null },
    { ...accepted, note: "x" }, { ...accepted, at: 0 }, { ...ambiguous, at: 0 }, { ...rejected, at: undefined },
    { ...rejected, seeded: "accept" }, { ...rejected, reason: 1 }, { ...rejected, expect: "maybe" },
    { ...ambiguous, error: null }, { ...accepted, stage: "syntax" }, { ...rejected, verdict: "unique" }]) {
    assert.ok(shapeProblems(shape, value).length, JSON.stringify(value));
  }
});

test("JSON bytes and strings retain the shared readers' restrictions", () => {
  assert.deepEqual(duplicateMembers('{"id":"x","at":2,"at":5}'), ["at"]);
  assert.deepEqual(duplicateMembers('{"error":{"kind":"a","k\\u0069nd":"b"},"words":[{"a":1,"a":2}],"x":"\\"at\\""}'), ["error.kind", "words[0].a"]);
  assert.deepEqual(duplicateMembers('{"a":{"b":1},"c":{"b":1}}'), []);
  assert.deepEqual(illFormedStrings(JSON.parse('{"text":"mi \\ud800","\\udc00":"x","words":["\\ud83d\\ude00"]}')), ['"mi \\ud800"', '"\\udc00"']);
  assert.deepEqual(illFormedStrings(JSON.parse("[".repeat(20000) + '"\\ud800"' + "]".repeat(20000))), ['"\\ud800"']);
  assert.match(fixtureProblems("places.json", Buffer.from([0x7b, 0xff, 0x7d])).join("\n"), /not UTF-8/);
  assert.match(fixtureProblems("places.json", "{").join("\n"), /not JSON/);
  assert.match(fixtureProblems("notation/x.json", '{"document":"","document":"","expect":{"dom":{}}}').join("\n"), /repeated member document/);
  const corpus = '{"id":"s","text":"\\ud800","pipeline":"lojban/cll","expect":"reject","stage":"syntax","at":0}';
  assert.match(fixtureProblems("corpus/x.jsonl", `\n${corpus}\nnull\n`).join("\n"), /x.jsonl:2: not a Unicode scalar string/);
  assert.match(fixtureProblems("corpus/x.jsonl", "null\n").join("\n"), /expected an object/);
});
