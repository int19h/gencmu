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
    // The playground's hook throws an error of another realm.
    if (error instanceof WorkBudget || (typeof error === "object" && error !== null && /** @type {Error} */ (error).name === "WorkBudget")) assert.fail(`${what}: ${error.message} at ${4 * n}, after ${kinds.map((kind) => `${small[kind]} ${kind}`).join(", ")} at ${n}`);
    throw error;
  }
  if (process.env.LINEAR_REPORT) console.log(`${what}: ${kinds.map((kind) => `${kind} ${(large[kind] / small[kind]).toFixed(1)}x`).join(", ")}`);
  return { small, large };
}
