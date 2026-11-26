// Runs the shared cases of tests/engine and tests/notation on the format 50
// loader. The translator of tools/translate-shared-cases.js gives each case
// its format 50 source and its expectation. shared50.test.js runs them under
// node --test. Run this file directly to print one line for each case:
//
//   node test/shared50.js engine|notation [START [COUNT]]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GencmuError } from "../src/errors.js";
import { Loader50 } from "../src/format50/loader.js";
import { loaderForNotation } from "../src/node.js";
import { validPipelineName } from "../src/resources.js";
import { resultRecord } from "../src/format50/result.js";
import { nodeBrackets50 } from "../src/format50/render.js";
import { decoration, unitFace } from "../src/format50/faces.js";
import { matches } from "./shared.js";
import { withOracle, oracleProblems, oracleTotals } from "./oracle.js";
import { translateSharedCase } from "../../../tools/translate-shared-cases.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const testsRoot = fileURLToPath(new URL("../../../tests/", import.meta.url));
const decoder = new TextDecoder("utf-8", { fatal: true });
const UNSUPPORTED = /cannot yet/;

function bundled(file) {
  try {
    return decoder.decode(fs.readFileSync(path.join(root, file)));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** The sorted case files of a family. */
export function sharedFiles(family) {
  return fs.readdirSync(path.join(testsRoot, family)).filter(file => file.endsWith(".json")).sort();
}

/** The translated outcome of one shared case. */
export function sharedOutcome(family, file) {
  const testCase = JSON.parse(fs.readFileSync(path.join(testsRoot, family, file), "utf8"));
  return translateSharedCase(family, file, testCase);
}

// The caller tokens of a case, with the spans and sources of the format 49
// runner: one token per spec, sources over the texts joined by spaces.
function callerTokens(specs) {
  let offset = 0;
  return specs.map((spec, index) => {
    const length = typeof spec.text === "string" ? [...spec.text].length : 0;
    const token = { ...spec };
    token.span ??= [index, index + 1];
    token.source ??= [offset, offset + length];
    offset += length + 1;
    return token;
  });
}

/**
 * The format 17 view of a format 50 result, for the patterns of the
 * reference expectations: visible keys as tags, splices flattened.
 */
export function format17View(result) {
  const visible = bag => bag.keys().filter(key => /^[A-Z_]/.test(key)).sort();
  const tree = rootNode => {
    const build = node => {
      if (node.kind === "token") return { kind: "token", terminal: node.terminal, token: node.token, span: node.span, source: node.source };
      if (node.kind === "elided") {
        return { kind: "elided", terminal: node.terminal, span: node.span, source: node.source, ...(node.default !== undefined ? { value: node.default } : {}) };
      }
      const children = [];
      for (const child of node.children) {
        if (child.kind === "splice") for (const inner of build(child).children) children.push(inner);
        else children.push(build(child));
      }
      return { kind: "rule", rule: node.rule, span: node.span, source: node.source, children };
    };
    return rootNode ? build(rootNode) : null;
  };
  const token = item => {
    const out = { text: item.text, value: item.value, image: item.image, tags: visible(item.props), span: item.span, source: item.source };
    if (item.insertedBy !== undefined) out.insertedBy = item.insertedBy;
    // The satellites that a decorated token shows beside its primary, with
    // the images that its stage stored when it published.
    const decorated = item.node ? decoration(item.node) : null;
    if (decorated?.before.length) out.before = decorated.before.map(unit => ({ image: unitFace(unit).image }));
    if (decorated?.after.length) out.after = decorated.after.map(unit => ({ image: unitFace(unit).image }));
    if (item.errors?.length) out.errors = item.errors;
    if (item.warnings?.length) out.warnings = item.warnings;
    return out;
  };
  const error = result.error ? { ...result.error } : null;
  const failed = result.stages.find(stage => stage.error);
  if (error && failed?.readings) error.readings = failed.readings.map(tree);
  return {
    format: 17,
    ok: result.ok,
    stages: result.stages.map(stage => ({
      name: stage.name, verdict: stage.verdict ?? null,
      ...(stage.witness && !stage.error?.reason?.startsWith("elision") ? { witness: stage.witness } : {}),
      ...(stage.output ? { output: stage.output.map(token) } : {}),
      // The reports that a stage keeps for want of a token.
      ...(stage.errors?.length ? { errors: stage.errors } : {}),
      tree: tree(stage.root),
    })),
    tree: result.ok || result.error?.kind === "reported" ? tree(result.stages.at(-1).root) : null,
    error,
    warnings: result.warnings ?? [],
  };
}

const pass = () => ({ status: "pass", detail: "" });
const fail = detail => ({ status: "fail", detail });

function where(error) {
  return error.where ?? {};
}

function samePlace(error, expected, document) {
  const at = where(error);
  if (expected.document !== undefined && at.document !== (expected.document.startsWith("data/") ? expected.document : document(expected.document))) return false;
  if (expected.line !== undefined && at.line !== expected.line) return false;
  if (expected.column !== undefined && at.column !== expected.column) return false;
  return true;
}

/**
 * Runs one translated shared case.
 * @returns {{status: "pass" | "fail" | "skip", detail: string}}
 */
export function runSharedOutcome(outcome) {
  const { status } = outcome;
  if (status === "retired" || status === "deferred") return { status: "skip", detail: `${status}: ${outcome.reason ?? outcome.pipeline ?? ""}` };
  // A fixture with documents and a pipeline document runs that pipeline. It
  // can keep the old notation document beside them for reference.
  const raw = outcome.fixture ?? { document: outcome.document };
  const fixture = raw.documents && raw.pipelineDocument ? { ...raw, document: undefined } : { ...raw };
  if (fixture.source) fixture.pipelineDocument ??= "p.md";
  // The documents of a case stand under case/, as in the format 49 runner,
  // so that an include of ../grammars50/... reaches the bundled sources.
  const documents = new Map();
  const document = name => `case/${name}`;
  // A notation case reads one document. Its errors name notation.md.
  const single = outcome.expected?.document ?? "notation.md";
  if (fixture.document !== undefined) documents.set(document(single), fixture.document);
  for (const [name, text] of Object.entries(fixture.documents ?? {})) {
    documents.set(name.startsWith("data/") ? name : document(name), text.replaceAll("../grammars/", "../grammars50/"));
  }
  if (fixture.source) documents.set(document(fixture.pipelineDocument ?? "p.md"), ["```jbogenbau", ...fixture.source, "```", ""].join("\n"));
  // The reference names file is the pinned one of the package, as the Node
  // loaders map it, even where a case replaces the standard names file.
  const read = file => documents.has(file) ? documents.get(file) :
    bundled(file === "data/unicode/unicode-names-reference.txt" ? "data/unicode/unicode-names.txt" : file);
  // The expectation of a negative case: an error at a site.
  const negative = outcome.expected && status !== "translated" && status !== "hand-migrated" && !outcome.expected.props;
  let loader, pipeline;
  try {
    loader = new Loader50(read);
    if (fixture.document !== undefined) {
      loader.documentDom(document(single), []);
      if (negative) return fail(`the document read; expected an error at ${outcome.expected.line}:${outcome.expected.column}`);
      return pass();
    }
    // A case of a bundled pipeline loads it through the bundle of notation
    // 50, which refuses a name of no bundled pipeline with a usage error.
    // A pipeline that has a format 49 grammar and no format 50 one waits.
    if (fixture.pipeline !== undefined) {
      const name = fixture.pipeline;
      if (validPipelineName(name) && bundled(`grammars/${name}/pipeline.md`) !== undefined && bundled(`grammars50/${name}/pipeline.md`) === undefined) {
        return { status: "skip", detail: `the bundled pipeline ${name} has no format 50 source` };
      }
      pipeline = loaderForNotation(50).loadPipeline(name);
    } else pipeline = loader.pipeline(document(fixture.pipelineDocument));
  } catch (error) {
    if (!(error instanceof GencmuError)) return fail(`crash at load: ${error.stack?.split("\n").slice(0, 3).join(" ")}`);
    if (error.kind === "usage") return outcome.reference?.error === "usage" ? pass() : fail(`usage error at load: ${error.message}`);
    if (UNSUPPORTED.test(error.message)) return fail(`unsupported: ${error.message}`);
    if (negative) {
      return samePlace(error, outcome.expected, document) ? pass()
        : fail(`the error is at ${where(error).document}:${where(error).line}:${where(error).column}, expected ${outcome.expected.document ?? ""}:${outcome.expected.line}:${outcome.expected.column}: ${error.message}`);
    }
    if (/grammars50\/[a-z-]+\/[a-z0-9-/.]+ was not found/.test(error.message) && !/gencmu\/jbogenbau/.test(error.message)) {
      return { status: "skip", detail: `a bundled pipeline has no format 50 source: ${error.message}` };
    }
    if (status === "native-pending" && outcome.load) return fail(`expected a load: ${error.message}`);
    const reference = outcome.reference ?? {};
    if (reference.error === "grammar" && !reference.result && !reference.brackets) return pass();
    return fail(`load error: ${error.message}`);
  }
  if (negative) {
    // An error of a later phase stands in the parse result.
    const result = parse(pipeline, fixture, fixture.options ?? {});
    if (result.usage) return fail(`usage error: ${result.usage.message}`);
    if (result.oracle?.length) return fail(result.oracle.join("; "));
    const error = result.value.error;
    if (error?.kind === "grammar") {
      const at = /([^\s:]+):(\d+):(\d+): /.exec(error.message);
      const expected = outcome.expected;
      if (!at) return fail(`a grammar error without a site: ${error.message}`);
      if (Number(at[2]) === expected.line && Number(at[3]) === expected.column) return pass();
      return fail(`the error is at ${at[1]}:${at[2]}:${at[3]}, expected ${expected.document ?? ""}:${expected.line}:${expected.column}: ${error.message}`);
    }
    return fail(`expected an error at ${outcome.expected.line}:${outcome.expected.column}, got ${error ? error.kind : "success"}`);
  }
  if (status === "native-pending" && outcome.load) return pass();
  const runs = fixture.parses ?? [{ options: fixture.options, expect: outcome.reference }];
  // The translator keeps the runs of a case with several parses, each with
  // its expectation, as the reference.
  const references = fixture.parses ? (Array.isArray(outcome.reference) ? outcome.reference.map(run => run.expect) :
    outcome.reference?.parses ?? fixture.parses.map(run => run.expect)) : [outcome.reference];
  for (const [index, run] of runs.entries()) {
    const expect = references[index] ?? run.expect ?? {};
    const result = parse(pipeline, fixture, run.options ?? {});
    if (result.usage) {
      if (expect.error === "usage") continue;
      return fail(`usage error: ${result.usage.message}`);
    }
    // The chosen trees agree with the recognizer on the real bags.
    const problems = [...(result.oracle ?? []), ...compare(result.value, expect, outcome)];
    if (problems.length) return fail(problems.join("; "));
  }
  return pass();
}

function parse(pipeline, fixture, options) {
  const parseOptions = {
    features: options.features ?? [],
    withoutFeatures: options.withoutFeatures ?? [],
    ...(options.until !== undefined ? { until: options.until } : {}),
    ...(options.elisionOnly !== undefined ? { elisionOnly: options.elisionOnly } : {}),
  };
  let text = fixture.input;
  if (fixture.tokens) {
    parseOptions.tokens = callerTokens(fixture.tokens);
    text ??= fixture.tokens.map(token => token.text).join(" ");
  }
  try {
    const { value, checks } = withOracle(() => pipeline.parse(text ?? "", parseOptions));
    return { value, oracle: oracleProblems(checks) };
  } catch (error) {
    if (error instanceof GencmuError && error.kind === "usage") return { usage: error };
    throw error;
  }
}

function compare(result, expect, outcome) {
  const problems = [];
  const kind = result.error?.kind ?? null;
  if (expect.error !== undefined) {
    if (kind !== expect.error) problems.push(`expected the error ${expect.error}, got ${kind ?? "success"}${result.error ? `: ${result.error.message}` : ""}`);
  } else if (kind !== null) problems.push(`unexpected error ${kind}: ${result.error.message}`);
  if (problems.length) return problems;
  try {
    resultRecord(result);
  } catch (error) {
    problems.push(`the result does not serialize: ${error.message}`);
  }
  if (expect.brackets !== undefined) {
    const root = result.stages.at(-1)?.root;
    const brackets = root && (result.ok || kind === "reported") ? nodeBrackets50(root) : "";
    if (brackets !== expect.brackets) problems.push(`brackets ${JSON.stringify(brackets)}, expected ${JSON.stringify(expect.brackets)}`);
  }
  if (expect.warnings !== undefined) {
    const actual = JSON.stringify(result.warnings ?? []);
    if (actual !== JSON.stringify(expect.warnings)) problems.push(`warnings ${actual}, expected ${JSON.stringify(expect.warnings)}`);
  }
  if (expect.result !== undefined) {
    const view = format17View(result);
    const pattern = withoutRuleTags(withoutFormat(expect.result));
    if (!matches(pattern, view)) problems.push(`the result does not match the reference at ${firstMismatch(pattern, view)}`);
  }
  if (outcome.expected?.props) {
    const props = result.stages.at(-1)?.output?.[0]?.props;
    if (!props || !matches(outcome.expected.props, Object.fromEntries(props.keys().map(key => [key, props.value(key) ?? true])))) problems.push("the published props differ");
  }
  return problems;
}

// The path of the first member where a value does not match a pattern,
// with both values.
function firstMismatch(pattern, value, at = "") {
  if (Array.isArray(pattern)) {
    if (!Array.isArray(value) || value.length !== pattern.length) return `${at || "/"}: ${JSON.stringify(pattern).slice(0, 160)} vs ${JSON.stringify(value)?.slice(0, 160)}`;
    for (let index = 0; index < pattern.length; index++) {
      if (!matches(pattern[index], value[index])) return firstMismatch(pattern[index], value[index], `${at}/${index}`);
    }
    return at;
  }
  if (pattern !== null && typeof pattern === "object") {
    if (value === null || typeof value !== "object") return `${at || "/"}: ${JSON.stringify(pattern).slice(0, 160)} vs ${JSON.stringify(value)?.slice(0, 160)}`;
    for (const key of Object.keys(pattern)) {
      if (!Object.hasOwn(value, key)) return `${at}/${key}: missing, expected ${JSON.stringify(pattern[key]).slice(0, 160)}`;
      if (!matches(pattern[key], value[key])) return firstMismatch(pattern[key], value[key], `${at}/${key}`);
    }
    return at;
  }
  return `${at}: ${JSON.stringify(pattern)} vs ${JSON.stringify(value)}`;
}

// The tags of a rule node in a format 49 tree include the keys that a
// repetition passed from one item. Format 50 has no such inheritance (docs/notation.md, "Rule bags"), so
// the comparison leaves the tags of rule nodes out. Published tokens keep
// their tags.
function withoutRuleTags(pattern) {
  if (Array.isArray(pattern)) return pattern.map(withoutRuleTags);
  if (!pattern || typeof pattern !== "object") return pattern;
  const result = {};
  for (const [key, value] of Object.entries(pattern)) {
    if (key === "tags" && (pattern.kind === "rule" || pattern.rule !== undefined || pattern.children !== undefined)) continue;
    if (key === "output") {
      result.output = value;
      continue;
    }
    result[key] = withoutRuleTags(value);
  }
  return result;
}

// The reference patterns name format 17. The view has that format too, so
// only a pattern with another format member would fail on it.
function withoutFormat(pattern) {
  if (!pattern || typeof pattern !== "object" || Array.isArray(pattern)) return pattern;
  const { format, ...rest } = pattern;
  void format;
  return rest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [family, startText, countText] = process.argv.slice(2);
  const files = sharedFiles(family).slice(Number(startText ?? 0), Number(startText ?? 0) + Number(countText ?? Infinity));
  const counts = { pass: 0, fail: 0, skip: 0 };
  for (const file of files) {
    let outcome, run;
    try {
      outcome = sharedOutcome(family, file);
      run = runSharedOutcome(outcome);
    } catch (error) {
      run = { status: "fail", detail: `crash: ${error.stack?.split("\n").slice(0, 3).join(" ")}` };
    }
    counts[run.status]++;
    console.log(`${run.status}\t${family}/${file}\t${outcome?.status ?? "?"}\t${run.detail.replace(/\s+/g, " ").slice(0, 400)}`);
  }
  console.log(JSON.stringify(counts));
  console.log(JSON.stringify({ oracle: { checked: oracleTotals.checked, disagreements: oracleTotals.disagreements,
    undecided: Object.fromEntries(oracleTotals.undecided) } }));
}
