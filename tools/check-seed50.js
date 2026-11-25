#!/usr/bin/env node
import fs from "node:fs";
import { createHash } from "node:crypto";
import { UnicodeTable } from "../lib/js/src/unicode.js";
import { methods50, validProperty50 } from "./transition/signatures.js";

const root = new URL("../", import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), "utf8");
const manifest = JSON.parse(read("data/notation-bundles.json"));
const file = manifest["50"].bootstrap;
const seed = read(file);
if (seed !== read("lib/js/" + file)) throw new Error("the package seed differs from the root seed");
const unicode = new UnicodeTable(read("data/unicode/unicode.txt"), read("data/unicode/unicode-properties.txt"));
const digest = createHash("sha256").update(seed).digest("hex");
console.log(JSON.stringify({ file, digest }));

for (const [document, { dom }] of Object.entries(JSON.parse(seed).documents)) {
  if (dom.format !== 50) throw new Error(`${document}: expected format 50`);
  const pending = [[dom, ""]];
  while (pending.length) {
    const [value, pointer] = pending.pop();
    if (!value || typeof value !== "object") continue;
    if (Object.hasOwn(value, "method")) {
      const signature = methods50.get(value.method);
      const count = Array.isArray(value.args) ? value.args.length : -1;
      const ok = !!signature && count >= signature.min && count <= signature.max;
      if (!ok) process.exitCode = 1;
      console.log(JSON.stringify({ document, pointer, at: value.at, method: value.method, count, ok }));
    }
    if (Object.hasOwn(value, "property")) {
      const ok = validProperty50(value.property, unicode);
      if (!ok) process.exitCode = 1;
      console.log(JSON.stringify({ document, pointer, at: value.at, property: value.property, ok }));
    }
    for (const [key, child] of Object.entries(value).reverse()) pending.push([child, `${pointer}/${key}`]);
  }
}
