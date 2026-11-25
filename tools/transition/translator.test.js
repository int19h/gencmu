import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { translateSharedCase } from "../translate-shared-cases.js";
import { createTransitionCompiler } from "../transition-compiler.js";

const compiler = createTransitionCompiler();
const legacyFixture = (family, name) =>
  JSON.parse(fs.readFileSync(new URL(`../../tests/${family}/${name}`, import.meta.url), "utf8"));

test("the translator keeps statement, alternative and emission terms on their owners", () => {
  const grammar = '%rule text :- "head"\n  | $x:A := "body"\n%emits $x :: Result';
  const { fixture, status, diagnostics } = translateSharedCase("engine", "probe", {
    grammar, expect: { where: { document: "main.md", line: 3, column: 1 } },
  });
  assert.equal(status, "translated");
  assert.deepEqual(diagnostics[0].from, diagnostics[0].to);
  const [rule] = compiler.compileDocument(fixture.documents["main.md"]).rules;
  assert.deepEqual(rule.term.bag[0].keys, ["image"]);
  assert.equal(rule.term.bag[0].value.string, "head");
  assert.deepEqual(rule.alternatives[0].term.bag[0].keys, ["value"]);
  assert.equal(rule.alternatives[0].term.bag[0].value.string, "body");
  assert.equal(rule.emit.items[0].capture, "x");
  assert.equal(rule.emit.items[0].term.bag[0].key, "Result");
});

test("the translator follows an old span receiver and keeps its literal operands", () => {
  const { fixture } = translateSharedCase("engine", "probe", {
    grammar: '%rule text $x:A\n%conditions $x.following-tokens.first-token.value ∈ ("b" "c")',
  });
  const [rule] = compiler.compileDocument(fixture.documents["main.md"]).rules;
  const [{ op, left, right }] = rule.conditions;
  assert.equal(op, "∈");
  assert.equal(left.receiver.map.receiver.method, "first-token");
  assert.equal(left.receiver.map.receiver.receiver.method, "following-tokens");
  assert.deepEqual(right.list.map(item => item.value.string), ["b", "c"]);
});

test("an obsolete malformed case stays on the format 49 path", () => {
  const name = "267-default-off-head.json";
  const original = legacyFixture("notation", name);
  assert.equal(translateSharedCase("notation", name, original).status, "old");
});

test("the hand-written origin counterpart keeps its recorded diagnostic position", () => {
  const name = "pattern-rule-positive-elided.json";
  const migrated = translateSharedCase("notation", name, legacyFixture("notation", name));
  const [{ to }] = migrated.diagnostics;
  assert.equal(migrated.status, "hand-migrated");
  assert.throws(() => compiler.compileDocument(migrated.document, "notation.md"), error => {
    assert.equal(error.description, migrated.expectedSourceError);
    assert.deepEqual(error.where, to);
    return true;
  });
});

test("the hand-written implication writes the extra key only at publication", () => {
  const name = "implies-emitted-only.json";
  const migrated = translateSharedCase("engine", name, legacyFixture("engine", name));
  const document = ["```jbogenbau", ...migrated.fixture.source, "```"].join("\n");
  const { rules } = compiler.compileDocument(document);
  assert.equal(migrated.status, "hand-migrated");
  assert.equal(rules[1].emit.items[0].term.bag[1].key, "M");
  assert.equal(rules[1].alternatives[0].term.bag.some(entry => entry.key === "M"), false);
});

test("each written migration has format 50 source or an expected source error", () => {
  const migrations = JSON.parse(fs.readFileSync(new URL("../shared-case-migrations.json", import.meta.url), "utf8"));
  const root = new URL("../../", import.meta.url);
  for (const [id, record] of Object.entries(migrations)) {
    if (record.expectedSourceError) continue;
    const [family, name] = id.split("/");
    const { document, fixture, diagnostics } = translateSharedCase(family, name, legacyFixture(family, name));
    if (fixture?.documents) {
      const scoped = createTransitionCompiler(file => fixture.documents[file] ??
        (file.startsWith("data/unicode/") ? fs.readFileSync(new URL(file, root), "utf8") : undefined));
      for (const [file, text] of Object.entries(fixture.documents)) {
        if (!file.endsWith(".md")) continue;
        if (file.endsWith("/shared.md")) {
          const first = scoped.compileDocument(text, file, ["grammars/demo/a.txt"]);
          const second = scoped.compileDocument(text, file, ["grammars/demo/b.txt"]);
          assert.equal(first.rules[0].alternatives[0].expr.literal.string, "\uE000");
          assert.equal(second.rules[0].alternatives[0].expr.literal.string, "\uE001");
          assert.deepEqual(first.rules[0].term.bag[0].value.at, [diagnostics[0].to.line, diagnostics[0].to.column]);
        } else assert.equal(scoped.compileDocument(text, file).format, 50, id);
      }
    } else {
      const source = document ?? ["```jbogenbau", ...fixture.source, "```"].join("\n");
      assert.equal(compiler.compileDocument(source, id).format, 50, id);
    }
  }
});
