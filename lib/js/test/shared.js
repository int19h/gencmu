// Runs the shared test cases of tests/, which every library runs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { Loader, resultJson, toBrackets, Token, GencmuError } from "../src/node.js";
import { compactJson } from "../src/output.js";
import { isTag } from "../src/tags.js";
import { attached } from "../src/tokens.js";
import { withChecks, keepsWitness } from "./witness.js";

export const repository = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const grammars = path.join(repository, "grammars");

export function readGrammarFile(relative) {
  try {
    return fs.readFileSync(path.join(grammars, relative.split("/").join(path.sep)), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

// A loader that reads the repository's grammars and, under `case/`, a
// case's own documents. One loader serves every case, since building one
// reads the Unicode table and the bootstrap, and its cache is keyed by each
// document's text as well as its path.
let caseDocuments = {};
const repositoryFiles = new Map();
const sharedLoader = new Loader((relative) => {
  if (relative.startsWith("case/")) return caseDocuments[relative.slice(5)];
  if (relative === "compiled.json") return undefined;
  if (!repositoryFiles.has(relative)) repositoryFiles.set(relative, readGrammarFile(relative));
  return repositoryFiles.get(relative);
});

export function loaderWith(documents) {
  caseDocuments = documents;
  return sharedLoader;
}

// Whether a value matches a pattern (tests/README.md).
export function matches(pattern, value) {
  // The pairs still to compare, with an explicit stack, since an expected
  // tree can nest as deep as a long text is long.
  const stack = [[pattern, value]];
  while (stack.length > 0) {
    const [part, actual] = stack.pop();
    if (Array.isArray(part)) {
      if (!Array.isArray(actual) || part.length !== actual.length) return false;
      part.forEach((item, index) => stack.push([item, actual[index]]));
    } else if (part !== null && typeof part === "object") {
      if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false;
      for (const key of Object.keys(part)) stack.push([part[key], actual[key]]);
    } else if (part !== actual) return false;
  }
  return true;
}

// Whether two JSON values are equal, members in any order, as
// assert.deepStrictEqual compares them. It keeps an explicit stack, since a
// value can nest as deep as a long text is long, and deepStrictEqual
// recurses.
export function sameJson(left, right) {
  const stack = [[left, right]];
  while (stack.length > 0) {
    const [a, b] = stack.pop();
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      a.forEach((item, index) => stack.push([item, b[index]]));
    } else if (a !== null && typeof a === "object") {
      if (b === null || typeof b !== "object" || Array.isArray(b)) return false;
      const keys = Object.keys(a);
      if (keys.length !== Object.keys(b).length) return false;
      for (const key of keys) {
        if (!Object.hasOwn(b, key)) return false;
        stack.push([a[key], b[key]]);
      }
    } else if (!Object.is(a, b)) return false;
  }
  return true;
}

// A copy of a JSON value. structuredClone recurses, and a value can nest
// deeper than the call stack allows. compactJson and JSON.parse do not
// recurse.
export function copyJson(value) {
  return JSON.parse(compactJson(value));
}

// What a canonical result breaks of the invariants that every runner checks
// on every engine case, whatever the case expects (tests/README.md): an
// ambiguous error has no token or source, no stage has a tied tree, and a
// stage whose verdict is tie has no output, comes last, and has the
// result's ambiguous error with two readings.
export function resultProblems(json) {
  const problems = [];
  // An ambiguous error has no position (docs/output.md, engine §7).
  if (json.error && json.error.kind === "ambiguous") {
    for (const member of ["token", "source"]) if (member in json.error) problems.push(`the ambiguous error has a member ${member}`);
  }
  // An error that loses the witness of elision-only is a grammar error of
  // the last stage, with its chosen tree and completion, and nothing else
  // (engine §7.9).
  if (json.error && json.error.code === "elision-witness-lost") {
    const error = json.error;
    if (error.kind !== "grammar" || typeof error.stage !== "string" || !("chosen" in error) || !Array.isArray(error.completion)) {
      problems.push("the elision-witness-lost error lacks its kind grammar, stage, chosen or completion");
    }
    for (const member of ["token", "source", "line", "column", "expected", "reason", "readings"]) {
      if (member in error) problems.push(`the elision-witness-lost error has a member ${member}`);
    }
    const last = json.stages[json.stages.length - 1];
    if (!last || last.name !== error.stage || last.verdict !== "resolved" || "output" in last) {
      problems.push("the stage of the elision-witness-lost error is not the last, resolved, with no output");
    }
  }
  json.stages.forEach((stage, index) => {
    if ("tied" in stage) problems.push(`stage ${stage.name} has a tied tree`);
    if (stage.verdict !== "tie") return;
    if ("output" in stage) problems.push(`the tied stage ${stage.name} has output`);
    if (index !== json.stages.length - 1) problems.push(`a stage runs after the tied stage ${stage.name}`);
    const error = json.error;
    if (json.ok !== false || json.tree !== null || !error || error.kind !== "ambiguous" || error.reason !== "tie" || error.stage !== stage.name ||
        !Array.isArray(error.readings) || (!error.cycle && error.readings.length !== 2)) {
      problems.push(`the tied stage ${stage.name} lacks its error of kind ambiguous, reason tie and two readings`);
    }
  });
  const cycle = json.error?.cycle;
  if (cycle) {
    const error = json.error;
    if (!Array.isArray(error.readings) || error.readings.length < 3) problems.push("a cycle needs at least three readings");
    if (!Array.isArray(cycle) || cycle.length < 3) problems.push("a cycle needs at least three edges");
    else {
      const vertices = new Set();
      for (let i = 0; i < cycle.length; i++) {
        const edge = cycle[i];
        if (!Number.isInteger(edge.from) || !Number.isInteger(edge.to) || edge.from < 0 || edge.to < 0 ||
            edge.from >= (error.readings?.length || 0) || edge.to >= (error.readings?.length || 0)) problems.push("a cycle index is out of range");
        if (edge.to !== cycle[(i + 1) % cycle.length].from) problems.push("cycle edges do not connect");
        if (vertices.has(edge.from)) problems.push("a cycle repeats a vertex");
        vertices.add(edge.from);
        if (!["prefer", "stage"].includes(edge.basis)) problems.push("a cycle edge lacks its reason");
        if (edge.basis === "prefer" && (!Array.isArray(edge.contests) || !edge.contests.length)) problems.push("a preference edge lacks contests");
        if (edge.basis === "stage" && (!["late-elision", "greedy", "lazy"].includes(edge.directive) ||
            (edge.directive === "late-elision" ? !Number.isInteger(edge.boundary) || edge.boundary < 0 || !Array.isArray(edge.counts) || edge.counts.length !== 2 : !Array.isArray(edge.witness) || edge.witness.length !== 2))) problems.push("a stage edge lacks its directive witness");
        for (const contest of edge.contests || []) {
          if (!Array.isArray(contest.span) || contest.span.length !== 2 || contest.span[0] >= contest.span[1] ||
              !Array.isArray(contest.path) || contest.path.length < 2 || contest.path[0] !== contest.higher || contest.path.at(-1) !== contest.lower ||
              !Array.isArray(contest.residualCounts) || contest.residualCounts.length !== 2) problems.push("a preference contest is malformed");
        }
        for (const count of edge.counts || []) if (typeof count !== "string" || !/^(0|[1-9][0-9]*)$/.test(count)) problems.push("a cycle count is not an exact integer string");
        for (const contest of edge.contests || []) for (const count of contest.residualCounts || []) if (typeof count !== "string" || !/^[1-9][0-9]*$/.test(count)) problems.push("a residual count is not a positive integer string");
      }
    }
    if ("witness" in error || json.stages.some((stage) => "witness" in stage)) problems.push("a cycle has a pairwise witness");
    if (error.reason === "elision-only" && error.chosenReading !== 0) problems.push("a reconstruction cycle lacks its chosen reading index");
  }
  return problems;
}

// Whether a result has the error elision-witness-lost. No grammar gives
// it (engine §7.8), so a shared case or a corpus case that gives it fails,
// whatever it expects (tests/README.md). The library's own tests that lose
// the witness on purpose do not run through the runner.
export function witnessLost(json) {
  return Boolean(json.error && json.error.code === "elision-witness-lost");
}

// The invariants of a tie (resultProblems) for a corpus case's result. The
// canonical result is built only where a stage ties or the error is
// ambiguous, since a corpus text can be long, and the parse result itself
// must hold no tied tree either.
export function corpusResultProblems(result) {
  const problems = result.stages.filter((stage) => "tied" in stage).map((stage) => `stage ${stage.name} has a tied tree`);
  if (result.error?.cycle && (result.error.witness != null || result.stages.some((stage) => stage.witness != null))) problems.push("a cycle has a pairwise witness");
  const ambiguous = result.error && (result.error.kind === "ambiguous" || result.error.code !== undefined);
  if (ambiguous || result.stages.some((stage) => stage.verdict === "tie")) for (const problem of resultProblems(resultJson(result))) problems.push(problem);
  return problems;
}

export function caseTokens(specs) {
  // The tokens of one list of specs, each list of attachments with spans
  // and sources of its own, as if it were a text.
  const level = (list) => {
    const tokens = [];
    let offset = 0;
    list.forEach((spec, index) => {
      // Each tag in its canonical spelling, as the output writes it (tests/README.md).
      for (const tag of spec.tags) if (!isTag(tag)) throw new Error(`a case token's tag ${tag} is not a tag`);
      const tags = new Set(spec.tags);
      const length = [...spec.text].length;
      tokens.push(new Token(tags, [index, index + 1], [offset, offset + length], spec.text, spec.phonemes ?? null, undefined));
      offset += length + 1;
    });
    return tokens;
  };
  const tokens = level(specs);
  // Attachments, which a caller cannot supply, go to the library as they
  // stand, so that it refuses them or drops empty ones (tests/README.md).
  // An explicit stack gives each token its attachments, which can nest
  // deeper than the call stack.
  const stack = tokens.map((token, index) => ({ token, spec: specs[index] }));
  for (let task = stack.pop(); task !== undefined; task = stack.pop()) {
    for (const side of /** @type {const} */ (["before", "after"])) {
      const list = task.spec[side];
      if (!list) continue;
      const inner = level(list).map(attached);
      inner.forEach((token, index) => stack.push({ token, spec: list[index] }));
      task.token[side] = inner;
    }
  }
  return { tokens, text: specs.map((spec) => spec.text).join(" ") };
}

// Runs one engine case: the canonical result, the brackets and the error
// kind, or the grammar error.
export function runEngineCase(testCase) {
  const loaded = loadEngineCase(testCase);
  if (loaded.loadError) return loaded;
  return parseEngineCase(loaded.dialect, testCase);
}

// Loads the dialect of an engine case, or the grammar error.
export function loadEngineCase(testCase) {
  let documents = testCase.documents || {};
  let pipeline = testCase.pipeline;
  if (testCase.grammar !== undefined) {
    const rules = testCase.grammar.includes("%ambiguity-resolution") ? testCase.grammar : `%ambiguity-resolution greedy\n${testCase.grammar}`;
    documents = { "main.md": "```jbogenbau\n" + rules + "\n```\n", "pipeline.md": "```jbogenbau\n%stage main\n%include \"main.md\"\n```\n" };
    pipeline = "pipeline.md";
  }
  try {
    return { dialect: loaderWith(documents).dialect(`case/${pipeline}`) };
  } catch (error) {
    if (error instanceof GencmuError) return { loadError: error };
    throw error;
  }
}

// Parses an engine case's input with a loaded dialect, under the options of
// `run`, the case itself or one item of its `parses` (tests/README.md).
export function parseEngineCase(dialect, testCase, run = testCase) {
  const options = {
    features: new Set((run.options && run.options.features) || []),
    withoutFeatures: new Set((run.options && run.options.withoutFeatures) || []),
    elisionOnly: run.options ? run.options.elisionOnly : undefined,
    autoFeatures: Boolean(run.options && run.options.autoFeatures),
    until: run.options ? run.options.until : undefined,
  };
  let text = testCase.input;
  if (testCase.tokens) {
    const built = caseTokens(testCase.tokens);
    options.tokens = built.tokens;
    text = built.text;
  }
  let result;
  let checks;
  try {
    // Every check of elision-only that ran must keep its witness
    // (tests/README.md).
    ({ value: result, checks } = withChecks(() => dialect.parse(text, options)));
  } catch (error) {
    // A mistake of the caller is an error, not a result (engine §13).
    if (error instanceof GencmuError && error.kind === "usage") return { usageError: error, features: dialect.features };
    throw error;
  }
  return { result, json: resultJson(result), brackets: toBrackets(result), features: dialect.features, loadWarnings: dialect.loadWarnings, checks: checks.length, lostWitnesses: checks.filter((run) => !keepsWitness(run)).length };
}

// The members of `expect` that only a loaded dialect can meet.
export const afterLoad = ["result", "brackets", "warnings", "features", "loadWarnings"];

// Whether an outcome meets a case's expectation (tests/README.md).
export function checkEngineOutcome(expect, outcome, label) {
  if (outcome.loadError) {
    // A dialect that does not load gives the error alone, so a case that
    // expects anything that only a loaded dialect gives fails
    // (tests/README.md).
    assert.equal(outcome.loadError.kind, expect.error, `unexpected load error: ${outcome.loadError.message}`);
    const loadedOnly = afterLoad.filter((name) => expect[name] !== undefined);
    assert.deepEqual(loadedOnly, [], `the dialect did not load: ${outcome.loadError.message}`);
    // Where the error stands, in a document of the case, given only for a
    // grammar error (tests/README.md).
    if (expect.where !== undefined) {
      assert.equal(expect.error, "grammar", "expect.where is only for a grammar error");
      const where = outcome.loadError.where;
      assert.deepEqual({ document: where.document, line: where.line, column: where.column },
        { ...expect.where, document: `case/${expect.where.document}` }, outcome.loadError.message);
    }
    return;
  }
  if (expect.features !== undefined) assert.deepEqual(outcome.features, expect.features, label);
  if (expect.loadWarnings !== undefined) assert.ok(matches(expect.loadWarnings, outcome.loadWarnings), label);
  if (outcome.usageError) {
    assert.equal(expect.error, "usage", `${label} unexpected usage error: ${outcome.usageError.message}`);
    return;
  }
  // The invariants hold of every result, whatever the case expects
  // (tests/README.md).
  assert.deepEqual(resultProblems(outcome.json), [], `${label} breaks an invariant of the result`);
  assert.ok(!witnessLost(outcome.json), `${label} gives the error elision-witness-lost, which no grammar gives`);
  assert.equal(outcome.lostWitnesses, 0, `${label} a check of elision-only lost the witness of its chosen derivation`);
  if (expect.warnings !== undefined) assert.deepEqual(outcome.json.warnings || [], expect.warnings, label);
  // A message is written only for a failure, and by compactJson, since a
  // result can nest deeper than JSON.stringify can write.
  if (expect.result && !matches(expect.result, outcome.json)) assert.fail(`${label} result does not match:\n${compactJson(outcome.json)}`);
  if (expect.brackets !== undefined) assert.equal(outcome.brackets, expect.brackets, label);
  if (expect.error !== undefined) assert.equal(outcome.json.error && outcome.json.error.kind, expect.error, label);
  else if (outcome.json.error !== null) assert.fail(`${label} unexpected error: ${compactJson(outcome.json.error)}`);
}

// The changes to a canonical result that break an invariant
// (tests/README.md, "Result mutants"), each with its engine case.
export function resultMutants() {
  const { mutants } = JSON.parse(fs.readFileSync(path.join(repository, "tests", "result-mutants.json"), "utf8"));
  // An empty list would pass every runner with nothing refused.
  if (!Array.isArray(mutants) || !mutants.length) throw new Error("tests/result-mutants.json has no mutant");
  return mutants.map((mutant) => ({ ...mutant, engineCase: JSON.parse(fs.readFileSync(path.join(repository, "tests", "engine", mutant.case), "utf8")) }));
}

// Applies a mutant to a result, in place: the canonical result, or the
// library's own, whose members have the same names. A path step of -1 is the
// last element of a list.
export function applyMutant(value, mutant) {
  const at = (target, step) => (step === -1 ? target.length - 1 : step);
  const follow = (steps) => steps.reduce((target, step) => target[at(target, step)], value);
  const parent = follow(mutant.path.slice(0, -1));
  const last = at(parent, mutant.path[mutant.path.length - 1]);
  if ("set" in mutant) parent[last] = copyJson(mutant.set);
  else if ("copy" in mutant) parent[last] = follow(mutant.copy);
  else if ("keep" in mutant) parent[last] = parent[last].slice(0, mutant.keep);
  else if ("remove" in mutant) delete parent[last];
  else if ("append" in mutant) parent[last] = [...parent[last], copyJson(mutant.append)];
  else throw new Error(`the mutant ${mutant.name} changes nothing`);
  return value;
}

// ---- Places in the shared fixtures (tests/README.md, "Places in fixtures")

/** In a fixture's `find` and `replace`, a source position of any value. */
const ANY_POSITION = '"at":[*]';

/**
 * Every place where a fixture's `find` stands in `text`, with the source
 * positions that its wildcards stand for, as "LINE,COLUMN".
 * @param {string} text
 * @param {string} find
 * @returns {{start: number, end: number, positions: string[]}[]}
 */
export function findPlaces(text, find) {
  const [first, ...rest] = find.split(ANY_POSITION);
  const places = [];
  // indexOf of an empty text past the end gives the end, so the search
  // stops there.
  for (let start = text.indexOf(first); start !== -1; start = start < text.length ? text.indexOf(first, start + 1) : -1) {
    let at = start + first.length;
    const positions = [];
    for (const piece of rest) {
      const position = /^"at":\[(\d+,\d+)\]/.exec(text.slice(at, at + 32));
      if (!position || !text.startsWith(piece, at + position[0].length)) break;
      positions.push(position[1]);
      at += position[0].length + piece.length;
    }
    if (positions.length === rest.length) places.push({ start, end: at, positions });
  }
  return places;
}

/**
 * `text` with the first place of `find` replaced by `replace`, whose
 * wildcards take the positions of those of `find`, in order.
 * @param {string} text
 * @param {string} find
 * @param {string} replace
 */
export function substitute(text, find, replace) {
  const [place] = findPlaces(text, find);
  if (!place) throw new Error(`the fixture's find is not in the text: ${find}`);
  const [first, ...rest] = replace.split(ANY_POSITION);
  if (rest.length > place.positions.length) throw new Error(`the fixture's replace has more wildcards than its find: ${replace}`);
  return text.slice(0, place.start) + first + rest.map((piece, index) => `"at":[${place.positions[index]}]${piece}`).join("") + text.slice(place.end);
}

/**
 * The line and column, counted from 1, where `needle` stands in `text`. It
 * must stand there exactly once, and a second place may overlap the first. A line ends at CR LF, CR or LF, and a
 * column counts code points.
 * @param {string} text
 * @param {string} needle
 * @returns {{line: number, column: number}}
 */
export function positionOf(text, needle) {
  if (needle === "") throw new Error("an empty text stands everywhere in the document");
  const first = text.indexOf(needle);
  if (first === -1 || text.indexOf(needle, first + 1) !== -1) throw new Error(`${JSON.stringify(needle)} stands ${first === -1 ? "nowhere" : "more than once"} in the document`);
  const lines = text.slice(0, first).split(/\r\n|\r|\n/);
  return { line: lines.length, column: [...lines[lines.length - 1]].length + 1 };
}
