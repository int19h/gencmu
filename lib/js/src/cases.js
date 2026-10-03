// Corpus cases (tests/README.md, "Corpus cases"): what a result gives in a
// case's own terms, and where it differs from the case. The corpus runner of
// the library's tests and `gencmu test` share this code, so that they compare
// cases in one way. Neither the index nor node.js exports it.

import { toBrackets } from "./output.js";

/**
 * The fields of a corpus case that a result is compared with, in the order
 * in which a difference is reported.
 */
export const CASE_FIELDS = /** @type {const} */ (["expect", "verdict", "stage", "error", "ties", "words", "brackets"]);

/**
 * What a corpus case records of a result.
 * @typedef {object} CaseOutcome
 * @property {"accept" | "reject"} expect
 * @property {import("./types.js").Verdict | null} [verdict] the verdict of
 *   the last stage of an accepted text
 * @property {string | null | undefined} [stage] the stage that rejected a
 *   text
 * @property {{kind: string, reason: string | undefined}} [error] an
 *   ambiguous error's kind and reason
 * @property {string[]} [ties] the stages whose verdict is a tie
 * @property {string[]} [words] the labels of the words stage's output
 * @property {string} [brackets] the tree of an accepted text, with elided
 *   terminators hidden
 */

/**
 * A result in the terms of a corpus case.
 * @param {import("./types.js").ParseResult} result
 * @returns {CaseOutcome}
 */
export function caseOutcome(result) {
  /** @type {CaseOutcome} */
  const got = { expect: result.ok ? "accept" : "reject" };
  if (result.ok) got.verdict = result.stages[result.stages.length - 1].verdict;
  else got.stage = result.error ? result.error.stage : null;
  // An ambiguous error pins its kind and reason (tests/README.md).
  if (result.error && result.error.kind === "ambiguous") got.error = { kind: result.error.kind, reason: result.error.reason };
  const ties = result.stages.filter((stage) => stage.verdict === "tie").map((stage) => stage.name);
  if (ties.length) got.ties = ties;
  const words = result.stages.find((stage) => stage.name === "words");
  if (words && words.output) got.words = words.output.map((token) => token.label);
  if (result.ok) got.brackets = toBrackets(result);
  return got;
}

/**
 * The first field in which a case and an outcome differ, as a sentence, or
 * null where they agree. A field counts where the case or the outcome has
 * it (tests/README.md).
 * @param {Record<string, unknown>} expected the case
 * @param {CaseOutcome} got
 * @returns {string | null}
 */
export function caseDifference(expected, got) {
  for (const key of CASE_FIELDS) {
    if (!(key in expected) && !(key in got)) continue;
    if (JSON.stringify(expected[key]) !== JSON.stringify(got[key])) {
      return `${key} expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(got[key])}`;
    }
  }
  return null;
}
