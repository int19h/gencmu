// @ts-nocheck
// The format 50 loader recognizes a stage with the format 49 recognizer.
// This module lowers one DOM 50 document to the records that the recognizer
// reads. Recognition sees the visible keys of a bag as tags, the certified
// rule values as strings, and the conditions as format 49 conditions. Bags,
// emission and results stay in the format 50 modules.

import { GencmuError } from "../errors.js";

/** The capture name that marks a primary without a written label. */
export const PRIMARY_CAPTURE = "^";

const STAGE_CONSTANTS = new Set(["INPUTS", "OUTPUTS", "DEFAULTS"]);
const SYMBOL_KEYS = ["ref", "call", "param", "literal", "range", "wildcard", "splice", "test"];
const SPAN_METHODS = new Set([
  "first-token", "last-token", "tokens-after-first", "onward", "following-tokens", "preceding-tokens",
  "starts-input", "ends-input", "source-text", "decomposed-source-text", "verbatim-text",
  "without-elision", "without-elision-except", "followed-by", "preceded-by", "parse", "error-free",
]);

/** A visible key: a capitalized key or an engine key. */
export function isVisibleKey(key) {
  return /^[A-Z_]/.test(key);
}

/**
 * The format 49 records of one DOM 50 document, for recognition.
 * @param {any} dom a valid DOM 50
 * @param {string} path the document
 * @returns {any} a DOM 49 with the extra members `format50` and `origins`
 */
export function bridgeDocument(dom, path, origins) {
  return new Bridge(dom, path, origins).document();
}

class Bridge {
  constructor(dom, path, origins) {
    this.dom = dom;
    this.path = path;
    this.origins = origins;
    this.classifiers = [];
    /** @type {Map<string, GencmuError>} the rules whose keys have no tag term */
    this.untranslated = new Map();
    /** @type {Set<string>} the rules whose keys a recognizer test reads */
    this.keyReaders = new Set();
    /** @type {Map<string, string>} the symbol of each capture of the rule in hand */
    this.captureSymbols = new Map();
  }

  // Each bridged record names its format 50 record, so that the stage can
  // find it after stitching copies the record.
  origin(record) {
    const id = `${this.path}#${this.origins.size}`;
    this.origins.set(id, { ...record, document: this.path });
    return id;
  }

  fail(description, at) {
    throw new GencmuError("grammar", `the format 50 recognizer cannot yet ${description}`,
      { document: this.path, ...(at ? { line: at[0], column: at[1] } : {}) });
  }

  document() {
    const constants = [];
    // The stage reads each constant through its format 50 record. The
    // recognizer gets a placeholder for each one, with its value where a
    // condition or a filter reads it.
    for (const constant of this.dom.constants) {
      if (constant.name === "INPUTS") throw new GencmuError("grammar", "a grammar cannot define $INPUTS", { document: this.path, line: constant.at[0], column: constant.at[1] });
      const origin50 = this.origin({ constant });
      if (!STAGE_CONSTANTS.has(constant.name) && constant.value.bag && this.isClassifier(constant.value)) {
        this.classifiers.push(this.classifier(constant));
      }
      constants.push({ name: constant.name, op: constant.op, value: this.data(constant.value), at: constant.at, origin50 });
    }
    return {
      format: 49,
      rules: this.dom.rules.map(rule => this.rule(rule)),
      directives: this.dom.directives.map(directive => this.directive(directive)),
      constants,
      classifiers: this.classifiers,
      implications: [],
      untranslated: this.untranslated,
      keyReaders: this.keyReaders,
    };
  }

  isClassifier(value) {
    return value.bag.every(entry => entry.kind === "write" && classValue(entry.value) !== null);
  }

  // A classifier for the recognizer. A class that names other classes gets
  // their strings, with the gates on the path to each string.
  classifier(constant) {
    const classes = new Map();
    for (const entry of constant.value.bag) {
      for (const key of entry.keys) {
        if (!classes.has(key)) classes.set(key, []);
        classes.get(key).push({ gates: entry.gates, value: classValue(entry.value), at: entry.at });
      }
    }
    const entries = [];
    const expand = (key, gates, at, path) => {
      for (const row of classes.get(key) ?? []) {
        const combined = [...gates, ...row.gates];
        if (row.value.strings) {
          if (row.value.strings.length) entries.push({ gates: combined, keys: row.value.strings.map(string => ({ string })), op: "∈", class: path[0], at });
        } else {
          for (const target of row.value.references) if (!path.includes(target)) expand(target, combined, at, [...path, target]);
        }
      }
    };
    for (const [key, rows] of classes) expand(key, [], rows[0].at, [key]);
    return { name: constant.name, entries, at: constant.at };
  }

  data(value) {
    if (value.string !== undefined) return { string: value.string };
    if (value.list && value.list.every(item => item.value.string !== undefined)) return { union: value.list.map(item => this.data(item.value)) };
    // The recognizer reads only strings and lists of strings from a
    // constant. Any other constant gets a string that nothing reads.
    return { string: "" };
  }

  directive(directive) {
    const copy = { ...directive };
    if (directive.conditions) copy.conditions = directive.conditions.map(node => this.truth(node));
    if (directive.steps) copy.steps = directive.steps.map(step => step.pattern ? { ...step, pattern: this.pattern(step.pattern) } : step);
    return copy;
  }

  rule(rule) {
    if (rule.instance) return { ...rule };
    const copy = { name: rule.name, op: rule.op };
    if (rule.params) copy.params = rule.params;
    if (rule.args) copy.args = rule.args.map(arg => this.argument(arg));
    copy.alternatives = rule.alternatives.map(alternative => this.alternative(alternative, rule));
    this.captureSymbols = new Map();
    this.currentRule = rule.name;
    for (const alternative of rule.alternatives) collectCaptureSymbols(alternative.expr, this.captureSymbols);
    copy.conditions = rule.conditions.map(node => this.truth(node));
    if (rule.error) copy.error = this.message(rule.error);
    if (rule.warning) copy.warning = this.message(rule.warning);
    if (rule.suppressWarnings) copy.suppressWarnings = rule.suppressWarnings;
    if (rule.erased) copy.erased = true;
    copy.at = rule.at;
    return copy;
  }

  alternative(alternative, rule) {
    const primary = { name: null };
    const expr = this.body(alternative.expr, primary);
    const origin50 = this.origin({ rule, alternative, ...(primary.name !== null ? { primary: primary.name } : {}) });
    const copy = { gates: alternative.gates, expr, origin50 };
    let tags;
    try {
      tags = this.alternativeTags(alternative, rule, primary.name);
    } catch (error) {
      if (!(error instanceof GencmuError)) throw error;
      // The keys of this bag cannot become a tag term. That is a problem
      // only where a recognizer test reads the keys of the rule.
      this.untranslated.set(rule.name, error);
      tags = { emptySet: true };
    }
    if (tags !== undefined) copy.tags = tags;
    return copy;
  }

  // The visible keys of the bag of an alternative, as a tag term. The
  // sources apply in their order: the primary or the sole symbol, the
  // statement term, then the alternative term. A plain sole symbol keeps
  // the singleton inheritance of the recognizer, which gives the same keys.
  alternativeTags(alternative, rule, primary) {
    const terms = [rule.term, alternative.term].filter(Boolean);
    let tags = null;
    if (primary !== null) tags = { method: "tags", receiver: { capture: primary }, args: [] };
    else if (!terms.length) return isPlainSymbol(alternative.expr) ? undefined : { emptySet: true };
    for (const term of terms) tags = this.bagTags(term, tags);
    return tags ?? { emptySet: true };
  }

  bagTags(term, tags) {
    const union = (left, right) => left === null ? right : { union: [left, right] };
    for (const entry of term.bag) {
      let written = null;
      let deleted = null;
      switch (entry.kind) {
        case "bare":
          if (isVisibleKey(entry.key)) written = { tag: entry.key };
          break;
        case "write":
          for (const key of entry.keys.filter(isVisibleKey)) written = union(written, { tag: key });
          break;
        case "copy":
          if (isVisibleKey(entry.key)) {
            written = { intersection: [this.tagsOf(entry.source, entry.at), { tag: entry.key }] };
          }
          break;
        case "splat":
          written = this.tagsOf(entry.value, entry.at);
          break;
        case "delete":
          if (isVisibleKey(entry.key)) deleted = { tag: entry.key };
          break;
        default:
          this.fail(`read the entry ${entry.kind}`, entry.at);
      }
      if (written === null && deleted === null) continue;
      if (entry.gates.length) this.fail("gate an entry of a bag", entry.at);
      if (entry.guard) {
        if (deleted !== null) this.fail("guard a deletion", entry.at);
        written = { if: this.truth(entry.guard), then: written };
      }
      if (deleted !== null) tags = tags === null ? null : { difference: [tags, deleted] };
      else tags = union(tags, written);
    }
    return tags;
  }

  // The visible keys of a bag or a node, as a tag term.
  tagsOf(node, at) {
    if (node.capture !== undefined) return { method: "tags", receiver: { capture: node.capture }, args: [] };
    if (node.method === "flags" || node.method === "keys") return this.tagsOf(node.receiver, at);
    if (node.method === "classify" && node.receiver.const !== undefined) {
      return { method: "classify", receiver: this.string(node.args[0]), args: [{ classifier: node.receiver.const }] };
    }
    if (node.method === "parse") return { method: "tags", receiver: this.expression(node), args: [] };
    return this.fail("read the keys of this expression", node.at ?? at);
  }

  message(node) {
    return this.string(node);
  }

  argument(arg) {
    if (arg.expression) return { expression: this.expression(arg.expression), at: arg.at };
    if (arg.body) return { ...arg, body: this.body(arg.body, { name: null }) };
    return { ...arg };
  }

  // A body record of format 50 is a body record of format 49, with a mark
  // for the primary and positions on tests.
  body(node, primary) {
    if (node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(item => this.body(item, primary));
    if (node.primary) {
      const inner = node.primary;
      if (inner.capture !== undefined) {
        primary.name = inner.capture;
        return this.body(inner, primary);
      }
      primary.name = PRIMARY_CAPTURE;
      return { capture: PRIMARY_CAPTURE, expr: this.body(inner, primary) };
    }
    if (node.test !== undefined) {
      if (node.test === "tags") {
        let base = node.expr;
        while (base.capture !== undefined || base.test !== undefined) base = base.expr;
        if (base.ref !== undefined && /^[a-z]/.test(base.ref)) this.keyReaders.add(base.ref);
      }
      const copy = { test: node.test };
      if (node.requirements) copy.requirements = node.requirements.map(item => ({ negated: item.negated, value: this.requirement(item.value) }));
      if (node.value) copy.value = this.stringOperand(node.value);
      copy.expr = this.body(node.expr, primary);
      return copy;
    }
    if (node.literal) return { literal: this.stringOperand(node.literal) };
    if (node.range) return { range: node.range.map(item => this.stringOperand(item)) };
    if (node.optional && node.default) return { ...node, optional: this.body(node.optional, primary), default: this.stringOperand(node.default) };
    const copy = {};
    for (const [key, value] of Object.entries(node)) copy[key] = this.body(value, primary);
    return copy;
  }

  requirement(value) {
    if (value.tag !== undefined || value.param !== undefined) return { ...value };
    if (value.const !== undefined) return { const: value.const, ...(value.at ? { at: value.at } : {}) };
    return this.fail("read this requirement", value.at);
  }

  stringOperand(node) {
    if (node.string !== undefined) return { string: node.string };
    if (node.const !== undefined) return { const: node.const, ...(node.at ? { at: node.at } : {}) };
    if (node.param !== undefined) return { ...node };
    return this.fail("read this string operand", node.at);
  }

  pattern(node) {
    return node;
  }

  // A condition: an expression in a truth position.
  truth(node) {
    if (node.capture !== undefined) return node.capture === "" ? { emptySet: false } : { captured: node.capture };
    if (node.not) return { not: this.truth(node.not) };
    if (node.all) return { all: node.all.map(item => this.truth(item)) };
    if (node.any) return { any: node.any.map(item => this.truth(item)) };
    if (node.if !== undefined && node.else === undefined) return { if: this.truth(node.if), then: this.truth(node.then) };
    if (node.method === "classify" && node.receiver.const !== undefined) {
      return { op: "≠", left: this.tagsOf(node), right: { emptySet: true } };
    }
    if (node.method === "parse" || node.method === "starts-input" || node.method === "ends-input" ||
        node.method === "followed-by" || node.method === "preceded-by") return this.expression(node);
    if (node.op !== undefined) return this.comparison(node);
    // A read of a visible key with no value is a flag test. So is .has(k).
    const flag = node.property !== undefined && node.receiver ? node.property :
      node.method === "has" && node.args[0]?.key !== undefined ? node.args[0].key : undefined;
    if (flag !== undefined && isVisibleKey(flag) && flag !== "_Elided" && node.receiver?.capture !== undefined) {
      const symbol = this.captureSymbols.get(node.receiver.capture);
      if (node.receiver.capture === "" || (symbol !== undefined && /^[a-z]/.test(symbol))) {
        this.keyReaders.add(node.receiver.capture === "" ? this.currentRule : symbol);
      }
      return { op: "⊆", left: { tag: flag }, right: { method: "tags", receiver: { capture: node.receiver.capture }, args: [] } };
    }
    return this.fail("test this expression", node.at);
  }

  comparison(node) {
    const op = node.op;
    if (op === "∈" || op === "∉") {
      return { op, left: this.string(node.left), right: this.strings(node.right) };
    }
    if (op === "=" || op === "≠") return { op, left: this.string(node.left), right: this.string(node.right) };
    return this.fail(`compare with ${op}`, node.at);
  }

  strings(node) {
    if (node.list) return { union: node.list.map(item => this.string(item.value)) };
    if (node.const !== undefined) return { const: node.const, at: node.at };
    return this.fail("read this list", node.at);
  }

  // An expression with a string value.
  string(node) {
    if (node.string !== undefined) return { string: node.string };
    if (node.const !== undefined) return { const: node.const, at: node.at };
    if (node.concat) return { concat: node.concat.map(item => this.string(item)) };
    if (node.property === "value" && node.receiver) return { method: "value", receiver: this.expression(node.receiver), args: [] };
    if (node.property === "image" && node.receiver) return { method: "image", receiver: this.expression(node.receiver), args: [] };
    // The join of the input values of a span is the value of that span.
    if (node.method === "join" && !node.args.length && node.receiver.map &&
        node.receiver.by.property === "value" && node.receiver.map.method === "tokens") {
      return { method: "value", receiver: this.expression(node.receiver.map.receiver), args: [] };
    }
    if (node.method === "source-text" || node.method === "decomposed-source-text" || node.method === "verbatim-text") {
      return this.expression(node);
    }
    return this.fail("compute this string", node.at);
  }

  // A node or a span.
  expression(node) {
    if (node.capture !== undefined) return { capture: node.capture };
    if (node.method === "span") return this.expression(node.receiver);
    if (node.method !== undefined && SPAN_METHODS.has(node.method)) {
      const args = node.args.map(arg => {
        if (arg.body) return { body: this.body(arg.body, { name: null }) };
        if (arg.rule !== undefined || arg.terminal !== undefined || arg.call !== undefined || arg.param !== undefined) return { ...arg };
        return this.fail(`pass this argument to .${node.method}`, node.at);
      });
      return { method: node.method, receiver: this.expression(node.receiver), args };
    }
    return this.fail("read this expression", node.at);
  }
}

// The strings or the class references of a classifier entry, or null.
function classValue(value) {
  if (value.string !== undefined) return { strings: [value.string] };
  if (value.list?.every(item => item.kind === "item" && !item.gates.length && !item.guard && item.value.string !== undefined)) {
    return { strings: value.list.map(item => item.value.string) };
  }
  if (value.bag?.every(entry => entry.kind === "bare" && !entry.gates.length && !entry.guard)) {
    return { references: value.bag.map(entry => entry.key) };
  }
  return null;
}

// The rule or terminal that each capture of a body names.
function collectCaptureSymbols(node, symbols) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectCaptureSymbols(item, symbols);
    return;
  }
  if (node.capture !== undefined && node.expr) {
    let base = node.expr;
    while (base.test !== undefined || base.primary) base = base.expr ?? base.primary;
    if (base.ref !== undefined) symbols.set(node.capture, base.ref);
  }
  for (const value of Object.values(node)) if (value && typeof value === "object") collectCaptureSymbols(value, symbols);
}

function isPlainSymbol(node) {
  if (node.capture !== undefined) return isPlainSymbol(node.expr);
  if (node.choice) return node.choice.every(isPlainSymbol);
  return SYMBOL_KEYS.some(key => Object.hasOwn(node, key)) && !node.optional && !node.repeat;
}
