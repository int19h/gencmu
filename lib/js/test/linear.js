// The check of the linear-work tests: that a function's work grows linearly
// with its input. The work is counted where it is done, through
// `hooks.work` (src/testing.js), not timed. A quadratic cost shows as a
// sixteenfold count at 4n, where a linear one shows as fourfold.
import assert from "node:assert/strict";
import { WorkBudget, hooks, newWork } from "../src/testing.js";

/**
 * The work that a call counts, which stops at the first count past the
 * budget, if any. The playground's scans count through a hook of their
 * own, which a test can name as `target`.
 * @param {() => unknown} run
 * @param {Partial<Record<import("../src/testing.js").WorkKind, number>>} [budget]
 * @param {{work: any}} [target]
 * @returns {import("../src/testing.js").WorkCounts}
 */
export function countedWork(run, budget, target = hooks) {
  const work = (target.work = newWork(budget));
  try {
    run();
  } finally {
    target.work = null;
  }
  return work;
}

/**
 * Asserts that a call counts some of each kind of work at n, and at 4n no
 * more than `factor` times as much, with a little slack for small counts.
 * The larger call runs under that budget, so a quadratic cost stops at the
 * first count past it rather than running on. Only the call that `setup`
 * returns is counted, not the setup itself.
 * @param {string} what
 * @param {number} n
 * @param {(n: number) => () => unknown} setup makes the call for a size
 * @param {import("../src/testing.js").WorkKind[]} kinds
 * @param {{factor?: number, target?: {work: any}}} [options] the most that
 *   4n may cost as a multiple of n, and the hook that counts
 * @returns {{small: import("../src/testing.js").WorkCounts, large: import("../src/testing.js").WorkCounts}}
 */
export function assertLinearWork(what, n, setup, kinds, { factor = 5, target = hooks } = {}) {
  const small = countedWork(setup(n), undefined, target);
  for (const kind of kinds) assert.ok(small[kind] > 0, `${what}: no ${kind} counted at ${n}`);
  /** @type {Partial<Record<import("../src/testing.js").WorkKind, number>>} */
  const budget = {};
  for (const kind of kinds) budget[kind] = Math.ceil(factor * small[kind]) + 16;
  const call = setup(4 * n);
  /** @type {import("../src/testing.js").WorkCounts} */
  let large;
  try {
    large = countedWork(call, budget, target);
  } catch (error) {
    if (error instanceof WorkBudget || (error instanceof Object && /** @type {Error} */ (error).name === "WorkBudget")) assert.fail(`${what}: ${error.message} at ${4 * n}, after ${kinds.map((kind) => `${small[kind]} ${kind}`).join(", ")} at ${n}`);
    throw error;
  }
  if (process.env.LINEAR_REPORT) console.log(`${what}: ${kinds.map((kind) => `${kind} ${(large[kind] / small[kind]).toFixed(1)}x`).join(", ")}`);
  return { small, large };
}

/**
 * The processor time of some rounds of a call, in milliseconds. The test
 * runner runs files in parallel, so a time on the clock would count the
 * time other processes took.
 * @param {() => unknown} run
 * @param {number} rounds
 */
function timed(run, rounds) {
  const start = process.cpuUsage();
  for (let round = 0; round < rounds; round++) run();
  const { user, system } = process.cpuUsage(start);
  return (user + system) / 1000;
}

/**
 * Asserts that a call costs no more than eight times as much at 4n as at
 * n, with a few milliseconds of slack. The call is repeated until the
 * least of three measurements at n takes 20 ms, so that the clock's grain
 * stays small beside it. Then the two sizes are measured in turn, five
 * times each, taking the least of each, so that a collection of garbage
 * shows in neither. The test runner runs files in parallel, which can
 * still slow one size more than the other, so a failed comparison is
 * measured again, up to three times. A quadratic cost fails all three.
 * @param {string} what
 * @param {number} n
 * @param {(n: number) => () => unknown} setup makes the call for a size
 */
export function assertLinear(what, n, setup) {
  const small = setup(n);
  const large = setup(4 * n);
  for (let warm = 0; warm < 2; warm++) {
    small();
    large();
  }
  /** @param {() => unknown} run @param {number} rounds @param {number} times */
  const least = (run, rounds, times) => {
    let best = Infinity;
    for (let time = 0; time < times; time++) best = Math.min(best, timed(run, rounds));
    return best;
  };
  let rounds = 1;
  while (rounds < 1 << 16 && least(small, rounds, 3) < 20) rounds *= 2;
  let t1 = Infinity;
  let t4 = Infinity;
  for (let attempt = 0; attempt < 3; attempt++) {
    t1 = Infinity;
    t4 = Infinity;
    for (let measure = 0; measure < 5; measure++) {
      t1 = Math.min(t1, timed(small, rounds));
      t4 = Math.min(t4, timed(large, rounds));
    }
    if (t4 <= 8 * t1 + 5) break;
  }
  if (process.env.LINEAR_REPORT) console.log(`${what}: ${(t4 / t1).toFixed(1)}x, ${t1.toFixed(1)} ms, ${rounds} rounds`);
  assert.ok(t4 <= 8 * t1 + 5, `${what}: ${t1.toFixed(1)} ms at ${n}, ${t4.toFixed(1)} ms at ${4 * n}, ${rounds} rounds each`);
}
