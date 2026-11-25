// Result 18: the canonical JSON of a format 50 parse (docs/output.md).
// Occurrence IDs number the body of each tree in preorder, then the
// synthetic occurrences by producer, item and binding. Earlier stages keep
// compact records: their roots, the nodes of their tokens, and the targets
// of primary, part, producer and face links.

import { GencmuError } from "../errors.js";
import { compareCodePoints } from "../tags.js";
import { BARE, Bag, CLASS_KEY } from "./bag.js";
import { decoration, unitFace } from "./faces.js";


/**
 * The JSON value of a payload or a bag.
 * @param {any} value
 * @returns {any}
 */
export function propsJson(value) {
  if (value instanceof Bag) {
    /** @type {Record<string, any>} */
    const object = {};
    for (const key of value.keys()) {
      const entry = value.entry(key);
      object[key] = entry === BARE ? true : propsJson(entry.deferred.force());
    }
    return object;
  }
  if (Array.isArray(value)) return value.map(propsJson);
  return value;
}

/**
 * The tables of a result: one for each chosen tree and displayed reading.
 * A table numbers its occurrences.
 */
class Table {
  /**
   * @param {any} stage
   * @param {any} reading
   * @param {any} root
   */
  constructor(stage, reading, root) {
    this.stage = stage;
    this.reading = reading;
    this.root = root;
    /** @type {Map<any, number>} */
    /** @type {Map<any, number>} */
    this.ids = new Map();
    this.nodes = [];
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      this.ids.set(node, this.nodes.length);
      this.nodes.push(node);
      for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]);
    }
    const synthetic = [...(root.synthetic ?? [])].sort((a, b) =>
      /** @type {number} */ (this.ids.get(a.producer)) - /** @type {number} */ (this.ids.get(b.producer)) || a.item - b.item);
    for (const node of synthetic) {
      this.ids.set(node, this.nodes.length);
      this.nodes.push(node);
    }
  }
}

/**
 * The canonical record of a format 50 result.
 * @param {any} result
 * @param {{stageTrees?: "compact" | "all"}} [options]
 */
export function resultRecord(result, options = {}) {
  const all = (options.stageTrees ?? result.stageTrees ?? "compact") === "all";
  const stages = result.stages;
  const tables = stages.map((/** @type {any} */ stage, /** @type {any} */ index) => stage.root ? new Table(index, 0, stage.root) : null);
  const readings = stages.map((/** @type {any} */ stage, /** @type {any} */ index) => (stage.readings ?? []).map((/** @type {any} */ root, /** @type {any} */ reading) => new Table(index, reading + 1, root)));
  const reporting = stages.length - 1;
  // The face of each published node, and the core that it names.
  const faces = new Map();
  /**
   * @param {any} stageIndex
   * @param {any} node
   */
  const coreOf = (stageIndex, node) => {
    let stage = stageIndex;
    let current = node;
    for (;;) {
      if (current.kind === "projection") current = current.part;
      else if ((current.kind === "rule" || current.kind === "splice") && current.primary) current = current.primary;
      else if (current.kind === "token" && current.input) {
        if (stage === 0) return [-1, 0, current.token];
        const previous = current.input.node;
        stage -= 1;
        if (!previous) return [-1, 0, current.token];
        current = previous;
      } else return [stage, 0, tables[stage].ids.get(current)];
    }
  };
  // A decorated face names its parts: the satellites before the primary,
  // the primary, and the satellites after it. Each satellite is a display
  // unit with a face of its own.
  /**
   * @param {any} index
   * @param {any} node
   * @param {any} image
   * @param {any} classes
   */
  const faceOf = (index, node, image, classes) => {
    /** @type {any} */
    const face = { image, classes, core: coreOf(index, node) };
    const decorated = decoration(node);
    if (decorated) {
      const base = node.kind === "projection" ? node.part : node;
      /** @param {any} unit */
      const ref = unit => [index, 0, tables[index].ids.get(unit)];
      face.parts = [...decorated.before.map(ref), ref(base.primary), ...decorated.after.map(ref)];
      face.primaryIndex = decorated.before.length;
      for (const unit of [...decorated.before, ...decorated.after]) {
        if (!faces.has(unit)) {
          const shown = unitFace(unit);
          faces.set(unit, faceOf(index, unit, shown.image, shown.classes));
        }
      }
    }
    return face;
  };
  stages.forEach((/** @type {any} */ stage, /** @type {any} */ index) => {
    for (const token of stage.output ?? []) {
      faces.set(token.node, faceOf(index, token.node, token.image,
        token.props.keys().filter((/** @type {any} */ key) => CLASS_KEY.test(key)).sort(compareCodePoints)));
    }
  });
  // Retention: full tables keep every node, compact ones follow the links.
  const keep = tables.map((/** @type {any} */ table, /** @type {any} */ index) => table && (all || index === reporting || stages[index].error) ? null : new Set());
  /** @type {any[]} */
  const pending = [];
  /**
   * @param {any} stage
   * @param {any} node
   */
  const mark = (stage, node) => {
    if (stage < 0 || !keep[stage] || keep[stage].has(node)) return;
    keep[stage].add(node);
    pending.push([stage, node]);
  };
  stages.forEach((/** @type {any} */ stage, /** @type {any} */ index) => {
    if (!tables[index]) return;
    if (keep[index] === null) for (const node of tables[index].nodes) pending.push([index, node]);
    mark(index, stage.root);
    for (const token of stage.output ?? []) mark(index, token.node);
  });
  while (pending.length) {
    const [stage, node] = /** @type {any[]} */ (pending.pop());
    for (const target of [node.primary, node.part, node.producer]) if (target) mark(stage, target);
    const face = faces.get(node);
    if (face && face.core[0] >= 0) mark(face.core[0], tables[face.core[0]].nodes[face.core[2]]);
    for (const part of face?.parts ?? []) mark(part[0], tables[part[0]].nodes[part[2]]);
  }
  /** @type {any} */
  const record = {
    format: 18,
    ok: result.ok,
    input: { text: result.text, tokens: result.origin.map((/** @type {any} */ token) => tokenRecord(token, null)) },
    stages: stages.map((/** @type {any} */ stage, /** @type {any} */ index) => {
      const table = tables[index];
      /** @type {any} */
      const out = { name: stage.name, verdict: stage.verdict ?? null, input: index - 1 };
      if (table) {
        out.root = table.ids.get(stage.root);
        const full = keep[index] === null;
        out.nodes = table.nodes.filter((/** @type {any} */ node) => full || keep[index].has(node))
          .map((/** @type {any} */ node) => nodeRecord(node, table, full, faces));
      }
      if (readings[index].length) {
        out.readings = readings[index].map((/** @type {any} */ reading) => ({
          root: reading.ids.get(reading.root),
          nodes: reading.nodes.map((/** @type {any} */ node) => nodeRecord(node, reading, true, faces)),
        }));
      }
      if (stage.witness) out.witness = stage.witness;
      if (stage.output) out.output = stage.output.map((/** @type {any} */ token) => tokenRecord(token, table.ids.get(token.node)));
      if (stage.errors?.length) out.errors = stage.errors;
      if (stage.warnings?.length) out.warnings = stage.warnings;
      return out;
    }),
    tree: result.ok || result.error?.kind === "reported" ? [reporting, 0, tables[reporting].ids.get(stages[reporting].root)] : null,
    error: result.error ? errorRecord(result.error, stages, readings) : null,
  };
  if (result.warnings?.length) record.warnings = result.warnings;
  return record;
}

/**
 * @param {any} node
 * @param {any} table
 * @param {any} full
 * @param {any} faces
 */
function nodeRecord(node, table, full, faces) {
  const id = table.ids;
  /** @type {any} */
  const out = { id: id.get(node), kind: node.kind };
  if (node.kind === "rule" || node.kind === "splice") out.rule = node.rule;
  if (node.kind === "token" || node.kind === "elided") out.terminal = node.terminal;
  if (node.kind === "token") out.token = node.token;
  out.span = [...node.span];
  out.source = [...node.source];
  if (node.kind === "elided" && node.default !== undefined) out.default = node.default;
  if (full && (node.kind === "rule" || node.kind === "splice")) out.children = node.children.map((/** @type {any} */ child) => id.get(child));
  if (node.primary) out.primary = id.get(node.primary);
  if (node.producer) out.producer = id.get(node.producer);
  if (node.part) out.part = { node: id.get(node.part) };
  const face = faces.get(node);
  if (face) out.face = face;
  return out;
}

/**
 * @param {any} token
 * @param {any} node
 */
function tokenRecord(token, node) {
  const out = {};
  if (node !== null && node !== undefined) out.node = node;
  out.text = token.text;
  out.props = propsJson(token.props);
  out.span = [...token.span];
  out.source = [...token.source];
  if (token.insertedBy !== undefined) out.insertedBy = token.insertedBy;
  if (token.errors?.length) out.errors = token.errors;
  if (token.warnings?.length) out.warnings = token.warnings;
  return out;
}

/** @type {Record<string, string[]>} */
const ERROR_ORDER = {
  rejected: ["kind", "stage", "token", "source", "line", "column", "expected", "boundary", "errors", "warnings", "message"],
  ambiguous: ["kind", "stage", "reason", "readings", "witness", "errors", "message"],
  "feature-conflict": ["kind", "stage", "feature", "errors", "warnings", "message"],
  grammar: ["kind", "stage", "code", "errors", "warnings", "message", "chosen", "completion"],
  reported: ["kind", "stage", "errors", "message"],
};

/**
 * @param {any} error
 * @param {any} stages
 * @param {any} readings
 */
function errorRecord(error, stages, readings) {
  const index = stages.findIndex((/** @type {any} */ stage) => stage.name === error.stage && stage.error === error);
  const fields = { ...error };
  if (error.kind === "ambiguous" && index >= 0) {
    fields.readings = readings[index].map((/** @type {any} */ reading) => [index, reading.reading, reading.ids.get(reading.root)]);
  }
  /** @type {Record<string, any>} */
  const out = {};
  for (const key of ERROR_ORDER[error.kind] ?? Object.keys(error)) {
    if (fields[key] !== undefined && !(Array.isArray(fields[key]) && !fields[key].length && (key === "errors" || key === "warnings"))) out[key] = fields[key];
  }
  return out;
}

/**
 * The canonical JSON text of a format 50 result.
 * @param {any} result
 * @param {any} options
 */
export function resultJson50(result, options) {
  return JSON.stringify(resultRecord(result, options));
}

/**
 * Decodes the canonical JSON of a result and checks its references.
 * @param {string} text
 */
export function decodeResult50(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new GencmuError("usage", `the result is not JSON: ${/** @type {Error} */ (error).message}`);
  }
  /** @param {any} description */
  const fail = description => { throw new GencmuError("usage", `the result is malformed: ${description}`); };
  if (!data || data.format !== 18) fail("it requires format 18");
  if (!Array.isArray(data.stages) || !data.input || !Array.isArray(data.input.tokens)) fail("it requires input and stages");
  const tables = data.stages.map((/** @type {any} */ stage) => new Map((stage.nodes ?? []).map((/** @type {any} */ node) => [node.id, node])));
  const readingTables = data.stages.map((/** @type {any} */ stage) => (stage.readings ?? []).map((/** @type {any} */ reading) => new Map(reading.nodes.map((/** @type {any} */ node) => [node.id, node]))));
  /** @param {any} index */
  const ordinal = index => ["first", "second", "third", "fourth", "fifth"][index] ?? `${index + 1}th`;
  /**
   * @param {any} stage
   * @param {any} table
   * @param {any} id
   * @param {any} what
   */
  const local = (stage, table, id, what) => {
    if (!Number.isInteger(id) || !table.has(id)) fail(`the ${ordinal(stage)} stage has no node with local ID ${id} for ${what}`);
  };
  /**
   * @param {any} reference
   * @param {any} what
   */
  const qualified = (reference, what) => {
    if (!Array.isArray(reference) || reference.length !== 3 || !reference.every(Number.isInteger)) fail(`${what} is not a qualified reference`);
    const [stage, reading, id] = reference;
    if (stage === -1) {
      if (reading !== 0 || id < 0 || id >= data.input.tokens.length) fail(`${what} names no origin token`);
      return;
    }
    if (stage < 0 || stage >= data.stages.length) fail(`${what} names no stage`);
    const table = reading === 0 ? tables[stage] : readingTables[stage][reading - 1];
    if (!table) fail(`${what} names no reading`);
    local(stage, table, id, what);
  };
  data.stages.forEach((/** @type {any} */ stage, /** @type {any} */ index) => {
    /** @param {any} table */
    const checkTable = (table) => {
      for (const node of table.values()) {
        for (const child of node.children ?? []) local(index, table, child, "a child");
        if (node.primary !== undefined) local(index, table, node.primary, "a primary");
        if (node.producer !== undefined) local(index, table, node.producer, "a producer");
        if (node.part !== undefined) local(index, table, node.part.node, "a part");
        if (node.face) qualified(node.face.core, "a face core");
      }
    };
    checkTable(tables[index]);
    readingTables[index].forEach(checkTable);
    for (const token of stage.output ?? []) local(index, tables[index], token.node, "an output token");
    if (stage.root !== undefined) local(index, tables[index], stage.root, "the root");
  });
  for (const token of data.input.tokens) if (token.node !== undefined) fail("an origin token names a node");
  if (data.tree !== null && data.tree !== undefined) qualified(data.tree, "the tree");
  return data;
}
