// Runs the shared Lojban corpus (tests/README.md, "Corpus cases"): the core
// sample by default, every case with GENCMU_CORPUS=full. Cases run on a pool
// of worker threads, each loading the bundled pipelines once.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { assertJsonEqual, applyMutant, corpusResultProblems, loadEngineCase, parseEngineCase, resultMutants, witnessLost } from "./shared.js";
import { withChecks, keepsWitness } from "./witness.js";
import { caseOutcome, caseDifference } from "../src/cases.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const tests = path.join(here, "..", "..", "..", "tests");

function corpusRecords(text, file) {
  assert.ok(!text.startsWith("\ufeff"),`${file}: a byte order mark is not permitted`);
  const records=[];
  for (const line of text.split("\n")) if (!/^[ \t\r]*$/.test(line)) records.push(JSON.parse(line));
  return records;
}

/** Every corpus case, in file order. */
function allCases() {
  const cases = [];
  const directory = path.join(tests, "corpus");
  for (const file of fs.readdirSync(directory).filter((name) => name.endsWith(".jsonl")).sort()) {
    for (const record of corpusRecords(fs.readFileSync(path.join(directory,file),"utf8"),file)) cases.push(record);
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

/**
 * What gencmu produces for a case, in the case's own terms (src/cases.js,
 * which `gencmu test` shares). The runner also checks what the library
 * must never give: the error elision-witness-lost, a check that lost its
 * witness, and a result that breaks an invariant of a tie.
 */
async function outcome(g, pipelines, c) {
  if (!pipelines.has(c.pipeline)) pipelines.set(c.pipeline, g.loadPipeline(c.pipeline));
  const { value: result, checks } = withChecks(() => pipelines.get(c.pipeline).parse(c.text, { features: c.features || [], withoutFeatures: c.withoutFeatures || [] }));
  // No corpus case gives elision-witness-lost, whatever it expects
  // (tests/README.md).
  if (witnessLost(result)) throw new Error("the result is the error elision-witness-lost, which no grammar gives");
  // Every check of elision-only that ran keeps its witness (tests/README.md).
  if (checks.some((run) => !keepsWitness(run))) throw new Error("a check of elision-only lost the witness of its chosen derivation");
  // The invariants of a tie hold of every result (tests/README.md).
  const problems = corpusResultProblems(result);
  if (problems.length) throw new Error(`the result breaks an invariant: ${problems.join("; ")}`);
  return caseOutcome(result);
}

if (!isMainThread) {
  const g = await import("../src/node.js");
  const {hooks} = await import("../src/testing.js");
  const pipelines = new Map();
  parentPort.on("message", async (c) => {
    const splits = new Set(), recognitions = new WeakMap();
    let nextRecognition = 0;
    hooks.boundaryAdmission = (observations,chart) => {
      if (!recognitions.has(chart)) recognitions.set(chart,nextRecognition++);
      for (const split of observations) splits.add(JSON.stringify({
        recognition:recognitions.get(chart),input:[chart.start,chart.end],...split,
      }));
    };
    try {
      parentPort.postMessage({ id: c.id, got: await outcome(g, pipelines, c) });
      if (splits.size) console.log(JSON.stringify({case:c.id,boundaryAdmissionSplits:[...splits].map(value=>JSON.parse(value))}));
    } catch (error) {
      parentPort.postMessage({ id: c.id, crash: String(error && error.stack || error) });
    }
  });
} else {
  test("corpus outcome comparisons require own array elements", () => {
    const hole=Array(1), inherited=Array(1);
    Object.setPrototypeOf(inherited,Object.assign(Object.create(Array.prototype),{0:"a"}));
    for (const missing of [hole,inherited]) {
      for (const [expected,actual] of [[["a"],missing],[missing,["a"]],[missing,missing]]) {
        assert.notEqual(caseDifference({words:expected},{words:actual}),null);
      }
    }
    assert.equal(caseDifference({at:-0},{at:0}),null);
    assert.equal(caseDifference({words:["a"]},{words:["a"]}),null);
    assert.notEqual(caseDifference({at:0},{at:false}),null);
  });

  test("the corpus reader refuses a leading byte order mark before blank-line filtering", () => {
    const record={id:"probe",text:"a",pipeline:"lojban/cll",expect:"reject",stage:"syntax",at:0};
    const text=JSON.stringify(record)+"\n";
    assertJsonEqual(corpusRecords("\n \r\n"+text,"probe.jsonl"),[record]);
    for (const mark of ["\ufeff","\ufeff\n","\ufeff \r\n"]) {
      assert.throws(()=>corpusRecords(mark+text,"probe.jsonl"),/byte order mark is not permitted/);
    }
  });

  test("the corpus reader ignores only JSON whitespace between records", () => {
    const record={id:"probe",text:"a",pipeline:"lojban/cll",expect:"reject",stage:"syntax",at:0};
    const text=JSON.stringify(record)+"\n";
    assertJsonEqual(corpusRecords(" \t\r\n"+text+"\t \r\n","probe.jsonl"),[record]);
    for (const mark of ["\ufeff","\u00a0","\u000b","\u000c","\u2028","\u2029"]) {
      for (const before of ["","\n \t\r\n",text]) {
        assert.throws(()=>corpusRecords(before+" \t"+mark+"\r\n"+text,"probe.jsonl"),SyntaxError);
      }
    }
    const embedded={...record,text:"\ufeff"};
    assertJsonEqual(corpusRecords(JSON.stringify(embedded)+"\n","probe.jsonl"),[embedded]);
  });

  test("the corpus runner refuses a result that breaks an invariant", async () => {
    const g = await import("../src/node.js");
    // Tied corpus cases keep the invariants. The shared mutants of
    // tests/result-mutants.json stand for a broken result.
    const tiedCases = allCases().filter((c) => c.error && c.error.reason === "tie");
    assert.ok(tiedCases.length > 0,"no tied corpus cases for the invariant test");
    for (const c of tiedCases) {
      const result = g.loadPipeline(c.pipeline).parse(c.text, { features: c.features || [], withoutFeatures: c.withoutFeatures || [] });
      assert.deepEqual(corpusResultProblems(result), [], c.id);
    }
    for (const mutant of resultMutants()) {
      const parse = () => parseEngineCase(loadEngineCase(mutant.engineCase).pipeline, mutant.engineCase).result;
      assert.deepEqual(corpusResultProblems(parse()), [], mutant.case);
      assert.notDeepEqual(corpusResultProblems(applyMutant(parse(), mutant)), [], mutant.name);
    }
  });

  test("the corpus runner refuses the error elision-witness-lost", async () => {
    // The check of le sutra tavla runs in lojban/cll, since the ranking
    // chooses the fragment (grammars/lojban/cll/syntax.md). A private switch loses
    // its witness after recognition.
    const g = await import("../src/node.js");
    const { faults } = await import("../src/testing.js");
    const c = { pipeline: "lojban/cll", text: "le sutra tavla" };
    const clean = await outcome(g, new Map(), c);
    assert.equal(clean.verdict, "resolved");
    faults.add("lost:roots");
    try {
      await assert.rejects(outcome(g, new Map(), c), /elision-witness-lost/);
    } finally {
      faults.delete("lost:roots");
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
    const selectedPipelines = process.env.GENCMU_CORPUS_PIPELINE?.split(",");
    if (selectedPipelines) cases = cases.filter((c) => selectedPipelines.includes(c.pipeline));
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
          const difference = caseDifference(c, message.got);
          if (difference) failures.push(`${c.id} (${c.pipeline}): ${difference}`);
        }
        feed();
      });
      worker.on("error", (error) => {
        reject(running ? new Error(`${running.id} (${running.pipeline}): the worker failed: ${error.message}`, { cause: error }) : error);
      });
      feed();
    })));
    assert.deepEqual((await withQuotingPlaces(failures, byId)).slice(0, 20), [], `${failures.length} of ${cases.length} cases differ`);
  });
}


test("corpus comparison ignores object member order and preserves array order", () => {
  const got = {expect:"reject", error:{kind:"ambiguous", reason:"tie"}, ties:["a", "b"]};
  assert.equal(caseDifference({expect:"reject", error:{reason:"tie", kind:"ambiguous"}, ties:["a", "b"]}, got), null);
  assert.match(caseDifference({expect:"reject", error:{kind:"ambiguous", reason:"other"}, ties:["a", "b"]}, got), /^error /);
  assert.match(caseDifference({...got, ties:["b", "a"]}, got), /^ties /);
  assert.match(caseDifference({...got, error:{kind:"ambiguous"}}, got), /^error /);
});
