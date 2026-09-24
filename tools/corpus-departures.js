#!/usr/bin/env node
// Lists the corpus cases whose expectation departs from the verdict they
// were seeded with (tests/README.md, "Corpus cases"), grouped by reason.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tests", "corpus");
const groups = new Map();
for (const file of fs.readdirSync(directory).filter((name) => name.endsWith(".jsonl")).sort()) {
  for (const line of fs.readFileSync(path.join(directory, file), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const c = JSON.parse(line);
    if (!c.seeded) continue;
    if (!groups.has(c.reason)) groups.set(c.reason, []);
    groups.get(c.reason).push(c);
  }
}
for (const [reason, cases] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${cases.length} × ${reason}`);
  for (const c of cases) console.log(`  ${c.id} [${c.dialect}] seeded ${c.seeded}, expect ${c.expect}: ${JSON.stringify(c.text.length > 80 ? c.text.slice(0, 80) + "…" : c.text)}`);
}
