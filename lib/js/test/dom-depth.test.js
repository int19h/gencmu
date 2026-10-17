// Shared DOM depth boundaries from engine §9 and tests/dom-depth.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repository } from "./shared.js";
import { domProblem, DOM_FORMAT } from "../src/dom.js";
import { UnicodeTable } from "../src/unicode.js";

const cases = JSON.parse(fs.readFileSync(path.join(repository, "tests", "dom-depth.json"), "utf8"));
const unicode = new UnicodeTable(fs.readFileSync(path.join(repository, "grammars", "unicode.txt"), "utf8"));
assert.ok(cases.length);
for (const c of cases) {
  test(`DOM depth: ${c.description}`, () => {
    for (const extra of [0, 1]) {
      let node = JSON.stringify(c.leaf);
      const wrapper = JSON.stringify(c.wrapper);
      assert.equal(wrapper.split('"$inner"').length, 2);
      for (let i = 0; i < c.atLimit + extra; i++) node = wrapper.replace('"$inner"', () => node);
      const text = JSON.stringify(c.dom).replace('"$inner"', () => node);
      const dom = { format: DOM_FORMAT, ...JSON.parse(text) };
      const problem = domProblem(dom, unicode);
      if (extra) assert.match(problem ?? "", /nested too deeply/, text);
      else assert.equal(problem, null, String(problem));
    }
  });
}

const sourceCases = JSON.parse(fs.readFileSync(path.join(repository, "tests", "dom-depth-source.json"), "utf8"));
const { loaderFromDirectory } = await import("../src/node.js");
const reader = loaderFromDirectory();
for (const c of sourceCases) {
  test(`Source depth: ${c.description}`, () => {
    for (const extra of [0, 1]) {
      const n = c.atLimit + extra;
      const source = "```jbogenbau\n" + c.head + c.prefix.repeat(n) + c.leaf + c.suffix.repeat(n) + c.tail + "\n```\n";
      if (extra) assert.throws(() => reader.readDocument(source, "depth.md"), /nested/);
      else assert.doesNotThrow(() => reader.readDocument(source, "depth.md"));
    }
  });
}
