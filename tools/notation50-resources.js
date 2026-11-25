import fs from "node:fs";
import path from "node:path";
import { fnv1a64 } from "../lib/js/src/hash.js";
import { resolvePath } from "../lib/js/src/markdown.js";
import { compareCodePoints } from "../lib/js/src/tags.js";
import { createTransitionCompiler, readFile } from "./transition-compiler.js";

export const manifestPath = "data/notation-bundles.json";

export function notation50Resources(root, { readSource } = {}) {
  const read = file => readFile(path.join(root, file));
  const bundle = JSON.parse(read(manifestPath))["50"];
  const source = readSource ?? read;
  const compiler = createTransitionCompiler(source);
  const sources = fs.readdirSync(path.join(root, bundle.sourceRoot), { recursive: true, withFileTypes: true })
    .filter(item => item.isFile() && !item.name.startsWith("."))
    .map(item => path.relative(root, path.join(item.parentPath, item.name))).sort(compareCodePoints);
  const required = compiler.pipelineReadings(bundle.notation);
  const readings = new Map();
  const add = (file, entries) => {
    if (!readings.has(file)) readings.set(file, []);
    for (const reading of entries) readings.get(file).push(reading.entry);
  };
  for (const [file, entries] of required) add(file, entries);
  for (const file of sources.filter(file => file.endsWith("/pipeline.md") && file !== bundle.notation)) {
    for (const [document, entries] of compiler.pipelineReadings(file)) add(document, entries);
  }
  const documents = {};
  for (const [file, entries] of required) {
    const first = entries[0].entry;
    if (entries.some(reading => JSON.stringify(reading.entry) !== JSON.stringify(first))) {
      throw new Error(`${file}: the required bootstrap has more than one reading`);
    }
    documents[file] = first;
  }
  const names = new Set(["data/unicode/unicode-names.txt"]);
  for (const [file, entries] of readings) {
    for (const { dom } of entries) {
      for (const item of dom.directives.filter(directive => directive.name === "names")) {
        const target = resolvePath(file, item.args[0]);
        if (sources.includes(target) || target.startsWith("data/") && read(target) !== undefined) names.add(target);
      }
    }
  }
  const header = {
    unicode: fnv1a64(read("data/unicode/unicode.txt")),
    properties: fnv1a64(read("data/unicode/unicode-properties.txt")),
    bundledNames: Object.fromEntries([...names].sort(compareCodePoints).map(file => [file, fnv1a64(source(file))])),
  };
  const serialize = record => JSON.stringify({ format: bundle.format, ...record }) + "\n";
  const bootstrap = serialize({ ...header, documents });
  // Diagrams and layout use the first reading in pipeline and include order.
  const sourceDocuments = Object.fromEntries([...readings].sort(([a], [b]) => compareCodePoints(a, b))
    .map(([file, entries]) => [file, entries[0]]));
  return { bundle, sources, documents, sourceDocuments, bootstrap, cacheFiles() {
    const families = new Map();
    for (const [file, entries] of readings) {
      if (Object.hasOwn(documents, file)) continue;
      const [entry, ...otherReadings] = entries;
      if (otherReadings.some(other => JSON.stringify(other) !== JSON.stringify(entry))) continue;
      const family = file.split("/")[1];
      if (!families.has(family)) families.set(family, {});
      families.get(family)[file] = entry;
    }
    const caches = new Map([[bundle.bootstrap, bootstrap]]);
    for (const [family, entries] of families) {
      const familyCache = `${bundle.cacheRoot}/${family}.json`;
      const file = familyCache === bundle.bootstrap ? bundle.bootstrapFamilyCache : familyCache;
      caches.set(file, serialize({ bootstrap: fnv1a64(bootstrap), ...header, documents: entries }));
    }
    return caches;
  } };
}
