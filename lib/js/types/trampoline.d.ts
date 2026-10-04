export type Step = Generator<any, any, any>;
/**
 * Runs a reader to its result, keeping the chain of its calls in an
 * explicit stack.
 * @template T
 * @param {Generator<any, T, any>} root
 * @returns {T}
 */
export declare function run<T>(root: Generator<any, T, any>): T;
