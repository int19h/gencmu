// Runs the cases of tests/tree-emission/pairs.json on the format 50 loader.
// tree-emission.test.js runs them under node --test. Run this file directly
// to print one line for each case:
//
//   node test/tree-emission.js [ID]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GencmuError } from "../src/errors.js";
import { Loader50, BUNDLE_50 } from "../src/format50/loader.js";
import { resultRecord, decodeResult50 } from "../src/format50/result.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixtures = fileURLToPath(new URL("../../../tests/tree-emission/pairs.json", import.meta.url));
const decoder = new TextDecoder("utf-8", { fatal: true });
// The loader names a construct that it cannot handle yet with this phrase.
// Such an error never counts as the expected error of a case.
const UNSUPPORTED = /cannot yet/;
const CAUSES = JSON.parse(fs.readFileSync(fileURLToPath(new URL("./tree-emission-causes.json", import.meta.url)), "utf8"));

function bundled(file) {
  try {
    return decoder.decode(fs.readFileSync(path.join(root, file)));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** Each case of the fixture file with its identifier. */
export function treeEmissionCases() {
  const pairs = JSON.parse(fs.readFileSync(fixtures, "utf8"));
  const cases = [];
  for (const pair of pairs) {
    for (const kind of ["valid", "malformed"]) if (pair[kind]) cases.push({ id: `${pair.id}/${kind}`, pair, item: pair[kind] });
    (pair.controls ?? []).forEach((item, index) => cases.push({ id: `${pair.id}/control/${index}`, pair, item }));
  }
  return cases;
}

/** The tokens that a case supplies, with the spans and sources of the fixture rules. */
function callerTokens(tokens) {
  let offset = 0;
  return tokens.map((token, index) => {
    const length = [...token.text].length;
    const made = { text: token.text, props: token.props, span: [index, index + 1], source: [offset, offset + length] };
    offset += length + 1;
    return made;
  });
}

function pointer(value, path) {
  if (path === "") return { found: true, value };
  let current = value;
  for (const raw of path.split("/").slice(1)) {
    const part = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, part)) return { found: false };
    current = current[part];
  }
  return { found: true, value: current };
}

function matches(actual, expected) {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((item, index) => matches(actual[index], item));
  }
  if (expected !== null && typeof expected === "object") {
    return actual !== null && typeof actual === "object" && !Array.isArray(actual) &&
      Object.entries(expected).every(([key, item]) => Object.hasOwn(actual, key) && matches(actual[key], item));
  }
  return actual === expected;
}

function checkAssertions(record, assertions, problems) {
  for (const assertion of assertions ?? []) {
    const at = pointer(record, assertion.path);
    const show = value => JSON.stringify(value);
    if ("equals" in assertion) {
      if (!at.found || show(at.value) !== show(assertion.equals)) problems.push(`${assertion.path}: expected ${show(assertion.equals)}, got ${at.found ? show(at.value) : "nothing"}`);
    } else if ("matches" in assertion) {
      if (!at.found || !matches(at.value, assertion.matches)) problems.push(`${assertion.path}: expected a match of ${show(assertion.matches)}, got ${at.found ? show(at.value) : "nothing"}`);
    } else if ("contains" in assertion) {
      if (!at.found || !Array.isArray(at.value) || !at.value.some(item => matches(item, assertion.contains))) problems.push(`${assertion.path}: no item matches ${show(assertion.contains)}`);
    } else if ("excludes" in assertion) {
      if (at.found && Array.isArray(at.value) && at.value.some(item => matches(item, assertion.excludes))) problems.push(`${assertion.path}: an item matches ${show(assertion.excludes)}`);
    } else if ("absent" in assertion) {
      if (at.found) problems.push(`${assertion.path}: expected no member, got ${show(at.value)}`);
    }
  }
}

function resolveReference(record, target) {
  const [stage, reading, id] = target;
  if (stage === -1) return record.input.tokens[id];
  const table = reading === 0 ? record.stages[stage].nodes : record.stages[stage].readings?.[reading - 1]?.nodes;
  return table?.find(node => node.id === id);
}

/**
 * Runs one case.
 * @returns {{status: "pass" | "fail" | "pending", detail: string}}
 */
export function runCase({ id, item }) {
  const expect = item.expect;
  if (item.pipeline) return { status: "pending", detail: `the bundled pipeline ${item.pipeline} has no format 50 source yet` };
  if (item.domPaths || item.domJson) return { status: "pending", detail: "cached and supplied DOM paths are not implemented yet" };
  if (item.resultJson) {
    try {
      decodeResult50(item.resultJson);
    } catch (error) {
      if (!(error instanceof GencmuError)) throw error;
      return expect.outcome === "invalid-result" ? { status: "pass", detail: error.message } : { status: "fail", detail: error.message };
    }
    return { status: "fail", detail: "the decoder accepted the result" };
  }
  const sources = new Map();
  const document = "case/pipeline.md";
  if (item.document) sources.set(document, item.document);
  else sources.set(document, ["```jbogenbau", ...item.source, "```", ""].join("\n"));
  const read = file => sources.get(file) ?? bundled(file);
  let loader, pipeline;
  try {
    loader = new Loader50(read);
    if (item.document) {
      const entry = loader.readDocument(item.document, document);
      if (expect.outcome !== "dom") return { status: "fail", detail: `the document read, but the case expects ${expect.outcome}` };
      const problems = [];
      checkAssertions(entry.dom, expect.assertions, problems);
      return problems.length ? { status: "fail", detail: problems.join("; ") } : { status: "pass", detail: "" };
    }
    pipeline = loader.pipeline(document);
  } catch (error) {
    if (!(error instanceof GencmuError)) return { status: "fail", detail: `crash at load: ${error.stack}` };
    if (UNSUPPORTED.test(error.message)) return { status: "fail", detail: `unsupported: ${error.message}` };
    if (expect.outcome === "grammar" && expect.phase === "load") {
      const pattern = CAUSES[id];
      if (pattern && new RegExp(pattern).test(error.message)) return { status: "pass", detail: error.message };
      return { status: "fail", detail: `the cause differs: ${error.message} (expected: ${expect.cause})` };
    }
    return { status: "fail", detail: `load error: ${error.message}` };
  }
  if (expect.outcome === "grammar" && expect.phase === "load") return { status: "fail", detail: "the pipeline loaded" };
  let result;
  const options = { ...(item.options ?? {}) };
  if (item.tokens) options.tokens = callerTokens(item.tokens);
  try {
    result = pipeline.parse(item.input, options);
  } catch (error) {
    if (!(error instanceof GencmuError)) return { status: "fail", detail: `crash at parse: ${error.stack}` };
    return { status: "fail", detail: `parse error: ${error.kind}: ${error.message}` };
  }
  let record;
  try {
    record = resultRecord(result, { stageTrees: options.stageTrees });
  } catch (error) {
    return { status: "fail", detail: `crash at serialization: ${error.stack}` };
  }
  const problems = [];
  const outcome = result.ok ? "accept" : result.error.kind;
  if (outcome !== expect.outcome) problems.push(`expected ${expect.outcome}, got ${outcome}${result.error ? `: ${result.error.message}` : ""}`);
  checkAssertions(record, expect.assertions, problems);
  if (expect.roundTrip) {
    try {
      const decoded = decodeResult50(JSON.stringify(record));
      checkAssertions(decoded, expect.assertions, problems);
    } catch (error) {
      problems.push(`the decoder rejected the result: ${error.message}`);
    }
  }
  for (const reference of expect.references ?? []) {
    const at = pointer(record, reference.path);
    const target = resolveReference(record, reference.target);
    if (!at.found || target === undefined) problems.push(`${reference.path}: the reference does not resolve`);
  }
  return problems.length ? { status: "fail", detail: problems.join("; ") } : { status: "pass", detail: "" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const only = process.argv[2];
  const counts = { pass: 0, fail: 0, pending: 0 };
  for (const entry of treeEmissionCases()) {
    if (only && !entry.id.startsWith(only)) continue;
    const outcome = runCase(entry);
    counts[outcome.status]++;
    console.log(`${outcome.status}\t${entry.id}\t${outcome.detail.split("\n")[0].slice(0, 300)}`);
  }
  console.log(JSON.stringify(counts));
}

export { BUNDLE_50 };
