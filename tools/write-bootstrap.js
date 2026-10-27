#!/usr/bin/env node
// Writes data/preparsed/gencmu.json with the hand-written reader.
// Run it to create the first bootstrap or recover from a notation or DOM
// format change that prevents the current bootstrap from loading.
// Otherwise tools/sync.js regenerates the bootstrap with the engine itself,
// reading the notation's documents until that reaches a fixpoint.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readDocument, readResource } from "./bootstrap-reader.js";
import { splicePipeline } from "../lib/js/src/splice.js";
import { Loader } from "../lib/js/src/pipeline.js";
import { fnv1a64 } from "../lib/js/src/hash.js";
import { BOOTSTRAP_PATH, NOTATION_PATH } from "../lib/js/src/resources.js";
import { DOM_FORMAT } from "../lib/js/src/dom.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// Read every required document before the engine uses the new file.
const documents = new Map();
splicePipeline(NOTATION_PATH, (documentPath, inherited) => {
  const text = readResource(documentPath);
  const dom = readDocument(text, documentPath, inherited);
  documents.set(documentPath, {hash:fnv1a64(text), dom});
  return dom;
});
const resources = ["data/unicode/unicode-names.txt"];
function namesFiles(directory) {
  for (const item of fs.readdirSync(path.join(root,directory),{withFileTypes:true})) {
    const file = `${directory}/${item.name}`;
    if (item.isDirectory()) namesFiles(file);
    else if (file.endsWith("-names.txt")) resources.push(file);
  }
}
namesFiles("grammars");
const bootstrap = JSON.stringify({format:DOM_FORMAT,
  unicode:fnv1a64(readResource("data/unicode/unicode.txt")),
  properties:fnv1a64(readResource("data/unicode/unicode-properties.txt")),
  bundledNames:Object.fromEntries(resources.sort().map(file => [file,fnv1a64(readResource(file))])),
  documents:Object.fromEntries([...documents].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0))}) + "\n";
const loader = new Loader(relative => {
  if (relative === BOOTSTRAP_PATH) return bootstrap;
  if (relative.startsWith("data/preparsed/")) return undefined;
  if (relative === "data/unicode/unicode-names-reference.txt") return readResource(relative);
  const file = path.join(root,relative);
  return fs.existsSync(file) ? readResource(relative) : undefined;
});
for (const [file, entry] of documents) {
  const dom = loader.readDocument(readResource(file),file);
  if (JSON.stringify(dom) !== JSON.stringify(entry.dom)) throw new Error(`the bootstrap readers disagree: ${file}`);
}
// Exercise constructors that the notation documents do not need themselves.
const templateProbe = "```jbogenbau\n%rule pair(@Left, @Right) @Left @Right\n%rule text = pair(\"a\", \"b\")\n```";
const handProbe = readDocument(templateProbe, "bootstrap-template-probe.md");
const engineProbe = loader.readDocument(templateProbe, "bootstrap-template-probe.md");
if (JSON.stringify(handProbe) !== JSON.stringify(engineProbe)) throw new Error("the bootstrap readers disagree on parameterized rules");
fs.mkdirSync(path.join(root,"data/preparsed"),{recursive:true});
fs.writeFileSync(path.join(root, BOOTSTRAP_PATH), bootstrap);
console.log(`wrote ${BOOTSTRAP_PATH}`);
