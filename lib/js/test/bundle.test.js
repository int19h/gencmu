import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

test("the browser factory runs a structural condition with an omitted marker", () => {
  const context = { TextEncoder };
  vm.runInNewContext(fs.readFileSync(new URL("../../../dist/gencmu.js", import.meta.url), "utf8"), context);
  assert.equal(typeof context.gencmuFactory, "function");
  const api = context.gencmuFactory();
  const sources = {
    "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```',
    "g.md": '```jbogenbau\n%ambiguity-resolution greedy\n%rule text A [+T]\n%conditions $ ≅ @(A T="")\n```',
  };
  for (const file of ["unicode.txt", "notation/bootstrap.json"]) sources[file] = fs.readFileSync(new URL("../grammars/" + file, import.meta.url), "utf8");
  const result = api.loadDialectSources(sources, "p.md").parse("a", { tokens: [new api.Token(["A"], [0, 1], [0, 1], "a", "a")] });
  assert.equal(result.ok, true);
  assert.equal(result.stages.at(-1).verdict, "unique");
});
