import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repository, matches, validateNotationCase } from "./shared.js";
import { valueLoader } from "./notation-values.js";
import { notationCachePaths } from "./notation-cache.js";
import { GencmuError } from "../src/errors.js";

const cases = JSON.parse(fs.readFileSync(path.join(repository, "tests/notation-values.json"), "utf8")).cases;
for (const testCase of cases) {
  test(`notation values: ${testCase.id}`, () => {
    validateNotationCase(testCase,true);
    const file = testCase.id + ".md";
    const loader = valueLoader(testCase, file);
    if (testCase.expect.error) {
      const expected = testCase.expect.error;
      assert.throws(() => loader.readDocument(testCase.document, file), error =>
        error instanceof GencmuError && error.where.line === expected.line && error.where.column === expected.column
        && (testCase.expect.message === undefined || error.description === testCase.expect.message));
      return;
    }
    const dom = loader.readDocument(testCase.document, file);
    assert.ok(matches(testCase.expect, {dom}), JSON.stringify(dom));
    notationCachePaths(loader, testCase.document, file, dom,
      (preparsed, documentPath) => valueLoader(testCase, documentPath, JSON.stringify(preparsed)));
  });
}


test("supplied notation values refuse nested error messages during validation", () => {
  const error = {line:1,column:1};
  const fixture = {id:"message-location",aliases:[],document:"",expect:{error}};
  assert.doesNotThrow(() => validateNotationCase(fixture,true));
  assert.doesNotThrow(() => validateNotationCase({...fixture,expect:{error,message:"agreed reason"}},true));
  assert.throws(() => validateNotationCase({...fixture,expect:{error:{...error,message:"wrong level"}}},true),/notation error has unknown member message/);
  // Ordinary notation cases retain their separately documented nested form.
  assert.doesNotThrow(() => validateNotationCase({document:"",expect:{error:{...error,message:"agreed reason"}}}));
});
