// The shared cases of tests/dom-malformed.json: directives and rules that every
// library refuses, or accepts, in a DOM (engine §9).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repository } from "./shared.js";
import { domProblem, ruleTypeFault, DOM_FORMAT } from "../src/dom.js";
import { UnicodeTable } from "../src/unicode.js";

const cases = JSON.parse(fs.readFileSync(path.join(repository, "tests", "dom-malformed.json"), "utf8"));
const unicode = new UnicodeTable(fs.readFileSync(path.join(repository, "data", "unicode", "unicode.txt"), "utf8"));

for (const testCase of cases) {
  test(`dom-malformed: ${testCase.description}`, () => {
    const dom = Object.hasOwn(testCase,"dom") ? testCase.dom : { format: DOM_FORMAT, rules: testCase.rule === undefined ? [] : [testCase.rule], directives: testCase.directive === undefined ? [] : [testCase.directive], constants: [], classifiers: [], implications: [], checks:[] };
    const table = testCase.unicode === undefined ? unicode : new UnicodeTable(testCase.unicode);
    const problem = domProblem(dom, table);
    assert.equal(problem !== null, testCase.malformed, String(problem));
    if (testCase.message !== undefined) assert.ok(problem?.includes(testCase.message), String(problem));
    if (testCase.code !== undefined) assert.equal(problem?.split(":")[0], testCase.code);
  });
}

test("ranked syntax codes depend on the complete shape", () => {
  for (const [expr, coded] of [
    [{ranked:null}, true], [{ranked:[]}, true], [{ranked:[{ref:"A"}]}, true],
    [{ranked:[{ref:"A"},{ref:"B"}],extra:1}, false],
    [{extra:1,ranked:[{ref:"A"},{ref:"B"}]}, false],
    [{ranked:[null,{ref:"B"}]}, false],
  ]) {
    const dom = {format:DOM_FORMAT,rules:[{name:"text",op:"define",alternatives:[{guards:[],expr}],conditions:[],at:[1,1]}], directives:[],constants:[],classifiers:[],implications:[],checks:[]};
    assert.equal(domProblem(dom,unicode)?.startsWith("ranked-choice-syntax:"),coded);
  }
});

test("type faults without constants keep their construct order", () => {
  for (const description of [
    "A first pattern comparison precedes a later constantless type fault.",
    "A first constantless comparison precedes a later pattern type fault.",
  ]) {
    const testCase = cases.find(item => item.description === description);
    assert.ok(testCase, `missing shared case: ${description}`);
    assert.equal(ruleTypeFault(testCase.rule)?.node, testCase.rule.conditions[0], testCase.description);
  }
});
