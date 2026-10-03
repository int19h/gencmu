/**
 * The fields of a corpus case that a result is compared with, in the order
 * in which a difference is reported.
 */
export declare const CASE_FIELDS: readonly ["expect", "verdict", "stage", "error", "ties", "words", "brackets"];
export type CaseOutcome = {
    expect: "accept" | "reject";
    /**
     * the verdict of
     * the last stage of an accepted text
     */
    verdict?: import("./types.js").Verdict | null;
    /**
     * the stage that rejected a
     * text
     */
    stage?: string | null | undefined;
    /**
     * an
     * ambiguous error's kind and reason
     */
    error?: {
        kind: string;
        reason: string | undefined;
    };
    /**
     * the stages whose verdict is a tie
     */
    ties?: string[];
    /**
     * the labels of the words stage's output
     */
    words?: string[];
    /**
     * the tree of an accepted text, with elided
     * terminators hidden
     */
    brackets?: string;
};
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
export declare function caseOutcome(result: import("./types.js").ParseResult): CaseOutcome;
/**
 * The first field in which a case and an outcome differ, as a sentence, or
 * null where they agree. A field counts where the case or the outcome has
 * it (tests/README.md).
 * @param {Record<string, unknown>} expected the case
 * @param {CaseOutcome} got
 * @returns {string | null}
 */
export declare function caseDifference(expected: Record<string, unknown>, got: CaseOutcome): string | null;
