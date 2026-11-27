// The negated twins of a case. For each condition of the case's own
// documents, a twin negates that condition in the format 50 DOM, and the
// loader takes the changed DOM in place of the source. The twin runs the
// texts of the case with the oracle on. A text that recognition rejects
// with a wrong answer for the condition is accepted by its twin, so the
// oracle then sees that answer on the real bags.
import { GencmuError } from "../src/errors.js";
import { Loader50 } from "../src/format50/loader.js";
import { withOracle, oracleProblems } from "./oracle.js";

/** The counts of every twin that ran, for a summary. */
export const twinTotals = { twins: 0, loaded: 0, runs: 0, accepted: 0, problems: 0 };

/**
 * Runs the negated twin of each condition of the own documents of a case.
 * @param {{read: (file: string) => string | undefined, pipelinePath: string, own: string[],
 *   runs: {text: string, options: any}[]}} spec
 * @returns {{twins: number, loaded: number, runs: number, accepted: number, problems: string[]}}
 */
export function twinChecks({ read, pipelinePath, own, runs }) {
  const stats = { twins: 0, loaded: 0, runs: 0, accepted: 0, problems: /** @type {string[]} */ ([]) };
  let base;
  try {
    base = new Loader50(read);
  } catch (error) {
    // A case whose resources the loader refuses has no twins to run.
    if (error instanceof GencmuError) return stats;
    throw error;
  }
  for (const path of own) {
    let dom;
    try {
      dom = base.documentDom(path, []);
    } catch (error) {
      if (error instanceof GencmuError) continue;
      throw error;
    }
    if (!dom) continue;
    const text = JSON.stringify(dom);
    dom.rules.forEach((/** @type {any} */ rule, /** @type {number} */ ruleIndex) => {
      (rule.conditions ?? []).forEach((/** @type {any} */ condition, /** @type {number} */ conditionIndex) => {
        const twin = JSON.parse(text);
        const written = twin.rules[ruleIndex].conditions[conditionIndex];
        twin.rules[ruleIndex].conditions[conditionIndex] = { not: written, ...(written.at ? { at: written.at } : {}) };
        stats.twins++;
        let pipeline;
        try {
          const loader = new Loader50(read);
          loader.supplyDom(path, JSON.stringify(twin));
          pipeline = loader.pipeline(pipelinePath);
        } catch (error) {
          // A twin that the loader refuses has no text to check.
          if (error instanceof GencmuError) return;
          throw error;
        }
        stats.loaded++;
        for (const run of runs) {
          let outcome;
          try {
            outcome = withOracle(() => pipeline.parse(run.text, run.options));
          } catch (error) {
            if (error instanceof GencmuError) continue;
            throw error;
          }
          stats.runs++;
          if (outcome.value.ok) stats.accepted++;
          const where = `the twin of ${path}, rule ${rule.name ?? "?"}, condition ${conditionIndex + 1}`;
          for (const problem of oracleProblems(outcome.checks)) stats.problems.push(`${where}: ${problem}`);
        }
      });
    });
  }
  twinTotals.twins += stats.twins;
  twinTotals.loaded += stats.loaded;
  twinTotals.runs += stats.runs;
  twinTotals.accepted += stats.accepted;
  twinTotals.problems += stats.problems.length;
  return stats;
}
