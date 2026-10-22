#!/usr/bin/env node
// Writes grammars/notation/bootstrap.json with the hand-written reader.
// Run it to create the first bootstrap or recover from a notation or DOM
// format change that prevents the current bootstrap from loading.
// Otherwise tools/sync.js regenerates the bootstrap with the engine itself,
// reading the notation's documents until that reaches a fixpoint.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readDocument } from "./bootstrap-reader.js";
import { splicePipeline } from "../lib/js/src/pipeline.js";
import { Loader } from "../lib/js/src/dialect.js";
import { DOM_FORMAT } from "../lib/js/src/dom.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "grammars");
// The notation's pipeline, spliced from DOMs that the hand-written reader
// makes.
const { stages } = splicePipeline("dialects/notation.md", (documentPath) => {
  const file = path.join(root, documentPath);
  return fs.existsSync(file) ? readDocument(fs.readFileSync(file, "utf8"), documentPath) : undefined;
});
const bootstrap = JSON.stringify({ format: DOM_FORMAT, stages: stages.map((stage) => ({ name: stage.name, documents: stage.documents })) }) + "\n";
// The new engine must read the candidate before the writer replaces the file.
const loader = new Loader(relative => {
  if (relative === "notation/bootstrap.json") return bootstrap;
  if (relative === "compiled.json") return undefined;
  const file = path.join(root, relative);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
});
const reread = loader.pipeline("dialects/notation.md");
const engine = JSON.stringify({ format: DOM_FORMAT, stages: reread.stages.map(stage => ({ name: stage.name, documents: stage.documents })) }) + "\n";
if (engine !== bootstrap) throw new Error("the bootstrap reader and engine reader disagree");
// Exercise constructors that the notation documents do not need themselves.
const templateProbe = "```jbogenbau\n%rule pair(@Left, @Right) @Left @Right\n%rule text = pair(\"a\", \"b\")\n```";
const handProbe = readDocument(templateProbe, "bootstrap-template-probe.md");
const engineProbe = loader.readDocument(templateProbe, "bootstrap-template-probe.md");
if (JSON.stringify(handProbe) !== JSON.stringify(engineProbe)) throw new Error("the bootstrap readers disagree on parameterized rules");
fs.writeFileSync(path.join(root, "notation", "bootstrap.json"), bootstrap);
console.log("wrote grammars/notation/bootstrap.json");
