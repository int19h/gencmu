import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repository, loaderWith, runEngineCase } from "./shared.js";
import { faults, hooks, newWork } from "../src/testing.js";
import { PatternMachine } from "../src/patterns.js";

const loader = loaderWith({});
test("pattern notation has one syntax derivation for each accepted form", () => {
  const directory = path.join(repository, "tests/notation");
  for (const name of fs.readdirSync(directory).filter(n => n.startsWith("tree-pattern-"))) {
    const c = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
    if (!c.expect.dom) continue;
    const text = c.document.split("\n").slice(1, -2).join("\n");
    const result = loader.notation.parse(text, { features: new Set(), });
    assert.equal(result.ok, true, name);
    assert.equal(result.stages.at(-1).verdict, "unique", name);
  }
});

test("the bootstrap reader agrees on every elidable test table case", async () => {
  const { readDocument } = await import("../../../tools/bootstrap-reader.js");
  const directory = path.join(repository, "tests/engine");
  for (const name of fs.readdirSync(directory).filter(n => n.startsWith("elidable-table-"))) {
    const c = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
    const document = "```jbogenbau\n" + c.grammar + "\n```\n";
    assert.deepEqual(readDocument(document, name), loader.readDocument(document, name), name);
  }
});

test("a bare pattern name receives the specific diagnostic at that name", () => {
  for (const name of ["sumti", "KEhE"]) {
    const out = runEngineCase({ grammar: `%rule text A
%conditions $ ≅ ${name}`, input: "" });
    assert.match(out.loadError.message, new RegExp(`tree comparison requires a pattern; write #${name}, not ${name}$`));
    assert.equal(out.loadError.where.column, 17);
  }
});

test("skipping an inert omission predicate loses its reconstructed witness", () => {
  const c = {
    grammar: '%ambiguity-resolution late-elision\n%rule text A [+T≠""] | A [+OTHER] [+OTHER] | A [+OTHER] [+OTHER] [+OTHER]',
    tokens: [{ text: "a", tags: ["A"] }], options: { elisionOnly: true },
  };
  assert.equal(runEngineCase(c).json.ok, true);
  faults.add("omission:skip");
  try {
    const out = runEngineCase(c);
    assert.equal(out.json.error.code, "elision-witness-lost");
    assert.equal(out.lostWitnesses, 1);
  } finally {
    faults.delete("omission:skip");
  }
});

test("an increasingly long list reuses finite structural states", () => {
  const pattern = {any:true,children:[{repeat:[{child:{terminal:"A",at:[1,1]}}]}]};
  const machine = new PatternMachine([pattern]);
  const a = machine.node(null, machine.empty, { terminal: "A", value: "a", tags: new Set(["A"]) });
  let prefix = machine.empty;
  for (let i = 0; i < 1000; i++) {
    prefix = machine.concat(prefix, a);
    assert.equal(machine.matches(machine.node("list", prefix), pattern), true);
  }
  assert.ok(machine.states.length < 10, `${machine.states.length} structural states`);
});

test("pattern observation counters record actual recognition and summary work", () => {
  const work = hooks.work = newWork();
  try {
    assert.equal(runEngineCase({ grammar: "%rule text A\n%conditions $ ≅ #A", tokens: [{ text: "a", tags: ["A"] }] }).json.ok, true);
    for (const kind of ["structuralStates", "structuralTransitions", "packedEdges", "summaryContexts"]) assert.ok(work[kind] > 0, kind);
  } finally {
    hooks.work = null;
  }
});
