// Switches and hooks for the library's own tests. Nothing here is part of
// the API, and index.js does not export it.
//
// `faults` holds the faults of the elision-only check that a test turns on,
// one at a time, to show which shared cases catch each (proposal of the
// reconstruction, Part 4). An empty set is the engine as specified. The
// names are those of the fault list: F1 has one name per observer, such as
// "F1:after"; F27 has "F27:order" and "F27:bare"; "lost:roots" and
// "lost:count" lose the witness after recognition (engine §7.9).
//
// `hooks.elisionCheck`, when set, receives each check that ran and met no
// error of the grammar, for the witness test of tests/README.md.

/** @type {Set<string>} */
export const faults = new Set();

/**
 * What the check of engine §7 hands its test hook.
 * @typedef {object} ElisionCheckRun
 * @property {import("./types.js").Derivation} chosen D, the chosen
 *   derivation of the main parse
 * @property {import("./earley.js").Chart} chart the recognition of R
 * @property {import("./types.js").Item[]} roots the completed items of
 *   `text` over R
 * @property {boolean[]} synthetic for each token of R, whether it is
 *   synthetic, by its provenance
 * @property {number[]} originalAt for each token of the stage's input, its
 *   index in R
 * @property {number[]} recordAt for each restoration record, the index of
 *   its synthetic token in R
 */

/** @type {{elisionCheck: ((run: ElisionCheckRun) => void) | null}} */
export const hooks = { elisionCheck: null };

/**
 * Whether a fault is on.
 * @param {string} name
 * @returns {boolean}
 */
export function fault(name) {
  return faults.size > 0 && faults.has(name);
}
