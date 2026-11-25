import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createTransitionCompiler } from "../../../tools/transition-compiler.js";
import { syntaxEbnf } from "../../../tools/notation-ebnf.js";

const root = new URL("../../../", import.meta.url);
const sourcePath = "grammars50/gencmu/jbogenbau/syntax.md";
const source = fs.readFileSync(new URL(sourcePath, root), "utf8");
const compiler = createTransitionCompiler();

function recognitionProductions() {
  const spec = fs.readFileSync(new URL("docs/engine.md", root), "utf8");
  const block = /Recognition productions:\n\n```text\n([\s\S]*?)\n```/.exec(spec);
  assert.ok(block, "the recognition production block exists");
  return block[1];
}

test("the specification EBNF covers every format 50 syntax production and recognition condition", () => {
  const listing = recognitionProductions();
  const dom = compiler.compileDocument(source, sourcePath);
  assert.equal(listing, syntaxEbnf(dom));
  assert.equal(listing.split("\n").filter(line => line.startsWith("  assert ")).length,
    dom.rules.reduce((count, rule) => count + rule.conditions.length, 0));
  assert.match(listing, /named-selector = method-name.*\n  assert \(\$\.first-token\.tokens!'value\.join\(\) ∉ \["parse"/);
});

for (const change of ["changed", "added", "removed"]) {
  test(`the EBNF conformance check rejects a ${change} source condition`, () => {
    const listing = recognitionProductions();
    const clause = '%conditions\n  $header ⟹ $header.following-tokens.first-token.tokens!\'value.join() = "|"';
    const replacements = {
      changed: clause.replace('"|"', '"&"'),
      added: `${clause},\n  $header.present`,
      removed: "",
    };
    assert.ok(source.includes(clause));
    const altered = compiler.compileDocument(source.replace(clause, replacements[change]), sourcePath);
    assert.throws(() => assert.equal(listing, syntaxEbnf(altered)), { code: "ERR_ASSERTION" }, change);
  });
}

test("the EBNF generator rejects an unrepresented condition", () => {
  const altered = compiler.compileDocument(source, sourcePath);
  altered.rules[0].conditions.push({ unknown: true });
  assert.throws(() => syntaxEbnf(altered), /Unrepresented recognition condition/);
});
