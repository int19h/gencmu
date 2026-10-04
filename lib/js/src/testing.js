// Switches and hooks for the library's own tests. Nothing here is part of
// the API, and index.js does not export it.
//
// `faults` holds the faults that a test turns on, one at a time, to show
// which shared cases catch each (tests/README.md). An empty set is the
// engine as specified. The names F1 to F32 are those of the fault list of
// the check of elision-only. Each fault is defined by exactly what
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
//   T. "F32:queue" leaves an item that an ordinary step reaches as it was
//   processed while strict, and "F32:predict" never predicts again a rule
//   that a strict prediction predicted first.
// - "lost:roots" and "lost:count" lose the witness after recognition
//   (engine §7.9).
// - "lost:rank" gives a restoration no derivation in the ranking, so the
//   check's ranking does not count W(D) though its chart holds it. Most
//   cases see it through the result too, since the readings change or none
//   is left. reparse-witness-sibling-last sees it through the hook alone.
// - "lost:context" makes the check's count skip the last edge of an item
//   that has two or more, and "lost:select" makes its candidates skip it.
//   In the sibling cases that edge is W(D)'s. The count channel of the
//   witness hook alone sees lost:context, where the readings stay; the
//   selection channel sees lost:select, where W(D) was a reading.
// - "witness:project" leaves the witness of an error of elision-only over
//   R, unmapped: a read keeps its index in R, and a close its span there.
// - "order:tags" evaluates a completing item's tag term before its
//   conditions, and "order:conditions" evaluates the conditions that read
//   only captures before those that read `$`, against the order of one step
//   of the recognizer (engine §4). Both apply to every parse, the main parse
//   as well as the check.
//
// F25 finds no query cycle at all while the check runs. A detector that
// finds only some cycles gives the same public result, because the
// recursion meets the same rule and span one level deeper, and only the
// message differs, which no pattern pins. The switch ends the recursion at
// a bound, with an error that is not the library's, and faults.json labels
// that catch "bound".
//
// A fault with several sites names the site where it is checked, and
// `hits` counts each site that a run enters while the fault is on. The
// fault test asserts that the named cases enter every declared site.
//
// A strict and an ordinary prediction of one symbol at one position share
// their items (engine §7.4). So a fault of the strict path (F16, F29, F31,
// F32) shows only where that path is the only one at its position, or
// comes first, and a case that catches it says so. A case for a fault that
// depends on the order of processing comes in both orders.
//
// `hooks.elisionCheck`, when set, receives each check that recognized R
// and met no error of the grammar, before the check ranks, for the witness
// test of tests/README.md. It returns the marks of W(D)'s edges, which the
// check's own ranker takes, and a callback that receives the ranking.
//
// `hooks.work`, when set, counts work for the tests that it grows with the
// input as it should: the items that the recognizer makes, in parses and
// nested parses alike (tests/growth.json), and the checks of maximality in
// nested queries, the items of the chart that they read to find their
// table, and the completions that they read for a tested symbol (engine
// §4). Each is counted where the work is done, as it is done, by
// countWork, which throws a WorkBudget at the first count past the budget
// that `hooks.work.budget` gives it, if any, so that a regression to
// quadratic work stops at once. Unset, a parse counts nothing.
//
// The other kinds count the steps of reads, scans, checks and formatters
// whose work must grow linearly with their input, each where a loop takes
// the step. A loop that rescanned or copied a growing list would count
// the square of the input, so the tests that read these kinds fail on it.
// Tools outside the library count through the same hook.

/** @type {Set<string>} */
export const faults = new Set();

/**
 * How often each site of a fault was entered while that fault was on, by
 * the fault's name, or its name and the site's after an @, for a fault
 * with several sites. The fault test asserts that its named cases enter
 * every declared site (tests/README.md).
 * @type {Map<string, number>}
 */
export const hits = new Map();

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

/**
 * What the witness test hands back to the check: the marks of W(D)'s
 * edges, for each item the indices of the edges that W(D) uses, or null
 * where the chart does not hold W(D); and a callback that receives the
 * check's ranking, with whether its count counted W(D).
 * @typedef {object} ElisionCheckWatch
 * @property {Map<import("./earley.js").Item, Set<number>> | null} marks
 * @property {(outcome: {ranking: import("./rank.js").Ranking | null, counted: boolean}) => void} ranked
 */

/**
 * The counts of `hooks.work`.
 * @typedef {object} WorkCounts
 * @property {number} items the items that the recognizer made
 * @property {number} checks the checks of maximality in nested queries
 * @property {number} scanned the items of the chart that those checks
 *   read to find their table of completions
 * @property {number} candidates the completions that those checks read for
 *   a tested symbol
 * @property {number} captures the captured parts that the recognizer made
 * @property {number} captureSteps the steps that find a captured part from
 *   the last one, or that list every part at once
 * @property {number} captureLookups the entries of a production's captures
 *   that an advance or a formatter reads to find the capture at a position
 * @property {number} edgeChecks the ways of building an item that the
 *   recognizer compares with a new way, to find it already there
 * @property {number} conditions the conditions that an advance reads to
 *   find those ready at its dot
 * @property {number} visits the nodes of conditions and terms that an
 *   evaluation visits, each counted before it is evaluated, also where the
 *   evaluation halts for a nested parse
 * @property {number} soundSteps the tokens that a sound test or phonemes()
 *   visits
 * @property {number} tags the tags that a union of tag sets or an entry of
 *   a classifier adds to a set or copies
 * @property {number} implications the implications that the closure of a
 *   token's tags reads
 * @property {number} walkSteps the steps of the readers and walks of a
 *   document, of its notation's tree and of its DOM, in the library and in
 *   the tools
 * @property {number} lowering the symbols and captures that lowering and
 *   the checks of a definition add to a sequence or copy, the helpers
 *   that lowering moves on its list of those waiting, and the positions,
 *   captures and conditions of a production that it indexes
 * @property {number} closures the productions, alternatives and symbols
 *   that the closures over a grammar's rules read: the nullable rules, the
 *   rules that can read, and those that can emit
 * @property {number} clauses the items of an emission and the alternatives
 *   of a rule that the checks of a definition and the audit read
 * @property {number} splice the names, stages and documents that a splice
 *   of a pipeline checks or copies
 * @property {number} text the characters, words, lines and cells that the
 *   formatters of diagnostics and the tools' scans of a text read
 * @property {Partial<Record<WorkKind, number>>} [budget] the most of each
 *   count that the work may reach
 */

/** @typedef {"items" | "checks" | "scanned" | "candidates" | "captures" | "captureSteps" | "captureLookups" | "edgeChecks" | "conditions" | "visits" | "soundSteps" | "tags" | "implications" | "walkSteps" | "lowering" | "closures" | "clauses" | "splice" | "text"} WorkKind */

/** @type {readonly WorkKind[]} */
export const WORK_KINDS = ["items", "checks", "scanned", "candidates", "captures", "captureSteps", "captureLookups", "edgeChecks", "conditions", "visits", "soundSteps", "tags", "implications", "walkSteps", "lowering", "closures", "clauses", "splice", "text"];

/**
 * Counts of every kind at zero, for a test to set as `hooks.work`.
 * @param {Partial<Record<WorkKind, number>>} [budget]
 * @returns {WorkCounts}
 */
export function newWork(budget) {
  const work = /** @type {WorkCounts} */ ({ budget });
  for (const kind of WORK_KINDS) work[kind] = 0;
  return work;
}

/**
 * A count of `hooks.work` past its budget. It is no GencmuError, so no
 * handler of the library's catches it.
 */
export class WorkBudget extends Error {}

/**
 * Counts one or more of `work`, and throws a WorkBudget if that passes its
 * budget.
 * @param {WorkCounts} work
 * @param {WorkKind} kind
 * @param {number} [steps]
 */
export function countWork(work, kind, steps = 1) {
  const counted = (work[kind] += steps);
  const most = work.budget?.[kind];
  if (most !== undefined && counted > most) throw new WorkBudget(`${counted} ${kind}, past the budget of ${most}`);
}

/** @type {{elisionCheck: ((run: ElisionCheckRun) => ElisionCheckWatch) | null, work: WorkCounts | null}} */
export const hooks = { elisionCheck: null, work: null };

/**
 * Whether a fault is on, at one of its sites. A fault that is on counts the
 * site as entered.
 * @param {string} name
 * @param {string} [site] the site, for a fault with several
 * @returns {boolean}
 */
export function fault(name, site = "") {
  if (faults.size === 0 || !faults.has(name)) return false;
  const key = site === "" ? name : `${name}@${site}`;
  hits.set(key, (hits.get(key) || 0) + 1);
  return true;
}
