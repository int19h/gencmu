import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { createTransitionCompiler } from "../transition-compiler.js";

const fixture = new URL("../../tests/tree-emission/pairs.json", import.meta.url);
const pairs = JSON.parse(fs.readFileSync(fixture, "utf8"));
const compiler = createTransitionCompiler();

test("a custom emoji rule name can also be an ASCII tag spelling", () => {
  const unicode = [
    "unicode 15.1.0",
    "white-space 0009 000D",
    "white-space 0020 0020",
    "emoji-presentation 0041 0041",
    "emoji-presentation 0061 0061",
  ].join("\n") + "\n";
  const custom = createTransitionCompiler(file => file === "data/unicode/unicode.txt" ? unicode : undefined);
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
