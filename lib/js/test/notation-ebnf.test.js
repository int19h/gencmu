import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Loader } from "../src/node.js";
import { readGrammarFile } from "./shared.js";
import { syntaxEbnf } from "../../../tools/notation-ebnf.js";

const root = new URL("../../../", import.meta.url);
const todo = "When the format 50 notation grammar exists, re-enable this check.";
const source = readGrammarFile("grammars/gencmu/jbogenbau/syntax.md");

function recognitionProductions() {
  const spec = fs.readFileSync(new URL("docs/engine.md", root), "utf8");
  const block = /Recognition productions:\n\n```text\n([\s\S]*?)\n```/.exec(spec);
  assert.ok(block, "the recognition production block exists");
  return block[1];
}

function readSyntax(text = source, path = "notation-ebnf-source.md") {
  // A distinct path forces a source reading even when the bundled cache is current.
  return new Loader(readGrammarFile).readDocument(text, path);
}

test("the specification EBNF covers every syntax production and recognition condition", { todo }, () => {
  const listing = recognitionProductions();
  const dom = readSyntax();
  assert.equal(listing, syntaxEbnf(dom));
  assert.equal(listing.split("\n").filter(line => line.startsWith("  assert ")).length,
    dom.rules.reduce((count, rule) => count + rule.conditions.length, 0));
  assert.match(listing, /named-selector = method-name.*\n  assert \(\$\.first-token\.value ≠ "parse"\)/);
});

for (const change of ["changed", "added", "removed"]) {
  test(`the EBNF conformance check rejects a ${change} source condition`, { todo }, () => {
    const listing = recognitionProductions();
    const clause = '%conditions\n  $.first-token.value ≠ "parse"';
    const replacements = {
      changed: clause.replace('"parse"', '"different"'),
      added: `${clause},\n  $.first-token.value ≠ "other"`,
      removed: "",
    };
    assert.ok(source.includes(clause));
    const alteredSource = source.replace(clause, replacements[change]);
    const altered = readSyntax(alteredSource, `notation-ebnf-${change}.md`);
    assert.throws(() => assert.equal(listing, syntaxEbnf(altered)), { code: "ERR_ASSERTION" }, change);
  });
}

test("the EBNF generator rejects an unrepresented condition", { todo }, () => {
  const altered = readSyntax();
  altered.rules[0].conditions.push({ unknown: true });
  assert.throws(() => syntaxEbnf(altered), /Unrepresented recognition condition/);
});
