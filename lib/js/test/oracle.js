// Runs a parse with the oracle of the format 50 stage on (src/format50/oracle.js).
// The oracle evaluates each condition and symbol test of each chosen tree
// again on the real bags. A disagreement fails the case of a runner. An
// undecided check is one that the late evaluator cannot run, and the
// runners count these apart.
import { hooks } from "../src/testing.js";

/** The checks of every parse that ran with the oracle, for a summary. */
export const oracleTotals = { checked: 0, disagreements: 0, undecided: new Map() };

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
    for (const item of check.undecided) {
      const key = `${item.kind}: ${item.detail.replace(/^\S+:\d+:\d+: /, "").slice(0, 100)}`;
      oracleTotals.undecided.set(key, (oracleTotals.undecided.get(key) ?? 0) + 1);
    }
    for (const item of check.disagreements) {
      problems.push(`oracle: the ${item.stage} stage, ${item.kind} of ${item.rule}${item.at ? ` at ${item.document ?? ""}:${item.at}` : ""}: ${item.detail}`);
    }
  }
  return problems;
}
