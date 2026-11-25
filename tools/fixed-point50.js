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
const text = bootstrapText(entries, read);
fs.writeFileSync(out, text);
console.log(`${createHash("sha256").update(text).digest("hex")}  ${out}`);
