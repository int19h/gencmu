// The shared cases of tests/dom-malformed.json: directives and rules that every
// library refuses, or accepts, in a DOM (engine §9).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repository } from "./shared.js";
import { domProblem, DOM_FORMAT } from "../src/dom.js";
import { UnicodeTable } from "../src/unicode.js";

const cases = JSON.parse(fs.readFileSync(path.join(repository, "tests", "dom-malformed.json"), "utf8"));
const unicode = new UnicodeTable(fs.readFileSync(path.join(repository, "data", "unicode", "unicode.txt"), "utf8"));

for (const testCase of cases) {
  test(`dom-malformed: ${testCase.description}`, () => {
    const dom = { format: DOM_FORMAT, rules: testCase.rule === undefined ? [] : [testCase.rule], directives: testCase.directive === undefined ? [] : [testCase.directive], constants: [], classifiers: [], implications: [] };
    const table = testCase.unicode === undefined ? unicode : new UnicodeTable(testCase.unicode);
    const problem = domProblem(dom, table);
    assert.equal(problem !== null, testCase.malformed, String(problem));
  });
}
