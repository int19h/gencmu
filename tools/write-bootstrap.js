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
import { readPipeline, resolvePath } from "../js/src/markdown.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "grammars");
const pipelinePath = "dialects/notation.md";
const stages = readPipeline(fs.readFileSync(path.join(root, pipelinePath), "utf8"), pipelinePath).stages.map((stage) => ({
  name: stage.name,
  documents: stage.documents.map((relative) => {
    const documentPath = resolvePath(pipelinePath, relative);
    return { path: documentPath, dom: readDocument(fs.readFileSync(path.join(root, documentPath), "utf8"), documentPath) };
  }),
}));
fs.writeFileSync(path.join(root, "notation", "bootstrap.json"), JSON.stringify({ format: 2, stages }) + "\n");
console.log("wrote grammars/notation/bootstrap.json");
