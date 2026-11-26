// Runs the cases of tests/tree-emission/pairs.json on the format 50 loader.
// tree-emission.test.js runs them under node --test. Run this file directly
// to print one line for each case:
//
//   node test/tree-emission.js [ID]
//   node test/tree-emission.js --transparency [ID]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GencmuError } from "../src/errors.js";
import { Loader50, BUNDLE_50 } from "../src/format50/loader.js";
import { resultRecord, decodeResult50 } from "../src/format50/result.js";
import { fnv1a64 } from "../src/hash.js";
import { withOracle, oracleProblems, oracleTotals } from "./oracle.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixtures = fileURLToPath(new URL("../../../tests/tree-emission/pairs.json", import.meta.url));
const decoder = new TextDecoder("utf-8", { fatal: true });
// The loader names a construct that it cannot handle yet with this phrase.
// Such an error never counts as the expected error of a case.
const UNSUPPORTED = /cannot yet/;
const CAUSES = JSON.parse(fs.readFileSync(fileURLToPath(new URL("./tree-emission-causes.json", import.meta.url)), "utf8"));

function bundled(file) {
  // The reference names file is the pinned one, as the Node loaders map it.
  if (file === "data/unicode/unicode-names-reference.txt") file = "data/unicode/unicode-names.txt";
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

/** The document of a bundled pipeline of notation 50. */
function pipelineDocument(name) {
  return `grammars50/${name}/pipeline.md`;
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
  if (item.pipeline && bundled(pipelineDocument(item.pipeline)) === undefined) {
    return { status: "pending", detail: `the bundled pipeline ${item.pipeline} has no format 50 source yet` };
  }
  if (item.resultJson) {
    try {
      decodeResult50(item.resultJson);
    } catch (error) {
      if (!(error instanceof GencmuError)) throw error;
      return expect.outcome === "invalid-result" ? { status: "pass", detail: error.message } : { status: "fail", detail: error.message };
    }
    return { status: "fail", detail: "the decoder accepted the result" };
  }
  if (item.domJson) return runPath(id, item, expect, "supplied", item.domJson);
  const first = runPath(id, item, expect, "source");
  if (!item.domPaths || first.status !== "pass") return first;
  // The same case through an optional cache entry and a supplied DOM.
  const { json, cache, supplied } = item.domPaths;
  const cached = runPath(id, item, expect, "cache", json, cache);
  if (cached.status !== "pass") return { ...cached, detail: `cache path: ${cached.detail}` };
  const given = runPath(id, item, cache === "hit" ? expect : supplied, "supplied", json);
  if (given.status !== "pass") return { ...given, detail: `supplied path: ${given.detail}` };
  for (const other of [cached, given]) {
    if (first.dom && other.dom && JSON.stringify(first.dom) !== JSON.stringify(other.dom)) {
      return { status: "fail", detail: "the DOM paths give different records" };
    }
  }
  return first;
}

/**
 * Runs a case through one way of getting its DOM: its source, an optional
 * cache entry, or a supplied DOM.
 */
function runPath(id, item, expect, path, json, cache) {
  const sources = new Map();
  // A case of a bundled pipeline reads its pipeline document, with the
  // lines of its overlay after the declarations of that document.
  const document = item.pipeline ? pipelineDocument(item.pipeline) : "case/pipeline.md";
  if (item.pipeline) {
    const overlay = item.overlay ? ["", "```jbogenbau", ...item.overlay, "```", ""].join("\n") : "";
    sources.set(document, bundled(document) + overlay);
  } else if (item.document) sources.set(document, item.document);
  else if (item.source) sources.set(document, ["```jbogenbau", ...item.source, "```", ""].join("\n"));
  else sources.set(document, "");
  const read = file => sources.get(file) ?? bundled(file);
  const causeKey = path === "supplied" && expect !== item.expect ? `${id}#supplied` : id;
  const loadFailure = error => {
    if (!(error instanceof GencmuError)) return { status: "fail", detail: `crash at load: ${error.stack}` };
    if (UNSUPPORTED.test(error.message)) return { status: "fail", detail: `unsupported: ${error.message}` };
    if ((expect.outcome === "grammar" || expect.outcome === "invalid-dom") && expect.phase === "load") {
      const pattern = CAUSES[causeKey];
      if (pattern && new RegExp(pattern).test(error.message)) {
        // A source position counts from the first grammar line, and the
        // document adds the opening fence.
        if (expect.at && path !== "supplied") {
          const line = expect.at.line + (item.source ? 1 : 0);
          if (error.where?.line !== line || error.where?.column !== expect.at.column) {
            return { status: "fail", detail: `the error is at ${error.where?.line}:${error.where?.column}, the case expects ${line}:${expect.at.column}: ${error.message}` };
          }
        }
        return { status: "pass", detail: error.message };
      }
      return { status: "fail", detail: `the cause differs: ${error.message} (expected: ${expect.cause})` };
    }
    return { status: "fail", detail: `load error: ${error.message}` };
  };
  let loader, pipeline, dom;
  try {
    loader = new Loader50(read);
    if (path === "cache") {
      loader.usePreparsed({
        format: 50, bootstrap: loader.bootstrapHash, unicode: loader.unicodeHash, properties: loader.propertiesHash,
        documents: { [document]: { hash: fnv1a64(sources.get(document)), dom: JSON.parse(json) } },
      });
    }
    if (path === "supplied") loader.supplyDom(document, json);
    if (item.document || path === "supplied" && !item.source) {
      dom = loader.documentDom(document, []);
    } else {
      pipeline = loader.pipeline(document);
      dom = loader.documentDom(document, []);
    }
  } catch (error) {
    return loadFailure(error);
  }
  if (path === "cache") {
    const hit = loader.cacheHits.includes(document);
    if (hit !== (cache === "hit")) return { status: "fail", detail: `expected a cache ${cache}, got a ${hit ? "hit" : "miss"}` };
  }
  if (expect.phase === "load" && expect.outcome !== "dom") return { status: "fail", detail: "the document loaded" };
  if (!pipeline) {
    if (expect.outcome !== "dom") return { status: "fail", detail: `the document read, but the case expects ${expect.outcome}` };
    const problems = [];
    checkAssertions(dom, expect.assertions, problems);
    return problems.length ? { status: "fail", detail: problems.join("; ") } : { status: "pass", detail: "", dom };
  }
  let result;
  const options = { ...(item.options ?? {}) };
  if (item.tokens) options.tokens = callerTokens(item.tokens);
  let checks;
  try {
    ({ value: result, checks } = withOracle(() => pipeline.parse(item.input, options)));
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
  // The chosen trees agree with the recognizer on the real bags.
  const problems = oracleProblems(checks);
  const outcome = result.ok ? "accept" : result.error.kind;
  if (outcome !== expect.outcome) problems.push(`expected ${expect.outcome}, got ${outcome}${result.error ? `: ${result.error.message}` : ""}`);
  if (outcome === "grammar" && expect.outcome === "grammar") {
    const failed = result.stages.find(stage => stage.error);
    if (expect.phase === "lowering" || expect.phase === "recognition") {
      if (failed && (failed.verdict !== null || failed.output)) problems.push(`a ${expect.phase} error keeps no verdict and no output`);
    }
    if (expect.phase === "publication" && failed && !failed.root) problems.push("a publication error keeps the chosen root");
    const where = /:(\d+):(\d+): /.exec(result.error.message);
    if (expect.at && path !== "supplied") {
      const line = expect.at.line + (item.source ? 1 : 0);
      if (!where || Number(where[1]) !== line || Number(where[2]) !== expect.at.column) {
        problems.push(`the error is at ${where ? `${where[1]}:${where[2]}` : "no position"}, the case expects ${line}:${expect.at.column}: ${result.error.message}`);
      }
    }
  }
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
  return problems.length ? { status: "fail", detail: problems.join("; ") } : { status: "pass", detail: "", dom };
}

// A label before an optional, braces, or parentheses around more than one
// symbol. A label on parentheses around one symbol binds that symbol.
const COMPOUND_LABEL = /\$([a-z][a-z0-9_]*):(?=[[{]|\((?![^()\s]*\)))/g;

/**
 * The two copies of a grammar for the transparency comparison of compound
 * labels (docs/notation.md, "Ambiguity"). Both drop each condition, emission line and term that reads a
 * compound label of its rule. The second copy also drops the labels.
 * @param {string[]} source
 * @returns {[string[], string[]] | null} null when the grammar has no compound label
 */
export function transparencyCopies(source) {
  /** @type {string[][]} */
  const blocks = [];
  for (const line of source) {
    if (line.startsWith("%rule ") || line.startsWith("%const ") || !blocks.length) blocks.push([line]);
    else blocks[blocks.length - 1].push(line);
  }
  const kept = [];
  const plain = [];
  let found = false;
  for (const block of blocks) {
    const names = new Set();
    for (const line of block) {
      if (line.startsWith("%conditions") || line.startsWith("%emit")) continue;
      for (const match of line.matchAll(COMPOUND_LABEL)) names.add(match[1]);
    }
    if (names.size) found = true;
    const reads = (/** @type {string} */ line) => [...names].some(name => new RegExp(`\\$${name}(?![a-z0-9_])`).test(line.replace(COMPOUND_LABEL, "")));
    for (let line of block) {
      if ((line.startsWith("%conditions") || line.startsWith("%emit")) && reads(line)) continue;
      // A term that reads a label goes, and the body before it stays.
      const term = line.indexOf(" → ");
      if (term >= 0 && reads(line.slice(term))) line = line.slice(0, term);
      kept.push(line);
      plain.push(line.startsWith("%conditions") || line.startsWith("%emit") ? line : line.replace(COMPOUND_LABEL, ""));
    }
  }
  return found ? [kept, plain] : null;
}

/** The working bag of an occurrence, with private keys and payloads. */
function bagDigest(node) {
  let bag;
  try {
    bag = node.bag();
  } catch (error) {
    return `error: ${error.message}`;
  }
  const show = value => value instanceof Set ? [...value].sort() : value instanceof Map ? [...value] : value;
  return bag.keys().map(key => {
    try {
      return [key, bag.hasValue(key) ? JSON.stringify(show(bag.value(key))) : "bare"];
    } catch (error) {
      return [key, `error: ${error.message}`];
    }
  });
}

/** Each occurrence of a tree with its kind, rule, span, primary and bag. */
function treeDigest(root) {
  const lines = [];
  const visit = (node, depth) => {
    const primary = node.primary ? node.children.indexOf(node.primary) : null;
    lines.push(JSON.stringify([depth, node.kind, node.rule ?? node.terminal ?? null, node.span, primary,
      node.kind === "token" || node.kind === "rule" || node.kind === "splice" ? bagDigest(node) : null]));
    for (const child of node.children ?? []) visit(child, depth + 1);
  };
  if (root) visit(root, 0);
  return lines;
}

/** The verdict, result record and working bags of a grammar on a case. */
function observed(id, item, source) {
  const document = "case/pipeline.md";
  const text = ["```jbogenbau", ...source, "```", ""].join("\n");
  const loader = new Loader50(file => (file === document ? text : bundled(file)));
  const pipeline = loader.pipeline(document);
  const options = { ...(item.options ?? {}) };
  if (item.tokens) options.tokens = callerTokens(item.tokens);
  const result = pipeline.parse(item.input, options);
  const record = resultRecord(result, { stageTrees: options.stageTrees });
  const trees = result.stages.map(stage => [treeDigest(stage.root), ...(stage.readings ?? []).map(treeDigest)]);
  return { verdict: result.ok ? "accept" : result.error.kind, record: JSON.stringify(record), trees: JSON.stringify(trees) };
}

/**
 * The transparency comparison of compound labels for a case that a grammar
 * accepts or rejects: the copies with and without compound labels give the
 * same verdict, result record and working bags.
 * @returns {{status: "pass" | "fail", detail: string} | null} null where it does not apply
 */
export function transparencyCase({ id, item }) {
  if (!item.source || !["accept", "rejected", "ambiguous"].includes(item.expect?.outcome)) return null;
  const copies = transparencyCopies(item.source);
  if (!copies) return null;
  let labeled, unlabeled;
  try {
    labeled = observed(id, item, copies[0]);
    unlabeled = observed(id, item, copies[1]);
  } catch (error) {
    return { status: "fail", detail: `a copy fails: ${error.message}` };
  }
  for (const key of ["verdict", "record", "trees"]) {
    if (labeled[key] !== unlabeled[key]) return { status: "fail", detail: `the ${key} differs: ${labeled[key].slice(0, 400)} | ${unlabeled[key].slice(0, 400)}` };
  }
  return { status: "pass", detail: "" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // With --transparency, the run makes the transparency comparison instead.
  const transparency = process.argv[2] === "--transparency";
  const only = process.argv[transparency ? 3 : 2];
  const counts = { pass: 0, fail: 0, pending: 0 };
  for (const entry of treeEmissionCases()) {
    if (only && !entry.id.startsWith(only)) continue;
    const outcome = transparency ? transparencyCase(entry) : runCase(entry);
    if (!outcome) continue;
    counts[outcome.status]++;
    console.log(`${outcome.status}\t${entry.id}\t${outcome.detail.split("\n")[0].slice(0, 300)}`);
  }
  console.log(JSON.stringify(counts));
  console.log(JSON.stringify({ oracle: { checked: oracleTotals.checked, disagreements: oracleTotals.disagreements,
    undecided: Object.fromEntries(oracleTotals.undecided) } }));
}

export { BUNDLE_50, oracleTotals };
