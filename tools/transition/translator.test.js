import assert from "node:assert/strict";
import fs from "node:fs";
import { after, test } from "node:test";
import { translateSharedCase as translate } from "../translate-shared-cases.js";
import { createDifferential, fixtureDifferential } from "./differential.js";
import { transitionBatch } from "./sweep.js";
import { operandFields50 } from "../../lib/js/src/format50/records.js";
import { Token } from "../../lib/js/src/node.js";
import { loaderWith } from "../../lib/js/test/shared.js";

const batch = transitionBatch();
assert.ok(!batch || batch.suite === "catalog" || batch.suite === "written", "select a translator suite");
const differential = createDifferential();
after(() => {
  const details = batch?.suite === "catalog" ? { total: catalog.length, cases: selectedNegatives.length } :
    batch?.suite === "written" ? { total: written.length, cases: selectedWritten.length } : {};
  differential.finish("translator inputs", details);
});
const compiler = differential.compiler();
const inspectTranslation = fixtureDifferential(differential);
const translateSharedCase = (family, file, fixture) => {
  const result = translate(family, file, fixture);
  inspectTranslation(result);
  return result;
};
let activeDocuments = {};
const scopedCompiler = differential.compiler(file => activeDocuments[file]);
const legacyFixture = (family, name) =>
  JSON.parse(fs.readFileSync(new URL(`../../tests/${family}/${name}`, import.meta.url), "utf8"));

function hasSite(root, line, column) {
  const pending = [[root, "document"]];
  while (pending.length) {
    const [record, category] = pending.pop();
    if (!record || typeof record !== "object") continue;
    if (Array.isArray(record.at) && record.at[0] === line && record.at[1] === column) return true;
    for (const [, child, childCategory] of operandFields50(record, category)) pending.push([child, childCategory]);
  }
  return false;
}

function matchesSite(record, expected) {
  const dom = record?.dom ?? record;
  if (!expected.owner) return hasSite(dom, expected.line, expected.column);
  const owner = expected.owner.split("/").slice(1).reduce((node, part) => node?.[part], dom);
  return owner?.at?.[0] === expected.line && owner.at[1] === expected.column;
}

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

test("the input value join excludes nonempty elidable defaults", () => {
  for (const name of [
    "267-default-emission", "267-default-image", "267-default-template-constant",
    "267-default-template-head", "267-default-template-string", "reparse-original-rule-test",
  ]) {
    const file = name + ".json";
    const migrated = translateSharedCase("engine", file, legacyFixture("engine", file));
    const { documents, pipelineDocument } = migrated.fixture;
    assert.match(documents["main.md"], /value: \$\.span\.tokens!'value\.join\(\)/, name);
    assert.match(documents[pipelineDocument], /image: \$node\.children!'image\.join\(\)/, name);
    assert.ok(migrated.changes.some(change => change.document === "main.md" &&
      change.reason.includes("route with an omitted default")), name);
  }
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
  const compiled = differential.compiler(file => fixture.documents[file]).compilePipeline(fixture.pipelineDocument);
  const [text, emoji] = compiled["g.md"].dom.rules;
  assert.equal(emoji.name, "!");
  assert.equal(text.alternatives[0].expr.expr.ref, "!");
  assert.equal(text.conditions[0].right.pattern.name, "!");
});

const negatives = JSON.parse(fs.readFileSync(new URL("../shared-negative-migrations.json", import.meta.url), "utf8"));
const definitionOrder = new Set([
  "engine/definition-alternative-tags-name-absent-capture.json",
  "engine/definition-rule-tags-before-alternative-tags.json",
  "engine/issue314-alternative-tags.json",
  "engine/issue314-split-order-a-alternative.json",
  "engine/issue314-split-order-b-alternative.json",
  "engine/notation-r2-stage-integer-zero-discarded.json",
  "engine/notation-r2-stage-integer-zero-surviving.json",
  "notation/267-default-off-head.json",
  "notation/braces-257-deep.json",
  "notation/chain-alone-in-group.json",
  "notation/chain-alone-in-groups.json",
  "notation/deep-groups-syntax-later.json",
  "notation/deep-optionals-then-error.json",
  "notation/deep-optionals.json",
  "notation/deep-template-before-later-reader-error.json",
  "notation/deep-template-capture-before-depth.json",
  "notation/deep-template-depth-limit.json",
  "notation/definition-order-alternative-tags.json",
  "notation/definition-order-clause-definition.json",
  "notation/definition-order-tags-conditions.json",
  "notation/marked-optional-order-chain-first.json",
  "notation/nesting-257.json",
  "notation/nesting-too-deep-paired-later.json",
  "notation/nesting-too-deep-paired.json",
  "notation/nesting-too-deep-then-error.json",
  "notation/range-tag-set.json",
  "notation/range-wide-before-called-parameter.json",
  "notation/range-wide-before-parameter.json",
  "notation/reader-order-range-descending-tag.json",
  "notation/reader-order-range-descending-value.json",
  "notation/reader-order-range-multiple-scalars-tag.json",
  "notation/reader-order-range-multiple-scalars-value.json",
  "notation/tag-bare-name.json",
  "notation/tags-unguarded.json",
  "notation/test-nesting-257.json",
  "notation/values-include-method-syntax-first.json",
  "notation/values-include-method-syntax.json",
]);
const catalog = Object.entries(negatives);
const sampleNegatives = [...catalog.slice(0, 12), ["notation/nested-head-parameter-before-body.json",
  negatives["notation/nested-head-parameter-before-body.json"]]];
const selectedNegatives = !batch ? sampleNegatives :
  batch.suite === "catalog" ? catalog.slice(batch.start, batch.start + batch.count) : [];
for (const [id, record] of selectedNegatives) {
  test(definitionOrder.has(id) ? `§9.3 order ${id}` : id, () => {
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
      const reader = hasTables ? differential.compiler(file => documents[file]) : scopedCompiler;
      return reader.compilePipeline(pipelineDocument);
    };
    if (record.native) {
      assert.equal(migrated.status, "native-pending");
      assert.match(migrated.section, /^Engine §/);
      const compiled = compile();
      if (record.load) {
        assert.equal(migrated.load, true);
        assert.equal(expected, undefined);
      } else {
        assert.equal(expected.kind, "grammar");
        assert.ok(matchesSite(compiled[expected.document], expected),
          `${expected.document}:${expected.line}:${expected.column} needs a DOM record at the expected site`);
      }
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

const migrations = JSON.parse(fs.readFileSync(new URL("../shared-case-migrations.json", import.meta.url), "utf8"));
const written = Object.entries(migrations).filter(([, record]) => !record.expectedSourceError && !record.retired);
const selectedWritten = batch ? written.slice(batch.start, batch.start + batch.count) : [written[0], written.at(-1)];

test("each written migration has format 50 source or an expected source error", () => {
  const root = new URL("../../", import.meta.url);
  for (const [id, record] of selectedWritten) {
    if (batch) console.log(JSON.stringify({ writtenMigration: id }));
    const [family, name] = id.split("/");
    const { document, fixture, diagnostics } = translateSharedCase(family, name, legacyFixture(family, name));
    if (fixture?.documents) {
      const scoped = differential.compiler(file => fixture.documents[file] ??
        (file.startsWith("data/unicode/") ? fs.readFileSync(new URL(file, root), "utf8") : undefined));
      for (const [file, text] of Object.entries(fixture.documents)) {
        if (!file.endsWith(".md")) continue;
        if (file.endsWith("/shared.md")) {
          const first = scoped.compileDocument(text, file, ["grammars/demo/a.txt"]);
          const second = scoped.compileDocument(text, file, ["grammars/demo/b.txt"]);
          assert.equal(first.rules[0].alternatives[0].expr.literal.string, "\uE000");
          assert.equal(second.rules[0].alternatives[0].expr.literal.string, "\uE001");
          assert.deepEqual(first.rules[0].term.bag[0].value.at, [diagnostics[0].to.line, diagnostics[0].to.column]);
        } else {
          const dom = scoped.compileDocument(text, file);
          assert.equal(dom.format, 50, id);
          if (record.expected?.document === file && record.expected.line) {
            assert.ok(matchesSite(dom, record.expected), id);
          }
        }
      }
    } else {
      const source = document ?? ["```jbogenbau", ...fixture.source, "```"].join("\n");
      const dom = compiler.compileDocument(source, id);
      assert.equal(dom.format, 50, id);
      if (record.expected?.line) assert.ok(matchesSite(dom, record.expected), id);
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
    assert.throws(() => differential.compiler(file => documents[file]).compilePipeline(pipelineDocument), error => {
      assert.deepEqual({ description: error.description, ...error.where }, record.expected);
      return true;
    });
  });
}

test("invalid pipeline names are portable and language deferrals name the bundle", () => {
  for (const name of ["pipeline-name-empty.json", "pipeline-name-parent.json", "pipeline-name-unknown.json"]) {
    assert.equal(translateSharedCase("engine", name, legacyFixture("engine", name)).status, "portable-negative");
  }
  // The format 50 bundle decides which pipelines a case can run. A pipeline is
  // in the bundle where grammars50/NAME/pipeline.md exists.
  const inBundle = name => fs.existsSync(new URL(`../../grammars50/${name}/pipeline.md`, import.meta.url));
  // Each probe takes a bundled language pipeline from the source roots, so the
  // test follows the migration instead of naming its state.
  const pipelines = root => fs.readdirSync(new URL(`../../${root}/`, import.meta.url), { recursive: true })
    .filter(file => file.endsWith("/pipeline.md") && !file.startsWith("gencmu/"))
    .map(file => file.slice(0, -"/pipeline.md".length)).sort();
  const old = pipelines("grammars").find(name => !inBundle(name));
  const migrated = pipelines("grammars50")[0];
  assert.ok(old && migrated, "the probes need one pipeline on each side");
  const deferred = translateSharedCase("engine", "bundle-probe", { pipeline: old, input: "mi" });
  assert.equal(deferred.status, "deferred");
  assert.ok(deferred.reason.includes(old));
  const runnable = translateSharedCase("engine", "bundle-probe", { pipeline: migrated, input: "mi" });
  assert.equal(runnable.status, "native-pending");
  assert.equal(runnable.reason, "Run the pipeline with the format 50 bundle.");
  assert.equal(runnable.fixture.pipeline, migrated);
  const catalogCase = legacyFixture("engine", "pipeline-catalog.json");
  const catalog = translateSharedCase("engine", "pipeline-catalog.json", catalogCase);
  const missing = catalogCase.expect.bundledPipelines.filter(name => !inBundle(name));
  assert.ok(missing.length, "the catalog case needs a pipeline outside the bundle");
  assert.equal(catalog.status, "deferred");
  for (const name of catalogCase.expect.bundledPipelines) {
    const listed = catalog.reason.split(/[ ,.]+/).includes(name);
    assert.equal(listed, missing.includes(name), `the catalog reason and the bundle disagree on ${name}`);
  }
});

test("an item without the tested capture needs a hand migration", () => {
  const grammar = "%rule text {A | $c:B}\n%conditions $c";
  const probe = translateSharedCase("engine", "partial-item-probe", { grammar });
  assert.equal(probe.status, "needs-hand");
  assert.match(probe.reason, /an item route can omit/i);

  for (const [name, condition] of [
    ["presence", "not"], ["presence-holds", "not"],
    ["simplified-without-item", "if"], ["simplified-without-item-holds", "if"],
  ]) {
    const file = `item-condition-${name}.json`;
    const { fixture, status } = translateSharedCase("engine", file, legacyFixture("engine", file));
    assert.equal(status, "hand-migrated");
    const [rule] = compiler.compileDocument(fixture.documents["main.md"]).rules;
    const body = rule.alternatives[0].expr;
    const repetition = body.seq?.at(-1) ?? body;
    assert.equal(repetition.repeat.choice[0].capture, "a");
    assert.equal(rule.conditions[0][condition].capture, "a");
  }
});

test("the whole optional retains its body in its format 50 counterpart", () => {
  const name = "helper-tags.json";
  const { fixture, status, load, expected } = translateSharedCase("engine", name, legacyFixture("engine", name));
  assert.equal(status, "native-pending");
  assert.equal(load, true);
  const [text, rule] = compiler.compileDocument(fixture.documents["main.md"]).rules;
  assert.equal(text.alternatives[0].expr.ref, "w");
  assert.equal(rule.alternatives[0].expr.optional.ref, "A");
  assert.deepEqual(rule.emit.items, []);
  assert.deepEqual(expected, { props: { value: "a", image: "a" } });
});

for (const suffix of ["", "-not", "-reject", "-not-reject"]) {
  test(`the optional list preserves the outer comparison${suffix}`, () => {
    const name = `item-comparison-optional-pattern${suffix}.json`;
    const migrated = translateSharedCase("engine", name, legacyFixture("engine", name));
    assert.equal(migrated.status, "translated");
    const { rules } = compiler.compileDocument(migrated.fixture.documents["main.md"]);
    const rule = rules.find(rule => rule.name === "text");
    assert.ok(rule.alternatives[0].expr.seq[2].optional);
    const [outer, list] = rule.conditions[0].all;
    assert.deepEqual([outer.left.capture, outer.right.capture], ["x", "y"]);
    assert.equal(outer.op, "≅");
    assert.equal(list.method, "all");
    assert.equal(list.receiver.capture, "c");
    assert.equal(list.args[0].body.left.capture, list.args[0].lambda);
    assert.ok(migrated.changes.some(change => change.reason.includes("run on an empty list")));
  });
}

for (const name of [
  "item-condition-optional-braces-empty", "item-condition-optional-braces-fails",
  "item-condition-through-helper", "item-condition-through-helper-holds",
  "item-comparison-optional-tree", "item-comparison-optional-tree-reject",
]) {
  test(`the optional list keeps the item-only condition in ${name}`, () => {
    const file = name + ".json";
    const moved = translateSharedCase("engine", file, legacyFixture("engine", file));
    assert.equal(moved.status, "translated");
    const { rules } = compiler.compileDocument(moved.fixture.documents["main.md"]);
    const predicates = rules.flatMap(rule => rule.conditions).filter(condition => condition.method === "all");
    assert.ok(predicates.length);
  });
}

test("mixed recipes join the written child values and skip synthetic values", () => {
  const migrated = translateSharedCase("engine", "omission-with-recipe", {
    grammar: '%rule text item [$end:+T ≝ "end"]\n%emits\n%rule item A := "cooked"',
  });
  assert.equal(migrated.status, "translated");
  const { documents, pipelineDocument } = migrated.fixture;
  const { rules } = compiler.compileDocument(documents["main.md"]);
  const value = rules[0].alternatives[0].term.bag[0];
  const { constants } = compiler.compileDocument(documents[pipelineDocument]);
  const defaults = constants.find(item => item.name === "DEFAULTS").value;
  const image = defaults.body.bag[1];
  const map = value.value.receiver;
  assert.equal(map.map.method, "children");
  assert.equal(map.by.body.if.right.pattern.requirements[0].value.tag, "_Elided");
  assert.equal(map.by.body.then.string, "");
  assert.equal(map.by.body.else.property, "value");
  assert.equal(image.value.receiver.map.method, "children");
});

test("the tested rule keeps its input join when another rule cooks a value", () => {
  const name = "reparse-original-rule-test.json";
  const prior = legacyFixture("engine", name);
  const base = translateSharedCase("engine", name, prior);
  const unrelated = translateSharedCase("engine", name, {
    ...prior, grammar: prior.grammar + '\n%rule unused Z := "cooked"',
  });
  const testedRule = outcome => compiler.compileDocument(outcome.fixture.documents["main.md"]).rules.find(rule => rule.name === "a");
  assert.equal(unrelated.status, "translated");
  assert.deepEqual(testedRule(unrelated), testedRule(base));
  assert.match(unrelated.fixture.documents["main.md"], /a="a"/);
  const value = testedRule(unrelated).alternatives[0].term.bag[0].value;
  assert.equal(value.receiver.map.receiver.method, "span");
  const uncertain = translateSharedCase("engine", name, {
    ...prior, grammar: prior.grammar.replace("%rule a (A", "%rule a (cooked") + '\n%rule cooked A := "cooked"',
  });
  assert.equal(uncertain.status, "needs-hand");
  assert.match(uncertain.reason, /input-join proof/);
  const mixedAlternatives = translateSharedCase("engine", name, {
    ...prior, grammar: prior.grammar.replace('%rule a (A [+T="ta"])', '%rule a (A [+T="ta"]) | Z := "cooked"'),
  });
  assert.equal(mixedAlternatives.status, "needs-hand");
  assert.match(mixedAlternatives.reason, /input-join proof/);
});

test("a same-named recipe in a separate stage leaves the tested rule alone", () => {
  const first = '%stage first\n%ambiguity-resolution greedy\n%rule text a="a"\n%rule a item [+T ≝ "end"]\n%rule item A';
  const second = '%stage second\n%ambiguity-resolution greedy\n%rule text item\n%rule item A := "cooked"';
  const moved = translateSharedCase("engine", "omission-in-one-stage", {
    pipelineDocument: "p.md", documents: { "p.md": "\x60\x60\x60jbogenbau\n" + first + "\n" + second + "\n\x60\x60\x60" },
  });
  assert.equal(moved.status, "translated");
  assert.match(moved.fixture.documents["p.md"], /%rule a item \[\+T ≝ "end"\] → \{value: \$\.span\.tokens!'value\.join\(\)\}/);
});

test("the translator records changes to output, display and working reads", () => {
  const migrated = translateSharedCase("engine", "recipe-record", {
    grammar: '%rule text $x:r\n%conditions $x.emitted.value = "a"\n%rule r A',
  });
  // The old grammar rejects this recognition demand, so a recorded
  // migration is required for it. A late read prints the working property.
  const valid = translateSharedCase("engine", "recipe-record-late", {
    grammar: '%rule text (A | B) := "a"\n%emits $ := $.emitted.value',
  });
  assert.equal(migrated.status, "needs-negative");
  assert.equal(valid.status, "translated");
  assert.ok(valid.changes.some(change => change.reason.includes("$OUTPUTS")));
  assert.ok(valid.changes.some(change => change.reason.includes("display primary")));
  assert.ok(valid.changes.some(change => change.reason.includes("working value property")));
  const { rules: [rule] } = compiler.compileDocument(valid.fixture.documents["main.md"]);
  assert.equal(rule.alternatives.length, 1);
  assert.equal(rule.alternatives[0].expr.choice.length, 2);
  assert.deepEqual(rule.alternatives[0].expr.choice.map(node => node.primary.ref), ["A", "B"]);
  assert.equal(rule.alternatives[0].term.bag[0].value.string, "a");
});

for (const [body, actual] of [
  ["A @X", '[+T ≝ "end"]'],
  ["@X", '(A [+T ≝ "end"])'],
]) {
  test(`the translator requires a supplier for the bound actual ${actual}`, () => {
    const grammar = `%rule wrap(@X) ${body}\n%emits\n%rule text = wrap(${actual})`;
    const old = "\x60\x60\x60jbogenbau\n%stage main\n%ambiguity-resolution greedy\n" + grammar + "\n\x60\x60\x60";
    const result = loaderWith({ "main.md": old }).pipeline("case/main.md")
      .parse("a", { tokens: [new Token(["A"], [0, 1], [0, 1], "a")] });
    assert.equal(result.ok, true);
    const [token] = result.stages.at(-1).output;
    assert.deepEqual([token.value, token.image], ["a", "a"]);

    const moved = translateSharedCase("engine", "bound-omission", { grammar });
    assert.equal(moved.status, "needs-hand");
    assert.match(moved.reason, /instance value.*body argument/);
  });
}

test("the translator checks direct and nested calls for unproved body arguments", () => {
  for (const call of ['wrap([+T ≝ "end"])', 'wrap((leaf([+T ≝ "end"])))']) {
    const grammar = `%rule text ${call}\n%rule wrap(@X) A @X\n%rule leaf(@X) @X`;
    const moved = translateSharedCase("engine", "called-omission", { grammar });
    assert.equal(moved.status, "needs-hand");
    assert.match(moved.reason, /body argument/);
  }
});

test("the translator keeps the supplier on a named child and skips a proven unused argument", () => {
  const grammar = '%rule wrap(@X) A @X\n%emits\n%rule text = wrap(child)\n%rule child A [+T ≝ "end"]';
  const moved = translateSharedCase("engine", "named-omission", { grammar });
  assert.equal(moved.status, "translated");
  const dom = compiler.compileDocument(moved.fixture.documents["main.md"]);
  const child = dom.rules.find(rule => rule.name === "child");
  const value = child.alternatives[0].term.bag.find(item => item.keys?.includes("value")).value;
  assert.equal(value.receiver.map.receiver.method, "span");
  assert.equal(dom.rules.find(rule => rule.name === "text").instance.args[0].rule, "child");

  const ignores = '%rule wrap(@X) A\n%emits\n%rule text = wrap([+T ≝ "end"])';
  const unused = translateSharedCase("engine", "unused-omission", { grammar: ignores });
  assert.equal(unused.status, "translated");
  assert.match(unused.fixture.documents["main.md"], /%rule text = wrap/);
});

test("the translator reports the first of two unproved body arguments", () => {
  const grammar = '%rule wrap(@X) A @X\n%rule text wrap([+T ≝ "end"]) wrap([+U ≝ "end"])';
  const moved = translateSharedCase("engine", "two-unproved-arguments", { grammar });
  assert.equal(moved.status, "needs-hand");
  assert.deepEqual(moved.at, [4, 12]);
});

test("the translator finishes a nested body argument before its sibling", () => {
  for (const [inner, sibling, at] of [
    ['[+T ≝ "one"]', '[+U ≝ "two"]', [5, 18]],
    ['[+T ≝ "one"]', "U", [5, 18]],
    ["T", '[+U ≝ "two"]', [5, 12]],
    ["T", "U", undefined],
  ]) {
    const grammar = `%rule leaf(@V) A @V\n%rule outer(@X, @Y) @X @Y\n%rule text outer(leaf(${inner}), ${sibling})`;
    const moved = translateSharedCase("engine", "nested-and-sibling-arguments", { grammar });
    assert.equal(moved.status, at ? "needs-hand" : "translated");
    if (at) assert.deepEqual(moved.at, at);
  }
});

test("the translator keeps rule edits named like directives in their stage", () => {
  const names = ["names", "include", "stage", "features", "elision-only",
    "ambiguity-resolution", "extend-stage", "redefine-stage"];
  const grammar = names.flatMap(name => [
    `%rule ${name}(@X) @X`,
    `%extend-rule ${name}(A) B [+T ≝ "end"]`,
  ]).concat("%rule text B").join("\n");
  const result = translateSharedCase("engine", "rule-edits-named-like-directives", { grammar });
  assert.equal(result.status, "translated");
  const dom = compiler.compileDocument(result.fixture.documents["main.md"]);
  const edits = dom.rules.filter(rule => rule.op === "extend");
  assert.deepEqual(edits.map(rule => rule.name), names);
  assert.deepEqual(dom.directives.map(directive => directive.name), ["ambiguity-resolution"]);
  for (const edit of edits) {
    const value = edit.alternatives[0].term.bag.find(entry => entry.keys?.includes("value")).value;
    assert.equal(value.receiver.map.receiver.method, "span");
  }
});
