import fs from "node:fs";
import path from "node:path";
import { fnv1a64 } from "../lib/js/src/hash.js";
import { createTransitionCompiler, readFile } from "./transition-compiler.js";

export const manifestPath = "data/notation-bundles.json";

export function notation50Resources(root, { readSource } = {}) {
  const read = file => readFile(path.join(root, file));
  const bundle = JSON.parse(read(manifestPath))["50"];
  const source = readSource ?? read;
  const compiler = createTransitionCompiler(source);
  const sources = fs.readdirSync(path.join(root, bundle.sourceRoot), { recursive: true, withFileTypes: true })
    .filter(item => item.isFile() && !item.name.startsWith("."))
    .map(item => path.relative(root, path.join(item.parentPath, item.name))).sort();
  const names = ["data/unicode/unicode-names.txt", ...sources.filter(file => file.endsWith("-names.txt"))].sort();
  const header = {
    unicode: fnv1a64(read("data/unicode/unicode.txt")),
    properties: fnv1a64(read("data/unicode/unicode-properties.txt")),
    bundledNames: Object.fromEntries(names.map(file => [file, fnv1a64(read(file))])),
  };
  const serialize = record => JSON.stringify({ format: bundle.format, ...record }) + "\n";
  const documents = compiler.compilePipeline(bundle.notation);
  const bootstrap = serialize({ ...header, documents });
  return { bundle, sources, documents, bootstrap, compiler, cacheFiles() {
    const entries = new Map(Object.entries(documents));
    for (const file of sources.filter(file => file.endsWith("/pipeline.md") && file !== bundle.notation)) {
      for (const [document, entry] of Object.entries(compiler.compilePipeline(file))) {
        const earlier = entries.get(document);
        if (earlier && JSON.stringify(earlier) !== JSON.stringify(entry)) {
          // Different inherited names scopes keep their source reading.
          entries.set(document, null);
        } else if (!entries.has(document)) entries.set(document, entry);
      }
    }
    const families = new Map();
    for (const file of sources.filter(file => file.endsWith(".md"))) {
      if (!entries.has(file)) entries.set(file, compiler.documentEntry(source(file), file));
      const entry = entries.get(file);
      if (!entry) continue;
      const family = file.split("/")[1];
      if (!families.has(family)) families.set(family, {});
      families.get(family)[file] = entry;
    }
    const caches = new Map([[bundle.bootstrap, bootstrap]]);
    for (const [family, entries] of families) {
      const file = `${bundle.cacheRoot}/${family}.json`;
      if (file === bundle.bootstrap) continue;
      caches.set(file, serialize({ bootstrap: fnv1a64(bootstrap), ...header, documents: entries }));
    }
    return caches;
  } };
}
