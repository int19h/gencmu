import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { translateSharedCase } from "../translate-shared-cases.js";
import { createTransitionCompiler } from "../transition-compiler.js";

const compiler = createTransitionCompiler();
let activeDocuments = {};
const scopedCompiler = createTransitionCompiler(file => activeDocuments[file]);
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

test("the translator keeps each nested tag guard on its own entry", () => {
  const name = "i276-guard-simplified-origin.json";
  const { fixture } = translateSharedCase("engine", name, legacyFixture("engine", name));
  const rule = compiler.compileDocument(fixture.documents["main.md"]).rules.find(rule => rule.name === "r2");
  const [nested, direct] = rule.alternatives[0].term.bag;
  assert.equal(nested.guard.capture, "j");
  assert.equal(nested.value.bag[0].key, "T0");
  assert.equal(nested.value.bag[0].guard.method, "followed-by");
  assert.equal(direct.key, "T1");
  assert.equal(direct.guard.method, "followed-by");
});

test("a custom table can make punctuation an emoji rule name", () => {
  const name = "emoji-table-ascii-pattern.json";
  const { fixture } = translateSharedCase("engine", name, legacyFixture("engine", name));
  const compiled = createTransitionCompiler(file => fixture.documents[file]).compilePipeline(fixture.pipelineDocument);
  const [text, emoji] = compiled["g.md"].dom.rules;
  assert.equal(emoji.name, "!");
  assert.equal(text.alternatives[0].expr.expr.ref, "!");
  assert.equal(text.conditions[0].right.pattern.name, "!");
});

const negatives = JSON.parse(fs.readFileSync(new URL("../shared-negative-migrations.json", import.meta.url), "utf8"));
for (const [id, record] of Object.entries(negatives)) {
  test(id, () => {
    const [family, name] = id.split("/");
    const migrated = translateSharedCase(family, name, legacyFixture(family, name));
    assert.equal(migrated.oldPath, true);
    if (record.retired) {
      assert.equal(migrated.status, "retired");
      assert.equal(migrated.reason, record.retired);
      assert.equal(migrated.section, record.section);
      assert.match(migrated.section, /^Engine §/);
      return;
    }
    const { expected } = migrated;
    const compile = () => {
      if (!migrated.fixture) return compiler.compileDocument(migrated.document, "notation.md");
      const { documents, pipelineDocument } = migrated.fixture;
      activeDocuments = documents;
      const hasTables = Object.hasOwn(documents, "data/unicode/unicode.txt") ||
        Object.hasOwn(documents, "data/unicode/unicode-properties.txt");
      const reader = hasTables ? createTransitionCompiler(file => documents[file]) : scopedCompiler;
      return reader.compilePipeline(pipelineDocument);
    };
    if (record.native) {
      assert.equal(migrated.status, "native-pending");
      assert.match(migrated.section, /^Engine §/);
      assert.equal(expected.kind, "grammar");
      const source = migrated.fixture.documents[expected.document];
      const line = source.split("\n")[expected.line - 1];
      assert.match([...line][expected.column - 1], /\S/u);
      compile();
      return;
    }
    assert.equal(migrated.status, "retained-negative");
    assert.throws(compile, error => {
      assert.equal(error.kind, "grammar");
      for (const key of ["document", "line", "column", "stage"]) {
        if (Object.hasOwn(expected, key)) assert.equal(error.where[key], expected[key]);
      }
      if (expected.description !== undefined) assert.equal(error.description, expected.description);
      if (expected.token !== undefined) assert.match(error.description, new RegExp(`at token ${expected.token}(?:;|$)`));
      return true;
    });
  });
}

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

test("the translator retains the list frame for its item comparison", () => {
  const id = "item-condition-outer-capture.json";
  const { fixture, status } = translateSharedCase("engine", id, legacyFixture("engine", id));
  assert.equal(status, "translated");
  const [condition] = compiler.compileDocument(fixture.documents["main.md"]).rules[0].conditions;
  assert.equal(condition.receiver.capture, "c");
  assert.equal(condition.method, "all");
  const [predicate] = condition.args;
  assert.equal(predicate.lambda, "item");
  assert.equal(predicate.body.op, "≠");
  assert.equal(predicate.body.left.receiver.map.receiver.receiver.capture, "item");
  assert.equal(predicate.body.right.receiver.map.receiver.receiver.capture, "o");
});

test("the translator places the carrier on the mandatory primary", () => {
  const id = "attach-branch-names.json";
  const { fixture, status } = translateSharedCase("engine", id, legacyFixture("engine", id));
  assert.equal(status, "translated");
  const [rule] = compiler.compileDocument(fixture.documents["main.md"]).rules;
  assert.deepEqual(rule.emit.items, []);
  assert.equal(rule.alternatives[0].expr.seq[1].primary.capture, "w");
  assert.equal(rule.alternatives[1].expr.seq[0].primary.capture, "w");
});

test("the translator keeps a constant receiver in a native method counterpart", () => {
  const id = "notation-r2-begins-constant.json";
  const { fixture, status, expected } = translateSharedCase("engine", id, legacyFixture("engine", id));
  assert.equal(status, "native-pending");
  const source = fixture.documents["main.md"];
  const [condition] = compiler.compileDocument(source).rules[0].conditions;
  assert.equal(source.split("\n")[expected.line - 1][expected.column - 1], ".");
  assert.equal(condition.any[0].method, "parse");
  assert.equal(condition.any[0].receiver.const, "S");
});

test("a predicate receiver fails before the migrated list test", () => {
  const id = "notation-r2-ngrams-predicate.json";
  const { fixture, status, expected } = translateSharedCase("engine", id, legacyFixture("engine", id));
  assert.equal(status, "retained-negative");
  assert.equal(expected.description, "a method has the wrong receiver or arguments");
  const source = fixture.documents["main.md"];
  const line = source.split("\n")[expected.line - 1];
  assert.equal(line.slice(expected.column - 1), ".ngrams(1))");
});
test("the hand-written implication writes the extra key only at publication", () => {
  const name = "implies-emitted-only.json";
  const migrated = translateSharedCase("engine", name, legacyFixture("engine", name));
  const document = ["```jbogenbau", ...migrated.fixture.source, "```"].join("\n");
  const { rules } = compiler.compileDocument(document);
  assert.equal(migrated.status, "hand-migrated");
  assert.deepEqual(migrated.fixture.tokens[0], { text: "mi", props: { W: true, value: "mi" } });
  assert.equal(rules[1].emit.items[0].term.bag[1].key, "M");
  assert.equal(rules[1].alternatives[0].term.bag.some(entry => entry.key === "M"), false);
});

test("each written migration has format 50 source or an expected source error", () => {
  const migrations = JSON.parse(fs.readFileSync(new URL("../shared-case-migrations.json", import.meta.url), "utf8"));
  const root = new URL("../../", import.meta.url);
  for (const [id, record] of Object.entries(migrations)) {
    if (record.expectedSourceError || record.retired) continue;
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


test("a ranked group keeps its boundary when it shares a rule with another alternative", () => {
  const { fixture } = translateSharedCase("engine", "probe", {
    grammar: '%rule text (a ≻ b) :: ∅ | C',
  });
  const [rule] = compiler.compileDocument(fixture.documents["main.md"]).rules;
  assert.deepEqual(rule.alternatives[0].expr, { ranked: [{ ref: "a" }, { ref: "b" }] });
  assert.deepEqual(rule.alternatives[0].term, { bag: [] });
  assert.deepEqual(rule.alternatives[1].expr, { ref: "C" });
});

test("empty caller strings use the property bag and invalid caller fields stay written", () => {
  for (const channel of ["value", "image"]) {
    const name = `values-caller-empty-${channel}.json`;
    const migrated = translateSharedCase("engine", name, legacyFixture("engine", name));
    assert.deepEqual(migrated.fixture.tokens[0], { text: "a", props: { [channel]: "" } });
  }
  const token = { text: "a", tags: ["A", "A"], value: "" };
  const bad = translateSharedCase("engine", "repeat-key-probe", {
    grammar: "%rule text A", tokens: [token], expect: { error: "usage" },
  });
  assert.deepEqual(bad.fixture.tokens[0], token);
});

test("stage feature reads address the input span and a guarded literal gives a list", () => {
  for (const name of ["stage-features-token-methods.json", "stage-features-token-guarded-string.json"]) {
    const migrated = translateSharedCase("engine", name, legacyFixture("engine", name));
    const dom = compiler.compileDocument(migrated.fixture.documents["p.md"]);
    const [first] = dom.directives.find(directive => directive.conditions?.length).conditions;
    if (first.op === "=") assert.equal(first.left.receiver.map.receiver.capture, "");
    else {
      assert.equal(first.op, "∈");
      assert.deepEqual(first.right.list[0].guard, { capture: "" });
      assert.deepEqual(first.right.list[0].value, { string: "x" });
    }
    assert.doesNotMatch(migrated.fixture.documents["p.md"], /\$\.span\.tokens/);
  }
});

test("stage-dependent arguments and co-bound repeated captures require a decision", () => {
  const fenced = text => "\x60\x60\x60jbogenbau\n" + text + "\n\x60\x60\x60";
  const aliases = translateSharedCase("engine", "constant-scope-probe", { pipelineDocument: "p.md", documents: {
    "p.md": fenced('%stage main\n%include "a.md"\n%include "b.md"'),
    "a.md": fenced('%const $S "a"'),
    "b.md": fenced('%rule text f($S)'),
  } });
  assert.equal(aliases.status, "needs-hand");
  assert.match(aliases.reason, /argument's stage and version/);
  const repeated = translateSharedCase("engine", "repeat-read-probe", {
    grammar: "%rule text {$x:A $y:B} %conditions $x.value = $y.value",
  });
  assert.equal(repeated.status, "needs-hand");
  assert.match(repeated.reason, /co-bound operands/);
});

test("an insertion gets both explicit strings and an unproved singleton inheritance goes to hand", () => {
  const inserted = translateSharedCase("engine", "insertion-probe", { grammar: "%rule text ε %emits ε :: T" });
  const element = compiler.compileDocument(inserted.fixture.documents["main.md"]).rules[0].emit.items[0];
  assert.deepEqual(element.term.bag.map(({ key, keys, value }) => ({ key, keys, value })), [
    { key: "T", keys: undefined, value: undefined },
    { key: undefined, keys: ["image", "value"], value: { string: "" } },
  ]);
  const singleton = translateSharedCase("engine", "singleton-probe", { grammar: "%rule text {A} %emits $" });
  assert.equal(singleton.status, "needs-hand");
  assert.match(singleton.reason, /singleton route can inherit keys/);
});

test("a value pattern keeps written empty strings and the omitted control has its own origin test", () => {
  const control = translateSharedCase("engine", "empty-written", {
    grammar: '%rule text $x:T %conditions $x ≅ #T=""',
  });
  const condition = compiler.compileDocument(control.fixture.documents["main.md"]).rules[0].conditions[0];
  assert.deepEqual(condition.right.pattern.value, { string: "" });
  assert.equal(condition.right.pattern.test, "=");
  const name = "values-pattern-omitted-empty-value.json";
  const omitted = translateSharedCase("engine", name, legacyFixture("engine", name));
  assert.equal(omitted.status, "hand-migrated");
  assert.ok(omitted.fixture.source.some(line => line.includes('T=""') && line.includes("T<_Elided>")));
});

test("a rule across grammar fences maps its operand from the physical line", () => {
  const fenced = text => "\x60\x60\x60jbogenbau\n" + text + "\n\x60\x60\x60";
  const where = { document: "g.md", line: 6, column: 1 };
  const result = translateSharedCase("engine", "block-position-probe", {
    documents: { "p.md": fenced('%stage main\n%include "g.md"'), "g.md": fenced("%rule text") + "\nProse.\n" + fenced("absent") },
    pipelineDocument: "p.md", expect: { error: "grammar", where },
  });
  assert.deepEqual(result.diagnostics[0].from, where);
  assert.deepEqual(result.diagnostics[0].to, { document: "g.md", line: 3, column: 1 });
});

for (const name of ["names-core-version-missing.json", "names-core-version-repeated.json", "properties-resource-binary-arity.json"]) {
  test(`the resource error remains active in ${name}`, () => {
    const record = translateSharedCase("engine", name, legacyFixture("engine", name));
    assert.equal(record.status, "portable-negative");
    const { documents, pipelineDocument } = record.fixture;
    assert.throws(() => createTransitionCompiler(file => documents[file]).compilePipeline(pipelineDocument), error => {
      assert.deepEqual({ description: error.description, ...error.where }, record.expected);
      return true;
    });
  });
}

test("invalid pipeline names are portable and language deferrals name the bundle", () => {
  for (const name of ["pipeline-name-empty.json", "pipeline-name-parent.json", "pipeline-name-unknown.json"]) {
    assert.equal(translateSharedCase("engine", name, legacyFixture("engine", name)).status, "portable-negative");
  }
  const deferred = translateSharedCase("engine", "bundle-probe", { pipeline: "lojban/cll", input: "mi" });
  assert.match(deferred.reason, /lojban\/cll/);
});
