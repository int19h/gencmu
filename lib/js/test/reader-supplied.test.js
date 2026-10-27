import { test } from "node:test";
import assert from "node:assert/strict";
import { GencmuError, Loader } from "../src/node.js";
import { readGrammarFile } from "./shared.js";

function suppliedLoader(spelling, tag) {
  const bootstrap = JSON.parse(readGrammarFile("grammars/notation/bootstrap.json"));
  const lexical = bootstrap.stages.find(stage => stage.name === "lexical").documents[0].dom;
  if (spelling === undefined) {
    lexical.rules.find(rule => rule.name === "feature-character").alternatives.push({ guards: [], expr: { literal: { string: "_" } } });
  } else {
    lexical.rules.find(rule => rule.name === "piece").alternatives.push({ guards: [], expr: { ref: "supplied-token" } });
    // The rule profile selects the supplied token over ordinary lexical divisions.
    lexical.rules.push({
      name: "supplied-token", op: "define", flags: ["leftmost-longest"],
      alternatives: [{ guards: [], expr: { seq: [...spelling].map(string => ({ literal: { string } })) } }],
      conditions: [], emit: { items: [{ capture: "", tags: { tag } }] }, at: [9999, 1],
    });
  }
  return new Loader(file => file === "grammars/compiled.json" ? undefined : file === "grammars/notation/bootstrap.json" ? JSON.stringify(bootstrap) : readGrammarFile(file));
}

function rejectsAt(loader, source, column) {
  assert.throws(() => loader.readDocument("```jbogenbau\n" + source + "\n```", "case.md"), error => {
    assert.ok(error instanceof GencmuError);
    assert.equal(error.kind, "grammar");
    assert.deepEqual(error.where, { document: "case.md", line: 2, column }, error.message);
    return true;
  }, source);
}

test("supplied guards fail at the guard before later alternative or classifier parts", () => {
  const loader = suppliedLoader();
  for (const source of ["%rule r bad_name? A", '%rule r bad_name? [A]="x"', "%rule r bad_name? A ≻ B"]) {
    rejectsAt(loader, source, 9);
  }
  rejectsAt(loader, '%classifier c bad_name? "a" ∈ A', 15);
  rejectsAt(loader, '%classifier c bad_name? "a" ∈ bad', 15);
});

test("supplied guards validate their suffix and reject negated warnings", () => {
  for (const spelling of ["f.", "¬f!", "1f?"]) {
    const loader = suppliedLoader(spelling, "Guard");
    rejectsAt(loader, "%rule r " + spelling + " A", 9);
    rejectsAt(loader, '%classifier c ' + spelling + ' "a" ∈ A', 15);
  }
});

test("supplied classifier classes retain their exact written spelling", () => {
  const loader = suppliedLoader("~A", "Identifier");
  rejectsAt(loader, '%classifier c "a" ∈ ~A', 21);
});
