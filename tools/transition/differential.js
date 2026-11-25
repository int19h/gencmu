import assert from "node:assert/strict";
import { GencmuError } from "../../lib/js/src/errors.js";
import { compactJson } from "../../lib/js/src/output.js";
import { operandFields50, validateDocument50 } from "../../lib/js/src/format50/validate.js";
import { createTransitionCompiler } from "../transition-compiler.js";
import { inspectConverted50 } from "./dom.js";

const invalidName = "invalid name!";
const declarationKinds = ["rules", "directives", "constants"];
const nameFields = ["ref", "rule", "call", "constant", "const", "apply", "param", "terminal", "tag",
  "capture", "lambda", "method", "property", "feature", "key", "name", "step"];
const wrappers = new Set([...declarationKinds, "alternatives", "steps", "emit", "items", "children",
  "bag", "list", "gates", "requirements"]);

function declarations(dom) {
  return declarationKinds.flatMap(kind => dom[kind].map(record => [kind, record]))
    .sort(([, a], [, b]) => a.at[0] - b.at[0] || a.at[1] - b.at[1]);
}

export function diagnostic(action) {
  try {
    action();
  } catch (error) {
    if (!(error instanceof GencmuError)) throw error;
    return { kind: error.kind, description: error.description, message: error.message, where: error.where };
  }
  return null;
}

function reorder(root, order) {
  if (root === null || typeof root !== "object") return root;
  const allocate = node => Array.isArray(node) ? [] : Object.create(null);
  const result = allocate(root);
  const pending = [[root, result]];
  while (pending.length) {
    const [node, copy] = pending.pop();
    const fields = Array.isArray(node) ? node.entries() : order(Object.entries(node));
    const children = [];
    for (const [key, child] of fields) {
      if (child && typeof child === "object") {
        copy[key] = allocate(child);
        children.push([child, copy[key]]);
      } else copy[key] = child;
    }
    for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
  }
  return result;
}

function shuffle(seed) {
  return fields => {
    for (let i = fields.length - 1; i > 0; i--) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const next = (seed >>> 0) % (i + 1);
      [fields[next], fields[i]] = [fields[i], fields[next]];
    }
    return fields;
  };
}

function operandMutations(dom) {
  const result = [];
  function visit(node, path, parent, at) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const [index, child] of node.entries()) visit(child, [...path, String(index)], parent, at);
      return;
    }
    const site = node.at ?? at;
    const kind = path[0];
    const declaration = declarationKinds.includes(parent) && path.length === 2;
    for (const key of nameFields) {
      if (typeof node[key] !== "string" || declaration && kind === "directives" && key === "name") continue;
      result.push({ path: [...path, key], value: invalidName });
    }
    for (const [index] of (node.keys ?? []).entries()) result.push({ path: [...path, "keys", String(index)], value: invalidName });
    for (const key of ["params", "suppressWarnings"]) {
      for (const [index] of (node[key] ?? []).entries()) result.push({ path: [...path, key, String(index)], value: invalidName });
    }
    if (declaration && ["stage", "extend-stage", "redefine-stage", "features"].includes(node.name)) {
      for (const [index] of node.args.entries()) result.push({ path: [...path, "args", String(index)], value: invalidName });
    }
    if (path.length > 2 && !wrappers.has(parent) && !nameFields.some(key => typeof node[key] === "string")) {
      const name = node.wildcard || node.empty || node.primary || node.splice ? { ref: invalidName } : { const: invalidName };
      result.push({ path, value: { ...name, at: site } });
    }
    for (const [key, child] of operandFields50(node)) visit(child, [...path, key], key, site);
  }
  for (const kind of declarationKinds) visit(dom[kind], [kind], kind);
  return result;
}

function canPair(a, b) {
  return a.path.some((part, index) => index < b.path.length && part !== b.path[index]);
}

function mutate(dom, edits, run) {
  const undo = [];
  try {
    for (const { path, value } of edits) {
      const owner = path.slice(0, -1).reduce((node, key) => node[key], dom);
      const key = path.at(-1);
      undo.push([owner, key, owner[key]]);
      owner[key] = value;
    }
    return run();
  } finally {
    for (const [owner, key, value] of undo.reverse()) owner[key] = value;
  }
}

// A name fault is local to a declaration. The unedited document already
// passed. Keep the names preamble and the edited declarations in place.
function editedDeclarations(dom, edits) {
  if (!edits.length || dom.rules.length + dom.directives.length + dom.constants.length <= 16) return dom;
  const selected = new Map(declarationKinds.map(kind => [kind, new Set()]));
  for (const { path: [kind, index] } of edits) selected.get(kind).add(Number(index));
  const slice = { ...dom };
  for (const kind of declarationKinds) {
    slice[kind] = dom[kind].filter((record, index) => selected.get(kind).has(index) ||
      kind === "directives" && record.name === "names");
  }
  return slice;
}

export function createDifferential(window) {
  const counts = { sources: 0, valid: 0, prefix: 0, invalid: 0, sourceOnly: 0, single: 0, paired: 0 };
  const differences = [];
  const seen = new Set();
  const environments = new WeakMap();
  let environmentCount = 0;
  const sourceOnly = {};
  let operandsSeen = 0;
  let possiblePairs = 0;

  function observe({ markdown, document, inherited, unicode, dom, state, fault }, resources) {
    if (unicode && !environments.has(unicode)) environments.set(unicode, environmentCount++);
    const source = diagnostic(() => { if (fault) throw fault; });
    const identity = JSON.stringify([environments.get(unicode), document, inherited, resources, markdown, source]);
    if (seen.has(identity)) return;
    seen.add(identity);
    counts.sources++;
    if (!dom) {
      assert.ok(source, "conversion without a DOM must report a source fault");
      counts.sourceOnly++;
      sourceOnly[state] = (sourceOnly[state] ?? 0) + 1;
      return;
    }
    counts[source ? state === "prefix" ? "prefix" : "invalid" : "valid"]++;
    const configuration = { document, unicode };
    const roundtrip = (node, order) => JSON.parse(compactJson(reorder(node, order)));
    const reverseFields = fields => fields.reverse();
    const variants = [
      ["reverse", roundtrip(dom, reverseFields), reverseFields],
      ["seeded", roundtrip(dom, shuffle(0x50b007)), shuffle(0x45638)],
    ];
    const measured = new Set();
    const compare = (expected, edits, full = false) => {
      for (const [order, record, permute] of variants) {
        const permuted = edits.map(edit => ({ ...edit, value: reorder(edit.value, permute) }));
        const actual = mutate(record, permuted, () => diagnostic(() =>
          validateDocument50(full ? record : editedDeclarations(record, edits), configuration)));
        try {
          assert.deepEqual(actual, expected);
        } catch {
          differences.push({ document, markdown, order, paths: edits.map(edit => edit.path), expected, actual });
        }
      }
    };
    compare(source, []);
    if (source) return;

    // Invalid DOM names can have no legal token spelling. Replay the converted
    // records through the source reader's per-declaration validation in that case.
    const replay = (edits, full = false) => mutate(dom, edits, () => {
      const projection = full ? dom : editedDeclarations(dom, edits);
      return diagnostic(() => inspectConverted50(declarations(projection), configuration));
    });
    const compareMutation = (expected, edits) => {
      compare(expected, edits);
      if (editedDeclarations(dom, edits) === dom) return;
      const owners = edits.map(edit => edit.path.slice(0, 2).join("/")).sort().join(";");
      if (measured.has(owners)) return;
      measured.add(owners);
      // Exercise the full document once for each set of edited declarations.
      assert.deepEqual(replay(edits, true), expected);
      compare(expected, edits, true);
    };
    const operands = operandMutations(dom);
    const testedPairs = new Set();
    for (const [index, operand] of operands.entries()) {
      const cursor = operandsSeen++;
      const selected = !window || cursor >= window.start && cursor < window.start + window.count;
      if (selected) {
        const expected = replay([operand]);
        assert.ok(expected, `${document}: invalid name at ${operand.path.join("/")} did not fail`);
        counts.single++;
        compareMutation(expected, [operand]);
      }
      let next = operands.findIndex((other, i) => i > index && canPair(operand, other));
      if (next === -1) next = operands.findIndex(other => canPair(operand, other));
      if (next === -1) continue;
      const identity = `${Math.min(index, next)}:${Math.max(index, next)}`;
      if (testedPairs.has(identity)) continue;
      testedPairs.add(identity);
      possiblePairs++;
      if (selected) {
        const pair = [operand, operands[next]];
        counts.paired++;
        compareMutation(replay(pair), pair);
      }
    }
  }

  function finish(label, details = {}) {
    const coverage = window && { window, operandsSeen, possiblePairs };
    console.log(JSON.stringify({ differential: label, ...details, ...counts, ...coverage,
      sourceOnlyPhases: sourceOnly, differences: differences.length }));
    for (const difference of differences) console.log(JSON.stringify(difference));
    assert.equal(differences.length, 0, `${label}: source and reordered DOM diagnostics differ`);
  }

  const compiler = (read, resources) => createTransitionCompiler(read, {
    observeDocument: reading => observe(reading, resources?.()),
  });
  return { observe, finish, compiler };
}

// Share a reader and compiled source identities across one fixture batch.
export function fixtureDifferential(check) {
  let resources = {};
  const compilers = new Map();
  const seen = new Set();
  const reader = file => resources[file];
  const resourceKey = filter => JSON.stringify(Object.entries(resources).filter(([file]) => filter(file))
    .sort(([a], [b]) => a.localeCompare(b)));
  let context;
  const fence = lines => ["```jbogenbau", ...lines, "```"].join("\n");

  return ({ document, fixture }) => {
    resources = fixture?.documents ?? {};
    if (!document && !fixture?.source && !Object.keys(resources).length) return false;
    context = resourceKey(file => file.endsWith(".txt"));
    const key = resourceKey(file => file.includes("/unicode/"));
    if (!compilers.has(key)) {
      try {
        compilers.set(key, { compiler: check.compiler(reader, () => context) });
      } catch (fault) {
        if (!(fault instanceof GencmuError) || !fault.where.document?.startsWith("data/unicode/")) throw fault;
        compilers.set(key, { fault });
      }
    }
    const { compiler, fault } = compilers.get(key);
    const compile = (text, path) => {
      const identity = JSON.stringify([context, path, text]);
      if (seen.has(identity)) return;
      seen.add(identity);
      if (fault) check.observe({ markdown: text, document: path, state: "resource", fault }, context);
      else diagnostic(() => compiler.compileDocument(text, path));
    };
    if (document) compile(document, fixture?.pipelineDocument ?? "notation.md");
    else if (fixture?.source) compile(fence(fixture.source), "notation.md");
    if (compiler && fixture?.pipelineDocument && Object.values(resources).some(text => text.includes("%names"))) {
      // Pipeline reading supplies the inherited names at each include.
      diagnostic(() => compiler.compilePipeline(fixture.pipelineDocument));
    }
    for (const [file, source] of Object.entries(resources)) {
      if (!file.endsWith(".txt")) compile(source, file);
    }
    return true;
  };
}
