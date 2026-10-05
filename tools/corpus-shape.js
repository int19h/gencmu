// Whether every corpus case has the shape that tests/README.md ("Corpus
// cases") gives it. The runners of the four libraries compare the fields of
// a case in their own ways, and they differ on input that the format does
// not allow, such as a field whose value is null, a member name that an
// object has twice (the Rust test reader keeps the first, the others the
// last), or a string that is not a sequence of Unicode scalar values (Go
// replaces a lone surrogate with U+FFFD). So the shape is checked once,
// here, and the runners never see such input. tools/sync.js --check runs
// it.
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
  if (typeof c !== "object" || c === null || Array.isArray(c)) return ["not a JSON object"];
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
      if (typeof error !== "object" || error === null || error.kind !== "ambiguous" || !["tie", "elision-only"].includes(/** @type {string} */ (error.reason)) || Object.keys(error).length !== 2) problems.push('error is not {"kind": "ambiguous", "reason": "tie" or "elision-only"}');
      if ("at" in c) problems.push("an ambiguous case has at");
    } else if (!Number.isInteger(c.at) || /** @type {number} */ (c.at) < 0) problems.push("a rejected case has no at, a position counted from 0");
  } else problems.push("expect is neither accept nor reject");
  if ("seeded" in c && !("reason" in c)) problems.push("seeded needs a reason");
  if ("reason" in c && typeof c.reason !== "string") problems.push("reason is not a string");
  if ("seeded" in c && !["accept", "reject"].includes(/** @type {string} */ (c.seeded))) problems.push("seeded is neither accept nor reject");
  return problems;
}

/**
 * The member names that an object of a JSON text has twice, at any depth,
 * each as its path from the top, such as `at` or `error.kind`. The text
 * must be valid JSON. Two names are the same when their values are, so
 * `"a"` and `"\u0061"` are one name.
 * @param {string} json
 * @returns {string[]}
 */
export function duplicateMembers(json) {
  const found = [];
  /** @type {{object: boolean, path: string, names: Set<string>, name: string | null, expectName: boolean, index: number}[]} */
  const stack = [];
  const childPath = () => {
    const parent = stack[stack.length - 1];
    if (!parent) return "";
    const step = parent.object ? String(parent.name) : `[${parent.index}]`;
    return parent.path ? (parent.object ? `${parent.path}.${step}` : `${parent.path}${step}`) : step;
  };
  for (let at = 0; at < json.length; at++) {
    const char = json[at];
    if (char === '"') {
      let end = at + 1;
      while (json[end] !== '"') end += json[end] === "\\" ? 2 : 1;
      const top = stack[stack.length - 1];
      if (top && top.object && top.expectName) {
        const name = JSON.parse(json.slice(at, end + 1));
        if (top.names.has(name)) found.push(top.path ? `${top.path}.${name}` : name);
        top.names.add(name);
        top.name = name;
        top.expectName = false;
      }
      at = end;
    } else if (char === "{" || char === "[") {
      stack.push({ object: char === "{", path: childPath(), names: new Set(), name: null, expectName: char === "{", index: 0 });
    } else if (char === "}" || char === "]") stack.pop();
    else if (char === ",") {
      const top = stack[stack.length - 1];
      if (top.object) top.expectName = true;
      else top.index++;
    }
  }
  return found;
}

/**
 * The strings of a JSON value, member names included, that are not
 * sequences of Unicode scalar values: those with a lone surrogate.
 * @param {unknown} value
 * @returns {string[]} each as JSON
 */
export function illFormedStrings(value) {
  const found = [];
  // The values still to visit, the next one last. An explicit stack, since
  // a JSON value can nest deeper than the call stack allows.
  /** @type {unknown[]} */
  const stack = [value];
  while (stack.length > 0) {
    const item = stack.pop();
    if (typeof item === "string") {
      if (!item.isWellFormed()) found.push(JSON.stringify(item));
    } else if (Array.isArray(item)) {
      for (let index = item.length - 1; index >= 0; index--) stack.push(item[index]);
    } else if (item && typeof item === "object") {
      const entries = Object.entries(item);
      for (let index = entries.length - 1; index >= 0; index--) stack.push(entries[index][1], entries[index][0]);
    }
  }
  return found;
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
    const bytes = fs.readFileSync(path.join(corpus, file));
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      // The runners would read the file in different ways.
      problems.push(`tests/corpus/${file}: not UTF-8`);
      continue;
    }
    text.split("\n").forEach((line, index) => {
      if (!line.trim()) return;
      const at = `tests/corpus/${file}:${index + 1}`;
      let c;
      try {
        c = JSON.parse(line);
      } catch (error) {
        problems.push(`${at}: not JSON: ${error.message}`);
        return;
      }
      const id = c && typeof c === "object" && typeof c.id === "string" ? `${c.id}: ` : "";
      for (const name of duplicateMembers(line)) problems.push(`${at}: ${id}the member name ${name} stands twice in its object`);
      for (const string of illFormedStrings(c)) problems.push(`${at}: ${id}the string ${string} is not a sequence of Unicode scalar values`);
      for (const problem of caseShapeProblems(c)) problems.push(`${at}: ${id}${problem}`);
    });
  }
  return problems;
}

/** The changes that a result mutant can make (tests/README.md, "Result mutants"). */
export const CHANGES = ["set", "copy", "keep", "remove", "append"];

/**
 * Whether a value is a path of tests/result-mutants.json: a list of steps,
 * each a member name or an index into a list, where -1 is the last element
 * and no other negative index is defined.
 * @param {unknown} path
 */
const isPath = (path) => Array.isArray(path) && path.length > 0 && path.every((step) => typeof step === "string" || (Number.isInteger(step) && step >= -1));

/**
 * The problems of the shape of the result mutants of a repository
 * (tests/result-mutants.json), as messages. The four runners apply each
 * mutant with their own code, and they differ on a path that the README
 * does not define, such as an index below -1, or a `remove` of a list's
 * element. So, as with the corpus, the shape is checked once, here.
 * @param {string} base the repository
 * @returns {string[]}
 */
export function mutantShapeProblems(base) {
  const file = "tests/result-mutants.json";
  const text = fs.readFileSync(path.join(base, file), "utf8");
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return [`${file}: not JSON: ${error.message}`];
  }
  const problems = [];
  for (const name of duplicateMembers(text)) problems.push(`${file}: the member name ${name} stands twice in its object`);
  for (const string of illFormedStrings(value)) problems.push(`${file}: the string ${string} is not a sequence of Unicode scalar values`);
  const mutants = value && typeof value === "object" ? value.mutants : undefined;
  // An empty list would let every runner pass with nothing to refuse.
  if (!Array.isArray(mutants) || !mutants.length) return [...problems, `${file}: mutants is not a list with at least one mutant`];
  mutants.forEach((mutant, index) => {
    const at = `${file}: mutant ${index}`;
    if (typeof mutant !== "object" || mutant === null || Array.isArray(mutant)) {
      problems.push(`${at}: not a JSON object`);
      return;
    }
    for (const key of Object.keys(mutant)) if (!["name", "case", "path", ...CHANGES].includes(key)) problems.push(`${at}: an unknown field ${key}`);
    if (typeof mutant.name !== "string") problems.push(`${at}: name is not a string`);
    if (typeof mutant.case !== "string" || !fs.existsSync(path.join(base, "tests", "engine", mutant.case))) problems.push(`${at}: case names no file under tests/engine`);
    if (!isPath(mutant.path)) problems.push(`${at}: path is not a list of member names and indices of -1 or more`);
    const changes = CHANGES.filter((change) => change in mutant);
    if (changes.length !== 1) {
      problems.push(`${at}: it has ${changes.length} changes, not one of ${CHANGES.join(", ")}`);
      return;
    }
    if ("copy" in mutant && !isPath(mutant.copy)) problems.push(`${at}: copy is not a path`);
    if ("keep" in mutant && !(Number.isInteger(mutant.keep) && mutant.keep >= 0)) problems.push(`${at}: keep is not a length`);
    if ("remove" in mutant && (mutant.remove !== true || !isPath(mutant.path) || typeof mutant.path[mutant.path.length - 1] !== "string")) problems.push(`${at}: remove is not true at a member name`);
  });
  return problems;
}
