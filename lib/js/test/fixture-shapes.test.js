import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureShapes } from "../../../tools/fixture-shapes.js";
import { fixtureContext, fixtureFiles, fixtureKind, fixtureProblems, fixtureShapeProblems, shapeProblems } from "../../../tools/check-fixtures.js";
import { validateOptions, validateNotationCase } from "./shared.js";
import { duplicateMembers, illFormedStrings, numberProblems } from "../../../tools/fixture-json.js";

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
  assert.ok(fixtureProblems("result-mutants.json", JSON.stringify({ mutants: [{ name: "x", case: "gone.json", path: ["ok"], set: true }] }), { files: new Set() }).length);
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

test("JSON fixtures refuse a byte order mark in bytes and strings", () => {
  const corpus = '{"id":"plain","text":"a","pipeline":"lojban/cll","expect":"reject","stage":"syntax","at":0}';
  for (const [relative, text] of [
    ["engine/case.json", '{"grammar":"%rule text A","expect":{}}'],
    ["notation/case.json", '{"document":"","expect":{"dom":{}}}'],
    ["corpus/case.jsonl", corpus + "\n"],
  ]) {
    assert.deepEqual(fixtureProblems(relative, text), []);
    assert.deepEqual(fixtureProblems(relative, Buffer.from(text)), []);
    const marked = "\ufeff" + text;
    const problems = fixtureProblems(relative, marked);
    assert.match(problems.join("\n"), /not JSON/);
    assert.deepEqual(fixtureProblems(relative, Buffer.from(marked)), problems);
  }
});

test("corpus indexing retains a byte order mark on the first record", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-bom-"));
  try {
    fs.mkdirSync(path.join(base, "tests", "corpus"), { recursive: true });
    const record = { id: "marked", text: "a", pipeline: "lojban/cll", expect: "reject", stage: "syntax", at: 0 };
    const text = "\ufeff" + JSON.stringify(record) + "\n" + JSON.stringify({ ...record, id: "plain" }) + "\n";
    fs.writeFileSync(path.join(base, "tests", "corpus", "case.jsonl"), text);
    const corpus = fixtureContext(base).corpus();
    assert.equal(corpus.has("marked"), false);
    assert.deepEqual(corpus.get("plain"), new Set(["a"]));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test("JSONL blank lines cannot hide a byte order mark", () => {
  const relative = "corpus/case.jsonl";
  const record = JSON.stringify({ id: "plain", text: "a", pipeline: "lojban/cll", expect: "reject", stage: "syntax", at: 0 });
  const valid = " \t\r\n\n" + record + "\n\t \r\n";
  assert.deepEqual(fixtureProblems(relative, valid), []);
  assert.deepEqual(fixtureProblems(relative, Buffer.from(valid)), []);
  for (const text of [
    "\ufeff\n" + record + "\n",
    "\ufeff \t\r\n" + record + "\n",
    "\n\ufeff\n" + record + "\n",
    "\n \ufeff\t\n" + record + "\n",
    record + "\n\ufeff\n",
    "\ufeff\n",
  ]) {
    const problems = fixtureProblems(relative, text);
    assert.match(problems.join("\n"), /not JSON/, JSON.stringify(text));
    assert.deepEqual(fixtureProblems(relative, Buffer.from(text)), problems);
  }
  for (const whitespace of ["\u00a0", "\u2028", "\u2029"]) {
    assert.match(fixtureProblems(relative, whitespace + "\n" + record).join("\n"), /not JSON/);
  }
  const embedded = JSON.stringify({ id: "embedded", text: "\ufeff", pipeline: "lojban/cll", expect: "reject", stage: "syntax", at: 0 });
  assert.deepEqual(fixtureProblems(relative, embedded + "\n"), []);
});

test("fixture numbers retain integer spellings before JSON decoding", () => {
  const growth = read("growth.json").toString();
  assert.ok(growth.includes('"small": 10'));
  for (const spelling of ["10.0", "10.00000000000000000001", "1e1", "1E+1", "100e-1"]) {
    const text = growth.replace('"small": 10', '"small": ' + spelling);
    const problems = fixtureProblems("growth.json", text);
    assert.match(problems.join("\n"), /needs an integer spelling/, spelling);
    assert.deepEqual(fixtureProblems("growth.json", Buffer.from(text)), problems);
  }
  const notation = '{"document":"","expect":{"error":{"line":1.0,"column":1}}}';
  assert.match(fixtureProblems("notation/case.json", notation).join("\n"), /needs an integer spelling/);
  const corpus = '{"id":"fraction","text":"a","pipeline":"lojban/cll","expect":"reject","stage":"syntax","at":0.0}';
  assert.match(fixtureProblems("corpus/case.jsonl", "\n" + corpus + "\n").join("\n"), /case.jsonl:2: number 0.0 needs an integer spelling/);
});

test("fixture numbers fit the shared integer range without constraining embedded text", () => {
  const payload = (number) => '[{"description":"integer encoding","malformed":true,"dom":{"probe":' + number + '}}]';
  for (const number of ["0", "-0", "9007199254740993", "-9223372036854775808", "9223372036854775807"]) {
    assert.deepEqual(fixtureProblems("dom-malformed.json", payload(number)), [], number);
  }
  for (const number of ["-9223372036854775809", "9223372036854775808"]) {
    assert.match(fixtureProblems("dom-malformed.json", payload(number)).join("\n"), /outside the signed 64-bit range/, number);
  }
  assert.match(fixtureProblems("dom-malformed.json", payload("1.5")).join("\n"), /needs an integer spelling/);
  const embedded = '{"number":1.5,"exponent":1e100,"large":9223372036854775808,"broken":01}';
  assert.deepEqual(fixtureProblems("dom-malformed.json", payload(JSON.stringify(embedded))), []);
  const strings = JSON.stringify({ '10.0': ['a\\"1e1', embedded], number: -1 });
  assert.deepEqual(numberProblems(strings), []);
  assert.deepEqual(numberProblems("[".repeat(20000) + strings + "]".repeat(20000)), []);
  assert.match(numberProblems("[".repeat(20000) + "1e0" + "]".repeat(20000)).join("\n"), /needs an integer spelling/);
});

test("corpus indexing omits unsupported number spellings", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-number-"));
  try {
    fs.mkdirSync(path.join(base, "tests", "corpus"), { recursive: true });
    const record = { id: "fraction", text: "a", pipeline: "lojban/cll", expect: "reject", stage: "syntax", at: 0 };
    const text = JSON.stringify(record).replace('"at":0', '"at":0.0') + "\n" + JSON.stringify({ ...record, id: "plain" }) + "\n";
    fs.writeFileSync(path.join(base, "tests", "corpus", "case.jsonl"), text);
    const corpus = fixtureContext(base).corpus();
    assert.equal(corpus.has("fraction"), false);
    assert.deepEqual(corpus.get("plain"), new Set(["a"]));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test("reader-required controls cannot disappear from fixture copies", () => {
  const failures = [];
  const missing = (relative, steps) => {
    const value = JSON.parse(read(relative));
    let owner = value;
    for (const step of steps.slice(0, -1)) owner = owner[step];
    delete owner[steps.at(-1)];
    failures.push([relative, value, steps.join(".")]);
  };
  missing("parameters.json", [0, "name"]);
  for (const coordinate of ["line", "column"]) {
    missing("disk-names.json", [0, "error", coordinate]);
    const supplied = JSON.parse(read("notation-values.json"));
    const index = supplied.cases.findIndex((c) => c.expect.error);
    missing("notation-values.json", ["cases", index, "expect", "error", coordinate]);
  }
  const cache = JSON.parse(read(files.find((p) => p.startsWith("notation/") && JSON.parse(read(p)).cacheMisses)));
  cache.expect = { error: { line: 1, column: 1 } };
  failures.push(["notation/cache.json", cache, "cacheMisses with an error"]);
  const structure = JSON.parse(read("parameter-structure.json"));
  const index = structure.findIndex((c) => c.public);
  missing("parameter-structure.json", [index, "order"]);
  missing("without-elision-growth.json", ["familyOwnerChoice", "slack"]);
  missing("without-elision-growth.json", ["familySharedDoubleCloses", "slack"]);
  failures.push(["parameter-structure.json", [{ name: "flags", dom: {}, flags: {} }], "flags without source"]);
  for (const [relative, value, label] of failures) assert.ok(errors(relative, value).length, `${relative}: ${label}`);
  cache.cacheMisses = false;
  assert.deepEqual(errors("notation/cache.json", cache), []);
  // Engine resource errors can omit an unknown coordinate.
  assert.deepEqual(errors("engine/position.json", { grammar: "", expect: { error: "grammar", where: { document: "g.md" } } }), []);
  assert.ok(errors("notation/position.json", { document: "", expect: { error: {} } }).length);
  for (const error of [{ line: 2 }, { column: 15 }, { line: 0, column: 15 }]) {
    assert.ok(errors("notation/position.json", { document: "", expect: { error } }).length);
  }
});

test("case collections and memo dimensions cannot be empty", () => {
  for (const [kind, description] of Object.entries(fixtureShapes)) if (description.shape?.list) {
    assert.ok(shapeProblems(description.shape, []).length, kind);
  }
  for (const relative of ["notation-values.json", "bootstrap-errors.json"]) {
    const value = JSON.parse(read(relative));
    value.cases = [];
    assert.ok(errors(relative, value).length, relative);
  }
  const groups = [
    ["places.json", "positions"], ["places.json", "substitutions"],
    ["recipe-diagnostics.json", "recipes"], ["recipe-diagnostics.json", "positions"],
    ["json-keys.json", "values"], ["json-keys.json", "bootstrap"], ["json-keys.json", "preparsed"],
    ["recipe-diagnostics.json", "ordinary"], ["notation-shapes.json", "inputs"], ["notation-shapes.json", "control"],
    ["notation-shapes.json", "extraParts"], ["without-elision-growth.json", "unusedCases"],
  ];
  for (const [relative, field] of groups) {
    const value = JSON.parse(read(relative));
    value[field] = [];
    assert.ok(errors(relative, value).length, `${relative} ${field}`);
  }
  for (const field of ["runs", "options", "texts", "inputs"]) {
    const value = JSON.parse(read("shared-memo.json"));
    if (field === "runs") value.runs = [];
    else {
      if (field === "texts") value.runs = value.runs.filter((run) => run.texts);
      if (field === "inputs") value.runs = value.runs.filter((run) => run.inputs);
      value.runs[0][field] = [];
    }
    assert.ok(errors("shared-memo.json", value).length, field);
  }
});

test("expectation controls follow the strictest engine reader", () => {
  const value = { grammar: "", expect: { error: "misspelled-kind" } };
  assert.ok(errors("engine/kind.json", value).length);
  value.expect = { message: "a reason" };
  assert.ok(errors("engine/message.json", value).length);
  value.expect.error = "grammar";
  assert.deepEqual(errors("engine/message.json", value), []);
});

test("manifest references resolve to local snapshots and corpus texts", () => {
  const original = JSON.parse(read("text-sources/manifest.json"));
  const context = fixtureContext(root, files);
  const problems = (value) => fixtureProblems("text-sources/manifest.json", JSON.stringify(value), context);
  assert.deepEqual(problems(original), []);
  const mutations = [
    [(v) => { v.sources[0].html = "missing.html"; }, /missing fixture reference/],
    [(v) => { v.sources[0].extracted = "missing.txt"; }, /missing fixture reference/],
    [(v) => { v.sources[0].html_sha256 = "0".repeat(64); }, /html_sha256 differs/],
    [(v) => { v.sources[0].extracted_sha256 = "0".repeat(64); }, /extracted_sha256 differs/],
    [(v) => { v.sources[0].variants[0].cases = ["no.such.case"]; }, /unknown corpus case/],
    [(v) => { v.sources[0].variants[0].cases = []; }, /at least 1/],
    [(v) => { v.sources[0].variants[0].text_sha256 = "0".repeat(64); }, /text_sha256 differs/],
    [(v) => { v.sources[0].variants[0].cases.push(v.sources[1].variants[0].cases[0]); }, /must share one text/],
    [(v) => { v.sources.find((s) => s.variants.some((x) => x.changes.length)).variants.find((x) => x.changes.length).changes = []; }, /unchanged variant must use extracted_sha256/],
  ];
  for (const [change, message] of mutations) {
    const value = structuredClone(original);
    change(value);
    assert.match(problems(value).join("\n"), message);
  }
  for (const [field, paths] of [
    ["html", ["../outside.html", "/outside.html", "sub/inside.html", "sub\\inside.html", "C:outside.html", "bad\0.html"]],
    ["extracted", ["../outside.txt", "/outside.txt", "sub/inside.txt", "sub\\inside.txt", "C:outside.txt", "bad\0.txt"]],
  ]) for (const name of paths) {
    const value = structuredClone(original);
    value.sources[0][field] = name;
    assert.match(problems(value).join("\n"), /expected a string matching/, name);
  }
  const snapshot = `text-sources/${original.sources[0].html}`;
  const changedBytes = { ...context, read: (relative) => relative === snapshot ? Buffer.concat([context.read(relative), Buffer.from(" ")]) : context.read(relative) };
  assert.match(fixtureProblems("text-sources/manifest.json", JSON.stringify(original), changedBytes).join("\n"), /html_sha256 differs/);
});

test("the repository gate applies manifest audits and tolerates malformed corpus records", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-shape-"));
  try {
    fs.mkdirSync(path.join(base, "tests", "text-sources"), { recursive: true });
    fs.mkdirSync(path.join(base, "tests", "corpus"));
    const manifest = JSON.parse(read("text-sources/manifest.json"));
    manifest.sources = [manifest.sources[0]];
    const source = manifest.sources[0];
    fs.writeFileSync(path.join(base, "tests", "text-sources", source.html), read(`text-sources/${source.html}`));
    fs.writeFileSync(path.join(base, "tests", "text-sources", source.extracted), read(`text-sources/${source.extracted}`));
    fs.writeFileSync(path.join(base, "tests", "text-sources", "manifest.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(base, "tests", "corpus", "invalid.jsonl"), "not JSON\nnull\n");
    const problems = fixtureShapeProblems(base);
    assert.ok(problems.some((message) => message.includes("manifest.json") && message.includes("unknown corpus case")));
    assert.ok(problems.some((message) => message.includes("invalid.jsonl:1: not JSON")));
    assert.ok(problems.some((message) => message.includes("invalid.jsonl:2:") && message.includes("expected an object")));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});


test("core identifiers resolve to corpus records", () => {
  const context = fixtureContext(root, files);
  assert.deepEqual(fixtureProblems("core.txt", read("core.txt"), context), []);
  assert.match(fixtureProblems("core.txt", "no.such.case\n", context).join("\n"), /unknown corpus case/);
});

test("a corpus tie names exactly its one rejecting stage", () => {
  const original = read("corpus/i183-close-families.jsonl").toString().split("\n").filter(Boolean)
    .map((line) => JSON.parse(line)).find((c) => Object.hasOwn(c, "ties"));
  assert.ok(original);
  assert.deepEqual(errors("corpus/tie.jsonl", original), []);
  for (const ties of [[], ["syntax", "words"], [""], ["words"], [null], "syntax"]) {
    const value = structuredClone(original);
    value.ties = ties;
    assert.ok(errors("corpus/tie.jsonl", value).length, JSON.stringify(ties));
  }
  const accepted = { ...original, expect: "accept", verdict: "unique", brackets: "x" };
  delete accepted.stage;
  delete accepted.error;
  assert.match(errors("corpus/tie.jsonl", accepted).join("\n"), /accept forbids ties/);
  const noTies = structuredClone(original);
  delete noTies.ties;
  assert.deepEqual(errors("corpus/tie.jsonl", noTies), []);
  assert.match(fixtureProblems("corpus/empty.jsonl", "\n \r\n").join("\n"), /at least one corpus record/);
});

test("parameter structure refuses expectations outside the selected mode", () => {
  const cases = JSON.parse(read("parameter-structure.json"));
  const publicCase = cases.find(c => c.public);
  const cacheCase = cases.find(c => c.cacheFallback);
  const ordinary = cases.find(c => !c.public && !c.cacheFallback);
  assert.ok(publicCase && cacheCase && ordinary);
  for (const [base, patch] of [
    [publicCase,{argument:false}], [publicCase,{flags:{missing:[]}}], [publicCase,{input:"x"}],
    [cacheCase,{order:[]}], [cacheCase,{instances:0}], [cacheCase,{argument:null}],
    [cacheCase,{flags:{}}], [cacheCase,{public:true,order:[]}], [ordinary,{input:"x"}],
  ]) assert.notDeepEqual(errors("parameter-structure.json", [{...base,...patch}]), []);
});

test("bootstrap markers require at least one character", () => {
  const value = JSON.parse(read("bootstrap-errors.json"));
  const item = value.cases.find(c => Object.hasOwn(c,"at"));
  assert.ok(item);
  item.at = "";
  assert.match(errors("bootstrap-errors.json",value).join("\n"),/at/);
});

test("cache error expectations allow compared coordinates and refuse unused members", () => {
  const value = JSON.parse(read("json-keys.json"));
  const item = value.preparsed.find(item => item.error);
  assert.ok(item);
  item.error.column = 999;
  assert.deepEqual(errors("json-keys.json",value), []);
  for (const column of [0, -1, null, "999"]) {
    item.error.column = column;
    assert.ok(errors("json-keys.json",value).length);
  }
  item.error.column = 999;
  item.error.unobserved = true;
  assert.match(errors("json-keys.json",value).join("\n"),/unknown member unobserved/);
});

test("engine controls distinguish parameter names and nonempty stage names", () => {
  const original = JSON.parse(read("parameters.json"))[0];
  assert.deepEqual(errors("parameters.json", [original]), []);
  assert.match(errors("engine/named.json", original).join("\n"), /unknown member name/);
  const value = { grammar: '%rule text "a"', input: "a", options: { until: "" }, expect: { brackets: "a" } };
  assert.ok(errors("engine/until.json", value).length);
  const memo = JSON.parse(read("shared-memo.json"));
  memo.runs[0].options[0].until = "";
  assert.ok(errors("shared-memo.json", memo).length);
});


test("notation and parse controls retain the fixture contract in the JS runner", () => {
  for (const error of [{}, {line:2}, {column:15}, {line:0,column:15}]) {
    assert.throws(() => validateNotationCase({document:"",expect:{error}}), /positive integer/);
  }
  assert.throws(() => validateOptions({until:""}), /nonempty/);
  validateOptions({until:"main"});
});
