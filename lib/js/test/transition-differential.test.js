import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { translateSharedCase } from "../../../tools/translate-shared-cases.js";
import { createDifferential, fixtureDifferential } from "../../../tools/transition/differential.js";
import "../../../tools/transition/compiler.test.js";
import "../../../tools/transition/translator.test.js";
import "../../../tools/transition/validation.test.js";

const batchSize = Number(process.env.GENCMU_DIFFERENTIAL_BATCH_SIZE ?? 120);
assert.ok(Number.isInteger(batchSize) && batchSize > 0 && batchSize <= 120, "use a batch size from 1 through 120");
const inventory = process.env.GENCMU_DIFFERENTIAL_INVENTORY;
for (const family of ["engine", "notation"]) {
  const directory = new URL(`../../../tests/${family}/`, import.meta.url);
  const files = fs.readdirSync(directory).filter(file => file.endsWith(".json")).sort();
  for (let start = 0; start < files.length; start += batchSize) {
    test(`transition differential shared ${family} ${start}`, () => {
      const check = createDifferential();
      const inspect = fixtureDifferential(check);
      const selected = files.slice(start, start + batchSize);
      let casesWithSource = 0;
      const outcomes = [];
      for (const file of selected) {
        const fixture = JSON.parse(fs.readFileSync(new URL(file, directory), "utf8"));
        const result = translateSharedCase(family, file, fixture);
        if (inspect(result)) casesWithSource++;
        if (inventory) outcomes.push(JSON.stringify(result));
      }
      if (inventory) fs.writeFileSync(`${inventory}/${family}-${start}.jsonl`, outcomes.join("\n") + "\n");
      check.finish(`${family} ${start}`, { cases: selected.length, casesWithSource });
    });
  }
}
