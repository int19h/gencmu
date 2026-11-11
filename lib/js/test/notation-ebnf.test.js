import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Loader } from "../src/node.js";
import { readGrammarFile } from "./shared.js";
import { syntaxEbnf } from "../../../tools/notation-ebnf.js";

const root = new URL("../../../", import.meta.url);
const spec = fs.readFileSync(new URL("docs/engine.md", root), "utf8");
const block = /Recognition productions:\n\n```text\n([\s\S]*?)\n```/.exec(spec);
assert.ok(block, "the recognition production block exists");
const source = readGrammarFile("grammars/gencmu/jbogenbau/syntax.md");
// A distinct path forces a source reading, even when the bundled cache is current.
const dom = new Loader(readGrammarFile).readDocument(source, "notation-ebnf-source.md");
const conforms = document => assert.equal(block[1], syntaxEbnf(document));

test("the specification EBNF covers every syntax production and recognition condition", () => {
  conforms(dom);
  assert.equal(block[1].split("\n").filter(line => line.startsWith("  assert ")).length,
    dom.rules.reduce((count, rule) => count + rule.conditions.length, 0));
  assert.match(block[1], /named-selector = method-name.*\n  assert \(\$\.first-token\.value ≠ "parse"\)/);
});

for (const change of ["changed", "added", "removed"]) {
  test(`the EBNF conformance check rejects a ${change} source condition`, () => {
    const clause = '%conditions\n  $.first-token.value ≠ "parse"';
    const replacements = {
      changed: clause.replace('"parse"', '"different"'),
      added: `${clause},\n  $.first-token.value ≠ "other"`,
      removed: "",
    };
    assert.ok(source.includes(clause));
    const alteredSource = source.replace(clause, replacements[change]);
    const altered = new Loader(readGrammarFile).readDocument(alteredSource, `notation-ebnf-${change}.md`);
    assert.throws(() => conforms(altered), { code: "ERR_ASSERTION" }, change);
  });
}

test("the EBNF generator rejects an unrepresented condition", () => {
  const altered = structuredClone(dom);
  altered.rules[0].conditions.push({ unknown: true });
  assert.throws(() => syntaxEbnf(altered), /Unrepresented recognition condition/);
});
