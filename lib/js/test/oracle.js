// Runs a parse with the oracle of the format 50 stage on (src/format50/oracle.js).
// The oracle matches each written body against the chosen children, and it
// evaluates each symbol test and condition on the real bags. A disagreement
// fails the case of a runner. A refused check is one that only the
// recognizer runs, or that the late path refuses. An undecided check is one
// past a limit of the oracle. The runners count both.
import { hooks } from "../src/testing.js";

/** The checks of every parse that ran with the oracle, for a summary. */
export const oracleTotals = { checked: 0, disagreements: 0, refused: new Map(), undecided: new Map(), higherChecked: 0, higherUnmatched: 0 };

/**
 * Runs a function with the oracle on, and gives its value and the checks.
 * @template T
 * @param {() => T} run
 * @returns {{value: T, checks: any[]}}
 */
export function withOracle(run) {
  const checks = [];
  const previous = hooks.oracle50;
  hooks.oracle50 = check => checks.push(check);
  try {
    return { value: run(), checks };
  } finally {
    hooks.oracle50 = previous;
  }
}

/**
 * The disagreements of the checks as messages, and the counts in the totals.
 * @param {any[]} checks
 * @returns {string[]}
 */
export function oracleProblems(checks) {
  const problems = [];
  for (const check of checks) {
    oracleTotals.checked += check.checked;
    oracleTotals.disagreements += check.disagreements.length;
    for (const [list, map] of [[check.refused, oracleTotals.refused], [check.undecided, oracleTotals.undecided]]) {
      for (const item of list) {
        const key = `${item.kind}: ${item.detail.replace(/^\S+:\d+:\d+: /, "").slice(0, 100)}`;
        map.set(key, (map.get(key) ?? 0) + 1);
      }
    }
    oracleTotals.higherChecked += check.higher.checked;
    oracleTotals.higherUnmatched += check.higher.unmatched;
    for (const item of check.disagreements) {
      problems.push(`oracle: the ${item.stage} stage, ${item.kind} of ${item.rule}${item.at ? ` at ${item.document ?? ""}:${item.at}` : ""}: ${item.detail}`);
    }
  }
  return problems;
}
