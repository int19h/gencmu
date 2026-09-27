#!/usr/bin/env node
// Writes grammars/notation/bootstrap.json with the hand-written reader. Run
// it only to create the first bootstrap or to recover from a notation change
// the current bootstrap cannot read; otherwise tools/sync.js regenerates the
// bootstrap with the engine itself, reading the notation's documents until
// that reaches a fixpoint.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readDocument } from "./bootstrap-reader.js";
import { splicePipeline } from "../lib/js/src/pipeline.js";
import { DOM_FORMAT } from "../lib/js/src/dom.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "grammars");
// The notation's pipeline, spliced from DOMs that the hand-written reader
// makes.
const { stages } = splicePipeline("dialects/notation.md", (documentPath) => {
  const file = path.join(root, documentPath);
  return fs.existsSync(file) ? readDocument(fs.readFileSync(file, "utf8"), documentPath) : undefined;
});
fs.writeFileSync(path.join(root, "notation", "bootstrap.json"), JSON.stringify({ format: DOM_FORMAT, stages: stages.map((stage) => ({ name: stage.name, documents: stage.documents })) }) + "\n");
console.log("wrote grammars/notation/bootstrap.json");
