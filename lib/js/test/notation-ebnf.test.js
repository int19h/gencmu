import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syntaxEbnf } from "../../../tools/notation-ebnf.js";

test("the specification EBNF covers every bundled syntax production", () => {
  const root = new URL("../../../", import.meta.url);
  const bootstrap = JSON.parse(fs.readFileSync(new URL("data/preparsed/gencmu.json", root), "utf8"));
  const spec = fs.readFileSync(new URL("docs/engine.md", root), "utf8");
  const block = /Recognition productions:\n\n```text\n([\s\S]*?)\n```/.exec(spec);
  assert.ok(block, "the recognition production block exists");
  assert.equal(block[1], syntaxEbnf(bootstrap.documents["grammars/gencmu/jbogenbau/syntax.md"].dom));
  assert.match(block[1], /named-selector = .*method-name - "parse"/);
});
