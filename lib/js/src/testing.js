// Switches and hooks for the library's own tests. Nothing here is part of
// the API, and index.js does not export it.
//
// `faults` holds the faults of the elision-only check that a test turns on,
// one at a time, to show which shared cases catch each (proposal of the
// reconstruction, Part 4). An empty set is the engine as specified. The
// names are those of the fault list. Each fault is defined by exactly what
// it reads, and a variant of a fault is a switch of its own, so that every
// catch that the fault table names is shown by injection:
//
// - "F1:<observer>", such as "F1:head", computes the observer over the
//   tokens of R behind its argument, and projects afterwards. The tokens
//   behind a function of a span are exact: one token for head and last,
//   and from the first original token for tail, from and after. from and
//   after have no such fault, since they give the same span before the
//   projection or after it.
// - "F1pos:<observer>" reads R at the positions that it is handed, which
//   for a function of a span are positions of the stage's input.
// - "F7:restoration" gives a restoration the synthetic token's tags,
//   "F7:capture" gives them to a capture of the terminal that reads it and
//   to a production that inherits from that terminal, and "F7:union" adds
//   the synthetic tokens' tags inside the exact span of R behind a span to
//   the union of its tokens' tags.
// - "F26:lost" loses an error of the grammar that the check meets, and
//   "F26:relabel" reports it as elision-witness-lost, which the runner
//   invariant of tests/README.md fails.
// - "F27:order" reverses the records at one position, and "F27:bare" shows
//   a read of a synthetic token as a token.
// - "F30" takes the greatest answer of "can read" (engine §7.4), "F31"
//   makes the item after the T of route 3 ordinary where a strict item read
//   T, and "F32" leaves an item that an ordinary step reaches as it was
//   processed while strict.
// - "lost:roots" and "lost:count" lose the witness after recognition
//   (engine §7.9).
//
// F25 finds no query cycle at all while the check runs. A detector that
// finds only some cycles gives the same public result, because the
// recursion meets the same rule and span one level deeper, and only the
// message differs, which no pattern pins. The switch ends the recursion at
// a bound, with an error that is not the library's.
//
// A strict and an ordinary prediction of one symbol at one position share
// their items (engine §7.4). So a fault of the strict path (F16, F29, F31,
// F32) shows only where that path is the only one at its position, or
// comes first, and a case that catches it says so. A case for a fault that
// depends on the order of processing comes in both orders.
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
 * @property {boolean} counted whether the ranking of the check counted a
 *   derivation
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
