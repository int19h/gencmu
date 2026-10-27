import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repository, matches } from "./shared.js";
import { valueLoader } from "./notation-values.js";
import { notationCachePaths } from "./notation-cache.js";
import { GencmuError } from "../src/errors.js";

const cases = JSON.parse(fs.readFileSync(path.join(repository, "tests/notation-values.json"), "utf8")).cases;
for (const testCase of cases) {
  test(`notation values: ${testCase.id}`, () => {
    const file = testCase.id + ".md";
    const loader = valueLoader(testCase, file);
    if (testCase.expect.error) {
      const expected = testCase.expect.error;
      assert.ok(!Object.hasOwn(expected, "message"), "shared expectations omit message wording");
      assert.throws(() => loader.readDocument(testCase.document, file), error =>
        error instanceof GencmuError && error.where.line === expected.line && error.where.column === expected.column);
      return;
    }
    const dom = loader.readDocument(testCase.document, file);
    assert.ok(matches(testCase.expect, {dom}), JSON.stringify(dom));
    notationCachePaths(loader, testCase.document, file, dom,
      preparsed => valueLoader(testCase, file, JSON.stringify(preparsed)));
  });
}
