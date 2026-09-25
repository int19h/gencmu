import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repository, runEngineCase, matches } from "./shared.js";

const directory = path.join(repository, "tests", "engine");
for (const file of fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort()) {
  const testCase = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
  test(`engine: ${file}`, () => {
    const outcome = runEngineCase(testCase);
    const expect = testCase.expect;
    if (outcome.loadError) {
      assert.equal(expect.error, "grammar", `unexpected grammar error: ${outcome.loadError.message}`);
      return;
    }
    if (expect.result) {
      assert.ok(matches(expect.result, outcome.json), `result does not match:\n${JSON.stringify(outcome.json, null, 1)}`);
    }
    if (expect.brackets !== undefined) assert.equal(outcome.brackets, expect.brackets);
    if (expect.error !== undefined) assert.equal(outcome.json.error && outcome.json.error.kind, expect.error);
    else assert.equal(outcome.json.error, null, `unexpected error: ${JSON.stringify(outcome.json.error)}`);
  });
}
