// The witness hook of tests/README.md: whether the check of elision-only
// kept W(D), the chosen derivation mapped to the reconstructed input, as a
// counted derivation of its forest (engine §7.8). It reads the check through
// the library's private test hook, never through its API, and it ranks
// nothing itself: it marks W(D)'s edges before the check ranks, and reads
// what the check's own ranking did with them.
import { walkWitness } from "../src/witness.js";
import { hooks } from "../src/testing.js";
import { ropeOf, secondOrder, totalOrder } from "../src/rank.js";

/**
 * One check that the hook watched: the walk's W(D), or null where the chart
 * does not hold it, and, once the check has ranked, whether it kept W(D).
 * @typedef {{walk: import("../src/witness.js").Walk | null, kept: boolean | null}} WatchedCheck
 */

/**
 * Runs `parse` and returns its value with the checks of elision-only that
 * ran in it and met no error of the grammar.
 * @template T
 * @param {() => T} parse
 * @returns {{value: T, checks: WatchedCheck[]}}
 */
export function withChecks(parse) {
  /** @type {WatchedCheck[]} */
  const checks = [];
  const before = hooks.elisionCheck;
  hooks.elisionCheck = (run) => {
    const walk = walkWitness(run);
    /** @type {WatchedCheck} */
    const check = { walk, kept: null };
    checks.push(check);
    return { marks: walk ? walk.marks : null, ranked: (outcome) => { check.kept = walk !== null && keeps(walk, outcome); } };
  };
  try {
    return { value: parse(), checks };
  } finally {
    hooks.elisionCheck = before;
  }
}

/**
 * Whether a watched check kept W(D) (tests/README.md).
 * @param {WatchedCheck} check
 * @returns {boolean}
 */
export function keepsWitness(check) {
  return check.kept === true;
}

/**
 * The two channels of the hook. The count channel: the check's own count,
 * in the same loop that counts, counted a derivation made of W(D)'s marked
 * edges only. The selection channel: where the check reports two readings,
 * the first does not come after W(D) in the canonical order T. Where the
 * first is not W(D), W(D) was a candidate for the second, so the second
 * does not come after W(D) by the criterion of engine §6 that picks it:
 * divergence from the first, earliest first, and then T.
 * @param {import("../src/witness.js").Walk} walk
 * @param {{ranking: import("../src/rank.js").Ranking | null, counted: boolean}} outcome
 * @returns {boolean}
 */
function keeps(walk, { ranking, counted }) {
  if (!counted || ranking === null) return false;
  if (ranking.slow || ranking.verdict !== "tie") return true;
  const w = ropeOf(walk.sequence);
  const first = totalOrder(ranking.first, w, "none");
  if (first > 0) return false;
  return first === 0 || secondOrder(ranking.first, /** @type {import("../src/types.js").Rope} */ (ranking.second), w, "none") <= 0;
}
