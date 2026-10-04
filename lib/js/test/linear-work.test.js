// Reads, scans and formatters whose work must grow linearly with their
// input. Where no counter measures the work, a test times the function on
// a synthetic input of size n and 4n, and a quadratic cost shows as a
// sixteenfold time where a linear one shows as fourfold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { explainWarnings } from "../src/diagnostics.js";

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
