// @ts-nocheck
// The format 50 loader recognizes a stage with the format 49 recognizer.
// This module lowers one DOM 50 document to the records that the recognizer
// reads. Recognition sees the visible keys of a bag as tags, the certified
// rule values as strings, and the conditions as format 49 conditions. Bags,
// emission and results stay in the format 50 modules.

import { GencmuError } from "../errors.js";

/**
 * The capture name that marks a primary without a written label. The
 * bridge adds underscores until no capture of the rule has the name.
 */
export const PRIMARY_CAPTURE = "primary_";

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
    /** @type {GencmuError[]} the conditions that the recognizer cannot test */
    this.deferred = [];
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
    this.payloadReads = payloadReads(this.dom.rules);
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
      deferred: this.deferred,
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
    return { name: classifierName(constant.name), entries, at: constant.at };
  }

  data(value) {
    if (value.string !== undefined) return { string: value.string };
    if (value.list?.length && value.list.every(item => item.value.string !== undefined)) return { union: value.list.map(item => this.data(item.value)) };
    // A key set of visible keys holds its tags.
    const keys = keySetKeys(value, this.dom.constants);
    if (keys?.length) return keys.length === 1 ? { tag: keys[0] } : { union: keys.map(key => ({ tag: key })) };
    // The recognizer reads only strings and lists of strings from a
    // constant. Any other constant gets a string that nothing reads.
    return { string: "" };
  }

  directive(directive) {
    const copy = { ...directive };
    // The pipeline evaluates the conditions of %features itself, so the
    // recognizer gets the directive with no conditions. The format 49
    // reader ignores the extra member.
    if (directive.conditions) {
      copy.conditions = [];
      copy.conditions50 = directive.conditions;
    }
    if (directive.steps) copy.steps = directive.steps.map(step => step.pattern ? { ...step, pattern: this.pattern(step.pattern) } : step);
    return copy;
  }

  rule(rule) {
    if (rule.instance) return { ...rule, instance: { ...rule.instance, args: rule.instance.args.map(arg => this.argument(arg)) } };
    const copy = { name: rule.name, op: rule.op };
    if (rule.params) copy.params = rule.params;
    if (rule.args) copy.args = rule.args.map(arg => this.argument(arg));
    copy.alternatives = rule.alternatives.map(alternative => this.alternative(alternative, rule));
    this.captureSymbols = new Map();
    this.currentRule = rule.name;
    for (const alternative of rule.alternatives) collectCaptureSymbols(alternative.expr, this.captureSymbols);
    try {
      copy.conditions = rule.conditions.map(node => this.truth(node));
    } catch (error) {
      if (!(error instanceof GencmuError)) throw error;
      // The stage checks report their own errors before this one.
      this.deferred.push(error);
      copy.conditions = [];
    }
    if (rule.error) copy.error = this.message(rule.error);
    if (rule.warning) copy.warning = this.message(rule.warning);
    if (rule.suppressWarnings) copy.suppressWarnings = rule.suppressWarnings;
    if (rule.erased) copy.erased = true;
    copy.at = rule.at;
    return copy;
  }

  alternative(alternative, rule) {
    const used = new Map();
    for (const each of rule.alternatives) collectCaptureSymbols(each.expr, used);
    let synthetic = PRIMARY_CAPTURE;
    while ([...used.keys()].includes(synthetic)) synthetic += "_";
    const primary = { name: null, synthetic };
    const expr = this.body(alternative.expr, primary);
    const record = { rule, alternative, ...(primary.name !== null ? { primary: primary.name, primarySynthetic: primary.name === synthetic } : {}) };
    // The recognizer validates instance definitions strictly, so the
    // alternatives of a template name no origin. The stage finds them by
    // the template's name and the index of the alternative.
    let copy;
    if (rule.params) {
      this.origins.set(`template:${rule.name}#${rule.alternatives.indexOf(alternative)}`, { ...record, document: this.path });
      copy = { gates: alternative.gates, expr };
    } else {
      this.origins.set(alternativeKey(this.path, rule.at, rule.alternatives.indexOf(alternative)), { ...record, document: this.path });
      copy = { gates: alternative.gates, expr };
    }
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
    const base = this.writtenTags(alternative, rule, primary);
    const payloads = this.payloadTags(alternative, rule, primary);
    if (!payloads.length) return base;
    const extra = payloads.map(tag => ({ tag }));
    return base === undefined || base.emptySet ? (extra.length === 1 ? extra[0] : { union: extra }) : { union: [base, ...extra] };
  }

  // The hidden keys that let a recognizer test read a literal payload of
  // this rule: one for each key with a value, and one for each value.
  payloadTags(alternative, rule, primary) {
    const demands = this.payloadReads.get(rule.name);
    if (!demands) return [];
    const tags = [];
    for (const key of demands) {
      let writer = null;
      for (const term of [rule.term, alternative.term].filter(Boolean)) for (const entry of term.bag) {
        if (entry.kind === "write" && entry.keys.includes(key) || (entry.kind === "bare" || entry.kind === "delete" || entry.kind === "copy") && entry.key === key || entry.kind === "splat") writer = entry;
      }
      if (writer === null) {
        if (primary !== null || isPlainSymbol(alternative.expr)) this.fail(`read the payload ${key} that a primary or a sole symbol supplies`, rule.at);
        continue;
      }
      if (writer.gates.length || writer.guard) this.fail(`read the guarded payload ${key}`, writer.at);
      if (writer.kind === "bare" || writer.kind === "delete") continue;
      const literal = writer.kind === "write" ? literalPayload(writer.value) : undefined;
      if (literal === undefined) this.fail(`read the payload ${key} that this entry computes`, writer.at);
      tags.push(payloadTag(key), payloadTag(key, literal));
    }
    return tags;
  }

  writtenTags(alternative, rule, primary) {
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
  // The visible keys of a bag, a node, a span or a forest, as a tag term.
  tagsOf(node, at) {
    if (node.capture !== undefined) return { method: "tags", receiver: { capture: node.capture }, args: [] };
    if (node.param !== undefined) return { param: node.param, ...(node.at ? { at: node.at } : {}) };
    if (node.const !== undefined) {
      // Only a key set of visible keys in this document has a tag term.
      const versions = this.dom.constants.filter(constant => constant.name === node.const);
      if (!versions.length || !versions.every(constant => keySetKeys(constant.value, this.dom.constants)?.length)) {
        return this.fail("read the keys of the constant " + node.const, node.at ?? at);
      }
      return { const: node.const, ...(node.at ? { at: node.at } : {}) };
    }
    if (node.bag?.every(entry => (entry.kind === "bare" || entry.kind === "splat") && !entry.gates.length && !entry.guard)) {
      const parts = node.bag.map(entry => entry.kind === "bare" ? (isVisibleKey(entry.key) ? { tag: entry.key } : null) : this.tagsOf(entry.value, entry.at))
        .filter(Boolean);
      return parts.length === 0 ? { emptySet: true } : parts.length === 1 ? parts[0] : { union: parts };
    }
    if (node.intersection) return { intersection: node.intersection.map(item => this.tagsOf(item, at)) };
    if (node.union) return { union: node.union.map(item => this.tagsOf(item, at)) };
    if (node.difference) return { difference: node.difference.map(item => this.tagsOf(item, at)) };
    if (node.method === "flags" || node.method === "keys" || node.method === "classes") {
      const receiver = node.receiver;
      const method = node.method === "classes" ? "classes" : "tags";
      // A list of optional or repeated nodes has the union of their keys.
      if (receiver?.method === "union" && receiver.receiver?.map?.capture !== undefined &&
          receiver.receiver.by?.method === node.method) {
        return { method, receiver: { capture: receiver.receiver.map.capture }, args: [] };
      }
      if (receiver?.capture !== undefined) return { method, receiver: { capture: receiver.capture }, args: [] };
      if (receiver?.method === "parse" || receiver?.method === "error-free") return { method, receiver: this.expression(receiver), args: [] };
      // The keys of a span are those of its input tokens.
      if (receiver?.method !== undefined) return { method, receiver: this.expression(receiver), args: [] };
      return this.fail("read the keys of this expression", node.at ?? at);
    }
    if (node.method === "union" && node.receiver?.map?.capture !== undefined && ["flags", "keys"].includes(node.receiver.by?.method)) {
      return { method: "tags", receiver: { capture: node.receiver.map.capture }, args: [] };
    }
    if (node.method === "select") {
      return { intersection: [this.tagsOf(node.receiver, at), this.tagsOf(node.args[0], at)] };
    }
    if (node.method === "classify" && node.receiver.const !== undefined) {
      return { method: "classify", receiver: this.string(node.args[0]), args: [{ classifier: classifierName(node.receiver.const) }] };
    }
    if (node.method === "parse") return { method: "tags", receiver: this.expression(node), args: [] };
    return this.fail("read the keys of this expression", node.at ?? at);
  }

  message(node) {
    return this.string(node);
  }

  // A template argument. An expression argument becomes the recognizer's
  // term for it, and keeps its format 50 record for the stage to evaluate.
  argument(arg) {
    if (arg.expression) {
      const term = argumentTerm(arg.expression);
      if (term === null) this.fail("pass this expression to a template", arg.at);
      return term;
    }
    // The recognizer's argument records carry no position. The format 50
    // records keep it for the stage checks.
    const { at, ...rest } = arg;
    void at;
    if (rest.literal !== undefined && Object.keys(rest).length === 1) return this.stringOperand(rest.literal);
    if (rest.body) return { ...rest, body: this.body(rest.body, { name: null }) };
    if (rest.call !== undefined) return { ...rest, args: rest.args.map(item => this.argument(item)) };
    if (rest.test !== undefined || rest.capture !== undefined || rest.splice !== undefined) return this.body(rest, { name: null });
    return rest;
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
      primary.name = primary.synthetic ?? PRIMARY_CAPTURE;
      return { capture: primary.name, expr: this.body(inner, primary) };
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
    // The recognizer spells the omitted-only head [+T<_Elided>] as the
    // value test T="", which a written token of T never passes.
    if (node.optional && node.elidable) {
      const rewritten = omittedOnlyHead(node.optional);
      if (rewritten !== node.optional) {
        const copy = { ...node, optional: this.body(rewritten, primary) };
        if (node.default) copy.default = this.stringOperand(node.default);
        return copy;
      }
    }
    if (node.optional && node.default) return { ...node, optional: this.body(node.optional, primary), default: this.stringOperand(node.default) };
    if (node.call !== undefined && Array.isArray(node.args)) return { ...node, args: node.args.map(arg => this.argument(arg)) };
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
    // A closed expression reads only constants and literals. The stage
    // evaluates it for its features and input, before recognition.
    if (isClosed(node)) {
      this.hasClosed = true;
      return { closed50: this.origin({ closed: node }) };
    }
    // A span is true where its input window holds a token.
    if (isSpan(node)) {
      return { method: "parse", receiver: this.expression(node), args: [{ body: { seq: [{ wildcard: true }, { remainder: true }] } }] };
    }
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
    // A test for a payload, or a comparison of a payload with a literal,
    // reads the hidden keys of the payload.
    if (node.method === "has-value" && node.receiver?.capture !== undefined && node.args[0]?.key !== undefined) {
      return { op: "⊆", left: { tag: payloadTag(node.args[0].key) }, right: { method: "tags", receiver: { capture: node.receiver.capture }, args: [] } };
    }
    const payload = payloadComparison(node);
    if (payload) {
      return { op: payload.op === "=" ? "⊆" : "⊈", left: { tag: payloadTag(payload.key, payload.literal) },
        right: { method: "tags", receiver: { capture: payload.capture }, args: [] } };
    }
    // A predicate on each n-gram of a string reads the set of n-grams. A
    // list of n-grams and its set give the same answer to .all and .any.
    if ((node.method === "all" || node.method === "any") && node.receiver?.method === "ngrams") {
      const grams = { method: "ngrams", receiver: this.string(node.receiver.receiver), args: [{ integer: node.receiver.args[0].integer }] };
      const test = ngramPredicate(node.args[0]);
      if (test) {
        const set = test.op === "∈" ? this.strings(test.right) : { union: [this.string(test.right)] };
        const inside = test.op === "∈" || test.op === "=";
        if (node.method === "all") return { op: inside ? "⊆" : "=", left: inside ? grams : { intersection: [grams, set] }, right: inside ? set : { emptySet: true } };
        return { op: "≠", left: inside ? { intersection: [grams, set] } : { difference: [grams, set] }, right: { emptySet: true } };
      }
    }
    // A forest has a root with a visible key where the union of the keys
    // of its roots has that key.
    if (node.method === "any" && (node.receiver?.method === "parse" || node.receiver?.method === "error-free") &&
        node.args[0]?.lambda === "" && node.args[0].body?.property !== undefined && node.args[0].body.receiver?.item &&
        isVisibleKey(node.args[0].body.property)) {
      return { op: "⊆", left: { tag: node.args[0].body.property }, right: { method: "tags", receiver: this.expression(node.receiver), args: [] } };
    }
    // An overlap of two key sets is a nonempty intersection.
    if (node.method === "overlaps") {
      return { op: "≠", left: { intersection: [this.keySet(node.receiver), this.keySet(node.args[0])] }, right: { emptySet: true } };
    }
    if (node.op !== undefined) return this.comparison(node);
    // A read of a visible key with no value is a flag test. So is .has(k).
    const flag = node.property !== undefined && node.receiver ? node.property :
      node.method === "has" && node.args[0]?.key !== undefined ? node.args[0].key : undefined;
    if (flag !== undefined && isVisibleKey(flag) && flag !== "_Elided" && node.receiver?.capture !== undefined) {
      const symbol = this.captureSymbols.get(node.receiver.capture);
      // A leaf that a terminal reads has the key of that terminal, also
      // where it is omitted.
      if (symbol === flag) return { captured: node.receiver.capture };
      if (node.receiver.capture === "" || (symbol !== undefined && /^[a-z]/.test(symbol))) {
        this.keyReaders.add(node.receiver.capture === "" ? this.currentRule : symbol);
      }
      return { op: "⊆", left: { tag: flag }, right: { method: "tags", receiver: { capture: node.receiver.capture }, args: [] } };
    }
    return this.fail("test this expression", node.at);
  }

  comparison(node) {
    const op = node.op;
    // Structural comparisons keep the pattern records of the recognizer.
    if ((op === "≅" || op === "≇") && (node.left.capture !== undefined || node.left.item)) {
      const right = node.right.pattern !== undefined ? { pattern: this.pattern(node.right.pattern) } :
        node.right.capture !== undefined ? { capture: node.right.capture } :
        node.right.const !== undefined ? { const: node.right.const, at: node.right.at } : null;
      if (right && node.left.capture !== undefined) return { op, left: { capture: node.left.capture }, right };
    }
    if (op === "∈" || op === "∉") {
      return { op, left: this.string(node.left), right: this.strings(node.right) };
    }
    if (op === "⊆" || op === "⊈") return { op, left: this.keySet(node.left), right: this.keySet(node.right) };
    if ((op === "=" || op === "≠") && (isKeySetRecord(node.left) || isKeySetRecord(node.right))) {
      return { op, left: this.keySet(node.left), right: this.keySet(node.right) };
    }
    if (op === "=" || op === "≠") return { op, left: this.string(node.left), right: this.string(node.right) };
    return this.fail(`compare with ${op}`, node.at);
  }

  strings(node) {
    if (node.list) return { union: node.list.map(item => this.string(item.value)) };
    if (node.method === "split") return { method: "split", receiver: this.string(node.receiver), args: [this.string(node.args[0])] };
    if (node.const !== undefined) return { const: node.const, at: node.at };
    return this.fail("read this list", node.at);
  }

  // A key set of visible keys, as a tag term.
  keySet(node) {
    return this.tagsOf(node, node.at);
  }

  // An expression with a string value.
  string(node) {
    if (node.string !== undefined) return { string: node.string };
    if (node.const !== undefined) return { const: node.const, at: node.at };
    if (node.concat) return { concat: node.concat.map(item => this.string(item)) };
    // A leaf bound under T="s" has the value s, written or omitted.
    if (node.property === "value" && node.receiver?.capture !== undefined && this.captureSymbols.has(`${node.receiver.capture}=`)) {
      return { string: this.captureSymbols.get(`${node.receiver.capture}=`) };
    }
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

// The head of an elidable optional with its positive _Elided requirement
// replaced by the value test of the empty string.
function omittedOnlyHead(head) {
  if (head.seq) {
    const first = omittedOnlyHead(head.seq[0]);
    return first === head.seq[0] ? head : { ...head, seq: [first, ...head.seq.slice(1)] };
  }
  if (head.capture !== undefined && head.expr) {
    const inner = omittedOnlyHead(head.expr);
    return inner === head.expr ? head : { ...head, expr: inner };
  }
  if (head.test !== "tags") return head;
  const origin = head.requirements.findIndex(item => !item.negated && item.value.tag === "_Elided");
  if (origin < 0) return head;
  const rest = head.requirements.filter((_, index) => index !== origin);
  const base = rest.length ? { ...head, requirements: rest } : head.expr;
  return { test: "=", value: { string: "" }, expr: base, ...(head.at ? { at: head.at } : {}) };
}

/** The hidden recognizer key for a payload of a key, or for one value. */
export function payloadTag(key, value) {
  const hex = text => [...new TextEncoder().encode(text)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return value === undefined ? `Payload_${hex(key)}` : `Payload_${hex(key)}_${hex(JSON.stringify(value))}`;
}

function literalPayload(node) {
  if (node.string !== undefined) return node.string;
  if (node.integer !== undefined) return Number(node.integer);
  return undefined;
}

// The visible keys of a constant key set, or null for any other value. A
// key set can combine other key-set constants of the same document.
function keySetKeys(value, constants = [], active = new Set()) {
  if (!value || typeof value !== "object") return null;
  if (value.bag) {
    if (!value.bag.every(entry => entry.kind === "bare" && !entry.gates.length && !entry.guard && isVisibleKey(entry.key))) return null;
    return value.bag.map(entry => entry.key);
  }
  if (value.const !== undefined) {
    const versions = constants.filter(constant => constant.name === value.const);
    if (versions.length !== 1 || active.has(value.const)) return null;
    return keySetKeys(versions[0].value, constants, new Set([...active, value.const]));
  }
  const parts = value.union ?? value.intersection ?? value.difference;
  if (!parts) return null;
  const sets = parts.map(part => keySetKeys(part, constants, active));
  if (sets.some(set => set === null)) return null;
  if (value.union) return [...new Set(sets.flat())];
  if (value.intersection) return sets[0].filter(key => sets.slice(1).every(set => set.includes(key)));
  return sets[0].filter(key => !sets[1].includes(key));
}

/** The name of a classifier for the recognizer, which needs a lowercase name. */
export function classifierName(name) {
  return `classifier-${name.toLowerCase()}`;
}

// Whether a record is a key set by its form.
function isKeySetRecord(node) {
  return !!node && (node.bag !== undefined || ["flags", "keys", "classes", "select", "classify", "union"].includes(node.method) ||
    node.intersection !== undefined || node.union !== undefined);
}

// The test of an implicit predicate ' ∈ S, ' ∉ S, ' = s or ' ≠ s, or null.
function ngramPredicate(node) {
  const body = node?.lambda === "" ? node.body : null;
  if (!body || body.left?.item !== true) return null;
  if (body.op === "∉") return { op: "∉", right: body.right };
  if (["∈", "=", "≠"].includes(body.op)) return { op: body.op, right: body.right };
  return null;
}

// A comparison of a capture's payload with a literal, or null.
function payloadComparison(node) {
  if (node.op !== "=" && node.op !== "≠") return null;
  for (const [read, other] of [[node.left, node.right], [node.right, node.left]]) {
    if (read?.property !== undefined && read.property !== "value" && read.property !== "image" &&
        read.receiver?.capture !== undefined && read.receiver.capture !== "" && literalPayload(other) !== undefined) {
      return { op: node.op, key: read.property, capture: read.receiver.capture, literal: literalPayload(other) };
    }
  }
  return null;
}

// The payload keys that recognizer tests read on each rule, by the rules
// that the captures name.
function payloadReads(rules) {
  const reads = new Map();
  for (const rule of rules) {
    const symbols = new Map();
    for (const alternative of rule.alternatives ?? []) collectCaptureSymbols(alternative.expr, symbols);
    const visit = node => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(visit);
      let capture, key;
      if (node.method === "has-value" && node.receiver?.capture !== undefined) [capture, key] = [node.receiver.capture, node.args[0]?.key];
      const compared = payloadComparison(node);
      if (compared) [capture, key] = [compared.capture, compared.key];
      const target = capture !== undefined ? symbols.get(capture) : undefined;
      if (target && /^[a-z]/.test(target) && key !== undefined) {
        if (!reads.has(target)) reads.set(target, new Set());
        reads.get(target).add(key);
      }
      for (const value of Object.values(node)) if (value && typeof value === "object") visit(value);
    };
    visit(rule.conditions);
  }
  return reads;
}

/**
 * The key of an alternative in the origin table: its document, the
 * position of its definition and its index there.
 */
export function alternativeKey(document, at, index) {
  return `${document}#${at[0]}:${at[1]}#${index}`;
}

/**
 * The format 50 expression of an argument as the recognizer stores it in
 * an instance: the inverse of argumentTerm. Other arguments stay as they are.
 */
export function argumentExpression(arg) {
  const bare = key => ({ kind: "bare", key, gates: [] });
  if (!arg || typeof arg !== "object") return arg;
  if (arg.tag !== undefined && Object.keys(arg).length === 1) return { bag: [bare(arg.tag)] };
  if (arg.emptySet) return { bag: [] };
  if (arg.union?.every(item => item.tag !== undefined)) return { bag: arg.union.map(item => bare(item.tag)) };
  return arg;
}

// The recognizer's term for an expression argument of a template, or null.
function argumentTerm(node) {
  if (node.string !== undefined) return { string: node.string };
  if (node.integer !== undefined) return { integer: node.integer };
  if (node.const !== undefined) return { const: node.const, ...(node.at ? { at: node.at } : {}) };
  if (node.param !== undefined) return { param: node.param, ...(node.at ? { at: node.at } : {}) };
  if (node.bag?.every(entry => entry.kind === "bare" && !entry.gates.length && !entry.guard)) {
    const tags = node.bag.map(entry => ({ tag: entry.key }));
    return tags.length === 0 ? { emptySet: true } : tags.length === 1 ? tags[0] : { union: tags };
  }
  return null;
}

function withoutPositions(node) {
  if (Array.isArray(node)) return node.map(withoutPositions);
  if (!node || typeof node !== "object") return node;
  return Object.fromEntries(Object.entries(node).filter(([key]) => key !== "at").map(([key, value]) => [key, withoutPositions(value)]));
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

const SPAN_RESULTS = new Set(["span", "first-token", "last-token", "tokens-after-first", "onward", "following-tokens", "preceding-tokens"]);

function isSpan(node) {
  return node.method !== undefined && SPAN_RESULTS.has(node.method);
}

// Whether an expression reads no capture, no item, no parameter and no
// occurrence, outside the functions that it holds.
export function isClosed(node, bound = new Set()) {
  if (node === null || typeof node !== "object") return true;
  if (Array.isArray(node)) return node.every(item => isClosed(item, bound));
  if (node.capture !== undefined) return node.capture !== "" && bound.has(node.capture);
  if (node.item || node.param !== undefined || node.body !== undefined && node.lambda === undefined) return false;
  if (node.lambda !== undefined) {
    if (node.lambda === "") return false;
    return isClosed(node.body, new Set([...bound, node.lambda]));
  }
  if (node.pattern !== undefined) return false;
  return Object.entries(node).every(([key, value]) => key === "at" || isClosed(value, bound));
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
    let equals;
    while (base.test !== undefined || base.primary) {
      if (base.test === "=" && base.value?.string !== undefined) equals = base.value.string;
      base = base.expr ?? base.primary;
    }
    // A name with different symbols on different alternatives has none.
    const found = base.ref !== undefined ? base.ref : null;
    if (symbols.has(node.capture) && symbols.get(node.capture) !== found) symbols.set(node.capture, null);
    else symbols.set(node.capture, found);
    if (equals !== undefined && found !== null && /^[A-Z]/.test(found)) symbols.set(`${node.capture}=`, equals);
  }
  for (const value of Object.values(node)) if (value && typeof value === "object") collectCaptureSymbols(value, symbols);
}

function isPlainSymbol(node) {
  if (node.capture !== undefined) return isPlainSymbol(node.expr);
  if (node.choice) return node.choice.every(isPlainSymbol);
  return SYMBOL_KEYS.some(key => Object.hasOwn(node, key)) && !node.optional && !node.repeat;
}
