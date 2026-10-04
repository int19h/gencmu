// Runs mutually recursive readers and walks without the call stack, so a
// document's nesting cannot exhaust it (engine §9).

/**
 * A step of a reader written as a generator: it yields the generator of
 * each call it would make, and receives that call's result in its place,
 * or the call's error, thrown at the yield.
 * @typedef {Generator<any, any, any>} Step
 */

import { WorkBudget, countWork, hooks } from "./testing.js";

// Each step of a run counts as walkSteps of `hooks.work` while a test sets
// it, and so does each node that a walk with an explicit stack meets. The
// tests of growth compare the steps across depths of nesting
// (tests/README.md).

/**
 * Runs a reader to its result, keeping the chain of its calls in an
 * explicit stack.
 * @template T
 * @param {Generator<any, T, any>} root
 * @returns {T}
 */
export function run(root) {
  /** @type {Step[]} */
  const stack = [root];
  /** @type {any} */
  let value;
  let failed = false;
  /** @type {unknown} */
  let error = null;
  while (stack.length > 0) {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    const top = stack[stack.length - 1];
    let step;
    try {
      step = failed ? top.throw(error) : top.next(value);
    } catch (thrown) {
      // A count past a test's budget leaves at once, so the test sees the
      // first count past it, not a later count of the unwinding steps.
      if (thrown instanceof WorkBudget) throw thrown;
      stack.pop();
      failed = true;
      error = thrown;
      continue;
    }
    failed = false;
    error = null;
    if (step.done) {
      stack.pop();
      value = step.value;
    } else {
      stack.push(step.value);
      value = undefined;
    }
  }
  if (failed) throw error;
  return value;
}
