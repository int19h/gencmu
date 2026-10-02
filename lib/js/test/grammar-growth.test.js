// The work of the bundled grammars on long texts. A condition that parses a
// whole prefix again at each step makes a long text cost more than its
// length says, so these tests count the items that the recognizer makes,
// in parses and nested parses alike.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDialect } from "../src/node.js";
import { recognizerCounters } from "../src/earley.js";

test("a long chain of connected sumti or terms in the experimental dialect costs work in proportion to its length", () => {
  const dialect = loadDialect("experimental");
  const items = (link, n) => {
    recognizerCounters.items = 0;
    const result = dialect.parse(`mi ${Array(n).fill(link).join(" ")} klama`);
    assert.ok(result.ok, `mi ${link} ... klama`);
    return recognizerCounters.items;
  };
  for (const link of [".e do", ".e ca do", ".e bo do", ".e bo ca do"]) {
    const small = items(link, 10);
    const large = items(link, 40);
    // Four times the links, at most about four times the work. A condition
    // over the whole prefix gives about ten times.
    assert.ok(large <= 5 * small, `${link}: ${small} items for 10 links, ${large} for 40`);
  }
});
