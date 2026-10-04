// Runs mutually recursive readers and walks without the call stack, so a
// document's nesting cannot exhaust it (engine §9).

/**
 * A step of a reader written as a generator: it yields the generator of
 * each call it would make, and receives that call's result in its place,
 * or the call's error, thrown at the yield.
 * @typedef {Generator<any, any, any>} Step
 */

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
    const top = stack[stack.length - 1];
    let step;
    try {
      step = failed ? top.throw(error) : top.next(value);
    } catch (thrown) {
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
