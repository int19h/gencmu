import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../check-seed50.js", import.meta.url));
const seed = JSON.parse(fs.readFileSync(new URL("../../data/preparsed50/gencmu.json", import.meta.url)));
const document = (bootstrap, name) => bootstrap.documents[`grammars50/gencmu/jbogenbau/${name}.md`].dom;

function audit(t, change) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "seed-audit-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "seed.json");
  const mutation = structuredClone(seed);
  change(mutation);
  fs.writeFileSync(file, JSON.stringify(mutation));
  const result = spawnSync(process.execPath, [script, file], { encoding: "utf8", timeout: 20000 });
  assert.ifError(result.error);
  return result;
}

const method = (method, receiver, at) => ({ method, receiver, args: [], at });
function replaceCondition(bootstrap, make) {
  const rules = document(bootstrap, "syntax").rules;
  const rule = rules.find(rule => rule.alternatives[0]?.expr.capture === "atom") ??
    rules.find(rule => rule.conditions.some(node => JSON.stringify(node).includes('"capture":"atom"')));
  assert.ok(rule);
  rule.conditions = [make(rule.at)];
}

for (const [name, edit, message] of [
  ["one bound node cannot use a list method", seed => replaceCondition(seed, at => method("join", { capture: "atom" }, at)),
    /a method has the wrong receiver or arguments/],
  ["a span cannot use .present", seed => replaceCondition(seed, at => method("present", method("span", { capture: "" }, at), at)),
    /a method has the wrong receiver or arguments/],
  ["a constant string cannot use a list method", seed => {
    const constant = document(seed, "lexical").constants.find(record => record.name === "KEYWORDS");
    constant.value = method("join", { string: "a" }, constant.at);
  }, /a method has the wrong receiver or arguments/],
  ["a constant cannot store the origin key", seed => {
    const constant = document(seed, "lexical").constants[0];
    constant.value = { bag: [{ kind: "bare", key: "_Elided", gates: [], at: constant.at }] };
  }, /unknown or forbidden engine key _Elided/],
  ["a directive cannot read properties from its span", seed => {
    const directives = document(seed, "pipeline").directives;
    directives.push({ name: "features", args: ["f"], conditions: [{ property: "value", receiver: { capture: "" }, at: [1, 2] }], at: [1, 1] });
  }, /a property read needs a node or bag/],
]) {
  test(`the seed audit rejects ${name}`, t => {
    const { status, stdout } = audit(t, edit);
    assert.equal(status, 1);
    const failure = stdout.trim().split("\n").map(line => JSON.parse(line)).find(row => row.validation && !row.ok);
    assert.match(failure?.message ?? "", message);
  });
}

for (const [name, edit, error] of [
  ["obsolete format", seed => { seed.format = 49; }, /invalid bootstrap format or Unicode fingerprints/],
  ["wrong property table", seed => { seed.properties = seed.unicode; }, /invalid bootstrap format or Unicode fingerprints/],
  ["missing names table", seed => { seed.bundledNames = {}; }, /invalid bundled names/],
  ["wrong names checksum", seed => { seed.bundledNames["data/unicode/unicode-names.txt"] = seed.unicode; }, /invalid bundled names fingerprint/],
  ["missing included document", seed => { delete seed.documents["grammars50/gencmu/jbogenbau/syntax.md"]; },
    /missing required bootstrap document/],
]) {
  test(`the seed audit rejects ${name}`, t => {
    const { status, stderr } = audit(t, edit);
    assert.equal(status, 1);
    assert.match(stderr, error);
  });
}

test("the seed audit accepts forwarding a list capture", t => {
  const { status, stdout } = audit(t, bootstrap => {
    const rules = document(bootstrap, "syntax").rules;
    rules.push({
      name: "forward-test", op: "define", at: [10000, 1], conditions: [],
      alternatives: [{ gates: [], expr: { repeat: { capture: "list", expr: { ref: "A" } } } }],
      emit: { items: [{ capture: "list", gates: [], at: [10001, 7] }] },
    });
  });
  assert.equal(status, 0);
  assert.match(stdout, /"capture":"list","consumer":"0","ok":true/);
});

test("the seed audit rejects a self include at the directive", t => {
  const { status, stderr } = audit(t, bootstrap => {
    document(bootstrap, "pipeline").directives.push({ name: "include", args: ["pipeline.md"], at: [9999, 1] });
  });
  assert.equal(status, 1);
  assert.match(stderr, /pipeline\.md:9999:1: .*pipeline\.md includes itself/);
});

test("the seed audit rejects an include back edge at its source", t => {
  const { status, stderr } = audit(t, bootstrap => {
    document(bootstrap, "lexical").directives.push({ name: "include", args: ["pipeline.md"], at: [9999, 1] });
  });
  assert.equal(status, 1);
  assert.match(stderr, /lexical\.md:9999:1: .*pipeline\.md includes itself \(.*pipeline\.md → .*lexical\.md → .*pipeline\.md\)/);
});

test("the seed audit accepts two visits to a completed include", t => {
  const { status } = audit(t, bootstrap => {
    document(bootstrap, "pipeline").directives.push({ name: "include", args: ["lexical.md"], at: [9999, 1] });
  });
  assert.equal(status, 0);
});
