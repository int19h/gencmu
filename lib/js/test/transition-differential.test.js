import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { translateSharedCase } from "../../../tools/translate-shared-cases.js";
import { createDifferential, fixtureDifferential } from "../../../tools/transition/differential.js";
import { transitionBatch } from "../../../tools/transition/sweep.js";

const sample = {
  engine: ["item-condition-applies-to-no-production.json", "values-caller-empty-value.json"],
  notation: ["nested-head-parameter-before-body.json", "values-stacked-tests.json"],
};
const batch = transitionBatch();
assert.ok(!batch || Object.hasOwn(sample, batch.suite), "select the shared suite for this file");
const inventory = process.env.GENCMU_DIFFERENTIAL_INVENTORY;
const mutationCount = process.env.GENCMU_DIFFERENTIAL_MUTATION_COUNT;
const mutationWindow = mutationCount === undefined ? undefined : {
  start: Number(process.env.GENCMU_DIFFERENTIAL_MUTATION_START ?? 0),
  count: Number(mutationCount),
};
if (mutationWindow) {
  assert.ok(batch?.count === 1 && Number.isSafeInteger(mutationWindow.start) && mutationWindow.start >= 0 &&
    Number.isSafeInteger(mutationWindow.count) && mutationWindow.count >= 0,
    "use mutation windows with one fixture and nonnegative integer bounds");
}

for (const family of batch ? [batch.suite] : Object.keys(sample)) {
  const directory = new URL(`../../../tests/${family}/`, import.meta.url);
  const files = fs.readdirSync(directory).filter(file => file.endsWith(".json")).sort();
  if (batch) assert.ok(batch.start < files.length, "the first case must exist");
  const selected = batch ? files.slice(batch.start, batch.start + batch.count) : sample[family];
  const start = batch?.start ?? "sample";
  test(`transition differential shared ${family} ${start}`, () => {
    const check = createDifferential(mutationWindow);
    const inspect = fixtureDifferential(check);
    let casesWithSource = 0;
    const outcomes = [];
    for (const file of selected) {
      const fixture = JSON.parse(fs.readFileSync(new URL(file, directory), "utf8"));
      const result = translateSharedCase(family, file, fixture);
      if (inspect(result)) casesWithSource++;
      if (inventory) outcomes.push(JSON.stringify(result));
    }
    if (inventory) fs.writeFileSync(`${inventory}/${family}-${start}.jsonl`, outcomes.join("\n") + "\n");
    check.finish(`${family} ${start}`, { total: files.length, cases: selected.length, casesWithSource });
  });
}
