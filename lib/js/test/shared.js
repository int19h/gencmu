// Runs the shared test cases of tests/, which every library runs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { Loader, resultJson, toBrackets, Token, GencmuError } from "../src/node.js";
import { isTag } from "../src/tags.js";
import { attached } from "../src/tokens.js";
import { withChecks, keepsWitness } from "./witness.js";

export const repository = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const grammars = path.join(repository, "grammars");

export function readGrammarFile(relative) {
  try {
    return fs.readFileSync(path.join(grammars, ...relative.split("/")), "utf8");
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
  if (Array.isArray(pattern)) {
    return Array.isArray(value) && pattern.length === value.length && pattern.every((item, index) => matches(item, value[index]));
  }
  if (pattern !== null && typeof pattern === "object") {
    return value !== null && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(pattern).every((key) => matches(pattern[key], value[key]));
  }
  return pattern === value;
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
        !Array.isArray(error.readings) || error.readings.length !== 2) {
      problems.push(`the tied stage ${stage.name} lacks its error of kind ambiguous, reason tie and two readings`);
    }
  });
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
  const ambiguous = result.error && (result.error.kind === "ambiguous" || result.error.code !== undefined);
  if (ambiguous || result.stages.some((stage) => stage.verdict === "tie")) problems.push(...resultProblems(resultJson(result)));
  return problems;
}

export function caseTokens(specs) {
  const tokens = [];
  let offset = 0;
  specs.forEach((spec, index) => {
    // Each tag in its canonical spelling, as the output writes it (tests/README.md).
    for (const tag of spec.tags) if (!isTag(tag)) throw new Error(`a case token's tag ${tag} is not a tag`);
    const tags = new Set(spec.tags);
    const length = [...spec.text].length;
    const token = new Token(tags, [index, index + 1], [offset, offset + length], spec.text, spec.phonemes ?? null, undefined);
    // Attachments, which a caller cannot supply, go to the library as they
    // stand, so that it refuses them or drops empty ones (tests/README.md).
    if (spec.before) token.before = caseTokens(spec.before).tokens.map(attached);
    if (spec.after) token.after = caseTokens(spec.after).tokens.map(attached);
    tokens.push(token);
    offset += length + 1;
  });
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
  return { result, json: resultJson(result), brackets: toBrackets(result), features: dialect.features, checks: checks.length, lostWitnesses: checks.filter((run) => !keepsWitness(run)).length };
}

// The members of `expect` that only a loaded dialect can meet.
export const afterLoad = ["result", "brackets", "warnings", "features"];

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
  if (expect.result) {
    assert.ok(matches(expect.result, outcome.json), `${label} result does not match:\n${JSON.stringify(outcome.json, null, 1)}`);
  }
  if (expect.brackets !== undefined) assert.equal(outcome.brackets, expect.brackets, label);
  if (expect.error !== undefined) assert.equal(outcome.json.error && outcome.json.error.kind, expect.error, label);
  else assert.equal(outcome.json.error, null, `${label} unexpected error: ${JSON.stringify(outcome.json.error)}`);
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
  if ("set" in mutant) parent[last] = structuredClone(mutant.set);
  else if ("copy" in mutant) parent[last] = follow(mutant.copy);
  else if ("keep" in mutant) parent[last] = parent[last].slice(0, mutant.keep);
  else if ("remove" in mutant) delete parent[last];
  else if ("append" in mutant) parent[last] = [...parent[last], structuredClone(mutant.append)];
  else throw new Error(`the mutant ${mutant.name} changes nothing`);
  return value;
}
