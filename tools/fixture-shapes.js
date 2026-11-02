// Shared fixture contracts. An object lists its required and optional members.
// All other members are errors. Rules describe combinations of members.
// Opaque payloads deliberately reach the library without a shape restriction.
import { createHash } from "node:crypto";

const string = "string", boolean = "boolean", any = "any", record = "record";
const positive = "positive", natural = "natural";
const list = (item, min = 0) => ({ list: item, min });
const caseList = (item) => list(item, 1);
const object = (required, optional = {}, rules = []) => ({ required, optional, rules });
const map = (item) => ({ map: item });
const choice = (...values) => ({ choice: values });
const either = (...shapes) => ({ either: shapes });
const nullable = (shape) => either(shape, choice(null));
const strings = list(string), counts = list(positive, 1), pair = { tuple: [natural, natural] };
const has = (value, key) => Object.hasOwn(value, key);
const exactly = (...keys) => (value) => keys.filter((key) => has(value, key)).length === 1
  ? [] : [`supply exactly one of ${keys.join(", ")}`];
const together = (a, b) => (value) => has(value, a) === has(value, b) ? [] : [`${a} and ${b} must occur together`];
const position = object({ document: string }, { line: positive, column: positive });
const coordinates = { line: positive, column: positive };
const options = object({}, { features: strings, withoutFeatures: strings, until: { pattern: /./s }, elisionOnly: boolean });
const feature = object({ name: string, kind: choice("gate", "warning"), default: boolean });
const warning = object({ stage: string, feature: string, rule: string, span: pair, source: pair });
const expectation = object({}, {
  result: record, error: choice("grammar", "usage", "rejected", "ambiguous", "feature-conflict"), where: position, diagnostic: string, message: string,
  brackets: string, warnings: list(warning), features: list(feature), enabledFeatures: strings, bundledPipelines: strings,
}, [(v) => (has(v, "where") || has(v, "diagnostic") || has(v, "message")) && v.error !== "grammar"
  ? ["where, diagnostic and message require a grammar error"] : []]);
const parse = object({ expect: expectation }, { options });
const tokens = { check: tokenMembers };
const engine = object({}, {
  description: string, grammar: string, documents: map(string), pipelineDocument: string, pipeline: string,
  input: string, tokens, options, expect: expectation, parses: list(parse, 1),
  treeRendering: object({ aliases: strings, text: string, decodedError: string }),
}, [
  exactly("grammar", "documents", "pipeline"), together("documents", "pipelineDocument"),
  exactly("expect", "parses"),
  (v) => has(v, "parses") && has(v, "options") ? ["parses replaces options"] : [],
  // The main runners inspect token payloads and match result patterns.
]);
const notationError = object(coordinates, { message: string });
const notation = object({ document: string, expect: object({}, { dom: record, error: notationError }, [exactly("dom", "error")]) },
  { description: string, cacheMisses: boolean }, [
    (v) => v.cacheMisses === true && !has(v.expect, "dom") ? ["cacheMisses requires a DOM expectation"] : [],
  ]);
const suppliedExpectation = object({}, { dom: record, error: object(coordinates), message: string }, [
  exactly("dom", "error"), (v) => has(v, "message") && !has(v, "error") ? ["message requires error"] : [],
]);
const suppliedNotation = object({ description: string, cases: caseList(object({
  id: string, description: string, aliases: list(object({ spelling: string, value: string, tags: strings })),
  document: string, expect: suppliedExpectation,
})) });
const bootstrapCase = object({ description: string, stage: nullable(string) }, {
  bootstrap: string, find: string, replace: string, line: nullable(positive), column: nullable(positive),
  at: { pattern: /./s }, context: string, message: string,
}, [exactly("bootstrap", "find"), together("find", "replace"), together("line", "column"),
  exactly("line", "at"), (v) => has(v, "at") && !has(v, "context") ? ["at requires context"] : [],
  (v) => (v.line === null) !== (v.column === null) ? ["line and column must both be null or both be numbers"] : [],
]);
const parameterStructure = object({ name: string }, {
  grammar: string, dom: any, argument: any, order: strings, flags: map(strings), instances: natural,
  cacheFallback: boolean, input: string, public: boolean,
}, [(v) => v.cacheFallback === true
  ? (has(v, "grammar") && has(v, "dom") && has(v, "input") ? [] : ["cacheFallback requires grammar, dom and input"])
  : exactly("grammar", "dom")(v),
(v) => v.public === true && (!has(v, "grammar") || !has(v, "order")) ? ["public requires grammar and order"] : [],
(v) => has(v, "flags") && !has(v, "grammar") ? ["flags requires grammar"] : [],
(v) => {
  const problems = [];
  if (v.public === true) {
    if (v.cacheFallback === true) problems.push("public forbids cacheFallback");
    for (const key of ["argument", "flags", "input"]) if (has(v, key)) problems.push(`public forbids ${key}`);
  }
  if (v.cacheFallback === true) {
    for (const key of ["argument", "order", "flags", "instances"]) if (has(v, key)) problems.push(`cacheFallback forbids ${key}`);
  } else if (has(v, "input")) problems.push("input requires cacheFallback");
  return problems;
}]);
const memo = object({ description: string, runs: caseList(object({ options: list(options, 1) }, {
  grammar: string, pipeline: string, inputs: list(tokens, 1), texts: list(string, 1),
}, [exactly("grammar", "pipeline"), exactly("inputs", "texts")])) });
const mutationPath = list(either(string, "path-index"), 1);
const mutant = object({ name: string, case: string, path: mutationPath }, {
  set: any, copy: mutationPath, keep: natural, remove: choice(true), append: any,
}, [exactly("set", "copy", "keep", "remove", "append"),
(v) => has(v, "remove") && typeof v.path.at(-1) !== "string" ? ["remove needs a member name at the end of path"] : []]);
const growthBounds = { nodesPerDepth: natural, slack: natural, maxCloseNodes: natural, maxCloseStates: natural, itemsPerUnit: natural };
const family = object({ case: string, strictCase: string }, {
  depths: counts, lengths: counts, ...growthBounds, equalsStrict: boolean, atMostStrict: boolean,
  overStrict: object({}, { itemsPercent: natural, itemsPercentPerUnit: natural, itemsSlack: natural, closeStatesPerUnit: natural }),
  strictBound: object({ closeStatesPerUnit: natural, closeStatesSlack: natural }),
  summaries: object({ perSquare: natural, slack: natural }), steps: object({ perCube: natural, slack: natural }),
}, [exactly("depths", "lengths"),
(v) => (has(v, "itemsPerUnit") || has(v, "nodesPerDepth")) && !has(v, "slack") ? ["a scaled bound requires slack"] : []]);
const families = Object.fromEntries([
  "familyOwnerChoice", "familyOwnerChoiceTags", "familyNestedCloses", "familyNestedAnchored", "familyNestedExtras",
  "familyIrrelevant", "familyPermittedExtras", "familyNullableCycle", "familySharedDoubleCloses",
  "familyUndemandedRankedSibling", "familyCallerScope", "familyImpossiblePrefix", "familyNestedTwoTerminals",
].map((name) => [name, family]));
const linearClose = object({ case: string, lengths: counts, maxCloseNodes: natural, maxCloseStates: natural, itemsPerUnit: natural, slack: natural });
const growth = object({ case: string, depths: counts, nodesPerDepth: natural, slack: natural, unusedCases: strings }, {
  rankedSibling: object({ case: string, depths: counts, maxCloseNodes: natural }),
  callerScope: linearClose, impossiblePrefix: linearClose, ...families,
});
const corpus = object({ id: string, text: string, pipeline: string, expect: choice("accept", "reject") }, {
  features: strings, withoutFeatures: strings, verdict: string, stage: string, at: natural,
  error: object({ kind: choice("ambiguous"), reason: choice("tie", "elision-only") }),
  ties: { tuple: [{ pattern: /./s }] }, words: strings, brackets: string, seeded: choice("accept", "reject"), reason: string,
}, [(v) => {
  const problems = [];
  if (v.expect === "accept") {
    for (const key of ["verdict", "brackets"]) if (!has(v, key)) problems.push(`accept requires ${key}`);
    for (const key of ["stage", "at", "error", "ties"]) if (has(v, key)) problems.push(`accept forbids ${key}`);
  } else {
    if (!has(v, "stage")) problems.push("reject requires stage");
    for (const key of ["verdict", "brackets"]) if (has(v, key)) problems.push(`reject forbids ${key}`);
    for (const message of exactly("at", "error")(v)) problems.push(message);
  }
  if (has(v, "ties") && v.ties[0] !== v.stage) problems.push("ties must name stage");
  if (has(v, "seeded") && !has(v, "reason")) problems.push("seeded requires reason");
  return problems;
}]);
const location = object({ text: string, needle: string, line: nullable(positive), column: nullable(positive) }, {}, [
  (v) => (v.line === null) !== (v.column === null) ? ["line and column must both be null or both be numbers"] : [],
]);
const loadedOutcomes = either(string, strings);
const replacement = object({ description: string, find: string, replace: string, document: string, inputs: strings, expect: loadedOutcomes },
  { where: position }, [(v) => Array.isArray(v.expect) && v.expect.length !== v.inputs.length ? ["expect and inputs need equal lengths"] : [],
  (v) => has(v, "where") && typeof v.expect !== "string" ? ["where requires a load error"] : []]);
const digest = { pattern: /^[0-9a-f]{64}$/ }, hash = { pattern: /^[0-9a-f]{16}$/ };
const citation = object({ title: string }, { chapter: string, section: string, example: string, appendix: string });
const page = object({ sha256: digest, default: citation }, {
  anchors: map(citation), source: string, lines: positive,
  sections: list(object({ line: positive, title: string }, { section: string, appendix: string }, [exactly("section", "appendix")])),
  supports: list(object({ phrase: string, target: string, excerpt: string })),
}, [exactly("anchors", "source"), together("source", "lines"), together("source", "sections")]);
const sourceChange = object({}, { kind: string, description: string, before: string, after: string, count: positive }, [
  together("before", "after"),
  (v) => !has(v, "kind") && !has(v, "before") ? ["a change needs a kind or a replacement"] : [],
  (v) => has(v, "count") && !has(v, "before") ? ["count requires before and after"] : [],
]);
const sourceFile = (extension) => ({ pattern: new RegExp(`^[^/\\\\:\\x00]+\\.${extension}$`) });
const textManifest = object({ grammar_commit: { pattern: /^[0-9a-f]{40}$/ }, sources: caseList(object({
  id: string, title: string, url: string, fetched: { pattern: /^\d{4}-\d\d-\d\d$/ }, html: sourceFile("html"), html_sha256: digest,
  extracted: sourceFile("txt"), extracted_sha256: digest, location: either(object({ column: string, rows: list(positive) }),
    object({ chunk: string, paragraphs: list(positive) }, { heading: string })),
  variants: list(object({ name: string, changes: list(sourceChange), text_sha256: digest, cases: list(string, 1) })),
})) }, { audit_grammar_commit: { pattern: /^[0-9a-f]{40}$/ } });

// A directory's format applies to each member. Documentation is not a fixture.
// Text formats have their row rules below, next to the JSON descriptions.
export const fixtureShapes = {
  "engine/*.json": { shape: engine },
  "notation/*.json": { shape: notation },
  "corpus/*.jsonl": { shape: corpus, format: "jsonl", scalarStrings: true },
  "parameters.json": { shape: caseList({ ...engine, required: { name: string } }) },
  "parameter-structure.json": { shape: caseList(parameterStructure) },
  "bootstrap-errors.json": { shape: object({ kind: string, document: string, cases: caseList(bootstrapCase) }) },
  "disk-names.json": { shape: caseList(object({ description: string, files: map(string), error: object({ document: string, ...coordinates }) })) },
  "dom-depth-source.json": { shape: caseList(object({ description: string, head: string, prefix: string, leaf: string, suffix: string, tail: string, atLimit: natural })) },
  "dom-depth.json": { shape: caseList(object({ description: string, dom: any, leaf: any, wrapper: any, atLimit: natural })) },
  "dom-malformed.json": { shape: caseList(object({ description: string, malformed: boolean }, {
    dom: any, rule: any, directive: any, unicode: string, code: string, message: string,
  }, [exactly("dom", "rule", "directive")])) },
  "growth.json": { shape: caseList(object({ description: string, pipeline: string, text: string, link: string, small: positive, large: positive, most: positive }, {}, [
    (v) => v.large > v.small ? [] : ["large must exceed small"],
  ])) },
  "notation-growth.json": { shape: caseList(object({ name: string, description: string, prefix: string, open: string, middle: string, close: string, suffix: string })) },
  "query-depth.json": { shape: caseList(object({ name: string, description: string, grammar: string, link: string, suffix: string, count: positive })) },
  "query-work.json": { shape: caseList(object({ name: string, description: string, head: string, item: string, joiner: string, tail: string, rule: string, text: string, count: positive, most: positive })) },
  "places.json": { shape: object({ description: string, positions: caseList(location), substitutions: caseList(object({ text: string, find: string, replace: string, places: natural, expect: nullable(string) })) }) },
  "recipe-diagnostics.json": { shape: object({ recipes: caseList(object({ source: string, at: string })), positions: caseList(object({ name: string, template: string })), ordinary: caseList(string) }) },
  "notation-shapes.json": { shape: object({ description: string, document: string, inputs: caseList(string), control: caseList(string), loads: map(loadedOutcomes), extraParts: caseList(replacement) }, {}, [
    (v) => v.control.length !== v.inputs.length || Object.values(v.loads).some((x) => Array.isArray(x) && x.length !== v.inputs.length)
      ? ["control and loaded outcomes need one entry per input"] : [],
  ]) },
  "notation-values.json": { shape: suppliedNotation },
  "json-keys.json": { shape: object({ grammar: string, cache: string,
    values: caseList(object({ description: string, json: string, expect: any })),
    bootstrap: caseList(object({ description: string, find: string, replace: string, loads: boolean }, { rustLoads: boolean, note: string })),
    preparsed: caseList(object({ description: string, find: string, replace: string }, {
      cached: boolean,
      rustCached: boolean, note: string, document: string, tags: strings, portable: boolean, sources: map(string), error: position, concurrent: boolean,
    }, [(v) => !has(v, "cached") && !has(v, "error") ? ["a cache case needs cached or error"] : []])),
  }) },
  "shared-memo.json": { shape: memo },
  "result-mutants.json": { shape: object({ mutants: list(mutant, 1) }, { description: string }), scalarStrings: true,
    references: (v) => v.mutants.map((m) => `engine/${m.case}`) },
  "without-elision-growth.json": { shape: growth,
    references: (v) => [v.case].concat(v.unusedCases.map((name) => `engine/${name}`),
      Object.values(v).filter((x) => x && typeof x === "object" && !Array.isArray(x))
        .flatMap((x) => x.strictCase ? [x.case, x.strictCase] : [x.case])) },
  "diagnostic-notation.json": { shape: caseList(object({ description: string, grammar: string, text: string, term: any }, { abbreviation: string })) },
  "playground-includes.json": { shape: caseList(object({ description: string, sources: map(string), documents: strings }, { stages: list(object({ name: string, documents: strings })) })) },
  "playground-names-paths.json": { shape: caseList(string) },
  "cll-footnotes.json": { shape: object({ edition: string, index: object({ url: string, sha256: digest }), pages: map(page) }) },
  "unicode/property-digests.json": { shape: object({ unicode: string, algorithm: choice("fnv1a64"), scalars: positive, properties: map(hash) }) },
  "text-sources/manifest.json": { shape: textManifest,
    references: (v) => v.sources.flatMap((source) => [`text-sources/${source.html}`, `text-sources/${source.extracted}`]),
    audit: manifestProblems },
  "core.txt": { format: "text", rows: coreRows,
    audit: (text, context) => text.split(/\r\n|\r|\n/).filter(Boolean)
      .filter((id) => !context.corpus().has(id)).map((id) => `unknown corpus case ${id}`) },
  "quoted-allow.txt": { format: "text", rows: allowRows },
  "unicode/NormalizationTest.txt": { format: "text", rows: normalizationRows },
  "text-sources/*.html": { format: "text" },
  "text-sources/*.txt": { format: "text" },
};

function coreRows(text) {
  const seen = new Set(), problems = [];
  for (const [index, line] of text.split(/\r\n|\r|\n/).entries()) {
    if (!line) continue;
    if (!/^[^\s]+\.[^\s]+$/.test(line)) problems.push(`line ${index + 1}: expected a corpus case id`);
    if (seen.has(line)) problems.push(`line ${index + 1}: repeated corpus case id`);
    seen.add(line);
  }
  return problems;
}
// Quoted-text syntax is also used by the documentation tool. The checker
// supplies that parser without running its grammar or corpus checks.
function allowRows(text, parsers) { return parsers.readAllowList(text).problems; }
function normalizationRows(text) {
  const problems = [];
  for (const [index, raw] of text.split(/\r\n|\r|\n/).entries()) {
    const line = raw.split("#", 1)[0].trim();
    if (!line || /^@Part[0-3]$/.test(line)) continue;
    const columns = line.split(";");
    if (columns.length !== 6 || columns[5].trim() || columns.slice(0, 5).some((column) => {
      if (!column.trim()) return true;
      return column.trim().split(/\s+/).some((hex) => !/^[0-9A-F]{4,6}$/.test(hex)
        || Number.parseInt(hex, 16) > 0x10ffff || (Number.parseInt(hex, 16) >= 0xd800 && Number.parseInt(hex, 16) <= 0xdfff));
    })) problems.push(`line ${index + 1}: expected five scalar-sequence columns and a final semicolon`);
  }
  return problems;
}

// Token fields are caller payloads. Their types remain the main runners' job,
// including intentional usage errors. Unknown members are always errors.
function tokenMembers(value) {
  if (!Array.isArray(value)) return ["expected an array of token objects"];
  const allowed = ["text", "tags", "span", "source", "value", "image", "before", "after"];
  const pending = value.map((token, index) => [token, `[${index}]`]), problems = [];
  while (pending.length) {
    const [token, at] = pending.pop();
    if (token === null || typeof token !== "object" || Array.isArray(token)) {
      problems.push(`${at}: expected a token object`);
      continue;
    }
    for (const key of Object.keys(token)) if (!allowed.includes(key)) problems.push(`${at}: unknown token member ${key}`);
    for (const side of ["before", "after"]) if (Array.isArray(token[side])) {
      token[side].forEach((child, index) => pending.push([child, `${at}.${side}[${index}]`]));
    }
  }
  return problems;
}

// Hashes describe bytes, except for variant text, whose bytes are UTF-8.
// The context supplies files and corpus records without executing a case.
function manifestProblems(value, context) {
  const problems = [], corpus = context.corpus();
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  for (const source of value.sources) {
    for (const field of ["html", "extracted"]) {
      const relative = `text-sources/${source[field]}`;
      if (!context.files.has(relative)) continue; // The reference check reports it.
      try {
        if (sha256(context.read(relative)) !== source[`${field}_sha256`]) problems.push(`${relative}: ${field}_sha256 differs from the file bytes`);
      } catch (error) { problems.push(`${relative}: cannot read the snapshot: ${error.message}`); }
    }
    for (const variant of source.variants) {
      const at = `${source.id}/${variant.name}`, texts = new Set();
      if (!variant.changes.length && variant.text_sha256 !== source.extracted_sha256) {
        problems.push(`${at}: an unchanged variant must use extracted_sha256`);
      }
      for (const id of variant.cases) {
        const records = corpus.get(id);
        if (!records) problems.push(`${at}: unknown corpus case ${id}`);
        else for (const text of records) texts.add(text);
      }
      if (texts.size > 1) problems.push(`${at}: the corpus cases must share one text`);
      for (const text of texts) if (sha256(text) !== variant.text_sha256) {
        problems.push(`${at}: text_sha256 differs from the corpus text`);
      }
    }
  }
  return problems;
}
