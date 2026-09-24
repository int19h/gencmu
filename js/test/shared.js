// Runs the shared test cases of tests/, which every library runs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Loader, resultJson, toBrackets, Token, GencmuError } from "../src/node.js";

export const repository = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
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

export function caseTokens(specs) {
  const tokens = [];
  let offset = 0;
  specs.forEach((spec, index) => {
    const tags = new Map();
    for (const tag of spec.tags) tags.set(tag.startsWith("?") ? tag.slice(1) : tag, !tag.startsWith("?"));
    const length = [...spec.text].length;
    tokens.push(new Token(tags, [index, index + 1], [offset, offset + length], spec.text, spec.phonemes ?? null, undefined));
    offset += length + 1;
  });
  return { tokens, text: specs.map((spec) => spec.text).join(" ") };
}

// Runs one engine case: the canonical result, the brackets and the error
// kind, or the grammar error.
export function runEngineCase(testCase) {
  let documents = testCase.documents || {};
  let pipeline = testCase.pipeline;
  if (testCase.grammar !== undefined) {
    const rules = testCase.grammar.includes("%ambiguity-resolution") ? testCase.grammar : `%ambiguity-resolution greedy ;\n${testCase.grammar}`;
    documents = { "main.md": "```ebnf\n" + rules + "\n```\n", "pipeline.md": "## Main <?stage main?>\n\n- [main](main.md) <?grammar?>\n" };
    pipeline = "pipeline.md";
  }
  let dialect;
  try {
    dialect = loaderWith(documents).dialect(`case/${pipeline}`);
  } catch (error) {
    if (error instanceof GencmuError) return { loadError: error };
    throw error;
  }
  const options = {
    features: new Set((testCase.options && testCase.options.features) || []),
    elisionOnly: testCase.options ? testCase.options.elisionOnly : undefined,
    autoFeatures: Boolean(testCase.options && testCase.options.autoFeatures),
  };
  let text = testCase.input;
  if (testCase.tokens) {
    const built = caseTokens(testCase.tokens);
    options.tokens = built.tokens;
    text = built.text;
  }
  const result = dialect.parse(text, options);
  return { result, json: resultJson(result), brackets: toBrackets(result) };
}
