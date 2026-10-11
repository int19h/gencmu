import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DOM_FORMAT, domProblem } from "../src/dom.js";
import { UnicodeTable } from "../src/unicode.js";
import { readDocument } from "../../../tools/bootstrap-reader.js";

const unicode = new UnicodeTable(fs.readFileSync(new URL("../../../grammars/unicode.txt", import.meta.url), "utf8"));
const capture = { capture: "" };
const restored = { call: "without-elision", args: [capture] };
const documentWith = (span) => ({
  format: DOM_FORMAT,
  rules: [{ name: "text", op: "define", flags: [], alternatives: [{ guards: [], expr: { ref: "A" } }],
    conditions: [{ matches: span, rule: "text" }], at: [1, 1] }],
  directives: [], constants: [], classifiers: [], implications: [],
});

test("restored DOM spans require one bare capture through nested calls", () => {
  for (const span of [restored, { call: "from", args: [restored] }, { call: "head", args: [restored] }]) {
    assert.equal(domProblem(documentWith(span), unicode), null);
  }
  for (const args of [[], [capture, capture], [{ string: "a" }], [{ call: "from", args: [capture] }], [restored]]) {
    assert.equal(domProblem(documentWith({ call: "without-elision", args }), unicode), "a malformed term");
  }
});

test("rejected composition points to the supported order", () => {
  const text = "```jbogenbau\n%rule text A %conditions matches(without-elision(from($)), text)\n```\n";
  assert.throws(() => readDocument(text, "g.md"), /write from\(without-elision\(\$x\)\)/);
});
