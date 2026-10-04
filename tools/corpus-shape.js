// Whether every corpus case has the shape that tests/README.md ("Corpus
// cases") gives it. The runners of the four libraries compare the fields of
// a case in their own ways, and they differ on input that the format does
// not allow, such as a field whose value is null. So the shape is checked
// once, here, and the runners never see such input. tools/sync.js --check
// runs it.
import fs from "node:fs";
import path from "node:path";

/** The fields that a case can have. */
export const FIELDS = ["id", "text", "dialect", "features", "withoutFeatures", "expect", "verdict", "stage", "at", "error", "ties", "words", "brackets", "seeded", "reason"];

const strings = (/** @type {unknown} */ value) => Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * The problems of one case, as messages.
 * @param {Record<string, unknown>} c
 * @returns {string[]}
 */
export function caseShapeProblems(c) {
  const problems = [];
  for (const [key, value] of Object.entries(c)) {
    if (!FIELDS.includes(key)) problems.push(`an unknown field ${key}`);
    if (value === null) problems.push(`${key} is null`);
  }
  for (const key of ["id", "text", "dialect"]) if (typeof c[key] !== "string") problems.push(`${key} is not a string`);
  for (const key of ["features", "withoutFeatures", "ties", "words"]) if (key in c && !strings(c[key])) problems.push(`${key} is not a list of strings`);
  if (c.expect === "accept") {
    if (typeof c.verdict !== "string" || typeof c.brackets !== "string") problems.push("an accepted case has no verdict or no brackets");
    for (const key of ["stage", "at", "error"]) if (key in c) problems.push(`an accepted case has ${key}`);
  } else if (c.expect === "reject") {
    if (typeof c.stage !== "string") problems.push("a rejected case has no stage");
    for (const key of ["verdict", "brackets"]) if (key in c) problems.push(`a rejected case has ${key}`);
    // A rejection has a position, and an ambiguity has none.
    if ("error" in c) {
      const error = /** @type {Record<string, unknown>} */ (c.error);
      if (typeof error !== "object" || error.kind !== "ambiguous" || !["tie", "elision-only"].includes(/** @type {string} */ (error.reason)) || Object.keys(error).length !== 2) problems.push('error is not {"kind": "ambiguous", "reason": "tie" or "elision-only"}');
      if ("at" in c) problems.push("an ambiguous case has at");
    } else if (!Number.isInteger(c.at) || /** @type {number} */ (c.at) < 0) problems.push("a rejected case has no at, a position counted from 0");
  } else problems.push("expect is neither accept nor reject");
  if (("seeded" in c) !== ("reason" in c)) problems.push("seeded and reason come together");
  if ("seeded" in c && !["accept", "reject"].includes(/** @type {string} */ (c.seeded))) problems.push("seeded is neither accept nor reject");
  return problems;
}

/**
 * Every problem of the shape of the corpus cases under `base`, as
 * "FILE:LINE: ID: ...".
 * @param {string} base the repository
 * @returns {string[]}
 */
export function corpusShapeProblems(base) {
  const problems = [];
  const corpus = path.join(base, "tests", "corpus");
  for (const file of fs.readdirSync(corpus).filter((name) => name.endsWith(".jsonl")).sort()) {
    fs.readFileSync(path.join(corpus, file), "utf8").split("\n").forEach((line, index) => {
      if (!line.trim()) return;
      const at = `tests/corpus/${file}:${index + 1}`;
      let c;
      try {
        c = JSON.parse(line);
      } catch (error) {
        problems.push(`${at}: not JSON: ${error.message}`);
        return;
      }
      for (const problem of caseShapeProblems(c)) problems.push(`${at}: ${c.id}: ${problem}`);
    });
  }
  return problems;
}
