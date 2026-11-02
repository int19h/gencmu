// Fault injection, mostly for the check of elision-only (tests/README.md).
// Each fault is a private switch of src/testing.js. With one switch on at a
// time, every case of the fault table runs, and the cases that fail are the
// faults' catches. Each case must catch the faults that the table names for
// it, and each fault must have a case that catches it. faults.json records
// every catch, the table's and the others, so that a change shows, and the
// table's claims that the run does not confirm, with the reason. Each catch
// says how the case caught the fault: "result" through the public result,
// "hook" through the witness hook alone, or "result+hook" through both.
// "bound" means that the fault ends an unbounded recursion at its own limit.
// An unexpected exception fails the test. Each fault runs in a worker of
// its own, since some faults change cached grammars.
//
// GENCMU_FAULTS_WRITE=1 writes the observed catches to faults.json.
import { assertJsonEqual } from "./shared.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { FAULTS, sitesOf, hooks } from "../src/testing.js";
import { GencmuError } from "../src/errors.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const recordPath = path.join(here, "faults.json");


function faultCatch(run, checkOutcome) {
  let result = false;
  let hook = false;
  const check = (expect, outcome, label) => {
    if (outcome.lostWitnesses > 0) hook = true;
    try {
      checkOutcome(expect, { ...outcome, lostWitnesses: 0 }, label);
    } catch (error) {
      if (!(error instanceof assert.AssertionError)) throw error;
      result = true;
    }
  };
  try {
    run(check);
  } catch (error) {
    if (error instanceof Error && error.message === "F25: the queries of the check recurse without end") return "bound";
    if (!(error instanceof GencmuError)) throw error;
    result = true;
  }
  return result && hook ? "result+hook" : result ? "result" : hook ? "hook" : null;
}

if (!isMainThread) {
  const { faults, hits } = await import("../src/testing.js");
  const { repository, runEngineCase, loadEngineCase, parseEngineCase, checkEngineOutcome } = await import("./shared.js");
  faults.add(workerData.fault);
  // How each case catches the fault: through the public result, through
  // the witness hook alone, through both, or at its own recursion bound
  // (tests/README.md).
  /** @type {Record<string, string>} */
  const caught = {};
  for (const file of workerData.cases) {
    const testCase = JSON.parse(fs.readFileSync(path.join(repository, "tests", "engine", file), "utf8"));
    const how = faultCatch(check => {
      if (testCase.parses) {
        const loaded = loadEngineCase(testCase);
        if (loaded.loadError) throw loaded.loadError;
        testCase.parses.forEach((run, index) => check(run.expect, parseEngineCase(loaded.pipeline, testCase, run), `parse ${index}`));
      } else {
        check(testCase.expect, runEngineCase(testCase), "");
      }
    }, checkEngineOutcome);
    if (how !== null) caught[file] = how;
  }
  parentPort.postMessage({ caught, hits: Object.fromEntries(hits) });
} else {
  test("fault catches keep result, hook and bound observations separate", () => {
    for (const [result, hook, expected] of [[false,false,null],[true,false,"result"],[false,true,"hook"],[true,true,"result+hook"]]) {
      const how = faultCatch(check => check({}, {lostWitnesses:hook ? 1 : 0}, ""), (_expect,outcome) => {
        assert.equal(outcome.lostWitnesses,0);
        if (result) assert.fail("wrong result");
      });
      assert.equal(how,expected);
    }
    assert.equal(faultCatch(() => {throw new Error("F25: the queries of the check recurse without end");}),"bound");
    assert.equal(faultCatch(() => {throw new GencmuError("grammar","faulty grammar");}),"result");
    const crash = new TypeError("broken result inspector");
    assert.throws(() => faultCatch(check => check({}, {}, ""), () => {throw crash;}), error => error === crash);
    assert.throws(() => faultCatch(() => {throw new Error("F25: another crash");}), /another crash/);
  });

  test("a crashing private hook fails the fault runner", async () => {
    const {runEngineCase,checkEngineOutcome} = await import("./shared.js");
    const crash = new TypeError("broken admission hook");
    const previous = hooks.boundaryAdmission;
    hooks.boundaryAdmission = () => {throw crash;};
    try {
      assert.throws(() => faultCatch(check => check({}, runEngineCase({
        grammar:"%rule text (p ≻ q ≻ r) :: ∅ | B\n%rule p A\n%conditions ¬$.followed-by(B)\n%rule q A\n%rule r A",
        tokens:[{text:"a",tags:["A"]}],
      }), ""),checkEngineOutcome), error => error === crash);
    } finally {
      hooks.boundaryAdmission = previous;
    }
  });

  test("the duplicate item fault gives a wrong result without crashing", async () => {
    const {faults,hits} = await import("../src/testing.js");
    const {runEngineCase,checkEngineOutcome} = await import("./shared.js");
    const file = "reparse-strict-shared-prediction.json";
    const fixture = JSON.parse(fs.readFileSync(new URL(`../../../tests/engine/${file}`,import.meta.url),"utf8"));
    checkEngineOutcome(fixture.expect,runEngineCase(fixture),file);
    hits.clear();
    faults.add("F17");
    try {
      const outcome = runEngineCase(fixture);
      assert.equal(outcome.json.error.reason,"elision-only");
      assert.equal(outcome.json.error.witness,undefined);
      assertJsonEqual(outcome.json.error.readings[0],outcome.json.error.readings[1]);
      assert.throws(()=>checkEngineOutcome(fixture.expect,outcome,file),assert.AssertionError);
      for (const site of sitesOf("F17")) assert.ok(hits.get(site)>0,site);
    } finally {
      faults.delete("F17");
      hits.clear();
    }
    checkEngineOutcome(fixture.expect,runEngineCase(fixture),file);
  });

  test("each fault of the elision-only check fails the cases that name it, and the record of catches is current", async () => {
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
    const cases = Object.keys(record.named).sort();
    /** @type {Record<string, Record<string, string>>} */
    const caught = {};
    /** @type {Record<string, Record<string, number>>} */
    const entered = {};
    const queue = FAULTS.slice();
    // Each worker loads its own resource tables. Bound their aggregate memory.
    const workers = Math.max(1, Math.min(2, queue.length, os.availableParallelism() - 1 || 1));
    await Promise.all(Array.from({ length: workers }, async () => {
      for (let fault = queue.shift(); fault !== undefined; fault = queue.shift()) {
        /** @type {{caught: Record<string, string>, hits: Record<string, number>}} */
        const message = await new Promise((resolve, reject) => {
          const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { fault, cases } });
          worker.once("message", resolve);
          worker.once("error", reject);
        });
        caught[fault] = message.caught;
        entered[fault] = message.hits;
      }
    }));
    /** @type {Record<string, Record<string, string>>} */
    const observed = Object.fromEntries(FAULTS.map((fault) => [fault, caught[fault]]));
    if (process.env.GENCMU_FAULTS_WRITE) {
      fs.writeFileSync(recordPath, JSON.stringify({ named: record.named, unconfirmed: record.unconfirmed, caught: observed }, null, 2) + "\n");
      record.caught = observed;
    }
    assert.deepEqual(Object.keys(record.caught).sort(), [...FAULTS].sort(), "every declared fault has exactly one table entry");
    const missed = [];
    for (const [file, names] of Object.entries(record.named)) {
      for (const fault of names) if (!(file in observed[fault])) missed.push(`${file} does not catch ${fault}`);
    }
    // A catch that the table claims by reasoning and the run does not
    // confirm is recorded, with the reason, in faults.json.
    assert.deepEqual(missed, Object.keys(record.unconfirmed).map((entry) => entry.replace(" ", " does not catch ")), "cases that miss a fault that the table names");
    assert.deepEqual(FAULTS.filter((fault) => Object.keys(observed[fault]).length === 0), [], "faults that no case catches");
    // The hook catches some fault alone, and the selection channel catches
    // lost:select itself, whatever the result does (tests/README.md).
    assert.ok(Object.values(observed).some((catches) => Object.values(catches).includes("hook")), "no fault that only the hook catches");
    assert.ok(Object.values(observed["lost:select"]).some((how) => how.includes("hook")), "no case catches lost:select through the hook");
    // Each fault entered every site that it declares, and no other.
    const unentered = FAULTS.flatMap((fault) => sitesOf(fault).filter((site) => !entered[fault][site]));
    assert.deepEqual(unentered, [], "declared sites of faults that no named case enters");
    const undeclared = FAULTS.flatMap((fault) => Object.keys(entered[fault]).filter((site) => !sitesOf(fault).includes(site)));
    assert.deepEqual(undeclared, [], "sites that their fault does not declare");
    assert.deepEqual(observed, record.caught, "the catches differ from faults.json");
  });
}
