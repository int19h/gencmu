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

test("the notation's lexical stage tags keywords, tag literals, character tags, properties and symbols (grammars/notation/lexical.md)", () => {
  const run = loader.notation.parse("%rule a ¬f? ~b 'c' /d/ E ... | g! %tags X %rulex $e ¬h 'x'..'y' '\\p{L}' 'a'...", { features: new Set(), until: "lexical" });
  const tokens = /** @type {import("../src/tokens.js").Token[]} */ (run.stages[0].output).map((token) => [token.text, [...token.tags].sort()]);
  assert.deepEqual(tokens, [
    ["%rule", ["keyword-rule"]], ["a", ["identifier"]], ["¬f?", ["guard"]], ["~b", ["tag"]], ["'c'", ["character"]],
    ["/d/", ["phoneme"]], ["E", ["identifier"]], ["...", ["ellipsis"]], ["|", ["'|'"]], ["g!", ["guard"]],
    ["%tags", ["keyword-tags"]], ["X", ["identifier"]], ["%rulex", ["keyword"]], ["$e", ["capture"]], ["¬", ["'¬'"]], ["h", ["identifier"]],
    ["'x'", ["character"]], ["..", ["double-dot"]], ["'y'", ["character"]], ["'\\p{L}'", ["property"]], ["'a'", ["character"]], ["...", ["ellipsis"]],
  ]);
});

test("the notation's lexical stage tags constants and the keywords that define them (grammars/notation/lexical.md)", () => {
  const run = loader.notation.parse("%const $SU-STOPS %redefine-const $x $ $K1", { features: new Set(), until: "lexical" });
  const tokens = /** @type {import("../src/tokens.js").Token[]} */ (run.stages[0].output).map((token) => [token.text, [...token.tags].sort()]);
  assert.deepEqual(tokens, [
    ["%const", ["keyword-const"]], ["$SU-STOPS", ["constant"]], ["%redefine-const", ["keyword-redefine-const"]],
    ["$x", ["capture"]], ["$", ["capture"]], ["$K1", ["constant"]],
  ]);
});

test("the hand-written bootstrap reader reads constants as the notation does", async () => {
  const { readDocument } = await import("../../../tools/bootstrap-reader.js");
  const document = "```jbogenbau\n%const $A ~a ∪ B\n%const $S \".\"\n%const $T split(\"x.y\", $S)\n%redefine-const $A $A ∖ B ∪ tag(\"C\")\n" +
    "%rule text $x(C) <$A>\n%conditions phonemes($x) ∈ $T, tag($S) ⊆ $A\n```\n";
  assert.deepEqual(readDocument(document, "t.md"), loader.readDocument(document, "t.md"));
});
