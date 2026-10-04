// Reads, scans and formatters whose work must grow linearly with their
// input. Where no counter measures the work, a test times the function on
// a synthetic input of size n and 4n, and a quadratic cost shows as a
// sixteenfold time where a linear one shows as fourfold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { explainWarnings, formatItem } from "../src/diagnostics.js";
import { ParseContext, recognize, recognizerCounters } from "../src/earley.js";
import { implied } from "../src/stage.js";
import { loadEngineCase, caseTokens } from "./shared.js";

/**
 * The best of three timings of a call, in milliseconds.
 * @param {() => unknown} run
 */
function bestTime(run) {
  let best = Infinity;
  for (let round = 0; round < 3; round++) {
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

/**
 * Asserts that a function of a size costs no more than eight times as much
 * at 4n as at n, with a few milliseconds of slack for timer noise.
 * @param {string} what
 * @param {number} n
 * @param {(n: number) => () => unknown} setup makes the call for a size
 */
export function assertLinear(what, n, setup) {
  const small = setup(n);
  const large = setup(4 * n);
  const t1 = bestTime(small);
  const t4 = bestTime(large);
  assert.ok(t4 <= 8 * t1 + 5, `${what}: ${t1.toFixed(1)} ms at ${n}, ${t4.toFixed(1)} ms at ${4 * n}`);
}

test("explaining a warning on each line of a text costs linear time in the text, not the text once per warning", () => {
  assertLinear("explainWarnings", 3000, (n) => {
    const text = Array.from({ length: n }, () => "coi do").join("\n");
    const warnings = Array.from({ length: n }, (_, line) => ({ stage: "syntax", feature: "f", rule: "r", source: [line * 7, line * 7 + 3] }));
    const result = /** @type {any} */ ({ text, warnings });
    return () => explainWarnings(result);
  });
});

/**
 * The chart of a grammar over n tokens A, recognized from `text`.
 * @param {string} grammar
 * @param {number} n
 */
function chartOver(grammar, n) {
  const loaded = loadEngineCase({ grammar });
  const lowered = loaded.dialect.stages[0].grammar.lower(new Set());
  const { tokens, text } = caseTokens(Array.from({ length: n }, () => ({ text: "a", tags: ["A"] })));
  return () => recognize(new ParseContext(lowered, tokens, [...text], loaded.dialect.loader.unicode), "text", 0, tokens.length);
}

/**
 * @param {() => unknown} run
 * @param {number} rounds
 */
function repeated(run, rounds) {
  return () => {
    for (let round = 0; round < rounds; round++) run();
  };
}

test("an item built in many ways checks each new way against those found in a bounded number of comparisons", () => {
  const run = chartOver("%rule text t\n%rule t t t | A", 64);
  recognizerCounters.edgeChecks = 0;
  const chart = run();
  let edges = 0;
  for (const set of chart.sets) for (const item of set.items) edges += 1 + (item.more ? item.more.length : 0);
  assert.ok(recognizerCounters.edgeChecks <= 8 * edges, `${recognizerCounters.edgeChecks} checks for ${edges} edges`);
});

test("advancing over the captures of a production costs linear time in their number", () => {
  assertLinear("recognize", 400, (n) => {
    const names = Array.from({ length: n }, (_, index) => `$c${index}(A)`).join(" ");
    return repeated(chartOver(`%rule text ${names}`, n), 10);
  });
});

test("formatting an item of a production with many captures costs linear time in their number", () => {
  assertLinear("formatItem", 8000, (n) => {
    const captures = Array.from({ length: n }, (_, index) => ({ name: `c${index}`, index }));
    const production = /** @type {any} */ ({
      lhs: "text", helper: false, owner: "text",
      rhs: captures.map(() => ({ name: "A", terminal: true })),
      captures, captureAt: captures.map((_, index) => index), captureSlot: new Map(captures.map((capture, index) => [capture.name, index])),
    });
    return repeated(() => formatItem(production, 0), 10);
  });
});

test("checking a condition on each capture of a production costs linear time in their number", () => {
  assertLinear("recognize", 300, (n) => {
    const names = Array.from({ length: n }, (_, index) => `$c${index}(A)`).join(" ");
    const conditions = Array.from({ length: n }, (_, index) => `text($c${index}) = "a"`).join(", ");
    return repeated(chartOver(`%rule text ${names}\n%conditions ${conditions}`, n), 10);
  });
});

test("the implications of a stage close a token's tags in linear time, also over a chain written in reverse order", () => {
  assertLinear("implied", 500, (n) => {
    // T0 ⟹ T1 ⟹ … ⟹ Tn, written last link first.
    const implications = Array.from({ length: n }, (_, index) => ({ if: new Set([`T${n - 1 - index}`]), then: new Set([`T${n - index}`]) }));
    return repeated(() => implied(new Set(["T0"]), implications), 20);
  });
});
