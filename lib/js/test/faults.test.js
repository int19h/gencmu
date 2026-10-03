// Fault injection for the check of elision-only (the proposal of the
// reconstruction, Part 4). Each fault of the check is a private switch of
// src/testing.js. With one switch on at a time, every case of the fault
// table runs, and the cases that fail are the faults' catches. Each case
// must catch the faults that the table names for it, and each fault must
// have a case that catches it. faults.json records every catch, the table's
// and the others, so that a change shows, and the table's claims that the
// run does not confirm, with the reason. Each catch says how the case
// caught the fault: "result" through the public result, "hook" through the
// witness hook alone, or "result+hook" through both. Each fault runs in a
// worker of its own, since some faults change cached grammars.
//
// GENCMU_FAULTS_WRITE=1 writes the observed catches to faults.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

const here = path.dirname(fileURLToPath(import.meta.url));
const recordPath = path.join(here, "faults.json");

// The faults, one switch each (src/testing.js). F1 has two per observer,
// one for the tokens of R behind its argument and one for positions, except
// that from and after have only the second: applied before the projection
// or after it, they give the same span. F7,
// F26 and F27 have one switch for each of their variants. F28 is caught
// only by the witness hook.
const OBSERVERS = ["after", "from", "head", "tail", "last", "initial", "text", "phonemes", "classes", "tags"];
// The order of one step of the recognizer (engine §4), which the check
// meets on its own competing routes as the main parse does.
const ORDER = ["order:tags", "order:conditions"];
// A ranking that does not count W(D) though the chart holds it.
const LOST = ["lost:rank"];
const VARIANTS = { F7: ["restoration", "capture", "union"], F26: ["lost", "relabel"], F27: ["order", "bare"] };
export const FAULTS = [
  ...OBSERVERS.flatMap((name) => name === "from" || name === "after" ? [`F1pos:${name}`] : [`F1:${name}`, `F1pos:${name}`]),
  ...Array.from({ length: 31 }, (_, index) => `F${index + 2}`)
    .flatMap((name) => name in VARIANTS ? VARIANTS[/** @type {keyof typeof VARIANTS} */ (name)].map((variant) => `${name}:${variant}`) : [name]),
  ...ORDER,
  ...LOST,
].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

if (!isMainThread) {
  const { faults } = await import("../src/testing.js");
  const { repository, runEngineCase, loadEngineCase, parseEngineCase, checkEngineOutcome } = await import("./shared.js");
  faults.add(workerData.fault);
  // How each case catches the fault: through the public result, through
  // the witness hook alone, or through both (tests/README.md).
  /** @type {Record<string, string>} */
  const caught = {};
  for (const file of workerData.cases) {
    const testCase = JSON.parse(fs.readFileSync(path.join(repository, "tests", "engine", file), "utf8"));
    let result = false;
    let hook = false;
    /** @type {(expect: object, outcome: any, label: string) => void} */
    const check = (expect, outcome, label) => {
      if (outcome.lostWitnesses > 0) hook = true;
      try {
        checkEngineOutcome(expect, { ...outcome, lostWitnesses: 0 }, label);
      } catch {
        result = true;
      }
    };
    try {
      if (testCase.parses) {
        const loaded = loadEngineCase(testCase);
        if (loaded.loadError) throw loaded.loadError;
        testCase.parses.forEach((run, index) => check(run.expect, parseEngineCase(loaded.dialect, testCase, run), `parse ${index}`));
      } else {
        check(testCase.expect, runEngineCase(testCase), "");
      }
    } catch {
      result = true;
    }
    if (result || hook) caught[file] = result && hook ? "result+hook" : result ? "result" : "hook";
  }
  parentPort.postMessage(caught);
} else {
  test("each fault of the elision-only check fails the cases that name it, and the record of catches is current", async () => {
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
    const cases = Object.keys(record.named).sort();
    /** @type {Record<string, Record<string, string>>} */
    const caught = {};
    const queue = FAULTS.slice();
    const workers = Math.max(1, Math.min(queue.length, os.availableParallelism() - 1 || 1));
    await Promise.all(Array.from({ length: workers }, async () => {
      for (let fault = queue.shift(); fault !== undefined; fault = queue.shift()) {
        caught[fault] = await new Promise((resolve, reject) => {
          const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { fault, cases } });
          worker.once("message", resolve);
          worker.once("error", reject);
        });
      }
    }));
    /** @type {Record<string, Record<string, string>>} */
    const observed = Object.fromEntries(FAULTS.map((fault) => [fault, caught[fault]]));
    if (process.env.GENCMU_FAULTS_WRITE) {
      fs.writeFileSync(recordPath, JSON.stringify({ named: record.named, unconfirmed: record.unconfirmed, caught: observed }, null, 2) + "\n");
      record.caught = observed;
    }
    const missed = [];
    for (const [file, names] of Object.entries(record.named)) {
      for (const fault of names) if (!(file in observed[fault])) missed.push(`${file} does not catch ${fault}`);
    }
    // A catch that the table claims by reasoning and the run does not
    // confirm is recorded, with the reason, in faults.json.
    assert.deepEqual(missed, Object.keys(record.unconfirmed).map((entry) => entry.replace(" ", " does not catch ")), "cases that miss a fault that the table names");
    assert.deepEqual(FAULTS.filter((fault) => Object.keys(observed[fault]).length === 0), [], "faults that no case catches");
    assert.deepEqual(observed, record.caught, "the catches differ from faults.json");
  });
}
