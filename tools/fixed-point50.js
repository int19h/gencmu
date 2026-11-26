#!/usr/bin/env node
// Reads the notation pipeline of format 50 with the native loader and writes
// the bootstrap that the reading gives. The loader starts from the seed that
// --seed names, with no optional cache.
//
//   node tools/fixed-point50.js --seed FILE --out FILE
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Loader50, BUNDLE_50, bootstrapText } from "../lib/js/src/format50/loader.js";
import { resolvePath } from "../lib/js/src/markdown.js";
import { compareCodePoints } from "../lib/js/src/tags.js";

const root = fileURLToPath(new URL("../lib/js/", import.meta.url));
const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) throw new Error(`usage: node tools/fixed-point50.js --seed FILE --out FILE`);
  return args[index + 1];
};
const seed = fs.readFileSync(path.resolve(option("--seed")), "utf8");
const out = path.resolve(option("--out"));
const decoder = new TextDecoder("utf-8", { fatal: true });
const read = file => {
  if (file === BUNDLE_50.bootstrap) return seed;
  if (file.startsWith(BUNDLE_50.cacheRoot + "/")) return undefined;
  try {
    return decoder.decode(fs.readFileSync(path.join(root, file)));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
};
const loader = new Loader50(read);
const entries = new Map();
for (const document of loader.bootstrap.keys()) entries.set(document, loader.readDocument(read(document), document));
// The seed names the names files of every bundled pipeline, as
// tools/notation50-resources.js writes it for tools/sync.js: each %names
// target that is a source of the bundle or a readable data file.
const sources = new Set(fs.readdirSync(path.join(root, BUNDLE_50.sourceRoot), { recursive: true, withFileTypes: true })
  .filter(item => item.isFile() && !item.name.startsWith("."))
  .map(item => path.relative(root, path.join(item.parentPath, item.name)).split(path.sep).join("/")));
for (const file of [...sources].filter(file => file.endsWith("/pipeline.md")).sort(compareCodePoints)) loader.pipeline(file);
const names = new Set(["data/unicode/unicode-names.txt"]);
for (const [key, dom] of loader.documents) {
  if (!dom) continue;
  const [file] = JSON.parse(key);
  for (const item of dom.directives.filter(directive => directive.name === "names")) {
    const target = resolvePath(file, item.args[0]);
    if (sources.has(target) || target.startsWith("data/") && read(target) !== undefined) names.add(target);
  }
}
const text = bootstrapText(entries, read, [...names]);
fs.writeFileSync(out, text);
console.log(`${createHash("sha256").update(text).digest("hex")}  ${out}`);
