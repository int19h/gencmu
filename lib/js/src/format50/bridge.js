// The format 50 loader recognizes a stage with the format 49 recognizer.
// This module lowers one DOM 50 document to the records that the recognizer
// reads. Recognition sees the visible keys of a bag as tags, the certified
// rule values as strings, and the conditions as format 49 conditions. Bags,
// emission and results stay in the format 50 modules.

import { GencmuError } from "../errors.js";
import { Evaluator, isPatternSet } from "./evaluate.js";
import { Bag } from "./bag.js";
import { DOM_TRUE, DOM_FALSE } from "../dom.js";
// A condition that never holds, in a form that the recognizer reads in a
// written document.
const NEVER = Object.freeze({ not: { op: "=", left: { string: "" }, right: { string: "" } } });

/**
 * The capture name that marks a primary without a written label. The
 * bridge adds underscores until no capture of the rule has the name.
 */
export const PRIMARY_CAPTURE = "primary_";

const STAGE_CONSTANTS = new Set(["INPUTS", "OUTPUTS", "DEFAULTS"]);
export const SYMBOL_KEYS = ["ref", "call", "param", "literal", "range", "wildcard", "splice", "test"];
const SPAN_READS = new Set([
  "first-token", "last-token", "tokens-after-first", "onward", "following-tokens", "preceding-tokens",
  "starts-input", "ends-input", "source-text", "decomposed-source-text", "verbatim-text",
  "without-elision", "without-elision-except", "followed-by", "preceded-by", "parse", "error-free",
]);

/**
 * A visible key: a capitalized key or an engine key.
 * @param {any} key
 */
export function isVisibleKey(key) {
  return /^[A-Z_]/.test(key);
}

/**
 * The format 49 records of one DOM 50 document, for recognition.
 * @param {any} dom a valid DOM 50
 * @param {string} path the document
 * @returns {any} a DOM 49 with the extra members `format50` and `origins`
 * @param {any} origins
 */
export function bridgeDocument(dom, path, origins) {
  return new Bridge(dom, path, origins).document();
}

export class Bridge {
  /**
   * @param {any} dom
   * @param {any} path
   * @param {any} origins
   */
  constructor(dom, path, origins) {
    this.dom = dom;
    this.path = path;
    this.origins = origins;
    /** @type {any[]} */
    this.classifiers = [];
    /** @type {{demanded: Set<string>, domains: Map<string, any[]>}} the hidden keys that recognizer tests read */
    this.hidden = { demanded: new Set(), domains: new Map() };
    /** @type {Map<string, GencmuError>} the rules whose keys have no tag term */
    this.untranslated = new Map();
    /** @type {GencmuError[]} the conditions that the recognizer cannot test */
    this.deferred = [];
    /** @type {Set<string>} the rules whose keys a recognizer test reads */
    this.keyReaders = new Set();
    /** @type {any[]} the instance bindings of the document, with their format 50 calls */
    this.instances50 = [];
    /** @type {Set<string>} the constants that the recognizer gets a placeholder for */
    this.opaque = new Set();
    /** @type {Map<string, string>} the symbol of each capture of the rule in hand */
    this.captureSymbols = new Map();
  }

  // The written calls by their site, for the names of their instances.
  /** @param {any} call */
  registerCall(call) {
    if (call.at) this.origins.set(`call:${this.path}#${call.at[0]}:${call.at[1]}`, call);
  }

  // Each bridged record names its format 50 record, so that the stage can
  // find it after stitching copies the record.
  /** @param {any} record */
  origin(record) {
    const id = `${this.path}#${this.origins.size}`;
    this.origins.set(id, { ...record, document: this.path });
    return id;
  }

  /**
   * @param {any} description
   * @param {any} at
   * @returns {never}
   */
  fail(description, at) {
    throw new GencmuError("grammar", `the format 50 recognizer cannot yet ${description}`,
      { document: this.path, ...(at ? { line: at[0], column: at[1] } : {}) });
  }

  document() {
    this.hidden = hiddenKeys(this.dom);
    const constants = [];
    // The stage reads each constant through its format 50 record. The
    // recognizer gets a placeholder for each one, with its value where a
    // condition or a filter reads it.
    // Each version of a constant in this document gets a placeholder of
    // one kind, so that the recognizer sees no change of type.
    const kinds = new Map();
    for (const constant of this.dom.constants) {
      const data = this.data(constant.value);
      if (data === OPAQUE) this.opaque.add(constant.name);
      const placeholder = JSON.stringify(Object.keys(data)[0]);
      kinds.set(constant.name, kinds.has(constant.name) && kinds.get(constant.name) !== placeholder ? "mixed" : placeholder);
    }
    for (const constant of this.dom.constants) {
      if (constant.name === "INPUTS") throw new GencmuError("grammar", "a grammar cannot define $INPUTS", { document: this.path, line: constant.at[0], column: constant.at[1] });
      const origin50 = this.origin({ constant });
      if (!STAGE_CONSTANTS.has(constant.name) && constant.value.bag && this.isClassifier(constant.value)) {
        this.classifiers.push(this.classifier(constant));
      }
      if (kinds.get(constant.name) === "mixed") this.opaque.add(constant.name);
      const data = kinds.get(constant.name) === "mixed" ? OPAQUE : this.data(constant.value);
      const value = data === OPAQUE ? { string: "" } : data;
      constants.push({ name: constant.name, op: constant.op, value, at: constant.at, origin50 });
    }
    return {
      format: 49,
      rules: this.dom.rules.map((/** @type {any} */ rule) => this.rule(rule)),
      directives: this.dom.directives.map((/** @type {any} */ directive) => this.directive(directive)),
      constants,
      classifiers: this.classifiers,
      implications: [],
      untranslated: this.untranslated,
      deferred: this.deferred,
      keyReaders: this.keyReaders,
      instances50: this.instances50,
    };
  }

  /** @param {any} value */
  isClassifier(value) {
    return value.bag.every((/** @type {any} */ entry) => entry.kind === "write" && classValue(entry.value) !== null);
  }

  // A classifier for the recognizer. A class that names other classes gets
  // their strings, with the gates on the path to each string.
  /** @param {any} constant */
  classifier(constant) {
    const classes = new Map();
    for (const entry of constant.value.bag) {
      for (const key of entry.keys) {
        if (!classes.has(key)) classes.set(key, []);
        classes.get(key).push({ gates: entry.gates, value: classValue(entry.value), at: entry.at });
      }
    }
    /** @type {any[]} */
    const entries = [];
    /**
     * @param {any} key
     * @param {any} gates
     * @param {any} at
     * @param {any} path
     */
    const expand = (key, gates, at, path) => {
      for (const row of classes.get(key) ?? []) {
        const combined = [...gates, ...row.gates];
        if (row.value.strings) {
          if (row.value.strings.length) entries.push({ gates: combined, keys: row.value.strings.map((/** @type {any} */ string) => ({ string })), op: "∈", class: path[0], at });
        } else {
          for (const target of row.value.references) if (!path.includes(target)) expand(target, combined, at, [...path, target]);
        }
      }
    };
    for (const [key, rows] of classes) expand(key, [], rows[0].at, [key]);
    return { name: classifierName(constant.name), entries, at: constant.at };
  }

  /** @param {any} value */
  data(value) {
    if (value.string !== undefined) return { string: value.string };
    // A closed concatenation folds to its string.
    const folded = closedConcat(value, this.dom.constants);
    if (folded !== undefined) return { string: folded };
    // A list of strings, with its splats in place (part 1 §8).
    const strings = closedStringList(value, this.dom.constants);
    if (strings?.length) return { union: strings.map(text => ({ string: text })) };
    // A pattern constant holds its pattern.
    if (value.pattern !== undefined) return { pattern: this.pattern(value.pattern) };
    if (isPatternSet(value)) {
      const pattern = patternSet(value);
      this.notePatternReaders(pattern);
      if (pattern !== EMPTY_PATTERN) return { pattern };
    }
    // A key set of visible keys holds its tags.
    const keys = keySetKeys(value, this.dom.constants);
    if (keys?.length) return keys.length === 1 ? { tag: keys[0] } : { union: keys.map((/** @type {any} */ key) => ({ tag: key })) };
    // The recognizer reads only strings, lists of strings, patterns and key
    // sets from a constant. Any other constant gets a placeholder, and a
    // recognizer read of it fails at load.
    return OPAQUE;
  }

  /**
   * A recognizer read of a constant, which fails where the constant has a
   * placeholder only (cause B of the Eberban review).
   * @param {any} node
   */
  constantRead(node) {
    if (this.opaque.has(node.const)) return this.fail(`read the constant $${node.const}, whose value it cannot hold`, node.at);
    return { const: node.const, ...(node.at ? { at: node.at } : {}) };
  }

  /** @param {any} directive */
  directive(directive) {
    const copy = { ...directive };
    // The pipeline evaluates the conditions of %features itself, so the
    // recognizer gets the directive with no conditions. The format 49
    // reader ignores the extra member.
    if (directive.conditions) {
      copy.conditions = [];
      copy.conditions50 = directive.conditions;
    }
    if (directive.steps) copy.steps = directive.steps.map((/** @type {any} */ step) => step.pattern ? { ...step, pattern: this.pattern(step.pattern) } : step);
    return copy;
  }

  /** @param {any} rule */
  rule(rule) {
    if (rule.instance) {
      this.registerCall(rule.instance);
      // The stage checks read the format 50 actuals, which stay beside the
      // document that the recognizer reads.
      this.instances50.push({ name: rule.name, op: rule.op, at: rule.at, instance: rule.instance, conditions: [] });
      return { ...rule, instance: { ...rule.instance, args: rule.instance.args.map((/** @type {any} */ arg) => this.argument(arg)) } };
    }
    /** @type {any} */
    const copy = { name: rule.name, op: rule.op };
    if (rule.params) copy.params = rule.params;
    if (rule.args) copy.args = rule.args.map((/** @type {any} */ arg) => this.argument(arg));
    this.captureSymbols = new Map();
    this.currentRule = rule.name;
    // The captures that bind at most one node on every route of the rule.
    this.atMostOne = new Set();
    const counts = new Map();
    for (const alternative of rule.alternatives) {
      for (const [name, count] of maxBindings(alternative.expr)) counts.set(name, Math.max(counts.get(name) ?? 0, count));
    }
    for (const [name, count] of counts) if (count <= 1) this.atMostOne.add(name);
    // The fewest and the most nodes that each alternative binds to a name.
    this.bindings = rule.alternatives.map((/** @type {any} */ alternative) => ({ min: minBindings(alternative.expr), max: maxBindings(alternative.expr) }));
    this.repeated = new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
    for (const alternative of rule.alternatives) collectCaptureSymbols(alternative.expr, this.captureSymbols);
    // The tags of each alternative read the capture sets of this rule.
    copy.alternatives = rule.alternatives.map((/** @type {any} */ alternative) => this.alternative(alternative, rule));
    try {
      copy.conditions = rule.conditions.flatMap((/** @type {any} */ node) => this.clauses(node));
      // The recognizer evaluates the tags of an emission item only when it
      // emits, which the format 50 stage does itself. So one item carries
      // the late comparisons to lowering, and recognition never runs them.
      const queries = rule.erased ? [] : this.queryCarriers(rule);
      const carriers = rule.erased ? [] : this.comparisonCarriers(rule);
      if (carriers.length || queries.length) {
        // One item carries everything, since items of one node cannot
        // overlap. A comparison carrier ends in a hidden tag, so that
        // lowering does not fold it away. It reads its captures only where
        // they are present, since a route can lack one.
        const tags = carriers.map(({ condition, captures }) => {
          /** @type {any} */
          let tag = { if: condition, then: { tag: WRITTEN } };
          for (const name of captures) if (name !== undefined && name !== "") tag = { if: { captured: name }, then: tag };
          return tag;
        });
        // A query is a term, which lowering keeps even with an empty value.
        for (const query of queries) tags.push({ if: query, then: { emptySet: true } });
        copy.emit = { items: [{ capture: "", tags: tags.length === 1 ? tags[0] : { union: tags } }] };
      }
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

  /**
   * @param {any} alternative
   * @param {any} rule
   */
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
    /** @type {any} */
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
  /**
   * @param {any} alternative
   * @param {any} rule
   * @param {any} primary
   */
  alternativeTags(alternative, rule, primary) {
    return this.writtenTags(alternative, rule, primary);
  }

  /**
   * @param {any} alternative
   * @param {any} rule
   * @param {any} primary
   */
  writtenTags(alternative, rule, primary) {
    const terms = [rule.term, alternative.term].filter(Boolean);
    let tags = null;
    if (primary !== null) tags = { method: "tags", receiver: { capture: primary }, args: [] };
    else if (!terms.length) return isSingleSymbol(alternative.expr) ? undefined : { emptySet: true };
    for (const term of terms) tags = this.bagTags(term, tags);
    return tags ?? { emptySet: true };
  }

  /**
   * @param {any} term
   * @param {any} tags
   */
  bagTags(term, tags) {
    /**
     * @param {any} left
     * @param {any} right
     */
    const union = (left, right) => left === null ? right : right === null ? left : { union: [left, right] };
    /**
     * @param {any} left
     * @param {any} right
     */
    const minus = (left, right) => left === null || right === null ? left : { difference: [left, right] };
    for (const entry of this.inlined(term.bag)) {
      // Each entry removes the earlier tags of the keys that it writes and
      // adds its own. A guard keeps the earlier tags where it is false.
      let written = null;
      let deleted = null;
      let condition = null;
      /** @param {any} key */
      const hidden = key => !isVisibleKey(key) && this.hidden.demanded.has(key);
      switch (entry.kind) {
        case "bare":
          if (isVisibleKey(entry.key)) written = { tag: entry.key };
          else if (hidden(entry.key)) {
            deleted = this.hiddenAll(entry.key);
            written = { tag: presentTag(entry.key) };
          }
          break;
        case "write":
          for (const key of entry.keys) {
            if (isVisibleKey(key)) written = union(written, { tag: key });
            else if (hidden(key)) {
              deleted = union(deleted, this.hiddenAll(key));
              written = union(written, this.hiddenWrite(key, entry.value, entry.guard));
            }
          }
          break;
        case "copy":
          if (isVisibleKey(entry.key)) {
            written = { intersection: [this.tagsOf(entry.source, entry.at), { tag: entry.key }] };
          } else if (hidden(entry.key)) {
            const source = this.tagsOf(entry.source, entry.at);
            deleted = this.hiddenAll(entry.key);
            written = { intersection: [source, this.hiddenAll(entry.key)] };
            // A copy from a source without the key writes nothing.
            condition = { op: "⊆", left: { tag: presentTag(entry.key) }, right: source };
          }
          break;
        case "splat":
          written = this.tagsOf(entry.value, entry.at);
          break;
        case "delete":
          if (isVisibleKey(entry.key)) deleted = { tag: entry.key };
          else if (hidden(entry.key)) deleted = this.hiddenAll(entry.key);
          break;
        default:
          this.fail(`read the entry ${entry.kind}`, entry.at);
      }
      if (written === null && deleted === null) continue;
      if (entry.gates.length) this.fail("gate an entry of a bag", entry.at);
      const guards = [entry.guard ? this.truth(entry.guard) : null, condition].filter(Boolean);
      if (!guards.length) {
        tags = union(minus(tags, deleted), written);
        continue;
      }
      const test = guards.length === 1 ? guards[0] : { all: guards };
      // A guarded entry removes and adds only where its guard holds. The
      // earlier tags appear once, so a run of guarded entries stays linear.
      tags = union(minus(tags, deleted === null ? null : { if: test, then: deleted }), written === null ? null : { if: test, then: written });
    }
    return tags;
  }

  /**
   * The recognizer lowers only the queries that its conditions and terms
   * name. A query that only a bag term or an emission term reads after the
   * choice of a parse rides to lowering on an emission item too.
   * @param {any} rule
   */
  queryCarriers(rule) {
    /** @type {any[]} */
    const queries = [];
    /** @param {any} node */
    const visit = node => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(visit);
      if (node.method === "parse" || node.method === "error-free") {
        queries.push(node);
        return;
      }
      for (const value of Object.values(node)) if (value && typeof value === "object") visit(value);
    };
    visit([rule.term, rule.alternatives.map((/** @type {any} */ alternative) => alternative.term), rule.emit?.items.map((/** @type {any} */ item) => item.term)]);
    const carriers = [];
    for (const query of queries) {
      let base = query;
      while (base.receiver) base = base.receiver;
      if (base.capture === undefined) continue;
      try {
        carriers.push(this.expression(query));
      } catch (error) {
        if (!(error instanceof GencmuError)) throw error;
      }
    }
    return carriers;
  }

  /**
   * The late structural comparisons of a rule with a pattern on the right.
   * The recognizer compiles only the patterns that its records name, so
   * each such comparison rides to lowering on an emission item that the
   * format 50 stage never runs (engine §4).
   * @param {any} rule
   */
  comparisonCarriers(rule) {
    /** @type {any[]} */
    const comparisons = [];
    /** @param {any} node */
    const visit = node => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(visit);
      if ((node.op === "≅" || node.op === "≇") && node.left?.capture !== undefined &&
        (node.right?.pattern !== undefined || node.right?.const !== undefined || isPatternSet(node.right))) {
        comparisons.push(node);
        return;
      }
      for (const value of Object.values(node)) if (value && typeof value === "object") visit(value);
    };
    visit([rule.term, rule.alternatives.map((/** @type {any} */ alternative) => alternative.term),
      rule.emit?.items.map((/** @type {any} */ item) => [item.term, item.guard])]);
    const carriers = [];
    for (const comparison of comparisons) {
      try {
        const condition = this.truth(comparison);
        // A comparison that is constant needs no pattern.
        if (condition === DOM_TRUE || condition === DOM_FALSE) continue;
        CARRIED.set(comparison, carriers.length);
        carriers.push({ condition, captures: [comparison.left.capture] });
      } catch (error) {
        if (!(error instanceof GencmuError)) throw error;
      }
    }
    return carriers;
  }

  // The entries of a bag with each splat of a bag function of this
  // document, applied to a capture, replaced by the function's entries.
  /**
   * @param {any} entries
   * @returns {any}
   */
  inlined(entries) {
    const result = [];
    for (const entry of entries) {
      const body = entry.kind === "splat" ? inlineFunction(entry.value, this.dom.constants) : null;
      if (!body) {
        result.push(entry);
        continue;
      }
      if (entry.gates.length || entry.guard) this.fail("guard a splat of a function", entry.at);
      for (const inner of this.inlined(body.bag)) result.push(inner);
    }
    return result;
  }

  // Every hidden tag of a key: its presence, its value, and each value of
  // its domain.
  /** @param {any} key */
  hiddenAll(key) {
    const values = this.hidden.domains.get(key) ?? [];
    return { union: [{ tag: presentTag(key) }, { tag: payloadTag(key) }, ...values.map(value => ({ tag: payloadTag(key, value) }))] };
  }

  // The hidden tags that a write of an expression gives a key.
  /**
   * @param {any} key
   * @param {any} value
   * @param {any} guard
   */
  hiddenWrite(key, value, guard) {
    /** @type {any[]} */
    const parts = [{ tag: presentTag(key) }, { tag: payloadTag(key) }];
    const domain = this.hidden.domains.get(key);
    if (!domain) return { union: parts };
    for (const candidate of domain) {
      const test = this.valueTest(value, candidate, guard);
      if (test === false) continue;
      parts.push(test === true ? { tag: payloadTag(key, candidate) } : { if: test, then: { tag: payloadTag(key, candidate) } });
    }
    return { union: parts };
  }

  /**
   * A recognizer condition that holds where an expression has one value:
   * true, false, or a condition record.
   * @param {any} node
   * @param {any} value
   * @param {any} [guard]
   * @returns {any}
   */
  valueTest(node, value, guard) {
    const literal = literalPayload(node);
    if (literal !== undefined) return literal === value;
    if (node.property !== undefined && node.receiver?.capture !== undefined) {
      if (node.property === "value" || node.property === "image") {
        if (typeof value !== "string") return false;
        return { op: "=", left: this.string(node), right: { string: value } };
      }
      if (!this.hidden.domains.get(node.property)?.some(item => item === value)) return false;
      return { op: "⊆", left: { tag: payloadTag(node.property, value) }, right: { method: "tags", receiver: { capture: node.receiver.capture }, args: [] } };
    }
    if (node.if !== undefined && node.else !== undefined) {
      const test = this.truth(node.if);
      /** @type {any} */
      const sides = [[test, this.valueTest(node.then, value)], [{ not: test }, this.valueTest(node.else, value)]]
        .filter(([, branch]) => branch !== false).map(([condition, branch]) => branch === true ? condition : { all: [condition, branch] });
      return sides.length === 0 ? false : sides.length === 1 ? sides[0] : { any: sides };
    }
    const sum = node.op === "+" ? [node.left, node.right] : null;
    const cap = node.method === "at-most" ? Number(node.args[0].integer) : null;
    if (sum || cap !== null) {
      const operands = sum ?? [node.receiver];
      const domains = operands.map(operand => valuesOf(operand, this.hidden.domains));
      if (domains.some(domain => domain === null)) return this.fail("compute this number", node.at);
      /** @type {any[]} */
      const options = [];
      /**
       * @param {any} index
       * @param {any} chosen
       */
      const combine = (index, chosen) => {
        if (index === operands.length) {
          const total = sum ? chosen[0] + chosen[1] : Math.min(chosen[0], /** @type {number} */ (cap));
          if (total === value) options.push(chosen);
          return;
        }
        for (const item of domains[index]) combine(index + 1, [...chosen, item]);
      };
      combine(0, []);
      const tests = options.map(chosen => {
        const parts = chosen.map((/** @type {any} */ item, /** @type {any} */ index) => this.valueTest(operands[index], item)).filter((/** @type {any} */ part) => part !== true);
        if (parts.includes(false)) return false;
        return parts.length === 0 ? true : parts.length === 1 ? parts[0] : { all: parts };
      }).filter(test => test !== false);
      if (tests.includes(true)) return true;
      return tests.length === 0 ? false : tests.length === 1 ? tests[0] : { any: tests };
    }
    void guard;
    return this.fail("compute this payload in recognition", node.at);
  }

  // The visible keys of a bag or a node, as a tag term.
  // The visible keys of a bag, a node, a span or a forest, as a tag term.
  /**
   * @param {any} node
   * @param {any} [at]
   * @returns {any}
   */
  tagsOf(node, at) {
    const inlined = this.inline(node);
    if (inlined) return this.tagsOf(inlined, at);
    if (node.capture !== undefined) return { method: "tags", receiver: { capture: node.capture }, args: [] };
    if (node.param !== undefined) return { param: node.param, ...(node.at ? { at: node.at } : {}) };
    if (node.const !== undefined) {
      // Only a key set of visible keys in this document has a tag term.
      const versions = this.dom.constants.filter((/** @type {any} */ constant) => constant.name === node.const);
      if (!versions.length || !versions.every((/** @type {any} */ constant) => keySetKeys(constant.value, this.dom.constants)?.length)) {
        return this.fail("read the keys of the constant " + node.const, node.at ?? at);
      }
      return { const: node.const, ...(node.at ? { at: node.at } : {}) };
    }
    if (node.bag?.every((/** @type {any} */ entry) => (entry.kind === "bare" || entry.kind === "splat") && !entry.gates.length && !entry.guard)) {
      const parts = node.bag.map((/** @type {any} */ entry) => entry.kind === "bare" ? (isVisibleKey(entry.key) ? { tag: entry.key } : null) : this.tagsOf(entry.value, entry.at))
        .filter(Boolean);
      return parts.length === 0 ? { emptySet: true } : parts.length === 1 ? parts[0] : { union: parts };
    }
    if (node.intersection) return { intersection: node.intersection.map((/** @type {any} */ item) => this.tagsOf(item, at)) };
    if (node.union) return { union: node.union.map((/** @type {any} */ item) => this.tagsOf(item, at)) };
    if (node.difference) return { difference: node.difference.map((/** @type {any} */ item) => this.tagsOf(item, at)) };
    if (node.method === "flags" || node.method === "keys" || node.method === "classes") {
      const receiver = node.receiver;
      const method = node.method === "classes" ? "classes" : "tags";
      // A list of optional or repeated nodes has the union of their keys.
      if (receiver?.method === "union" && receiver.receiver?.map?.capture !== undefined &&
          receiver.receiver.by?.method === node.method) {
        const capture = receiver.receiver.map.capture;
        return { if: { captured: capture }, then: { method, receiver: { capture }, args: [] } };
      }
      if (receiver?.capture !== undefined) return { method, receiver: { capture: receiver.capture }, args: [] };
      if (receiver?.method === "parse" || receiver?.method === "error-free") return { method, receiver: this.expression(receiver), args: [] };
      // The keys of a span are those of its input tokens.
      if (receiver?.method !== undefined) return { method, receiver: this.expression(receiver), args: [] };
      return this.fail("read the keys of this expression", node.at ?? at);
    }
    // A list of optional or repeated nodes has the union of their keys.
    if (node.method === "union" && node.receiver?.map?.capture !== undefined && ["flags", "keys", "classes"].includes(node.receiver.by?.method)) {
      const capture = node.receiver.map.capture;
      const method = node.receiver.by.method === "classes" ? "classes" : "tags";
      return { if: { captured: capture }, then: { method, receiver: { capture }, args: [] } };
    }
    if (node.method === "select") {
      return { intersection: [this.tagsOf(node.receiver, at), this.tagsOf(node.args[0], at)] };
    }
    if (node.method === "classify" && node.receiver.const !== undefined) {
      return { method: "classify", receiver: this.string(node.args[0]), args: [{ classifier: classifierName(node.receiver.const) }] };
    }
    // A filtered forest is a forest too (part 1 §6).
    if (node.method === "parse" || node.method === "error-free") return { method: "tags", receiver: this.expression(node), args: [] };
    return this.fail("read the keys of this expression", node.at ?? at);
  }

  // A message is a concatenation for the recognizer, also of one part.
  /** @param {any} node */
  message(node) {
    const string = this.string(node);
    return string.concat ? string : { concat: [string] };
  }

  // A template argument. An expression argument becomes the recognizer's
  // term for it, and keeps its format 50 record for the stage to evaluate.
  /** @param {any} arg */
  argument(arg) {
    if (arg.expression) {
      const term = argumentTerm(arg.expression) ?? foldedArgument(arg.expression);
      if (term === null) this.fail("pass this expression to a template", arg.at);
      return term;
    }
    // The recognizer's argument records carry no position. The format 50
    // records keep it for the stage checks.
    const { at, ...rest } = arg;
    void at;
    if (rest.literal !== undefined && Object.keys(rest).length === 1) return this.stringOperand(rest.literal);
    if (rest.body) return { ...rest, body: this.body(rest.body, { name: null }) };
    if (rest.call !== undefined) return { ...rest, args: rest.args.map((/** @type {any} */ item) => this.argument(item)) };
    if (rest.test !== undefined || rest.capture !== undefined || rest.splice !== undefined) return this.body(rest, { name: null });
    return rest;
  }

  // A body record of format 50 is a body record of format 49, with a mark
  // for the primary and positions on tests.
  /**
   * @param {any} node
   * @param {any} primary
   * @returns {any}
   */
  body(node, primary) {
    if (node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map(/** @returns {any} */ item => this.body(item, primary));
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
      /** @type {any} */
      const copy = { test: node.test };
      // A test of _Elided on a terminal is a test of the hidden key that
      // every written token carries, with the opposite sign. A template
      // instance then passes the same check as a written test.
      if (node.requirements) copy.requirements = node.requirements.map((/** @type {any} */ item) => item.value.tag === "_Elided"
        ? { negated: !item.negated, value: { tag: WRITTEN } }
        : { negated: item.negated, value: this.requirement(item.value) });
      if (node.value) copy.value = this.stringOperand(node.value);
      copy.expr = this.body(node.expr, primary);
      return copy;
    }
    if (node.literal) return { literal: this.stringOperand(node.literal) };
    if (node.range) return { range: node.range.map((/** @type {any} */ item) => this.stringOperand(item)) };
    // The recognizer spells the omitted-only head [+T<_Elided>] as a test
    // that the head lacks the hidden key of written tokens.
    if (node.optional && node.elidable) {
      const rewritten = omittedOnlyHead(node.optional);
      if (rewritten !== node.optional) {
        /** @type {any} */
        const copy = { ...node, optional: this.body(rewritten, primary) };
        if (node.default) copy.default = this.stringOperand(node.default);
        return copy;
      }
    }
    if (node.optional && node.default) return { ...node, optional: this.body(node.optional, primary), default: this.stringOperand(node.default) };
    if (node.call !== undefined && Array.isArray(node.args)) {
      this.registerCall(node);
      return { ...node, args: node.args.map((/** @type {any} */ arg) => this.argument(arg)) };
    }
    /** @type {Record<string, any>} */
    const copy = {};
    for (const [key, value] of Object.entries(node)) copy[key] = this.body(value, primary);
    return copy;
  }

  /** @param {any} value */
  requirement(value) {
    if (value.tag !== undefined || value.param !== undefined) return { ...value };
    if (value.const !== undefined) return { const: value.const, ...(value.at ? { at: value.at } : {}) };
    return this.fail("read this requirement", value.at);
  }

  /** @param {any} node */
  stringOperand(node) {
    if (node.string !== undefined) return { string: node.string };
    if (node.const !== undefined) return this.constantRead(node);
    if (node.param !== undefined) return { ...node };
    return this.fail("read this string operand", node.at);
  }

  /** @param {any} node */
  pattern(node) {
    this.notePatternReaders(node);
    // A test record of DOM 50 keeps its position, which the pattern checks
    // of the recognizer do not admit on a test (part 2 §9).
    return withoutTestPositions(node);
  }

  /**
   * A tag test of a rule atom in a tree pattern reads the keys of that rule,
   * as a body filter does. A rule term that cannot be translated then fails
   * at load, and is not dropped.
   * @param {any} pattern
   */
  notePatternReaders(pattern) {
    /** @type {any[]} */
    const stack = [pattern];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node)) {
        for (const item of node) stack.push(item);
        continue;
      }
      if (node.test === "tags") {
        let base = node.expr;
        while (base && (base.test !== undefined || base.capture !== undefined)) base = base.expr;
        if (typeof base?.name === "string") this.keyReaders.add(base.name);
      }
      for (const [key, value] of Object.entries(node)) if (key !== "at" && value && typeof value === "object") stack.push(value);
    }
  }

  /**
   * The recognizer clauses of one written clause. A conjunction becomes
   * one clause for each operand. A universal predicate on a capture inside
   * a repetition becomes the predicate on the capture: the recognizer
   * checks a clause that names such a capture on each of its items, and an
   * empty list has none, as `.all` requires (part 1 §9).
   * @param {any} node
   * @returns {any[]}
   */
  clauses(node) {
    if (Array.isArray(node.all)) return node.all.flatMap((/** @type {any} */ item) => this.clauses(item));
    // A guard $d ⟹ P in a shared clause, where every alternative that binds
    // a capture of P also binds $d, holds as P does. An alternative without
    // the captures of P gives P no meaning (part 1 §5).
    if (node.if !== undefined && node.else === undefined && node.if.capture && !node.if.expr && node.if.receiver === undefined) {
      const guard = node.if.capture;
      /** @type {Set<string>} */
      const names = new Set();
      /** @param {any} item */
      const collect = item => {
        if (!item || typeof item !== "object") return;
        if (Array.isArray(item)) return item.forEach(collect);
        if (typeof item.capture === "string" && item.capture !== "") names.add(item.capture);
        for (const [key, value] of Object.entries(item)) if (key !== "at") collect(value);
      };
      collect(node.then);
      names.delete(guard);
      if (names.size && (this.bindings ?? []).every((/** @type {any} */ { min, max }) =>
        ![...names].some(name => (max.get(name) ?? 0) > 0) || (min.get(guard) ?? 0) >= 1)) return this.clauses(node.then);
    }
    if (node.method === "all" && node.receiver?.capture && !this.atMostOne?.has(node.receiver.capture) &&
        this.repeated?.has(node.receiver.capture) && node.args[0]?.lambda !== undefined) {
      return [this.truth(itemAsCapture(node.args[0], node.receiver.capture))];
    }
    return [this.truth(node)];
  }

  // A function constant of this document applied to a capture, with the
  // capture in place of its parameter, or null.
  /** @param {any} node */
  inline(node) {
    return node?.apply !== undefined ? inlineFunction(node, this.dom.constants, false) : null;
  }

  // A condition: an expression in a truth position.
  /**
   * @param {any} node
   * @returns {any}
   */
  truth(node) {
    const inlined = this.inline(node);
    if (inlined) return this.truth(inlined);
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
    if (node.all) return { all: node.all.map((/** @type {any} */ item) => this.truth(item)) };
    if (node.any) return { any: node.any.map((/** @type {any} */ item) => this.truth(item)) };
    if (node.if !== undefined && node.else === undefined) return { if: this.truth(node.if), then: this.truth(node.then) };
    if (node.method === "classify" && node.receiver.const !== undefined) {
      return { op: "≠", left: this.tagsOf(node), right: { emptySet: true } };
    }
    if (node.method === "parse" || node.method === "error-free" || node.method === "starts-input" || node.method === "ends-input" ||
        node.method === "followed-by" || node.method === "preceded-by") return this.expression(node);
    // A predicate on a capture that binds at most one node: .all(P) holds
    // where the capture is absent or P holds of it, .any(P) where it is
    // present and P holds of it.
    if ((node.method === "all" || node.method === "any") && node.receiver?.capture && node.args[0]?.lambda !== undefined &&
        (this.atMostOne?.has(node.receiver.capture))) {
      /** @type {any} */
      const test = this.truth(itemAsCapture(node.args[0], node.receiver.capture));
      return node.method === "all" ? { if: { captured: node.receiver.capture }, then: test } : { all: [{ captured: node.receiver.capture }, test] };
    }
    // A presence or payload test of a key that is not visible, and a
    // comparison of a payload, read the hidden tags of the key.
    // A token of the stage input carries the hidden key of each payload, so
    // .has-value of a visible key reads it too.
    if (node.method === "has-value" && node.args[0]?.key !== undefined && isVisibleKey(node.args[0].key) && node.receiver?.capture !== undefined) {
      const symbol = this.captureSymbols.get(node.receiver.capture);
      if (typeof symbol === "string" && !/^[a-z]/.test(symbol)) {
        return { op: "⊆", left: { tag: payloadTag(node.args[0].key) }, right: this.receiverTags(node.receiver) };
      }
    }
    if ((node.method === "has" || node.method === "has-value") && node.args[0]?.key !== undefined && !isVisibleKey(node.args[0].key)) {
      const tag = node.method === "has" ? presentTag(node.args[0].key) : payloadTag(node.args[0].key);
      return { op: "⊆", left: { tag }, right: this.receiverTags(node.receiver) };
    }
    const payload = this.payloadComparison(node);
    if (payload) return payload;
    // A predicate on a forest tests the keys of its roots, where each
    // disjunct of the predicate tests one key of the root.
    if ((node.method === "any" || node.method === "all") && (node.receiver?.method === "parse" || node.receiver?.method === "error-free")) {
      const forest = this.forestPredicate(node);
      if (forest) return forest;
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
    if (flag !== undefined && isVisibleKey(flag) && flag !== "_Elided" && this.forestRoot &&
        (node.receiver?.item || node.receiver?.capture === this.forestRoot)) {
      return { op: "⊆", left: { tag: flag }, right: { forestRoot: true } };
    }
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
    // A key set is true where it is not empty (part 3 §3).
    if (isKeySetRecord(node) && node.method !== "classify") {
      return { op: "≠", left: this.tagsOf(node, node.at), right: { emptySet: true } };
    }
    // A key read on a key set, as in $x.flags'K, tests that set.
    if (flag !== undefined && isVisibleKey(flag) && flag !== "_Elided" && node.receiver && isKeySetRecord(node.receiver)) {
      return { op: "⊆", left: { tag: flag }, right: this.tagsOf(node.receiver, node.at) };
    }
    return this.fail("test this expression", node.at);
  }

  // The tags of the receiver of a key read: a capture, the rule, or the
  // root of a forest predicate.
  /** @param {any} receiver */
  receiverTags(receiver) {
    if (receiver?.capture !== undefined && this.forestRoot && receiver.capture === this.forestRoot) return { forestRoot: true };
    if (receiver?.item && this.forestRoot) return { forestRoot: true };
    if (receiver?.capture !== undefined) return { method: "tags", receiver: { capture: receiver.capture }, args: [] };
    return this.fail("read the keys of this receiver", receiver?.at);
  }

  // A comparison of a payload that is not visible with a literal or with
  // another payload, through hidden tags. Null for any other comparison.
  /** @param {any} node */
  payloadComparison(node) {
    if (!["=", "≠", "<", "≤", ">", "≥"].includes(node.op)) return null;
    // A capture of a token of the stage input: its payloads stand on the
    // token as hidden keys, whatever the case of the key.
    /** @param {any} receiver */
    const tokenCapture = receiver => {
      const symbol = receiver?.capture !== undefined ? this.captureSymbols.get(receiver.capture) : undefined;
      return typeof symbol === "string" && !/^[a-z]/.test(symbol);
    };
    /** @param {any} side */
    const read = side => side?.property !== undefined && side.property !== "value" && side.property !== "image" &&
      (!isVisibleKey(side.property) && (side.receiver?.capture !== undefined || side.receiver?.item) || tokenCapture(side.receiver)) ? side : null;
    const [left, right] = [read(node.left), read(node.right)];
    if (!left && !right) return null;
    // A visible key of a token has no domain from this document. Equality
    // with a literal needs none.
    const visible = [left, right].some(side => side && isVisibleKey(side.property));
    if (visible) {
      const side = left ?? right;
      const other = literalPayload(left ? node.right : node.left);
      if (left && right || other === undefined || (node.op !== "=" && node.op !== "≠")) return this.fail(`compare the payload ${side.property} of a token with this expression`, node.at);
      const test = { op: "⊆", left: { tag: payloadTag(side.property, other) }, right: this.receiverTags(side.receiver) };
      return node.op === "=" ? test : { not: test };
    }
    /**
     * @param {any} a
     * @param {any} b
     */
    const holds = (a, b) => /** @type {Record<string, boolean>} */ ({ "=": a === b, "≠": a !== b, "<": a < b, "≤": a <= b, ">": a > b, "≥": a >= b })[node.op];
    /**
     * @param {any} side
     * @param {any} value
     */
    const tagTest = (side, value) => ({ op: "⊆", left: { tag: payloadTag(side.property, value) }, right: this.receiverTags(side.receiver) });
    /**
     * @param {any} side
     * @returns {any[]}
     */
    const domain = side => {
      const values = this.hidden.domains.get(side.property);
      if (!values) this.fail(`compare the payload ${side.property}, whose values are not known`, side.at);
      return values;
    };
    let tests;
    if (left && right) {
      tests = domain(left).flatMap(a => domain(right).filter(b => holds(a, b)).map(b => ({ all: [tagTest(left, a), tagTest(right, b)] })));
    } else {
      const side = left ?? right;
      const other = literalPayload(left ? node.right : node.left);
      // A payload with a finite domain against a string: one disjunct for
      // each value of the domain.
      if (other === undefined && (node.op === "=" || node.op === "≠")) {
        const string = this.string(left ? node.right : node.left);
        const tests = domain(side).map(value => ({ all: [tagTest(side, value), { op: node.op, left: string, right: { string: String(value) } }] }));
        return tests.length === 0 ? NEVER : tests.length === 1 ? tests[0] : { any: tests };
      }
      if (other === undefined) return this.fail("compare a payload with this expression", node.at);
      if (node.op === "=" && !left !== !right) return tagTest(side, other);
      tests = domain(side).filter(value => left ? holds(value, other) : holds(other, value)).map(value => tagTest(side, value));
    }
    return tests.length === 0 ? NEVER : tests.length === 1 ? tests[0] : { any: tests };
  }

  // A predicate on a forest. Each disjunct of its normal form may test one
  // key of the root, beside tests that do not read the root. Then a root
  // passes the predicate exactly where the union of the root keys passes.
  /**
   * @param {any} node
   * @returns {any}
   */
  forestPredicate(node) {
    const predicate = node.args[0];
    if (!predicate || predicate.lambda === undefined) return null;
    const forest = { method: "tags", receiver: this.expression(node.receiver), args: [] };
    /** @type {any} */
    const saved = this.forestRoot;
    this.forestRoot = predicate.lambda || " item";
    let body;
    try {
      body = this.truth(predicate.body);
    } finally {
      this.forestRoot = saved;
    }
    const disjuncts = normalForm(body);
    if (disjuncts === null) return null;
    for (const conjuncts of disjuncts) {
      const root = conjuncts.filter((/** @type {any} */ atom) => mentionsRoot(atom));
      // A presence test of a key beside a value test of that key on the
      // root adds nothing.
      const values = root.filter((/** @type {any} */ atom) => atom.left?.tag?.split("_").length === 3);
      /** @param {any} atom */
      const keyOf = atom => atom.left?.tag?.split("_")[1];
      const kept = root.filter((/** @type {any} */ atom) => values.includes(atom) || !values.some((/** @type {any} */ value) => keyOf(value) === keyOf(atom)));
      if (kept.length > 1 || kept.some((/** @type {any} */ atom) => atom.not)) return null;
      for (let index = conjuncts.length - 1; index >= 0; index--) if (root.includes(conjuncts[index]) && !kept.includes(conjuncts[index])) conjuncts.splice(index, 1);
    }
    /**
     * @param {any} value
     * @returns {any}
     */
    const replace = value => {
      if (Array.isArray(value)) return value.map(replace);
      if (!value || typeof value !== "object") return value;
      if (value.forestRoot) return forest;
      return Object.fromEntries(Object.entries(value).map(/** @returns {any} */ ([key, item]) => [key, replace(item)]));
    };
    const any = replace({ any: disjuncts.map((/** @type {any} */ conjuncts) => conjuncts.length === 1 ? conjuncts[0] : { all: conjuncts }) });
    if (node.method === "any") return any.any.length === 1 ? any.any[0] : any;
    return null;
  }

  /** @param {any} node */
  comparison(node) {
    const op = node.op;
    // Structural comparisons keep the pattern records of the recognizer.
    if ((op === "≅" || op === "≇") && node.left.capture !== undefined && (isPatternSet(node.right) || node.right.emptySet)) {
      // A set of patterns becomes one pattern of the recognizer. A set
      // that can match nothing makes the comparison a constant.
      const pattern = patternSet(node.right);
      if (pattern === EMPTY_PATTERN) return op === "≅" ? DOM_FALSE : DOM_TRUE;
      this.notePatternReaders(pattern);
      return { op, left: { capture: node.left.capture }, right: { pattern } };
    }
    if ((op === "≅" || op === "≇") && (node.left.capture !== undefined || node.left.item)) {
      const right = node.right.pattern !== undefined ? { pattern: this.pattern(node.right.pattern) } :
        node.right.capture !== undefined ? { capture: node.right.capture } :
        node.right.const !== undefined ? { const: node.right.const, at: node.right.at } : null;
      if (right && node.left.capture !== undefined) return { op, left: { capture: node.left.capture }, right };
    }
    if (op === "∈" || op === "∉") {
      return { op, left: this.string(node.left), right: this.strings(node.right) };
    }
    // The tags of a node in recognition hold hidden keys beside its visible
    // ones, so a test that needs the absence of other keys cannot read them.
    /** @param {any} receiver */
    const tokenCapture = receiver => {
      const symbol = receiver?.capture !== undefined ? this.captureSymbols.get(receiver.capture) : undefined;
      return typeof symbol === "string" && !/^[a-z]/.test(symbol);
    };
    const hidden = (/** @type {any} */ side) => mayHoldHidden(side, tokenCapture);
    // A written token holds its visible terminal key, so a comparison with
    // the empty set has the same answer with or without the hidden keys.
    /** @param {any} side */
    const empty = side => side?.emptySet || Array.isArray(side?.bag) && side.bag.length === 0;
    const withEmpty = empty(node.left) || empty(node.right);
    if ((op === "⊆" || op === "⊈") && hidden(node.left) && !empty(node.right) ||
        (op === "=" || op === "≠") && !withEmpty && (hidden(node.left) || hidden(node.right))) {
      return this.fail(`compare the keys of a node with ${op}`, node.at);
    }
    if (op === "⊆" || op === "⊈") return { op, left: this.keySet(node.left), right: this.keySet(node.right) };
    if ((op === "=" || op === "≠") && (isKeySetRecord(node.left) || isKeySetRecord(node.right))) {
      return { op, left: this.keySet(node.left), right: this.keySet(node.right) };
    }
    if (op === "=" || op === "≠") return { op, left: this.string(node.left), right: this.string(node.right) };
    return this.fail(`compare with ${op}`, node.at);
  }

  /** @param {any} node */
  strings(node) {
    if (node.list) {
      const closed = closedStringList(node, this.dom.constants);
      if (closed?.length) return { union: closed.map(text => ({ string: text })) };
      // A splat, a guard or a gate decides which items the list holds.
      if (node.list.some((/** @type {any} */ item) => item.kind === "splat" || item.guard || item.gates?.length)) return this.fail("read this list", node.at);
      return { union: node.list.map((/** @type {any} */ item) => this.string(item.value)) };
    }
    if (node.method === "split") return { method: "split", receiver: this.string(node.receiver), args: [this.string(node.args[0])] };
    if (node.const !== undefined) return this.constantRead(node);
    if (node.param !== undefined) return { ...node };
    return this.fail("read this list", node.at);
  }

  // A key set of visible keys, as a tag term.
  /** @param {any} node */
  keySet(node) {
    return this.tagsOf(node, node.at);
  }

  // An expression with a string value.
  /**
   * @param {any} node
   * @returns {any}
   */
  string(node) {
    const inlined = this.inline(node);
    if (inlined) return this.string(inlined);
    if (node.string !== undefined) return { string: node.string };
    if (node.const !== undefined) return this.constantRead(node);
    // A template parameter stands for its actual, which the recognizer
    // substitutes in each instance (part 3 §10).
    if (node.param !== undefined) return { ...node };
    if (node.concat) return { concat: node.concat.map((/** @type {any} */ item) => this.string(item)) };
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
  /**
   * @param {any} node
   * @returns {any}
   */
  expression(node) {
    if (node.capture !== undefined) return { capture: node.capture };
    if (node.method === "span") return this.expression(node.receiver);
    if (node.method !== undefined && SPAN_READS.has(node.method)) {
      const args = node.args.map((/** @type {any} */ arg) => {
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
/**
 * @param {any} head
 * @returns {any}
 */
function omittedOnlyHead(head) {
  if (head.seq) {
    /** @type {any} */
    const first = omittedOnlyHead(head.seq[0]);
    return first === head.seq[0] ? head : { ...head, seq: [first, ...head.seq.slice(1)] };
  }
  if (head.capture !== undefined && head.expr) {
    /** @type {any} */
    const inner = omittedOnlyHead(head.expr);
    return inner === head.expr ? head : { ...head, expr: inner };
  }
  if (head.test !== "tags") return head;
  const origin = head.requirements.findIndex((/** @type {any} */ item) => !item.negated && item.value.tag === "_Elided");
  if (origin < 0) return head;
  // Every written token carries the hidden key WRITTEN, and the omitted
  // leaf does not. So only the omitted leaf passes the head, and a written
  // token with an empty value stays written (engine §3.8).
  const requirements = head.requirements.map((/** @type {any} */ item, /** @type {any} */ index) => index === origin ? { negated: true, value: { tag: WRITTEN } } : item);
  return { ...head, requirements };
}

/**
 * Whether a recognizer key is one that the bridge adds.
 * @param {any} key
 */
export function isHiddenKey(key) {
  return key === WRITTEN || key.startsWith("Payload_") || key.startsWith("Present_");
}

/** The hidden recognizer key of every written token. */
export const WRITTEN = "Written_token";

/**
 * The place of each late structural comparison among the carriers of its
 * rule. The stage reads the lowered condition at that place, so that the
 * comparison uses the pattern that the recognizer compiled.
 * @type {WeakMap<object, number>}
 */
export const CARRIED = new WeakMap();

/**
 * The hidden recognizer key for a payload of a key, or for one value.
 * @param {any} key
 * @param {any} [value]
 */
export function payloadTag(key, value) {
  return value === undefined ? `Payload_${hex(key)}` : `Payload_${hex(key)}_${hex(JSON.stringify(value))}`;
}

/**
 * The hidden recognizer key for the presence of a key, bare or valued.
 * @param {any} key
 */
export function presentTag(key) {
  return `Present_${hex(key)}`;
}

/** @param {any} text */
function hex(text) {
  return [...new TextEncoder().encode(text)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/** @param {any} node */
function literalPayload(node) {
  if (node?.string !== undefined) return node.string;
  if (node?.integer !== undefined) return Number(node.integer);
  return undefined;
}

const MAX_DOMAIN = 64;

/**
 * The body of a function constant applied to an argument, with the argument
 * in place of the parameter, or null. A function is pure, so the argument
 * can stand in each place of the parameter (part 1 §8). Where bagsOnly
 * holds, only a function whose body is a bag constructor qualifies.
 * @param {any} node
 * @param {any} constants
 * @returns {any}
 */
function inlineFunction(node, constants, bagsOnly = true) {
  if (node?.apply === undefined || !node.arg || typeof node.arg !== "object") return null;
  const versions = constants.filter((/** @type {any} */ constant) => constant.name === node.apply);
  if (versions.length !== 1) return null;
  const value = versions[0].value;
  if (value.lambda === undefined || bagsOnly && !value.body?.bag) return null;
  // An argument that names a binder of the body would change its meaning
  // inside that binder.
  const binders = new Set();
  const names = new Set();
  /** @param {any} item @param {Set<string>} into @param {string} key */
  const collect = (item, into, key) => {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) return item.forEach(child => collect(child, into, key));
    if (typeof item[key] === "string" && item[key] !== "") into.add(item[key]);
    for (const [field, child] of Object.entries(item)) if (field !== "at") collect(child, into, key);
  };
  collect(value.body, binders, "lambda");
  collect(node.arg, names, "capture");
  for (const name of names) if (binders.has(name)) return null;
  /**
   * @param {any} item
   * @returns {any}
   */
  const substitute = item => {
    if (Array.isArray(item)) return item.map(substitute);
    if (!item || typeof item !== "object") return item;
    if (item.capture === value.lambda && !item.expr) return { ...node.arg };
    if (item.lambda !== undefined && item.lambda === value.lambda) return item;
    return Object.fromEntries(Object.entries(item).map(/** @returns {any} */ ([key, child]) => [key, substitute(child)]));
  };
  return substitute(value.body);
}

/**
 * The keys that are not visible and that a recognizer test reads, with
 * the finite set of values that the document can give each one. A key
 * whose values are not known has no domain.
 * @param {any} dom
 */
function hiddenKeys(dom) {
  const demanded = new Set();
  /** @param {any} node */
  const reads = node => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(reads);
    if (node.property !== undefined && !isVisibleKey(node.property) && node.property !== "value" && node.property !== "image") demanded.add(node.property);
    if ((node.method === "has" || node.method === "has-value") && node.args?.[0]?.key !== undefined && !isVisibleKey(node.args[0].key)) demanded.add(node.args[0].key);
    for (const value of Object.values(node)) if (value && typeof value === "object") reads(value);
  };
  const entries = [];
  for (const constant of dom.constants) {
    if (constant.value.lambda !== undefined && constant.value.body?.bag) {
      for (const entry of constant.value.body.bag) {
        reads(entry.guard);
        entries.push(entry);
      }
    }
  }
  for (const rule of dom.rules) {
    reads(rule.conditions);
    for (const term of [rule.term, ...(rule.alternatives ?? []).map((/** @type {any} */ alternative) => alternative.term)].filter(Boolean)) {
      for (const entry of term.bag) {
        reads(entry.guard);
        entries.push(entry);
      }
    }
  }
  // The keys that the writers of a demanded key read are demanded too.
  for (let size = -1; size !== demanded.size;) {
    size = demanded.size;
    for (const entry of entries) if (entry.kind === "write" && entry.keys.some((/** @type {any} */ key) => demanded.has(key))) reads(entry.value);
  }
  /** @type {Map<string, any[]>} */
  const domains = new Map([...demanded].map(key => [key, []]));
  const unknown = new Set();
  for (let changed = true; changed;) {
    changed = false;
    for (const entry of entries) {
      if (entry.kind !== "write") continue;
      for (const key of entry.keys.filter((/** @type {any} */ item) => demanded.has(item) && !unknown.has(item))) {
        let values = valuesOf(entry.value, domains, unknown);
        const allowed = guardValues(entry.guard, entry.value, dom.constants);
        if (allowed) values = values === null ? allowed : values.filter((/** @type {any} */ value) => allowed.includes(value));
        if (values === null) {
          unknown.add(key);
          domains.delete(key);
          changed = true;
          continue;
        }
        const domain = /** @type {any[]} */ (domains.get(key));
        for (const value of values) if (!domain.includes(value)) {
          domain.push(value);
          changed = true;
        }
        if (domain.length > MAX_DOMAIN) {
          unknown.add(key);
          domains.delete(key);
        }
      }
    }
  }
  for (const domain of domains.values()) domain.sort((a, b) => typeof a === typeof b ? (a < b ? -1 : a > b ? 1 : 0) : typeof a === "number" ? -1 : 1);
  return { demanded, domains };
}

// The values that an expression can have, or null where they are not known.
/**
 * @param {any} node
 * @param {any} domains
 * @returns {any}
 */
function valuesOf(node, domains, unknown = new Set()) {
  const literal = literalPayload(node);
  if (literal !== undefined) return [literal];
  if (node.property !== undefined && node.receiver?.capture !== undefined && !unknown.has(node.property)) {
    return domains.get(node.property) ?? null;
  }
  if (node.if !== undefined && node.else !== undefined) {
    /** @type {any} */
    const sides = [valuesOf(node.then, domains, unknown), valuesOf(node.else, domains, unknown)];
    return sides.includes(null) ? null : [...new Set(sides.flat())];
  }
  if (node.op === "+") {
    /** @type {any} */
    const [left, right] = [valuesOf(node.left, domains, unknown), valuesOf(node.right, domains, unknown)];
    if (left === null || right === null) return null;
    return [...new Set(left.flatMap((/** @type {any} */ a) => right.map((/** @type {any} */ b) => a + b)))];
  }
  if (node.method === "at-most") {
    /** @type {any} */
    const values = valuesOf(node.receiver, domains, unknown);
    return values === null ? null : [...new Set(values.map((/** @type {any} */ value) => Math.min(value, Number(node.args[0].integer))))];
  }
  return null;
}

// The literal values that a guard allows its entry's value expression,
// as in `$y'value ∈ ["a", "b"]? key: $y'value`, or null.
/**
 * @param {any} guard
 * @param {any} value
 * @param {any} constants
 */
function guardValues(guard, value, constants = []) {
  if (!guard) return null;
  // A constant list of literals in this document stands for its items.
  /** @param {any} node */
  const literals = node => closedStringList(node, constants)?.map(text => ({ value: { string: text } })) ?? null;
  /**
   * @param {any} a
   * @param {any} b
   */
  const same = (a, b) => JSON.stringify(withoutPositions(a)) === JSON.stringify(withoutPositions(b));
  const conjuncts = guard.all ?? [guard];
  for (const conjunct of conjuncts) {
    const items = conjunct.op === "∈" ? literals(conjunct.right) : null;
    if (items && same(conjunct.left, value) && items.every((/** @type {any} */ item) => literalPayload(item.value) !== undefined)) {
      return items.map((/** @type {any} */ item) => literalPayload(item.value));
    }
    if (conjunct.op === "=" && same(conjunct.left, value) && literalPayload(conjunct.right) !== undefined) return [literalPayload(conjunct.right)];
  }
  return null;
}

// The disjunctive normal form of a recognizer condition: a list of lists
// of atoms. Null where it grows beyond a small bound.
/** @param {any} node */
function normalForm(node) {
  if (node.any) {
    const parts = node.any.map(normalForm);
    return parts.includes(null) ? null : parts.flat();
  }
  if (node.all) {
    let product = [[]];
    for (const part of node.all.map(normalForm)) {
      if (part === null) return null;
      product = product.flatMap(left => part.map((/** @type {any} */ right) => [...left, ...right]));
      if (product.length > 64) return null;
    }
    return product;
  }
  return [[node]];
}

/**
 * @param {any} node
 * @returns {any}
 */
function mentionsRoot(node) {
  if (!node || typeof node !== "object") return false;
  if (node.forestRoot) return true;
  return Object.values(node).some(/** @returns {any} */ value => value && typeof value === "object" && mentionsRoot(value));
}

// The visible keys of a constant key set, or null for any other value. A
// key set can combine other key-set constants of the same document.
/**
 * @param {any} value
 * @param {any} constants
 */
function keySetKeys(value, constants = [], active = new Set()) {
  if (!value || typeof value !== "object") return null;
  if (value.bag) {
    if (!value.bag.every((/** @type {any} */ entry) => entry.kind === "bare" && !entry.gates.length && !entry.guard && isVisibleKey(entry.key))) return null;
    return value.bag.map((/** @type {any} */ entry) => entry.key);
  }
  if (value.const !== undefined) {
    const versions = constants.filter((/** @type {any} */ constant) => constant.name === value.const);
    if (versions.length !== 1 || active.has(value.const)) return null;
    return keySetKeys(versions[0].value, constants, new Set([...active, value.const]));
  }
  const parts = value.union ?? value.intersection ?? value.difference;
  if (!parts) return null;
  const sets = parts.map((/** @type {any} */ part) => keySetKeys(part, constants, active));
  if (sets.some((/** @type {any} */ set) => set === null)) return null;
  if (value.union) return [...new Set(sets.flat())];
  if (value.intersection) return sets[0].filter((/** @type {any} */ key) => sets.slice(1).every((/** @type {any} */ set) => set.includes(key)));
  return sets[0].filter((/** @type {any} */ key) => !sets[1].includes(key));
}

/**
 * The name of a classifier for the recognizer, which needs a lowercase name.
 * @param {any} name
 */
export function classifierName(name) {
  return `classifier-${name.toLowerCase()}`;
}

// Whether a record is a key set by its form.
/**
 * Whether a key set read in recognition holds hidden keys: the keys of a
 * token of the stage input, which carries the written-token key and a key
 * for each payload, unless an intersection with a written set bounds them.
 * @param {any} node
 * @param {(receiver: any) => boolean} tokenCapture
 * @returns {boolean}
 */
function mayHoldHidden(node, tokenCapture) {
  if (!node || typeof node !== "object") return false;
  // A class key ends in a capital letter, and a hidden key does not, so
  // .classes holds no hidden key.
  if (["flags", "keys", "tags"].includes(node.method)) return tokenCapture(node.receiver);
  if (node.union) return node.union.some((/** @type {any} */ item) => mayHoldHidden(item, tokenCapture));
  if (node.intersection) return node.intersection.every((/** @type {any} */ item) => mayHoldHidden(item, tokenCapture));
  if (node.difference) return mayHoldHidden(node.difference[0], tokenCapture);
  return false;
}

/** @param {any} node */
function isKeySetRecord(node) {
  return !!node && (node.bag !== undefined || ["flags", "keys", "classes", "select", "classify", "union"].includes(node.method) ||
    node.intersection !== undefined || node.union !== undefined);
}

// The test of an implicit predicate ' ∈ S, ' ∉ S, ' = s or ' ≠ s, or null.
/** @param {any} node */
function ngramPredicate(node) {
  const body = node?.lambda === "" ? node.body : null;
  if (!body || body.left?.item !== true) return null;
  if (body.op === "∉") return { op: "∉", right: body.right };
  if (["∈", "=", "≠"].includes(body.op)) return { op: body.op, right: body.right };
  return null;
}


/**
 * The key of an alternative in the origin table: its document, the
 * position of its definition and its index there.
 * @param {any} document
 * @param {any} at
 * @param {any} index
 */
export function alternativeKey(document, at, index) {
  return `${document}#${at[0]}:${at[1]}#${index}`;
}

/**
 * The format 50 expression of an argument as the recognizer stores it in
 * an instance: the inverse of argumentTerm. Other arguments stay as they are.
 * @param {any} arg
 */
export function argumentExpression(arg) {
  /** @param {any} key */
  const bare = key => ({ kind: "bare", key, gates: [] });
  if (!arg || typeof arg !== "object") return arg;
  if (arg.tag !== undefined && Object.keys(arg).length === 1) return { bag: [bare(arg.tag)] };
  if (arg.emptySet) return { bag: [] };
  if (arg.union?.every((/** @type {any} */ item) => item.tag !== undefined)) return { bag: arg.union.map((/** @type {any} */ item) => bare(item.tag)) };
  return arg;
}

/**
 * The recognizer's term for a closed argument that reads no constant: its
 * value, computed now. Null for any other argument.
 * @param {any} node
 */
function foldedArgument(node) {
  if (!isClosed(node) || JSON.stringify(node).includes('"const"') || JSON.stringify(node).includes('"apply"')) return null;
  let value;
  try {
    value = new Evaluator({ tokens: [], sourceText: [], features: new Set(), constants: new Map(), leaf: () => null }).evaluate(node, { items: [], names: new Map() });
  } catch (error) {
    if (error instanceof GencmuError) return null;
    throw error;
  }
  if (typeof value === "string") return { string: value };
  if (typeof value === "number") return { integer: String(value) };
  if (value instanceof Bag && value.keys().every(key => !value.hasValue(key))) {
    const tags = value.keys().map(tag => ({ tag }));
    return tags.length === 0 ? { emptySet: true } : tags.length === 1 ? tags[0] : { union: tags };
  }
  return null;
}

// The recognizer's term for an expression argument of a template, or null.
/** @param {any} node */
function argumentTerm(node) {
  if (node.string !== undefined) return { string: node.string };
  if (node.integer !== undefined) return { integer: node.integer };
  if (node.const !== undefined) return { const: node.const, ...(node.at ? { at: node.at } : {}) };
  if (node.param !== undefined) return { param: node.param, ...(node.at ? { at: node.at } : {}) };
  if (node.bag?.every((/** @type {any} */ entry) => entry.kind === "bare" && !entry.gates.length && !entry.guard)) {
    const tags = node.bag.map((/** @type {any} */ entry) => ({ tag: entry.key }));
    return tags.length === 0 ? { emptySet: true } : tags.length === 1 ? tags[0] : { union: tags };
  }
  return null;
}

/**
 * A pattern with the positions of its test records left out.
 * @param {any} node
 * @returns {any}
 */
function withoutTestPositions(node) {
  if (Array.isArray(node)) return node.map(withoutTestPositions);
  if (!node || typeof node !== "object") return node;
  const isTest = node.test !== undefined && node.expr !== undefined;
  return Object.fromEntries(Object.entries(node).filter(([key]) => !(isTest && key === "at"))
    .map(/** @returns {any} */ ([key, value]) => [key, withoutTestPositions(value)]));
}

/**
 * @param {any} node
 * @returns {any}
 */
function withoutPositions(node) {
  if (Array.isArray(node)) return node.map(withoutPositions);
  if (!node || typeof node !== "object") return node;
  return Object.fromEntries(Object.entries(node).filter(([key]) => key !== "at").map(/** @returns {any} */ ([key, value]) => [key, withoutPositions(value)]));
}

/**
 * The strings of a closed list: a list literal or a constant of this
 * document, with each splat of a closed list in place. Null where a guard,
 * a gate or another expression decides the items.
 * @param {any} node
 * @param {any[]} constants
 * @returns {string[] | null}
 */
function closedStringList(node, constants, depth = 0) {
  if (!node || typeof node !== "object" || depth > 32) return null;
  if (node.const !== undefined) {
    const versions = constants.filter(constant => constant.name === node.const);
    return versions.length === 1 ? closedStringList(versions[0].value, constants, depth + 1) : null;
  }
  if (!Array.isArray(node.list)) return null;
  /** @type {string[]} */
  const strings = [];
  for (const item of node.list) {
    if (item.guard || item.gates?.length) return null;
    if (item.kind === "splat") {
      const inner = closedStringList(item.value, constants, depth + 1);
      if (inner === null) return null;
      for (const text of inner) strings.push(text);
    } else if (item.value?.string !== undefined) {
      strings.push(item.value.string);
    } else {
      return null;
    }
  }
  return strings;
}

// The strings or the class references of a classifier entry, or null.
/** @param {any} value */
function classValue(value) {
  if (value.string !== undefined) return { strings: [value.string] };
  if (value.list?.every((/** @type {any} */ item) => item.kind === "item" && !item.gates.length && !item.guard && item.value.string !== undefined)) {
    return { strings: value.list.map((/** @type {any} */ item) => item.value.string) };
  }
  if (value.bag?.every((/** @type {any} */ entry) => entry.kind === "bare" && !entry.gates.length && !entry.guard)) {
    return { references: value.bag.map((/** @type {any} */ entry) => entry.key) };
  }
  return null;
}

const SPAN_RESULTS = new Set(["span", "first-token", "last-token", "tokens-after-first", "onward", "following-tokens", "preceding-tokens"]);

/** @param {any} node */
function isSpan(node) {
  return node.method !== undefined && SPAN_RESULTS.has(node.method);
}

// Whether an expression reads no capture, no item, no parameter and no
// occurrence, outside the functions that it holds.
/**
 * @param {any} node
 * @returns {any}
 */
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

// The body of a predicate with its item replaced by a capture.
/**
 * @param {any} predicate
 * @param {any} name
 * @returns {any}
 */
function itemAsCapture(predicate, name) {
  const capture = { capture: name };
  /**
   * @param {any} item
   * @returns {any}
   */
  const replace = item => {
    if (Array.isArray(item)) return item.map(replace);
    if (!item || typeof item !== "object") return item;
    if (item.item || predicate.lambda && item.capture === predicate.lambda && !item.expr) return capture;
    if (item.lambda !== undefined) return item;
    // A bare method or key of the item reads the capture.
    if ((item.method !== undefined || item.property !== undefined) && !item.receiver) return { ...replaceInner(item), receiver: capture };
    return replaceInner(item);
  };
  /** @param {any} item */
  const replaceInner = item => Object.fromEntries(Object.entries(item).map(/** @returns {any} */ ([key, value]) => [key, replace(value)]));
  return replace(predicate.body);
}

// The fewest nodes that every route binds to each capture of a body.
/**
 * @param {any} node
 * @returns {Map<string, number>}
 */
function minBindings(node) {
  /** @type {Map<string, number>} */
  const result = new Map();
  if (!node || typeof node !== "object") return result;
  if (node.capture !== undefined && node.expr) {
    const inner = minBindings(node.expr);
    inner.set(node.capture, (inner.get(node.capture) ?? 0) + 1);
    return inner;
  }
  if (node.primary) return minBindings(node.primary);
  if (node.test !== undefined) return minBindings(node.expr);
  if (node.seq || node.and) {
    for (const part of node.seq ?? node.and) for (const [name, count] of minBindings(part)) result.set(name, (result.get(name) ?? 0) + count);
    return result;
  }
  if (node.choice || node.ranked) {
    const branches = (node.choice ?? node.ranked).map(minBindings);
    for (const name of new Set(branches.flatMap((/** @type {Map<string, number>} */ branch) => [...branch.keys()]))) {
      result.set(name, branches.reduce((/** @type {number} */ least, /** @type {Map<string, number>} */ branch) => Math.min(least, branch.get(name) ?? 0), Infinity));
    }
    return result;
  }
  // An optional or a repetition can bind nothing.
  return result;
}

// The most nodes that one route binds to each capture of a body, with 2
// for any number above one.
/**
 * @param {any} node
 * @returns {any}
 */
function maxBindings(node) {
  const result = new Map();
  /**
   * @param {any} map
   * @param {any} name
   * @param {any} count
   */
  const add = (map, name, count) => map.set(name, Math.min(2, (map.get(name) ?? 0) + count));
  if (!node || typeof node !== "object") return result;
  if (node.capture !== undefined && node.expr) {
    /** @type {any} */
    const inner = maxBindings(node.expr);
    add(inner, node.capture, 1);
    return inner;
  }
  if (node.primary) return maxBindings(node.primary);
  if (node.test !== undefined) return maxBindings(node.expr);
  if (node.seq || node.and) {
    for (const part of node.seq ?? node.and) for (const [name, count] of maxBindings(part)) add(result, name, count);
    return result;
  }
  if (node.choice || node.ranked) {
    for (const part of node.choice ?? node.ranked) for (const [name, count] of maxBindings(part)) result.set(name, Math.max(result.get(name) ?? 0, count));
    return result;
  }
  if (node.optional) return maxBindings(node.optional);
  if (node.repeat) {
    for (const part of [node.repeat, node.separator]) for (const name of maxBindings(part).keys()) result.set(name, 2);
    return result;
  }
  return result;
}

// The rule or terminal that each capture of a body names.
/**
 * @param {any} node
 * @param {any} symbols
 */
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

/** @param {any} node */
function isSingleSymbol(node) {
  if (node.capture !== undefined) return isSingleSymbol(node.expr);
  if (node.choice) return node.choice.every(isSingleSymbol);
  return SYMBOL_KEYS.some(key => Object.hasOwn(node, key)) && !node.optional && !node.repeat;
}

/**
 * The string of a closed concatenation of literals and constants of this
 * document, or undefined.
 * @param {any} node
 * @param {any[]} constants
 * @returns {string | undefined}
 */
function closedConcat(node, constants, depth = 0) {
  if (!node || typeof node !== "object" || depth > 32) return undefined;
  if (node.string !== undefined) return node.string;
  if (node.const !== undefined) {
    const versions = constants.filter(constant => constant.name === node.const);
    return versions.length === 1 ? closedConcat(versions[0].value, constants, depth + 1) : undefined;
  }
  if (!Array.isArray(node.concat)) return undefined;
  let text = "";
  for (const part of node.concat) {
    const piece = closedConcat(part, constants, depth + 1);
    if (piece === undefined) return undefined;
    text += piece;
  }
  return text;
}

/** The placeholder of a constant whose value the recognizer cannot hold. */
const OPAQUE = Object.freeze({ string: "" });

/** The pattern set that matches nothing. */
const EMPTY_PATTERN = Object.freeze({ empty: true });

/**
 * One pattern of the recognizer for a set of patterns, or EMPTY_PATTERN.
 * A union and an intersection are flat in the recognizer, so a nested one
 * of the same kind joins its parent.
 * @param {any} node
 * @returns {any}
 */
function patternSet(node) {
  if (node.pattern !== undefined) return withoutTestPositions(node.pattern);
  // A constant inside a pattern of the recognizer is a constant atom.
  if (node.const !== undefined) return { constant: node.const };
  if (node.emptySet) return EMPTY_PATTERN;
  if (node.difference) {
    const [left, right] = node.difference.map(patternSet);
    if (left === EMPTY_PATTERN || right === EMPTY_PATTERN) return left;
    return { difference: [left, right] };
  }
  const kind = node.union ? "union" : "intersection";
  const parts = [];
  for (const item of node[kind].map(patternSet)) {
    if (item === EMPTY_PATTERN) {
      if (kind === "intersection") return EMPTY_PATTERN;
      continue;
    }
    for (const part of item[kind] ?? [item]) parts.push(part);
  }
  if (!parts.length) return EMPTY_PATTERN;
  return parts.length === 1 ? parts[0] : { [kind]: parts };
}
