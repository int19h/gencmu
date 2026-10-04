// The playground's scan of a pipeline's documents (playground/pipeline.js),
// which must list what a pipeline includes even when the library would
// refuse the pipeline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertLinearWork } from "./linear.js";
import fs from "node:fs";
import vm from "node:vm";

const context = {};
context.self = context;
vm.runInNewContext(fs.readFileSync(new URL("../../../playground/pipeline.js", import.meta.url), "utf8"), context);
// The scan's values come from another realm, so they are copied into this
// one before they are compared.
const pipelineStages = (path, textOf) => JSON.parse(JSON.stringify(/** @type {any} */ (context).gencmuPipeline.pipelineStages(path, textOf)));

const block = (...lines) => "```jbogenbau\n" + lines.join("\n") + "\n```\n";

test("a document included in two stages is listed in both, with what it includes", () => {
  const documents = {
    "dialects/p.md": block("%stage a", '%include "../w/wrapper.md"', "%stage b", '%include "../w/wrapper.md"'),
    "w/wrapper.md": block('%include "leaf.md"', "%rule text A"),
    "w/leaf.md": block("%rule x B"),
  };
  const { before, stages, documents: reached } = pipelineStages("dialects/p.md", (path) => documents[path]);
  assert.deepEqual(before, []);
  assert.deepEqual(stages, [
    { name: "a", documents: ["w/wrapper.md", "w/leaf.md"] },
    { name: "b", documents: ["w/wrapper.md", "w/leaf.md"] },
  ]);
  assert.deepEqual(reached, ["dialects/p.md", "w/wrapper.md", "w/leaf.md"]);
});

test("a cycle of includes, a missing document and an unreadable one are listed, and the scan stops", () => {
  const documents = {
    "p.md": block('%include "stages.md"', '%include "missing.md"'),
    "stages.md": block("%stage main", '%include "a.md"', '%include "broken.md"'),
    "a.md": block('%include "b.md"'),
    "b.md": block('%include "a.md"', '(* %include "commented.md" *)', '%rule r "%include"'),
    "broken.md": block("%rule ("),
  };
  const { before, stages, documents: reached } = pipelineStages("p.md", (path) => documents[path]);
  assert.deepEqual(before, ["stages.md"]);
  assert.deepEqual(stages, [{ name: "main", documents: ["a.md", "b.md", "a.md", "broken.md", "missing.md"] }]);
  assert.deepEqual(reached, ["p.md", "stages.md", "a.md", "b.md", "broken.md", "missing.md"]);
});

test("the scan reads comments and strings as the notation does", () => {
  const documents = {
    "p.md": block("%stage main", '%include (* why *) "\\u{67}.md"', "(* (* %include \"not.md\" *) %include \"h.md\"", '%rule r "%include" "x.md"'),
  };
  const { stages } = pipelineStages("p.md", (path) => documents[path]);
  assert.deepEqual(stages, [{ name: "main", documents: ["g.md", "h.md"] }]);
});

test("the scan reads phoneme tags, every space and bad escapes as the notation does", () => {
  const documents = {
    "p.md": block("%stage main", '%rule quote /"/', '%include\u0085"g.md"', '%include "\\u{110000}.md"', '%include "h.md"'),
  };
  const { stages } = pipelineStages("p.md", (path) => documents[path]);
  assert.deepEqual(stages, [{ name: "main", documents: ["g.md", "h.md"] }]);
});

test("the scan reads the string of a test as one token, and a backtick as a token of its own, as the notation does", () => {
  const documents = {
    "p.md": block("%stage main", '%rule r LE="%include \\"x.md\\"" B', '%rule q LE="\\"" B', '%include "g.md"', '%rule s LE="(*" B', '%include "h.md"', '%rule t LE="*)" B', '%rule u LE`` "%include" B'),
  };
  const { stages } = pipelineStages("p.md", (path) => documents[path]);
  assert.deepEqual(stages, [{ name: "main", documents: ["g.md", "h.md"] }]);
});

test("the scan reads a character tag as one token, as the notation does", () => {
  const documents = {
    "p.md": block("%stage main", "%rule q '\"' B", '%include "g.md"', "%rule r '`' B", '%include "h.md"', "%rule s '\\'' '(' '*' B", '%include "i.md"'),
  };
  const { stages } = pipelineStages("p.md", (path) => documents[path]);
  assert.deepEqual(stages, [{ name: "main", documents: ["g.md", "h.md", "i.md"] }]);
});

const documentMentions = (text) => JSON.parse(JSON.stringify(/** @type {any} */ (context).gencmuPipeline.documentMentions(text)));

test("the mentions of documents in a text are those the expression for them finds", () => {
  const pattern = /((?:[a-z0-9-]+\/)+[a-z0-9-]+\.md)(?::(\d+)(?::(\d+))?)?/g;
  const alphabet = ["a", "b", "-", "0", "/", "/", ".", ".md", ":", "1", "2", " ", "X", "_"];
  let seed = 1;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let round = 0; round < 20000; round++) {
    const length = Math.floor(random() * 16);
    const text = Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");
    const expected = [...text.matchAll(pattern)].map((match) => ({ index: match.index, text: match[0], path: match[1], line: match[2], column: match[3] }));
    assert.deepEqual(documentMentions(text), JSON.parse(JSON.stringify(expected)), JSON.stringify(text));
  }
});

// The scans count their steps through a hook of their own.
const target = /** @type {any} */ (context).gencmuPipeline.hooks;

test("finding the mentions of documents costs linear work in a long run of names and slashes", () => {
  assertLinearWork("documentMentions", 20000, (n) => {
    const text = "a/".repeat(n) + "a ".repeat(n) + "a".repeat(n);
    return () => documentMentions(text);
  }, ["text"], { target });
});

test("the scan of a chain of includes costs linear work in its depth", () => {
  assertLinearWork("pipelineStages", 1000, (n) => {
    const documents = Object.fromEntries(Array.from({ length: n }, (_, index) => [`d${index}.md`, block(`%include "d${index + 1}.md"`)]));
    return () => pipelineStages("d0.md", (path) => documents[path]);
  }, ["splice"], { target });
});
