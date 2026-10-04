// The shared cases of tests/query-depth.json: nested queries nest as deep
// as the input makes them, on an ordinary stack (tests/README.md, "Query
// depth cases"). These run on the main thread, with node's default stack.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repository } from "./shared.js";
import { loadDialectSources } from "../src/node.js";

const cases = JSON.parse(fs.readFileSync(path.join(repository, "tests", "query-depth.json"), "utf8"));

/**
 * The dialect whose one stage is `grammar`, reading the text's characters.
 * @param {string} grammar
 */
function single(grammar) {
  return loadDialectSources({
    "p.md": "```jbogenbau\n%stage main\n%include \"g.md\"\n```\n",
    "g.md": "# A grammar\n\n```jbogenbau\n" + grammar + "\n```\n",
  }, "p.md");
}

test("nested queries nest as deep as the text on an ordinary stack (tests/query-depth.json)", () => {
  assert.ok(cases.length > 0);
  for (const testCase of cases) {
    const text = testCase.link.repeat(testCase.count) + testCase.suffix;
    const result = single(testCase.grammar).parse(text, { autoFeatures: false });
    assert.equal(result.ok, true, `${testCase.name}: ${JSON.stringify(result.error)}`);
  }
});

test("a tag term of an emission asks a chain of nested queries on an ordinary stack", () => {
  // Emission evaluates the tag term outside any recognition. Its nested
  // query starts a chain of further ones, each over a span one token
  // shorter, and the recognizer keeps that chain on its own stack too.
  const chain = "%rule c 'a' %conditions ¬matches(after($), c)";
  const grammar = `%ambiguity-resolution greedy\n%rule text $x(s) %emits $ <T ∪ tags($x, c)>\n%rule s {'a'}\n${chain}`;
  const result = single(grammar).parse("a".repeat(20000), { autoFeatures: false });
  assert.equal(result.ok, true, JSON.stringify(result.error));
});
