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
import { applyMutant, corpusResultProblems, loadEngineCase, parseEngineCase, resultMutants } from "./shared.js";
import { withChecks, keepsWitness } from "./witness.js";

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

/** The strings that a list holds more than once. */
function repeated(list) {
  const seen = new Set();
  return [...new Set(list.filter((item) => seen.has(item) || !seen.add(item)))];
}

/**
 * The failures, each with the lines of the checked grammar documents that
 * its case pins (tests/README.md, "Quoted texts"): those that quote the
 * case's text, and those that quote a fragment that an allow-list entry
 * pins with the case. The prose there may now be false. The places come
 * from tools/quoted-texts.js, which needs the Markdown parser of the
 * development dependencies. Without the parser, the failures stay as they
 * are. Any other error of the tool fails the run.
 */
async function withQuotingPlaces(failures, byId) {
  if (!failures.length) return failures;
  const { missing } = await import("../../../tools/markdown.js");
  if (missing) return failures;
  const places = (await import("../../../tools/quoted-texts.js")).quotingPlaces();
  return failures.map((failure) => {
    const c = byId.get(failure.slice(0, failure.indexOf(" ")).replace(/:$/, ""));
    const quoted = c && places.get(c.id);
    return quoted ? `${failure}; quoted at ${quoted.join(", ")}` : failure;
  });
}

/** What gencmu produces for a case, in the case's own terms. */
async function outcome(g, dialects, c) {
  if (!dialects.has(c.dialect)) dialects.set(c.dialect, g.loadDialect(c.dialect));
  const { value: result, checks } = withChecks(() => dialects.get(c.dialect).parse(c.text, { features: c.features || [], withoutFeatures: c.withoutFeatures || [] }));
  // Every check of elision-only that ran keeps its witness (tests/README.md).
  if (checks.some((run) => !keepsWitness(run))) throw new Error("a check of elision-only lost the witness of its chosen derivation");
  const words = result.stages.find((stage) => stage.name === "words");
  const got = { expect: result.ok ? "accept" : "reject" };
  if (result.ok) got.verdict = result.stages[result.stages.length - 1].verdict;
  else got.stage = result.error ? result.error.stage : null;
  // A rejection pins where its stage stopped, as a position in the text
  // (tests/README.md).
  if (!result.ok && result.error && result.error.source) got.at = result.error.source[0];
  // An ambiguous error pins its kind and reason (tests/README.md).
  if (result.error && result.error.kind === "ambiguous") got.error = { kind: result.error.kind, reason: result.error.reason };
  // The invariants of a tie hold of every result (tests/README.md).
  const problems = corpusResultProblems(result);
  if (problems.length) throw new Error(`the result breaks an invariant: ${problems.join("; ")}`);
  const ties = result.stages.filter((stage) => stage.verdict === "tie").map((stage) => stage.name);
  if (ties.length) got.ties = ties;
  if (words && words.output) got.words = words.output.map((token) => token.label);
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
  test("the corpus runner refuses a result that breaks an invariant", async () => {
    const g = await import("../src/node.js");
    // No corpus text ties in a bundled dialect, so the tied corpus cases, if
    // any, pass, and the shared mutants of tests/result-mutants.json stand
    // for a broken result.
    for (const c of allCases().filter((c) => c.error && c.error.reason === "tie")) {
      const result = g.loadDialect(c.dialect).parse(c.text, { features: c.features || [], withoutFeatures: c.withoutFeatures || [] });
      assert.deepEqual(corpusResultProblems(result), [], c.id);
    }
    for (const mutant of resultMutants()) {
      const parse = () => parseEngineCase(loadEngineCase(mutant.engineCase).dialect, mutant.engineCase).result;
      assert.deepEqual(corpusResultProblems(parse()), [], mutant.case);
      assert.notDeepEqual(corpusResultProblems(applyMutant(parse(), mutant)), [], mutant.name);
    }
  });

  test("the corpus", async () => {
    const full = process.env.GENCMU_CORPUS === "full";
    let cases = allCases();
    // Two cases with one id would merge in byId below.
    assert.deepEqual(repeated(cases.map((c) => c.id)), [], "ids that more than one corpus case has");
    if (!full) {
      const lines = fs.readFileSync(path.join(tests, "core.txt"), "utf8").split("\n").filter(Boolean);
      assert.deepEqual(repeated(lines), [], "ids that core.txt lists more than once");
      const core = new Set(lines);
      cases = cases.filter((c) => core.has(c.id));
      assert.equal(cases.length, core.size, "every id of core.txt names a case");
    }
    // With no case selected, as for an empty tests/corpus/, the test would
    // pass without running one.
    assert.ok(cases.length > 0, "the corpus selects no case");
    const byId = new Map(cases.map((c) => [c.id, c]));
    // The longest texts first, so that the pool is not left waiting on one.
    // The queue is sorted shortest first, and a worker takes its last case.
    const queue = cases.slice().sort((a, b) => a.text.length - b.text.length);
    const failures = [];
    const workers = Math.max(1, Math.min(queue.length, Number(process.env.GENCMU_CORPUS_WORKERS) || os.availableParallelism() - 1 || 1));
    await Promise.all(Array.from({ length: workers }, () => new Promise((resolve, reject) => {
      // A chapter of a book takes over a gigabyte to parse, which may be
      // more than a worker's default heap on a small machine.
      const worker = new Worker(fileURLToPath(import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 3072 } });
      // The case that the worker runs, so that a worker that fails, as
      // when it runs out of memory, names it.
      let running;
      const feed = () => {
        running = queue.pop();
        if (running) worker.postMessage(running);
        else worker.terminate().then(resolve, reject);
      };
      worker.on("message", (message) => {
        const c = byId.get(message.id);
        if (message.crash) failures.push(`${c.id}: ${message.crash}`);
        else {
          for (const key of ["expect", "verdict", "stage", "at", "error", "ties", "words", "brackets"]) {
            if (!(key in c) && !(key in message.got)) continue;
            if (JSON.stringify(c[key]) !== JSON.stringify(message.got[key])) {
              failures.push(`${c.id} (${c.dialect}): ${key} expected ${JSON.stringify(c[key])}, got ${JSON.stringify(message.got[key])}`);
              break;
            }
          }
        }
        feed();
      });
      worker.on("error", (error) => {
        reject(running ? new Error(`${running.id} (${running.dialect}): the worker failed: ${error.message}`, { cause: error }) : error);
      });
      feed();
    })));
    assert.deepEqual((await withQuotingPlaces(failures, byId)).slice(0, 20), [], `${failures.length} of ${cases.length} cases differ`);
  });
}
