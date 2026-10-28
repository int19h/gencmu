// The runs of tests/shared-memo.json (tests/README.md): parses that share
// one pipeline, and so its shared memos (engine §4.3), give the results of
// parses with an empty shared memo, in every order and with a bound of one
// entry. JavaScript shares no pipeline between workers, so it has no
// threaded run.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repository, loadEngineCase, caseTokens } from "./shared.js";
import { loadPipeline, resultJson, GencmuError } from "../src/node.js";
import { hooks } from "../src/testing.js";

const file = JSON.parse(fs.readFileSync(path.join(repository, "tests", "shared-memo.json"), "utf8"));

function pipelineOf(run) {
  if (run.pipeline) return loadPipeline(run.pipeline);
  const loaded = loadEngineCase({ grammar: run.grammar });
  assert.ok(loaded.pipeline, String(loaded.loadError));
  return loaded.pipeline;
}

function parsesOf(run) {
  const parses = [];
  const inputs = run.texts ? run.texts.map((text) => ({ text })) : run.inputs.map((tokens) => caseTokens(tokens));
  for (const input of inputs) {
    for (const options of run.options) parses.push({ input, options });
  }
  return parses;
}

function parse(pipeline, { input, options }, limit) {
  const parseOptions = {
    features: new Set(options.features || []),
    withoutFeatures: new Set(options.withoutFeatures || []),
    elisionOnly: options.elisionOnly,
    until: options.until,
  };
  if (input.tokens) parseOptions.tokens = input.tokens;
  const saved = hooks.memoLimit;
  hooks.memoLimit = limit;
  try {
    return JSON.stringify(resultJson(pipeline.parse(input.text, parseOptions)));
  } catch (error) {
    if (error instanceof GencmuError) return `error ${error.kind} ${error.message}`;
    throw error;
  } finally {
    hooks.memoLimit = saved;
  }
}

for (const [index, run] of file.runs.entries()) {
  test(`shared memo run ${index} (${run.pipeline ?? "grammar"}) gives the results of an empty memo in every order`, () => {
    const parses = parsesOf(run);
    const cold = pipelineOf(run);
    const reference = parses.map((item) => parse(cold, item, 0));
    for (const limit of [null, 1]) {
      const warm = pipelineOf(run);
      const forward = parses.map((_, i) => i);
      const backward = [...forward].reverse();
      for (const order of [forward, backward, forward]) {
        for (const i of order) assert.equal(parse(warm, parses[i], limit), reference[i], `parse ${i} with bound ${limit}`);
      }
    }
  });
}

test("an answer that depends on an aligned query stays out of the shared memo", () => {
  // Directly, and through the memo of the parse (engine §4.3): driver asks
  // an aligned query, and wrap reads driver's answer.
  const runs = file.runs.filter((run) => run.grammar && run.grammar.includes("without-elision"));
  assert.equal(runs.length, 2);
  for (const run of runs) {
    const pipeline = pipelineOf(run);
    const rules = [];
    hooks.memoInsert = (key) => rules.push(JSON.parse(key)[2]);
    try {
      for (const item of parsesOf(run)) parse(pipeline, item, null);
    } finally {
      hooks.memoInsert = null;
    }
    assert.ok(rules.includes("tail"), `an ordinary answer stayed out: ${rules}`);
    assert.ok(!rules.includes("driver") && !rules.includes("wrap"), `an answer that read an aligned query entered: ${rules}`);
  }
});

test("matches and tags share one entry, also for a match with no tags", () => {
  const grammar = "%rule text a | b\n%rule a (A $x:W) %conditions $x.matches(probe)\n%rule b (B $x:W) %conditions $x.tags(probe) = ∅\n%rule probe W :: ∅\n";
  const asks = (first) => ({ tokens: [{ text: first.toLowerCase(), tags: [first] }, { text: "x", tags: ["W"] }] });
  for (const order of [["A", "B"], ["B", "A"]]) {
    const cold = loadEngineCase({ grammar }).pipeline;
    const reference = order.map((first) => parse(cold, { input: caseTokens(asks(first).tokens), options: {} }, 0));
    const warm = loadEngineCase({ grammar }).pipeline;
    const keys = [];
    hooks.memoInsert = (key) => keys.push(key);
    try {
      order.forEach((first, i) => assert.equal(parse(warm, { input: caseTokens(asks(first).tokens), options: {} }, null), reference[i], `${order} parse ${i}`));
    } finally {
      hooks.memoInsert = null;
    }
    assert.ok(reference.every((json) => JSON.parse(json).ok), `${order}: both parses succeed`);
    const probes = keys.filter((key) => JSON.parse(key)[2] === "probe");
    assert.equal(probes.length, 1, `${order}: one entry for probe, not ${probes.length}`);
    assert.equal(JSON.parse(probes[0])[1], "matches", "the shared kind of matches and tags");
  }
});

test("the shared memo serves no answer while an aligned query is active", () => {
  // Each run twice on one pipeline, so that answers repeat. The guard of
  // engine §4.3 must hold, and ordinary hits must still happen. The test
  // keeps its own count of the aligned queries active, from the start and
  // end of their nested parses, apart from the library's count. At each
  // hit the two counts must agree. Both rest on one classification of a
  // query as aligned, so the runs of driver and wrap above stand behind it.
  const during = [];
  const desync = [];
  let ordinary = 0;
  let active = 0;
  let starts = 0;
  hooks.alignedQuery = (change) => { active += change; if (change > 0) starts++; };
  hooks.memoHit = (key, library) => {
    if (library !== active) desync.push([JSON.parse(key)[2], library, active]);
    if (active > 0) during.push(JSON.parse(key)[2]); else ordinary++;
  };
  try {
    for (const run of file.runs) {
      const pipeline = pipelineOf(run);
      for (const item of [...parsesOf(run), ...parsesOf(run)]) parse(pipeline, item, null);
    }
  } finally {
    hooks.memoHit = null;
    hooks.alignedQuery = null;
  }
  assert.equal(active, 0, "an aligned query that never ended");
  assert.ok(starts > 0, "no aligned query started");
  assert.deepEqual(desync, [], "the test's count and the library's differ");
  assert.deepEqual(during, [], "shared hits while an aligned query was active");
  assert.ok(ordinary > 0, "no ordinary shared hit");
});

/** A grammar of one query about one token, and a parse of the token `text`. */
const ONE = "%rule text $x:_ %conditions $x.matches(probe)\n%rule probe W\n";
const one = (text, tags = ["W"]) => ({ input: caseTokens([{ text, tags }]), options: {} });

test("a bound of 0 keeps and serves nothing", () => {
  const pipeline = loadEngineCase({ grammar: ONE }).pipeline;
  let inserts = 0, hits = 0;
  hooks.memoInsert = () => inserts++;
  hooks.memoHit = () => hits++;
  try {
    for (const text of ["a", "a", "b", "a"]) assert.ok(JSON.parse(parse(pipeline, one(text), 0)).ok);
  } finally {
    hooks.memoInsert = null;
    hooks.memoHit = null;
  }
  assert.deepEqual([inserts, hits], [0, 0]);
});

test("the default bound keeps at most two generations", () => {
  // Three generations of distinct answers. The newest is all there, in the
  // newer generation, and the oldest is gone.
  const bound = 8192;
  const pipeline = loadEngineCase({ grammar: ONE }).pipeline;
  let hits = 0;
  hooks.memoHit = () => hits++;
  try {
    for (let i = 0; i < 3 * bound; i++) assert.ok(JSON.parse(parse(pipeline, one(`t${i}`), null)).ok);
    hits = 0;
    for (let i = 2 * bound; i < 3 * bound; i++) assert.ok(JSON.parse(parse(pipeline, one(`t${i}`), null)).ok);
    assert.equal(hits, bound, "an answer of the newest generation was not served");
    hits = 0;
    for (let i = 0; i < bound; i++) assert.ok(JSON.parse(parse(pipeline, one(`t${i}`), null)).ok);
  } finally {
    hooks.memoHit = null;
  }
  assert.equal(hits, 0, "an answer of the oldest generation was served");
});

test("two loaded pipelines never share answers", () => {
  // Two grammars whose probe reads other tags, parsed in turn.
  const grammars = [ONE, ONE.replace("%rule probe W", "%rule probe X")];
  const inputs = [one("x", ["W"]), one("x", ["X"])];
  const reference = grammars.map((grammar) => inputs.map((input) => parse(loadEngineCase({ grammar }).pipeline, input, 0)));
  const warm = grammars.map((grammar) => loadEngineCase({ grammar }).pipeline);
  for (let round = 0; round < 2; round++) {
    for (const [i, input] of inputs.entries()) {
      for (const [g, pipeline] of warm.entries()) assert.equal(parse(pipeline, input, null), reference[g][i], `grammar ${g}, input ${i}`);
    }
  }
});
