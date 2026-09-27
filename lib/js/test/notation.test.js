import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repository, grammars, loaderWith, matches, readGrammarFile } from "./shared.js";
import { GencmuError } from "../src/node.js";
import { splicePipeline } from "../src/pipeline.js";

const loader = loaderWith({});

const directory = path.join(repository, "tests", "notation");
for (const file of fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort()) {
  const testCase = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
  test(`notation: ${file}`, () => {
    let outcome;
    try {
      outcome = { dom: loader.readDocument(testCase.document, file) };
    } catch (error) {
      if (!(error instanceof GencmuError)) throw error;
      outcome = { error: { line: error.where.line, column: error.where.column, message: error.message } };
    }
    assert.ok(matches(testCase.expect, outcome), JSON.stringify(outcome, null, 1));
  });
}

test("the notation reads its own pipeline to the bootstrap (the fixpoint)", () => {
  const bootstrap = JSON.parse(readGrammarFile("notation/bootstrap.json"));
  // Every document is read afresh with the bootstrap, never from compiled.json.
  const { stages } = splicePipeline("dialects/notation.md", (documentPath) => {
    let text;
    try {
      text = readGrammarFile(documentPath);
    } catch {
      return undefined;
    }
    return loader.readDocument(text, documentPath);
  });
  assert.deepEqual(stages.map((stage) => ({ name: stage.name, documents: stage.documents })), bootstrap.stages);
  void grammars;
});
