// The shared cases of tests/growth.json: the work of the bundled grammars
// on long texts. A condition that parses a whole prefix again at each step
// makes a long text cost more than its length says, so these tests count
// the items that the recognizer makes, in parses and nested parses alike.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadDialect } from "../src/node.js";
import { hooks } from "../src/testing.js";
import { repository } from "./shared.js";

const cases = JSON.parse(fs.readFileSync(`${repository}/tests/growth.json`, "utf8"));

for (const c of cases) {
  test(`growth: ${c.dialect} with ${JSON.stringify(c.link)}`, () => {
    const dialect = loadDialect(c.dialect);
    const items = (n) => {
      const text = c.text.replace("{links}", Array(n).fill(c.link).join(" "));
      const work = (hooks.work = { items: 0, checks: 0, candidates: 0 });
      try {
        const result = dialect.parse(text);
        assert.ok(result.ok, text);
      } finally {
        hooks.work = null;
      }
      return work.items;
    };
    const small = items(c.small);
    const large = items(c.large);
    assert.ok(large <= c.most * small, `${c.link}: ${small} items for ${c.small} links, ${large} for ${c.large}`);
  });
}
