// Runs the shared Lojban corpus (tests/README.md, "Corpus cases"): the core
// sample by default, every case with GENCMU_CORPUS=full. Cases run on a pool
// of worker threads, each loading the bundled dialects once.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort } from "node:worker_threads";

const here = path.dirname(fileURLToPath(import.meta.url));
const tests = path.join(here, "..", "..", "..", "tests");

/** Every corpus case, in file order. */
function allCases() {
  const cases = [];
  const directory = path.join(tests, "corpus");
  for (const file of fs.readdirSync(directory).filter((name) => name.endsWith(".jsonl")).sort()) {
    for (const line of fs.readFileSync(path.join(directory, file), "utf8").split("\n")) {
      if (line.trim()) cases.push(JSON.parse(line));
    }
  }
  return cases;
}

/** What gencmu produces for a case, in the case's own terms. */
async function outcome(g, dialects, c) {
  if (!dialects.has(c.dialect)) dialects.set(c.dialect, g.loadDialect(c.dialect));
  const result = dialects.get(c.dialect).parse(c.text, { features: c.features || [] });
  const words = result.stages.find((stage) => stage.name === "words");
  const got = { expect: result.ok ? "accept" : "reject" };
  if (result.ok) got.verdict = result.stages[result.stages.length - 1].verdict;
  else got.stage = result.error ? result.error.stage : null;
  const ties = result.stages.filter((stage) => stage.verdict === "tie").map((stage) => stage.name);
  if (ties.length) got.ties = ties;
  if (words && words.output) got.words = words.output.map((token) => token.phonemes || token.text);
  if (result.ok) got.brackets = g.toBrackets(result);
  return got;
}

if (!isMainThread) {
  const g = await import("../src/node.js");
  const dialects = new Map();
  parentPort.on("message", async (c) => {
    try {
      parentPort.postMessage({ id: c.id, got: await outcome(g, dialects, c) });
    } catch (error) {
      parentPort.postMessage({ id: c.id, crash: String(error && error.stack || error) });
    }
  });
} else {
  test("the corpus", async () => {
    const full = process.env.GENCMU_CORPUS === "full";
    let cases = allCases();
    if (!full) {
      const core = new Set(fs.readFileSync(path.join(tests, "core.txt"), "utf8").split("\n").filter(Boolean));
      cases = cases.filter((c) => core.has(c.id));
      assert.equal(cases.length, core.size, "every id of core.txt names a case");
    }
    const byId = new Map(cases.map((c) => [c.id, c]));
    // The longest texts first, so that the pool is not left waiting on one.
    const queue = cases.slice().sort((a, b) => b.text.length - a.text.length);
    const failures = [];
    const workers = Math.max(1, Math.min(queue.length, Number(process.env.GENCMU_CORPUS_WORKERS) || os.availableParallelism() - 1 || 1));
    await Promise.all(Array.from({ length: workers }, () => new Promise((resolve, reject) => {
      // A chapter of a book takes over a gigabyte to parse, which may be
      // more than a worker's default heap on a small machine.
      const worker = new Worker(fileURLToPath(import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 3072 } });
      const feed = () => {
        const next = queue.pop();
        if (next) worker.postMessage(next);
        else worker.terminate().then(resolve, reject);
      };
      worker.on("message", (message) => {
        const c = byId.get(message.id);
        if (message.crash) failures.push(`${c.id}: ${message.crash}`);
        else {
          for (const key of ["expect", "verdict", "stage", "ties", "words", "brackets"]) {
            if (!(key in c) && !(key in message.got)) continue;
            if (JSON.stringify(c[key]) !== JSON.stringify(message.got[key])) {
              failures.push(`${c.id} (${c.dialect}): ${key} expected ${JSON.stringify(c[key])}, got ${JSON.stringify(message.got[key])}`);
              break;
            }
          }
        }
        feed();
      });
      worker.on("error", reject);
      feed();
    })));
    assert.deepEqual(failures.slice(0, 20), [], `${failures.length} of ${cases.length} cases differ`);
  });
}
