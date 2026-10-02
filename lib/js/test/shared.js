// Runs the shared test cases of tests/, which every library runs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Loader, resultJson, toBrackets, Token, GencmuError } from "../src/node.js";
import { isTag } from "../src/tags.js";
import { attached } from "../src/tokens.js";

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

// The invariants of a tie (resultProblems) for a corpus case's result. The
// canonical result is built only where a stage ties, since a corpus text
// can be long, and the parse result itself must hold no tied tree either.
export function corpusResultProblems(result) {
  const problems = result.stages.filter((stage) => "tied" in stage).map((stage) => `stage ${stage.name} has a tied tree`);
  if (result.stages.some((stage) => stage.verdict === "tie")) problems.push(...resultProblems(resultJson(result)));
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
  try {
    result = dialect.parse(text, options);
  } catch (error) {
    // A mistake of the caller is an error, not a result (engine §13).
    if (error instanceof GencmuError && error.kind === "usage") return { usageError: error, features: dialect.features };
    throw error;
  }
  return { result, json: resultJson(result), brackets: toBrackets(result), features: dialect.features };
}
