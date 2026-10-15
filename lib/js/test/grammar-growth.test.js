// The shared cases of tests/growth.json: the work of the bundled grammars
// on long texts. A condition that parses a whole prefix again at each step
// makes a long text cost more than its length says, so these tests count
// the items that the recognizer makes, in parses and nested parses alike.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadDialect } from "../src/node.js";
import { hooks, newWork } from "../src/testing.js";
import { repository } from "./shared.js";

const cases = JSON.parse(fs.readFileSync(`${repository}/tests/growth.json`, "utf8"));

for (const c of cases) {
  test(`growth: ${c.dialect} with ${JSON.stringify(c.link)}`, t => {
    const dialect = loadDialect(c.dialect);
    // A budget, where given, stops the parse at the first item past it.
    const measure = (n, budget) => {
      const text = c.text.replace("{links}", Array(n).fill(c.link).join(" "));
      const work = (hooks.work = newWork(budget));
      const start = performance.now();
      try {
        const result = dialect.parse(text);
        assert.ok(result.ok, text);
      } finally {
        hooks.work = null;
      }
      return {length:n,items:work.items,records:work.boundaryRecords,
        edges:work.packedEdges,contexts:work.summaryContexts,
        milliseconds:performance.now()-start,peakKiB:process.resourceUsage().maxRSS};
    };
    const small = measure(c.small);
    const large = measure(c.large, {items:c.most*small.items});
    t.diagnostic(JSON.stringify({dialect:c.dialect,link:c.link,small,large}));
    assert.ok(large.items <= c.most*small.items,
      `${c.link}: ${small.items} items for ${c.small} links, ${large.items} for ${c.large}`);
  });
}
