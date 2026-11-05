// Runs the shared test cases of tests/, which every library runs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { Loader, loadPipeline, bundledPipelines, resultJson, toBrackets, Token, GencmuError } from "../src/node.js";
import { compactJson } from "../src/output.js";
import { runtimeErrorLocations } from "../src/errors.js";
import { attached } from "../src/tokens.js";
import { withChecks, keepsWitness } from "./witness.js";

export const repository = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const grammars = path.join(repository, "grammars");

export function readGrammarFile(relative) {
  try {
    return fs.readFileSync(path.join(repository, relative.split("/").join(path.sep)), "utf8");
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
  if (relative === "data/preparsed/lojban.json") return undefined;
  if (relative === "data/unicode/unicode-names-reference.txt") relative = "data/unicode/unicode-names.txt";
  if (!repositoryFiles.has(relative)) repositoryFiles.set(relative, readGrammarFile(relative));
  return repositoryFiles.get(relative);
});

export function loaderWith(documents) {
  if (["data/unicode/unicode.txt", "data/unicode/unicode-properties.txt", "data/unicode/unicode-names.txt", "data/unicode/unicode-names-reference.txt"].some(key => Object.hasOwn(documents, key))) {
    // A table belongs to one loader. Cases with an override cannot share it.
    return new Loader(relative => {
      if (relative.startsWith("case/")) return documents[relative.slice(5)];
      if (["data/unicode/unicode.txt", "data/unicode/unicode-properties.txt", "data/unicode/unicode-names.txt", "data/unicode/unicode-names-reference.txt"].includes(relative) && Object.hasOwn(documents, relative)) return documents[relative];
      if (relative === "data/unicode/unicode-properties.txt" && Object.hasOwn(documents,"data/unicode/unicode.txt")) return undefined;
      if (relative === "data/preparsed/lojban.json") return undefined;
      if (relative === "data/unicode/unicode-names-reference.txt") relative = "data/unicode/unicode-names.txt";
      return readGrammarFile(relative);
    });
  }
  caseDocuments = documents;
  return sharedLoader;
}

// Fixture control fields are checked before loading or parsing. Token
// payload values stay raw so usage cases reach the library's validation.
const caseRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const caseStrings = value => Array.isArray(value) && value.every(item => typeof item === "string");
function caseMembers(value, keys, label) {
  assert.ok(caseRecord(value), `${label} must be an object`);
  for (const key of Object.keys(value)) assert.ok(keys.includes(key), `${label} has unknown member ${key}`);
}
function caseType(value, key, predicate, label) {
  if (Object.hasOwn(value,key)) assert.ok(predicate(value[key]), `${label}.${key} has the wrong type`);
}
const caseString = value => typeof value === "string";
const caseBoolean = value => typeof value === "boolean";
const casePosition = value => Number.isSafeInteger(value) && value > 0;

export function validateOptions(options) {
  caseMembers(options,["features","withoutFeatures","until","elisionOnly"],"options");
  for (const field of ["features","withoutFeatures"]) caseType(options,field,caseStrings,"options");
  caseType(options,"until",caseString,"options");
  if (Object.hasOwn(options,"until")) assert.ok(options.until.length > 0,"options.until must be nonempty");
  caseType(options,"elisionOnly",caseBoolean,"options");
}

function validateTokenSpecs(specs) {
  assert.ok(Array.isArray(specs),"tokens must be an array");
  const pending = [...specs];
  while (pending.length) {
    const spec = pending.pop();
    caseMembers(spec,["text","tags","span","source","value","image","before","after"],"token");
    for (const side of ["before","after"]) if (Array.isArray(spec[side])) {
      for (const child of spec[side]) pending.push(child);
    }
  }
}

// Error wording belongs to expect.message, outside the result pattern.
export function pinsMessage(pattern) {
  const pending = [[pattern,false]];
  while (pending.length) {
    const [part,inError] = pending.pop();
    if (Array.isArray(part)) for (const child of part) pending.push([child,inError]);
    else if (caseRecord(part)) for (const [key,value] of Object.entries(part)) {
      if (inError && key === "message") return true;
      pending.push([value,key === "error" || (inError && key !== "readings" && key !== "errors")]);
    }
  }
  return false;
}

export function validateExpectation(expect) {
  caseMembers(expect,["result","error","where","diagnostic","message","brackets","warnings","features","enabledFeatures","bundledPipelines"],"expect");
  for (const field of ["error","diagnostic","message","brackets"]) caseType(expect,field,caseString,"expect");
  for (const field of ["enabledFeatures","bundledPipelines"]) caseType(expect,field,caseStrings,"expect");
  assert.ok(!pinsMessage(expect.result),"a result pattern cannot assert an error message");
  if (Object.hasOwn(expect,"where")) {
    caseMembers(expect.where,["document","line","column"],"expect.where");
    assert.equal(typeof expect.where.document,"string","expect.where.document must be a string");
    for (const field of ["line","column"]) caseType(expect.where,field,casePosition,"expect.where");
    assert.equal(expect.error,"grammar","expect.where requires a grammar load error");
  }
  if (Object.hasOwn(expect,"diagnostic")) assert.equal(expect.error,"grammar","expect.diagnostic requires a grammar load error");
  if (Object.hasOwn(expect,"features")) {
    assert.ok(Array.isArray(expect.features),"expect.features must be an array");
    for (const feature of expect.features) {
      caseMembers(feature,["name","kind","default"],"feature");
      assert.ok(caseString(feature.name) && ["gate","warning"].includes(feature.kind) && caseBoolean(feature.default),"malformed feature expectation");
    }
  }
  if (Object.hasOwn(expect,"warnings")) {
    assert.ok(Array.isArray(expect.warnings),"expect.warnings must be an array");
    for (const warning of expect.warnings) {
      caseMembers(warning,["stage","code","rule","span","source","message"],"warning");
      for (const field of ["stage","code","rule","message"]) assert.ok(caseString(warning[field]),`warning.${field} must be a string`);
      for (const field of ["span","source"]) assert.ok(Array.isArray(warning[field]) && warning[field].length === 2 && warning[field].every(Number.isSafeInteger),`warning.${field} must be an integer pair`);
    }
  }
}

export function validateEngineCase(testCase) {
  caseMembers(testCase,["description","grammar","documents","pipelineDocument","pipeline","input","tokens","options","expect","parses","treeRendering"],"case");
  for (const field of ["description","grammar","pipelineDocument","pipeline","input"]) caseType(testCase,field,caseString,"case");
  if (Object.hasOwn(testCase,"documents")) {
    assert.ok(caseRecord(testCase.documents),"documents must be an object");
    for (const text of Object.values(testCase.documents)) assert.ok(caseString(text),"document text must be a string");
  }
  if (Object.hasOwn(testCase,"tokens")) validateTokenSpecs(testCase.tokens);
  if (Object.hasOwn(testCase,"options")) validateOptions(testCase.options);
  if (Object.hasOwn(testCase,"expect")) validateExpectation(testCase.expect);
  if (Object.hasOwn(testCase,"parses")) {
    assert.ok(Array.isArray(testCase.parses) && testCase.parses.length > 0,"parses must be a nonempty array");
    assert.ok(!Object.hasOwn(testCase,"expect") && !Object.hasOwn(testCase,"options"),"parses replaces the case's expect and options");
    for (const run of testCase.parses) {
      caseMembers(run,["options","expect"],"parse");
      if (Object.hasOwn(run,"options")) validateOptions(run.options);
      validateExpectation(run.expect);
    }
  }
  if (Object.hasOwn(testCase,"treeRendering")) {
    const tree = testCase.treeRendering;
    caseMembers(tree,["aliases","text","decodedError"],"treeRendering");
    assert.ok(caseStrings(tree.aliases) && caseString(tree.text) && caseString(tree.decodedError),"malformed tree rendering expectation");
  }
}

export function validateNotationCase(testCase, values = false) {
  caseMembers(testCase,values ? ["id","description","aliases","document","expect"] : ["description","document","expect","cacheMisses"],"notation case");
  for (const field of ["id","description","document"]) caseType(testCase,field,caseString,"notation case");
  assert.ok(caseString(testCase.document),"notation document must be a string");
  caseType(testCase,"cacheMisses",caseBoolean,"notation case");
  if (values) {
    assert.ok(Array.isArray(testCase.aliases),"aliases must be an array");
    for (const alias of testCase.aliases) {
      caseMembers(alias,["spelling","tags","value"],"alias");
      assert.ok(caseString(alias.spelling) && caseStrings(alias.tags) && caseString(alias.value),"malformed alias");
    }
  }
  const expect = testCase.expect;
  caseMembers(expect,values ? ["dom","error","message"] : ["dom","error"],"notation expect");
  assert.notEqual(Object.hasOwn(expect,"dom"),Object.hasOwn(expect,"error"),"notation expect requires exactly one of dom and error");
  if (Object.hasOwn(expect,"dom")) assert.ok(caseRecord(expect.dom),"notation dom pattern must be an object");
  if (Object.hasOwn(expect,"error")) {
    caseMembers(expect.error,values ? ["line","column"] : ["line","column","message"],"notation error");
    for (const field of ["line","column"]) assert.ok(casePosition(expect.error[field]),`notation error.${field} must be a positive integer`);
    if (!values) caseType(expect.error,"message",caseString,"notation error");
  }
  if (Object.hasOwn(expect,"message")) {
    assert.ok(Object.hasOwn(expect,"error"),"notation message requires an error");
    caseType(expect,"message",caseString,"notation expect");
  }
}

export function validateMemoCases(file) {
  caseMembers(file,["description","runs"],"shared memo");
  caseType(file,"description",caseString,"shared memo");
  assert.ok(Array.isArray(file.runs),"memo runs must be an array");
  for (const run of file.runs) {
    caseMembers(run,["grammar","pipeline","inputs","texts","options"],"memo run");
    assert.notEqual(Object.hasOwn(run,"grammar"),Object.hasOwn(run,"pipeline"),"memo run requires grammar or pipeline");
    assert.notEqual(Object.hasOwn(run,"inputs"),Object.hasOwn(run,"texts"),"memo run requires inputs or texts");
    for (const key of ["grammar","pipeline"]) caseType(run,key,caseString,"memo run");
    if (Object.hasOwn(run,"texts")) assert.ok(caseStrings(run.texts),"memo texts must be strings");
    if (Object.hasOwn(run,"inputs")) {
      assert.ok(Array.isArray(run.inputs),"memo inputs must be an array");
      for (const input of run.inputs) validateTokenSpecs(input);
    }
    assert.ok(Array.isArray(run.options),"memo options must be an array");
    for (const options of run.options) validateOptions(options);
  }
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
      for (let index = 0; index < part.length; index++) {
        if (!Object.hasOwn(part,index) || !Object.hasOwn(actual,index)) return false;
        stack.push([part[index], actual[index]]);
      }
    } else if (part !== null && typeof part === "object") {
      if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false;
      for (const key of Object.keys(part)) {
        if (!Object.hasOwn(actual,key)) return false;
        stack.push([part[key], actual[key]]);
      }
    } else if (part !== actual) return false;
  }
  return true;
}

// Whether two JSON values are equal, with object members in any order
// and numbers compared by value. An explicit stack supports deeply nested
// values without recursive calls.
export function sameJson(left, right) {
  const stack = [[left, right]];
  while (stack.length > 0) {
    const [a, b] = stack.pop();
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      for (let index = 0; index < a.length; index++) {
        if (!Object.hasOwn(a,index) || !Object.hasOwn(b,index)) return false;
        stack.push([a[index], b[index]]);
      }
    } else if (a !== null && typeof a === "object") {
      if (b === null || typeof b !== "object" || Array.isArray(b)) return false;
      const keys = Object.keys(a);
      if (keys.length !== Object.keys(b).length) return false;
      for (const key of keys) {
        if (!Object.hasOwn(b, key)) return false;
        stack.push([a[key], b[key]]);
      }
    } else if (a !== b) return false;
  }
  return true;
}

// Exact JSON equality follows tests/README.md, including signed zeros.
export function assertJsonEqual(actual, expected, label = "") {
  if (!sameJson(actual, expected)) assert.fail(`${label} JSON values differ:\nexpected ${compactJson(expected)}\ngot ${compactJson(actual)}`);
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
function namedDiagnostic(diagnostic) {
  const fields=["stage","code","rule","span","source","message"];
  if (!diagnostic || fields.some(key=>!Object.hasOwn(diagnostic,key)) || Object.keys(diagnostic).some(key=>!fields.includes(key))) return false;
  return ["stage","code","rule","message"].every(key=>typeof diagnostic[key]==="string") && diagnostic.code===diagnostic.rule &&
    [diagnostic.span,diagnostic.source].every(range=>Array.isArray(range)&&range.length===2&&Object.hasOwn(range,0)&&Object.hasOwn(range,1)&&range.every(Number.isSafeInteger)&&range[0]>=0&&range[0]<=range[1]);
}

export function resultProblems(json) {
  const problems = [];
  if (json.error && json.error.kind!=="reported" && json.tree!==null) problems.push("an error result other than reported has a tree");
  for (const warning of json.warnings ?? []) if (!namedDiagnostic(warning)) problems.push("a warning lacks its diagnostic fields");
  if (json.error?.kind==="reported") {
    const last=json.stages.at(-1), error=json.error;
    if (json.ok!==false || !json.tree || !last || last.name!==error.stage || !["unique","resolved"].includes(last.verdict) || "output" in last) problems.push("a reported result lacks its retained tree and verdict or has output");
    if (!Array.isArray(error.errors) || !error.errors.length || error.errors.some(diagnostic=>!namedDiagnostic(diagnostic)||diagnostic.stage!==error.stage)) problems.push("a reported result lacks its ordered named errors");
    for (const member of ["token","source","line","column","expected","readings"]) if (member in error) problems.push(`a reported error has the member ${member}`);
  }

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
    if (!last || last.name !== error.stage || !["unique", "resolved"].includes(last.verdict) || "output" in last) {
      problems.push("the stage of the elision-witness-lost error is not the last, unique or resolved, with no output");
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
  for (const member of ["cycle","conflict","chosenReading"]) if (json.error && member in json.error) problems.push(`the error has the member ${member}`);
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
  const problems = ["cycle","conflict","chosenReading"].filter(member => result.error && member in result.error).map(member => `the error has the member ${member}`);
  for (const stage of result.stages) if ("tied" in stage) problems.push(`stage ${stage.name} has a tied tree`);
  for (const diagnostic of [...result.warnings ?? [],...result.error?.errors ?? []]) if (!namedDiagnostic(diagnostic)) problems.push("a report lacks its diagnostic fields");
  const ambiguous = result.error && (result.error.kind === "ambiguous" || result.error.kind==="reported" || result.error.code !== undefined);
  if (result.error && result.error.kind!=="reported" && result.tree!==null) problems.push("an error result other than reported has a tree");
  if (ambiguous || result.warnings?.length || result.stages.some((stage) => stage.verdict === "tie")) for (const problem of resultProblems(resultJson(result))) problems.push(problem);
  return problems;
}

export function caseTokens(specs) {
  // The tokens of one list of specs, each list of attachments with spans
  // and sources of its own, as if it were a text.
  const level = (list) => {
    const tokens = [];
    let offset = 0;
    list.forEach((spec, index) => {
      const tags = Array.isArray(spec.tags) ? new Set(spec.tags) : spec.tags;
      const length = typeof spec.text === "string" ? [...spec.text].length : 0;
      const token = new Token(tags, spec.span === undefined ? [index,index+1] : spec.span,
        spec.source === undefined ? [offset,offset+length] : spec.source,
        spec.text, spec.value === undefined ? spec.text : spec.value, undefined,
        spec.image === undefined ? spec.text : spec.image);
      // The constructor supplies defaults too. Keep invalid present payloads
      // so the public API, rather than this builder, reports their errors.
      for (const field of ["text","value","image","span","source"]) {
        if (Object.hasOwn(spec,field)) token[field] = spec[field];
      }
      tokens.push(token);
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
      if (!Object.hasOwn(task.spec,side)) continue;
      if (!Array.isArray(list)) { task.token[side] = list; continue; }
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
  return parseEngineCase(loaded.pipeline, testCase);
}

// Loads the pipeline of an engine case, or the grammar error.
export function loadEngineCase(testCase) {
  validateEngineCase(testCase);
  assert.equal(["grammar","pipeline","documents"].filter(key => Object.hasOwn(testCase,key)).length,1,"a case needs exactly one grammar source");
  assert.equal(Object.hasOwn(testCase,"documents"),Object.hasOwn(testCase,"pipelineDocument"),"documents requires pipelineDocument");
  let documents = testCase.documents || {};
  let pipeline = testCase.pipelineDocument;
  if (testCase.grammar !== undefined) {
    const rules = testCase.grammar.includes("%ambiguity-resolution") ? testCase.grammar : `%ambiguity-resolution greedy\n${testCase.grammar}`;
    documents = { "main.md": "```jbogenbau\n" + rules + "\n```\n", "pipeline.md": "```jbogenbau\n%stage main\n%include \"main.md\"\n```\n" };
    pipeline = "pipeline.md";
  }
  try {
    return { pipeline: testCase.pipeline !== undefined ? loadPipeline(testCase.pipeline) : loaderWith(documents).pipeline(`case/${pipeline}`) };
  } catch (error) {
    if (error instanceof GencmuError) return { loadError: error };
    throw error;
  }
}

// Parses an engine case's input with a loaded pipeline, under the options of
// `run`, the case itself or one item of its `parses` (tests/README.md).
export function parseEngineCase(pipeline, testCase, run = testCase) {
  validateEngineCase(testCase);
  if (run !== testCase) caseMembers(run,["options","expect"],"parse");
  if (Object.hasOwn(run,"options")) validateOptions(run.options);
  if (Object.hasOwn(run,"expect")) validateExpectation(run.expect);
  const options = {
    features: new Set((run.options && run.options.features) || []),
    withoutFeatures: new Set((run.options && run.options.withoutFeatures) || []),
    elisionOnly: run.options ? run.options.elisionOnly : undefined,
    until: run.options ? run.options.until : undefined,
  };
  let text = testCase.input;
  if (testCase.tokens) {
    const built = caseTokens(testCase.tokens);
    options.tokens = built.tokens;
    text = testCase.input === undefined ? built.text : testCase.input;
  }
  let result;
  let checks;
  try {
    // Every check of elision-only that ran must keep its witness
    // (tests/README.md).
    ({ value: result, checks } = withChecks(() => pipeline.parse(text, options)));
  } catch (error) {
    // A mistake of the caller is an error, not a result (engine §13).
    if (error instanceof GencmuError && error.kind === "usage") return { usageError: error, features: pipeline.features };
    throw error;
  }
  return { result, json: resultJson(result), brackets: toBrackets(result), features: pipeline.features, checks: checks.length, lostWitnesses: checks.filter((run) => !keepsWitness(run)).length };
}

// The members of `expect` that only a loaded pipeline can meet.
export const afterLoad = ["result", "brackets", "warnings", "features", "enabledFeatures"];

// Whether an outcome meets a case's expectation (tests/README.md).
export function checkEngineOutcome(expect, outcome, label) {
  validateExpectation(expect);
  if (expect.bundledPipelines !== undefined) assert.deepEqual(bundledPipelines(),expect.bundledPipelines,label);
  if (outcome.loadError) {
    // A pipeline that does not load gives the error alone, so a case that
    // expects anything that only a loaded pipeline gives fails
    // (tests/README.md).
    assert.equal(outcome.loadError.kind, expect.error, `unexpected load error: ${outcome.loadError.message}`);
    if (expect.message !== undefined) {
      assert.equal(outcome.loadError.description, expect.message, label);
    }
    if (expect.diagnostic !== undefined) assert.equal(outcome.loadError.where.code, expect.diagnostic);
    const loadedOnly = afterLoad.filter((name) => expect[name] !== undefined);
    assert.deepEqual(loadedOnly, [], `the pipeline did not load: ${outcome.loadError.message}`);
    // Where the error stands, in a document of the case, given only for a
    // grammar error (tests/README.md).
    if (expect.where !== undefined) {
      assert.equal(expect.error, "grammar", "expect.where is only for a grammar error");
      const where = outcome.loadError.where;
      assert.deepEqual({ document: where.document, line: where.line, column: where.column },
        { line:expect.where.line, column:expect.where.column, document: ["data/unicode/unicode.txt", "data/unicode/unicode-properties.txt", "data/unicode/unicode-names.txt", "data/unicode/unicode-names-reference.txt"].includes(expect.where.document)
          ? expect.where.document : `case/${expect.where.document}` }, outcome.loadError.message);
    }
    return;
  }
  assert.ok(expect.where === undefined && expect.diagnostic === undefined,"loading expectations require a load error");
  if (expect.features !== undefined) assert.deepEqual(outcome.features, expect.features, label);
  if (outcome.usageError) {
    assert.equal(expect.error, "usage", `${label} unexpected usage error: ${outcome.usageError.message}`);
    for (const field of ["result","brackets","warnings","enabledFeatures","message"]) {
      assert.ok(expect[field] === undefined,`usage errors cannot satisfy expect.${field}`);
    }
    return;
  }
  // The invariants hold of every result, whatever the case expects
  // (tests/README.md).
  assert.deepEqual(resultProblems(outcome.json), [], `${label} breaks an invariant of the result`);
  assert.ok(!witnessLost(outcome.json), `${label} gives the error elision-witness-lost, which no grammar gives`);
  assert.equal(outcome.lostWitnesses, 0, `${label} a check of elision-only lost the witness of its chosen derivation`);
  assert.ok(!Object.hasOwn(outcome.json,"features"), `${label} canonical JSON contains enabled features`);
  if (expect.enabledFeatures !== undefined) assert.deepEqual(outcome.result.features,expect.enabledFeatures,label);
  if (expect.warnings !== undefined) assertJsonEqual(outcome.json.warnings || [], expect.warnings, label);
  // A message is written only for a failure, and by compactJson, since a
  // result can nest deeper than JSON.stringify can write.
  if (expect.result !== undefined && !matches(expect.result, outcome.json)) assert.fail(`${label} result does not match:\n${compactJson(outcome.json)}`);
  if (expect.brackets !== undefined) assert.equal(outcome.brackets, expect.brackets, label);
  if (expect.message !== undefined) {
    const message = outcome.json.error?.message;
    const where = runtimeErrorLocations.get(outcome.result.error);
    const location = where?.document === undefined ? "" : [where.document,where.line,where.column].filter(part=>part!==undefined).join(":");
    const prefix = location ? `${location}: ` : "";
    const reason = prefix && message?.startsWith(prefix) ? message.slice(prefix.length) : message;
    assert.equal(reason, expect.message, label);
  }
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
