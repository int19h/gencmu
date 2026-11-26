import assert from "node:assert/strict";
import fs from "node:fs";
import { after, test } from "node:test";
import { createDifferential } from "./differential.js";

const fixture = new URL("../../tests/tree-emission/pairs.json", import.meta.url);
const pairs = JSON.parse(fs.readFileSync(fixture, "utf8"));
const causes = JSON.parse(fs.readFileSync(new URL("../../lib/js/test/tree-emission-causes.json", import.meta.url), "utf8"));
const differential = createDifferential();
after(() => differential.finish("compiler inputs"));
const compiler = differential.compiler();

test("a custom emoji rule name can also be an ASCII tag spelling", () => {
  const unicode = [
    "unicode 15.1.0",
    "white-space 0009 000D",
    "white-space 0020 0020",
    "emoji-presentation 0041 0041",
    "emoji-presentation 0061 0061",
  ].join("\n") + "\n";
  const custom = differential.compiler(file => file === "data/unicode/unicode.txt" ? unicode : undefined);
  const { rules } = custom.compileDocument(`\`\`\`jbogenbau
%rule A "a"
%rule a(@p) @p
%rule A(@p) @p
%rule text a(A) A(A)
\`\`\`\n`);
  assert.deepEqual(rules.map(rule => rule.name), ["A", "a", "A", "text"]);
  const calls = rules.at(-1).alternatives[0].expr.seq;
  assert.deepEqual(calls.map(call => [call.call, call.args[0].tag]), [["a", "A"], ["A", "A"]]);
});

function cases(pair) {
  return [
    ["valid", pair.valid], ["malformed", pair.malformed],
    ...(pair.controls ?? []).map((entry, index) => [`control/${index}`, entry]),
  ];
}

function selected(record, pointer) {
  return pointer.split("/").slice(1)
    .map(key => key.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((value, key) => value?.[key], record);
}

// These cases fail during source reading. The remaining grammar errors need
// the format 50 loader to validate the DOM, stitch the stage or run the parse.
const sourceErrors = new Map([
  ["bare-and-zero/malformed", /duplicate direct write/],
  ["false-guard-after-splat/malformed", /does not have a truth value/],
  ["singleton-repetition/malformed", /primary must mark a mandatory child/],
  ["ordered-deletion/malformed", /stage syntax/],
  ["synthetic-bare-read/malformed", /_Elided/],
  ["guarded-defaults/malformed", /explicit binder/],
  ["truth-conversions/control/2", /does not have a truth value/],
  ["shared-capture-guard/malformed", /\$x is absent from this expansion/],
  ["shared-capture-guard/control/3", /\$x is absent from this expansion/],
  ["shared-capture-guard/control/4", /\$y is captured by no alternative/],
  ["empty-term/malformed", /stage syntax/],
  ["truth-conversions/control/4", /wrong receiver or arguments/],
  ["eberban-omitted-cai/malformed", /_Elided/],
  ["expression-depth/malformed", /nested more than 256 deep/],
  ["expression-depth/control/1", /nested more than 256 deep/],
  ...["malformed", "control/0", "control/1", "control/2", "control/3", "control/4", "control/8"]
    .map(name => [`origin-filter-on-rule/${name}`, /_Elided origin test/]),
  // The cases of erratum M-60 that fail in the source reader, with the
  // causes that the loader expects.
  ...[
    "m60-target-sequence/malformed",
    "m60-target-sequence/control/0",
    "m60-target-sequence/control/1",
    "m60-target-sequence/control/2",
    "m60-target-choice/malformed",
    "m60-target-choice/control/0",
    "m60-target-choice/control/1",
    "m60-target-choice/control/2",
    "m60-target-subset/malformed",
    "m60-target-subset/control/0",
    "m60-target-subset/control/1",
    "m60-target-subset/control/2",
    "m60-target-ranked/malformed",
    "m60-target-ranked/control/0",
    "m60-target-ranked/control/1",
    "m60-target-ranked/control/2",
    "m60-target-optional/malformed",
    "m60-target-optional/control/0",
    "m60-target-optional/control/1",
    "m60-target-optional/control/2",
    "m60-target-repetition/malformed",
    "m60-target-repetition/control/0",
    "m60-target-repetition/control/1",
    "m60-target-repetition/control/2",
    "m60-target-elidable/malformed",
    "m60-target-elidable/control/0",
    "m60-target-elidable/control/1",
    "m60-target-elidable/control/2",
    "m60-target-symbol-controls/malformed",
    "m60-whole-optional-rollback/malformed",
    "m60-source-boundaries/malformed",
    "m60-empty-input/malformed",
    "m60-zero-or-more/malformed",
    "m60-ordered-separators/malformed",
    "m60-grouped-sequence/malformed",
    "m60-ordered-subset/malformed",
    "m60-nested-captures/malformed",
    "m60-outer-multiplicity/malformed",
    "m60-skipped-label/malformed",
    "m60-alternative-scope/malformed",
    "m60-duplicate-route/malformed",
    "m60-no-singleton-inheritance/malformed",
    "m60-primary-through-label/malformed",
    "m60-primary-placement/malformed",
    "m60-sole-symbol-and-term/malformed",
    "m60-redundant-parentheses/malformed",
    "m60-elidable-twins/malformed",
    "m60-written-head/malformed",
    "m60-elidable-tail/malformed",
    "m60-written-empty-string/malformed",
    "m60-chain-ownership/malformed",
    "m60-chain-item/malformed",
    "m60-empty-target-query/malformed",
    "m60-chain-equality/malformed",
    "m60-inner-patterns/malformed",
    "m60-two-compounds/malformed",
    "m60-one-operand/malformed",
    "m60-one-operand/control/0",
    "m60-neighbor-empty-visit/malformed",
    "m60-enclosing-children/malformed",
    "m60-omitted-origin-restoration/malformed",
    "m60-normalized-dom/control/1"
  ].map(id => [id, new RegExp(causes[id])]),
]);

for (const pair of pairs) {
  for (const [name, entry] of cases(pair)) {
    const lines = entry.source ?? entry.overlay;
    if (!entry.document && !lines) continue;
    const markdown = entry.document ?? ["```jbogenbau", ...lines, "```"].join("\n");
    const id = `${pair.id}/${name}`;
    test(id, () => {
      const pattern = sourceErrors.get(id);
      if (pattern) {
        assert.throws(() => compiler.compileDocument(markdown, `${id}.md`), error =>
          error.kind === "grammar" && pattern.test(error.message));
        return;
      }
      const dom = compiler.compileDocument(markdown, `${id}.md`);
      assert.equal(dom.format, 50);
      if (entry.expect.outcome === "dom") {
        for (const assertion of entry.expect.assertions ?? []) {
          assert.ok(Object.hasOwn(assertion, "equals"));
          assert.deepEqual(selected(dom, assertion.path), assertion.equals);
        }
      }
    });
  }
}
