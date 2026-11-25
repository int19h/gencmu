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

test("the listing keeps gate scope and nested alternatives", () => {
  const listing = body => syntaxEbnf(compiler.compileDocument("\x60\x60\x60jbogenbau\n%rule r " + body + "\n\x60\x60\x60"));
  assert.equal(listing("f? (A | B) | C"), "r = f? (A | B) | C");
  assert.equal(listing("f? A | B | C"), "r = f? A | B | C");
  assert.equal(listing("(A | B) | C"), "r = (A | B) | C");
  assert.equal(listing("f? (A B) | C"), "r = f? (A B) | C");
});

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
    const clause = "%conditions\n  $name ∨ ¬$.following-tokens.parse(key | \"'\" …)";
    const replacements = {
      changed: clause.replace("key | ", ""),
      added: `${clause},\n  $name.present`,
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

for (const [label, before, after] of [
  ["list gate", '%rule text A %conditions "a" ∈ ["a"]', '%rule text A %conditions "a" ∈ [f? "a"]'],
  ["list guard", '%rule text A %conditions "a" ∈ ["a"]', '%rule text A %conditions "a" ∈ [$? "a"]'],
  ["list splat", '%rule text A %conditions "a" ∈ [$A]', '%rule text A %conditions "a" ∈ [*$A]'],
  ["else branch", '%rule text A %conditions (1=1 ? "a" | "b") = "a"', '%rule text A %conditions (1=1 ? "a" | "c") = "a"'],
  ["alternative gate", "%rule text A", "%rule text f? A"],
]) {
  test(`the EBNF changes when a ${label} changes`, () => {
    const compile = text => syntaxEbnf(compiler.compileDocument("~~~jbogenbau\n" + text + "\n~~~"));
    assert.notEqual(compile(before), compile(after));
  });
}

test("the EBNF keeps parentheses on predicate-free any", () => {
  const dom = compiler.compileDocument("~~~jbogenbau\n%rule text A %conditions $.parse(A).any()\n~~~");
  assert.match(syntaxEbnf(dom), /\.parse\(A\)\.any\(\)/);
});

test("the EBNF inspects a method receiver before the argument", () => {
  const dom = compiler.compileDocument("~~~jbogenbau\n%rule text A %conditions $.span.tokens.all($P)\n~~~");
  const [condition] = dom.rules[0].conditions;
  condition.receiver.badReceiver = true;
  condition.args[0].badArgument = true;
  for (const node of [condition, { args: condition.args, receiver: condition.receiver, method: condition.method, at: condition.at }]) {
    dom.rules[0].conditions[0] = node;
    assert.throws(() => syntaxEbnf(dom), /unrepresented field badReceiver/);
  }
});
