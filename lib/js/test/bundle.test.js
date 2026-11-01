import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {bundledPipelines} from "../src/index.js";
import {browserModule} from "../../../tools/bundle-imports.js";

test("the browser bundler refuses import aliases before stripping imports", () => {
  assert.deepEqual(browserModule("plain.js", 'import { first,\n second, } from "./dependency.js";'), {text:"", imports:["dependency.js"]});
  assert.deepEqual(browserModule("plain.js", "  import { asymmetric } from './dependency.js';\nconst value = asymmetric;"), {text:"\nconst value = asymmetric;", imports:["dependency.js"]});
  for (const names of ["{ first as second }", "{ first,\n second as third,\n }", "* as dependency", "dependency"]) {
    for (const quote of ['"', "'"]) {
      assert.throws(() => browserModule("aliased.js", `import ${names} from ${quote}./dependency.js${quote};`), {
        message: "aliased.js: the browser bundle requires named imports without aliases",
      });
    }
  }
  assert.throws(() => browserModule("side-effect.js", 'import "./dependency.js";'), {message:"side-effect.js: unsupported browser import syntax"});
  assert.throws(() => browserModule("external.js", 'import { value } from "external";'), {message:"external.js: the browser bundle requires relative imports"});
});

test("the browser factory runs a structural condition with an omitted marker", () => {
  const context = { TextEncoder };
  vm.runInNewContext(fs.readFileSync(new URL("../../../dist/gencmu.js", import.meta.url), "utf8"), context);
  assert.equal(typeof context.gencmuFactory, "function");
  const api = context.gencmuFactory();
  vm.runInNewContext(fs.readFileSync(new URL("../../../dist/grammars.js", import.meta.url), "utf8"), context);
  const expected = JSON.parse(fs.readFileSync(new URL("../../../tests/engine/pipeline-catalog.json", import.meta.url),"utf8")).expect.bundledPipelines;
  const catalog = {...context.gencmuGrammars,
    "grammars/experimental/pipeline.md":"", "grammars/lojban/cll\n/pipeline.md":"", "grammars/Family/member/pipeline.md":""};
  assert.deepEqual(bundledPipelines(catalog), expected);
  assert.deepEqual(bundledPipelines(new Map(Object.entries(catalog))), expected);
  assert.deepEqual(bundledPipelines(), []);
  assert.deepEqual(Array.from(api.bundledPipelines(catalog)), expected);

  const sources = {
    "p.md": '```jbogenbau\n%stage main\n%include "g.md"\n```',
    "g.md": "```jbogenbau\n%ambiguity-resolution greedy\n%rule text A [+T]\n%conditions $ ≅ #« A T=\"\" »\n```",
  };
  for (const file of ["data/unicode/unicode.txt", "data/preparsed/gencmu.json"]) sources[file] = fs.readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const result = api.loadPipelineSources(sources, "p.md").parse("a", { tokens: [new api.Token(["A"], [0, 1], [0, 1], "a", "a")] });
  assert.equal(result.ok, true);
  assert.equal(result.stages.at(-1).verdict, "unique");
});
