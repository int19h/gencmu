// The format 50 loader recognizes a stage with the format 49 recognizer.
// This module lowers one DOM 50 document to the records that the recognizer
// reads. Recognition sees the visible keys of a bag as tags, the certified
// rule values as strings, and the conditions as format 49 conditions. Bags,
// emission and results stay in the format 50 modules.

import { GencmuError } from "../errors.js";
import { Evaluator, isPatternSet } from "./evaluate.js";
import { Bag } from "./bag.js";
import { DOM_TRUE, DOM_FALSE } from "../dom.js";
import { NATIVE_JOIN, NATIVE_KEYS, NATIVE_PAYLOAD, NATIVE_VISIBLE } from "../methods.js";
import { observationRow, OBSERVATIONS } from "./observations.js";
import { recordKind50 } from "./records.js";
import { isCompoundCapture50, rankedOnlyNames } from "./validate.js";
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
  "starts-input", "ends-input", "source-text", "decomposed-source-text",
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
 * @param {HiddenKeys} [hidden] the hidden keys of the stages of the document,
 * where they are not those of the document alone
 */
export function bridgeDocument(dom, path, origins, hidden) {
  return new Bridge(dom, path, origins, hidden).document();
}

/**
 * @typedef {{demanded: Set<string>, valued?: Set<string>, domains: Map<string, any[]>, roots: Map<string, Set<string>>}} HiddenKeys
 * The keys that are not visible and that recognizer tests read, with the
 * finite set of values of each key that has one. `roots` gives, for `value`
 * and `image`, the rules at the root of a forest whose predicate reads that
 * key of the root.
 */

export class Bridge {
  /**
   * @param {any} dom
   * @param {any} path
   * @param {any} origins
   * @param {HiddenKeys} [stageHidden]
   */
  constructor(dom, path, origins, stageHidden) {
    this.dom = dom;
    this.path = path;
    this.origins = origins;
    this.stageHidden = stageHidden;
    /** @type {any[]} */
    this.classifiers = [];
    /** @type {HiddenKeys} the hidden keys that recognizer tests read */
    this.hidden = { demanded: new Set(), domains: new Map(), roots: new Map() };
    /** @type {string | undefined} the rule at the root of the forest of the predicate being lowered */
    this.forestRootRule = undefined;
    /** @type {Map<any, any> | undefined} the body of each alternative of the rule being lowered */
    this.bodies = undefined;
    /** @type {Set<string>} the compound labels of the rule being lowered */
    this.compounds = new Set();
    /** @type {Map<string, GencmuError>} the rules whose keys have no tag term */
    this.untranslated = new Map();
    /** @type {GencmuError[]} the conditions that the recognizer cannot test */
    this.deferred = [];
    /** @type {Set<string>} the rules whose keys a recognizer test reads */
    this.keyReaders = new Set();
    /** @type {{capture: string, rule: string}[]} the compound bindings whose keys a recognizer test reads */
    this.compoundKeyReads = [];
    // The rules whose keys flow into the keys of each rule, through its
    // primary or its sole symbol.
    /** @type {Map<string, Set<string>>} */
    this.tagSources = new Map();
    // The parameters of each template of this document, and the names that
    // the actuals of each call bind, by template. A key read through a
    // parameter of a template reads the rules of its actuals.
    /** @type {Map<string, string[]>} */
    this.templateParams = new Map();
    /** @type {{template: string, actuals: string[][]}[]} */
    this.templateCalls = [];
    /** @type {Map<string, Set<string>>} */
    this.captureRules = new Map();
    /** @type {any[]} the instance bindings of the document, with their format 50 calls */
    this.instances50 = [];
    /** @type {Set<string>} the constants that the recognizer gets a placeholder for */
    this.opaque = new Set();
    // The first recognizer read of each constant. A read fails at load where
    // any document of the stage gives the constant only a placeholder.
    /** @type {Map<string, GencmuError>} */
    this.constantReads = new Map();
    /** @type {Map<string, GencmuError>} the constants that this document folds */
    this.foldedConstants = new Map();
    // The keys with no finite domain that some write cannot give a value tag
    // in recognition, and the first read of each such key. The loader fails
    // on a read of a key that a write of the stage cannot tag.
    /** @type {Set<string>} */
    this.untaggedPayloads = new Set();
    /** @type {Map<string, GencmuError>} */
    this.nativeReads = new Map();
    // The reads that enumerate the values of a payload key. The loader
    // refuses each where the stage input can carry the key with a payload.
    /** @type {{key: string, at: any}[]} */
    this.domainReads = [];
    // The reads of the value of a node that recognition makes, with the
    // symbols that the receiver can bind. Each needs the certificate of
    // every such symbol (observations.js, "certified-value"). A read inside
    // a tag term counts where a recognizer test reads that rule's keys.
    /** @type {{targets: any[], shown: string, at: any, term: string | null, template?: string}[]} */
    this.valueReads = [];
    /** @type {string | undefined} the template being lowered */
    this.currentTemplate = undefined;
    /** @type {WeakSet<object>} the reads handed to the recognizer that have a row of the table */
    this.observed = new WeakSet();
    /** @type {Map<string, any[]>} the symbols that each capture of the rule in hand binds */
    this.captureTargets = new Map();
    /** @type {string | null} the rule whose tag term is being lowered */
    this.inTagTerm = null;
    // The constants that the definition of each constant refers to. A read
    // of a constant reads them too.
    /** @type {Map<string, Set<string>>} */
    this.constantDeps = new Map();
    /** @type {string | null} */
    this.defining = null;
    /** @type {Map<string, string>} the symbol of each capture of the rule in hand */
    this.captureSymbols = new Map();
  }

  // The written calls by their site, for the names of their instances.
  /** @param {any} call */
  registerCall(call) {
    this.noteCall(call);
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
    foldNotes.set(this.dom.constants, (/** @type {any} */ name, /** @type {any} */ at) => this.noteFold(name, at));
    try {
      return this.lowerDocument();
    } finally {
      foldNotes.delete(this.dom.constants);
    }
  }

  // A fold of a constant from the versions of this document. The loader
  // fails on it where another document of the stage has a version of the
  // constant, since the fold would read an earlier version.
  /** @param {string} name @param {any} at */
  noteFold(name, at) {
    if (this.foldedConstants.has(name)) return;
    try {
      this.fail(`fold the constant $${name}, which another document of the stage redefines`, at);
    } catch (error) {
      this.foldedConstants.set(name, /** @type {GencmuError} */ (error));
    }
  }

  lowerDocument() {
    this.hidden = this.stageHidden ?? hiddenKeys([this.dom]);
    const constants = [];
    // The stage reads each constant through its format 50 record. The
    // recognizer gets a placeholder for each one, with its value where a
    // condition or a filter reads it.
    // Each version of a constant in this document gets a placeholder of
    // one kind, so that the recognizer sees no change of type.
    const kinds = new Map();
    for (const constant of this.dom.constants) {
      const data = this.definitionData(constant);
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
      const data = kinds.get(constant.name) === "mixed" ? OPAQUE : this.definitionData(constant);
      // The loader refuses every recognizer read of a constant with a
      // placeholder, so only the type of the placeholder matters. A
      // redefinition names the version before it, which keeps its type. A
      // definition takes the type of the form of its value.
      const value = data !== OPAQUE ? data : constant.op === "redefine" ? { const: constant.name, at: constant.at } : this.placeholder(constant.value);
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
      compoundKeyReads: this.compoundKeyReads,
      tagSources: this.tagSources,
      templateParams: this.templateParams,
      templateCalls: this.templateCalls,
      opaque: this.opaque,
      constantDeps: this.constantDeps,
      foldedConstants: this.foldedConstants,
      definedConstants: new Set(this.dom.constants.map((/** @type {any} */ constant) => constant.name)),
      constantReads: this.constantReads,
      untaggedPayloads: this.untaggedPayloads,
      nativeReads: this.nativeReads,
      domainReads: this.domainReads.map(read => ({ ...read, document: this.path })),
      valueReads: this.valueReads.map(read => ({ ...read, document: this.path })),
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
    // A pattern constant holds its pattern, with its constants as atoms.
    if (value.pattern !== undefined) return { pattern: this.pattern(value.pattern) };
    if (isPatternSet(value)) {
      const pattern = patternSet(value);
      this.notePatternReaders(pattern);
      if (pattern !== EMPTY_PATTERN) return { pattern };
    }
    // A value built from other constants keeps its references, and the
    // recognizer reads the final version of each in the stage. A later
    // document can redefine any of them (notation, "Constants": every other
    // reference selects the final stitched version). A constant cannot hold
    // the bare empty set, whose kind is not given.
    if (mentionsConstant(value)) {
      const term = this.setTerm(value, "keys") ?? this.setTerm(value, "strings") ?? this.stringData(value);
      if (term && !term.emptySet) return term;
    }
    // A closed concatenation folds to its string.
    const folded = closedConcat(value, this.dom.constants);
    if (folded !== undefined) return { string: folded };
    // A list of strings, with its splats in place (docs/notation.md, "Lists, functions and numbers").
    const strings = closedStringList(value, this.dom.constants);
    if (strings?.length) return setOf(strings.map(text => ({ string: text })));
    // A key set of visible keys holds its tags.
    const keys = keySetKeys(value, this.dom.constants);
    if (keys?.length) return keys.length === 1 ? { tag: keys[0] } : { union: keys.map((/** @type {any} */ key) => ({ tag: key })) };
    // A closed set with no item, such as {A} ∖ {A}, keeps its written form,
    // which gives the recognizer its kind.
    const empty = this.setTerm(value, "keys") ?? this.setTerm(value, "strings");
    if (empty && !empty.emptySet) return empty;
    // The recognizer reads only strings, lists of strings, patterns and key
    // sets from a constant. Any other constant gets a placeholder, and a
    // recognizer read of it fails at load.
    return OPAQUE;
  }

  /**
   * A recognizer read of a constant, which fails where the constant has a
   * placeholder only.
   * @param {any} node
   */
  constantRead(node) {
    this.noteConstantRead(node.const, node.at);
    return { const: node.const, ...(node.at ? { at: node.at } : {}) };
  }

  /**
   * The recognizer's string of a concatenation or a constant reference,
   * with its constants as references, or null.
   * @param {any} value
   */
  stringData(value) {
    if (!Array.isArray(value.concat) && value.const === undefined) return null;
    // The engine gives $INPUTS to the stage, and the recognizer has no
    // constant of that name.
    if (mentionsConstant(value, "INPUTS")) return null;
    try {
      return this.string(value);
    } catch (error) {
      if (!(error instanceof GencmuError)) throw error;
      return null;
    }
  }

  /**
   * A placeholder with the type of the form of a value: a key set, a list
   * of strings, a pattern or a string. The recognizer never reads it.
   * @param {any} value
   * @returns {any}
   */
  placeholder(value, depth = 0) {
    const kind = this.formKind(value, depth);
    if (kind === "keys") return { tag: WRITTEN };
    if (kind === "strings") return setOf([{ string: "" }]);
    if (kind === "pattern") return { pattern: { wildcard: true } };
    return { string: "" };
  }

  /**
   * The kind of value that the form of an expression gives, or "string".
   * @param {any} value
   * @returns {"keys" | "strings" | "pattern" | "string"}
   */
  formKind(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 32) return "string";
    if (value.bag) return "keys";
    if (value.list) return "strings";
    if (value.pattern !== undefined || value.emptySet) return "pattern";
    if (["keys", "flags", "classes", "select"].includes(value.method)) return "keys";
    const parts = value.union ?? value.intersection ?? value.difference;
    if (parts) {
      for (const part of parts) {
        const kind = this.formKind(part, depth + 1);
        if (kind !== "string" || part.const === undefined) return kind;
      }
      return "string";
    }
    if (value.const !== undefined) {
      const version = this.dom.constants.find((/** @type {any} */ constant) => constant.name === value.const && constant.op !== "redefine");
      return version ? this.formKind(version.value, depth + 1) : "string";
    }
    return "string";
  }

  /**
   * The recognizer's value of a constant. A constant that the definition
   * refers to is a dependency, and not a read.
   * @param {any} constant
   */
  definitionData(constant) {
    this.defining = constant.name;
    try {
      return this.data(constant.value);
    } finally {
      this.defining = null;
    }
  }

  /**
   * The recognizer's term for a key set of visible keys or a list of
   * strings, with its constants as references, or null. A splat of a
   * constant and a set operation keep their operands.
   * @param {any} value
   * @param {"keys" | "strings"} kind
   * @returns {any}
   */
  setTerm(value, kind) {
    if (!value || typeof value !== "object") return null;
    if (value.const !== undefined) {
      // The engine gives $INPUTS to the stage, and the recognizer has no
      // constant of that name.
      if (value.const === "INPUTS") return null;
      this.noteConstantRead(value.const, value.at);
      return { const: value.const, ...(value.at ? { at: value.at } : {}) };
    }
    /** @type {any[]} */
    const parts = [];
    if (kind === "keys" && value.bag) {
      for (const entry of value.bag) {
        if (entry.gates.length || entry.guard) return null;
        if (entry.kind === "bare" && isVisibleKey(entry.key)) parts.push({ tag: entry.key });
        else if (entry.kind === "splat") {
          const inner = this.setTerm(entry.value, kind);
          if (!inner) return null;
          parts.push(inner);
        } else return null;
      }
      return parts.length === 0 ? { emptySet: true } : parts.length === 1 ? parts[0] : { union: parts };
    }
    if (kind === "keys" && (value.union || value.intersection || value.difference)) {
      const op = value.union ? "union" : value.intersection ? "intersection" : "difference";
      for (const operand of value[op]) {
        const inner = this.setTerm(operand, kind);
        if (!inner) return null;
        parts.push(inner);
      }
      return { [op]: parts };
    }
    if (kind === "strings" && Array.isArray(value.list)) {
      for (const item of value.list) {
        if (item.gates?.length || item.guard) return null;
        if (item.kind === "splat") {
          const inner = this.setTerm(item.value, kind);
          if (!inner) return null;
          parts.push(inner);
          continue;
        }
        // An item that names a constant keeps its reference, as a string
        // operand of the union, so that it reads the final version.
        if (item.value?.string === undefined && mentionsConstant(item.value)) {
          const term = this.stringData(item.value);
          if (!term) return null;
          parts.push(term);
          continue;
        }
        const text = item.value?.string ?? closedConcat(item.value, this.dom.constants);
        if (typeof text !== "string") return null;
        parts.push({ string: text });
      }
      return parts.length === 1 && parts[0].const !== undefined ? parts[0] : setOf(parts);
    }
    return null;
  }

  /**
   * Notes a fault that the loader reports once it has read the stage.
   * @param {string} description
   * @param {any} at
   */
  deferFault(description, at) {
    try {
      this.fail(description, at);
    } catch (error) {
      if (!(error instanceof GencmuError)) throw error;
      this.deferred.push(error);
    }
  }

  /**
   * Notes a read of the run-time value tag of a payload.
   * @param {string} key
   * @param {any} at
   */
  noteNativeRead(key, at) {
    if (this.nativeReads.has(key)) return;
    try {
      this.fail(`compare the payload ${key}, whose values are not known`, at);
    } catch (error) {
      this.nativeReads.set(key, /** @type {GencmuError} */ (error));
    }
  }

  /**
   * Notes a recognizer read of a constant. Every form that hands a constant
   * to the recognizer notes it: a string, a key set, a requirement, a
   * pattern and a template argument.
   * @param {string} name
   * @param {any} at
   */
  noteConstantRead(name, at) {
    if (this.defining !== null) {
      if (!this.constantDeps.has(this.defining)) this.constantDeps.set(this.defining, new Set());
      this.constantDeps.get(this.defining)?.add(name);
      return;
    }
    // The engine gives $INPUTS to the stage, and the recognizer has no
    // constant of that name.
    if (name === "INPUTS") this.fail("read $INPUTS, which the engine gives to the stage after recognition", at);
    // The loader fails on the read once it knows every placeholder of the
    // stage, so a read before a later version of this document counts too.
    if (!this.constantReads.has(name)) {
      try {
        this.fail(`read the constant $${name}, whose value it cannot hold`, at);
      } catch (error) {
        this.constantReads.set(name, /** @type {GencmuError} */ (error));
      }
    }
  }

  /** @param {any} directive */
  directive(directive) {
    const copy = { ...directive };
    // The pipeline evaluates the conditions of %features itself, so the
    // recognizer gets the directive with no conditions. The extra member is
    // not enumerable, so the readers of format 49, which walk every member
    // of a record, do not see its format 50 records.
    if (directive.conditions) {
      copy.conditions = [];
      Object.defineProperty(copy, "conditions50", { value: directive.conditions, enumerable: false });
    }
    if (directive.steps) copy.steps = directive.steps.map((/** @type {any} */ step) => step.pattern ? { ...step, pattern: this.pattern(step.pattern) } : step);
    return copy;
  }

  /** @param {any} rule */
  rule(rule) {
    if (rule.instance) {
      this.registerCall(rule.instance);
      // The recognizer names an instance binding by the binding's place.
      if (rule.at) this.origins.set(`call:${this.path}#${rule.at[0]}:${rule.at[1]}`, rule.instance);
      this.addTagSource(rule.name, rule.instance.call);
      // The stage checks read the format 50 actuals, which stay beside the
      // document that the recognizer reads.
      this.instances50.push({ name: rule.name, op: rule.op, at: rule.at, instance: rule.instance, conditions: [] });
      for (const [key, rules] of this.hidden.roots) {
        if (rules.has(rule.name)) this.deferFault(`read the ${key} of a root of a forest that the instance binding ${rule.name} gives`, rule.at);
      }
      return { ...rule, instance: { ...rule.instance, args: rule.instance.args.map((/** @type {any} */ arg) => this.argument(arg)) } };
    }
    /** @type {any} */
    const copy = { name: rule.name, op: rule.op };
    if (rule.params) copy.params = rule.params;
    this.captureSymbols = new Map();
    this.currentRule = rule.name;
    this.currentTemplate = rule.params ? rule.name : undefined;
    if (rule.params) this.templateParams.set(rule.name, rule.params);
    if (rule.args) copy.args = rule.args.map((/** @type {any} */ arg) => this.argument(arg));
    // The captures that bind at most one node on every route of the rule.
    this.atMostOne = new Set();
    const counts = new Map();
    // A compound label (docs/notation.md, "Captures") binds one node for each visit. Its
    // operand lowers in place, so the label is transparent to recognition,
    // and the recognizer gives its window and tags.
    const bodies = new Map(rule.alternatives.map((/** @type {any} */ alternative) => [alternative, alternative.expr]));
    this.bodies = bodies;
    this.compounds = compoundLabels(rule.alternatives.map((/** @type {any} */ alternative) => alternative.expr));
    // The compound bindings that a structural comparison reads need the
    // structure of each position of their operand.
    this.structural = this.compounds.size ? structurallyCompared(rule) : new Set();
    for (const alternative of rule.alternatives) {
      for (const [name, count] of maxBindings(bodies.get(alternative))) counts.set(name, Math.max(counts.get(name) ?? 0, count));
    }
    for (const [name, count] of counts) if (count <= 1) this.atMostOne.add(name);
    // The fewest and the most nodes that each alternative binds to a name.
    this.bindings = rule.alternatives.map((/** @type {any} */ alternative) => ({ min: minBindings(bodies.get(alternative)), max: maxBindings(bodies.get(alternative)) }));
    this.repeated = new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
    for (const alternative of rule.alternatives) collectCaptureSymbols(bodies.get(alternative), this.captureSymbols);
    this.captureRules = new Map();
    for (const alternative of rule.alternatives) collectCaptureRules(bodies.get(alternative), this.captureRules);
    this.captureTargets = new Map();
    for (const alternative of rule.alternatives) collectCaptureTargets(bodies.get(alternative), this.captureTargets, rule.name);
    // The tags of each alternative read the capture sets of this rule.
    copy.alternatives = rule.alternatives.map((/** @type {any} */ alternative) => this.alternative(alternative, rule));
    // A forest predicate reads the value or image of a root of this rule
    // through a hidden tag, which only a write in the terms of each
    // alternative gives. The stage defaults and the symbols give no tag.
    for (const [key, rules] of this.hidden.roots) {
      if (!rules.has(rule.name)) continue;
      const silent = rule.alternatives.find((/** @type {any} */ alternative) =>
        !writesLast([...rule.term?.bag ?? [], ...alternative.term?.bag ?? []], key));
      if (silent) this.deferFault(`read the ${key} of a root of a forest, which an alternative of ${rule.name} does not write in its term`, silent.term?.at ?? rule.at);
    }
    try {
      copy.conditions = rule.conditions.flatMap((/** @type {any} */ node) => this.clauses(node));
      // A condition that is always false removes the production, and one
      // that is always true adds nothing.
      if (copy.conditions.includes(DOM_FALSE)) copy.conditions = [DOM_FALSE];
      else copy.conditions = copy.conditions.filter((/** @type {any} */ condition) => condition !== DOM_TRUE);
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
    // A message runs after the choice of a parse, where the stage
    // evaluates it (engine §12.1). The recognizer gets its lowered form,
    // so that the checks of what a message can read run on it, such as
    // ranked-choice-export. A message that has no lowered form gets a
    // fixed text, because the recognizer needs only to know that the rule
    // reports.
    if (rule.error) copy.error = this.lateMessage(rule.error);
    if (rule.warning) copy.warning = this.lateMessage(rule.warning);
    if (rule.suppressWarnings) copy.suppressWarnings = rule.suppressWarnings;
    if (rule.erased) copy.erased = true;
    copy.at = rule.at;
    // Every read that recognition makes has a row of the table of
    // observations. A read with none fails here, so refusal is the default.
    try {
      // The lowered bodies hold the filters and value tests of the symbols,
      // which read no capture, so a capture read there has no row either.
      this.assertObserved([copy.conditions, copy.tags, (copy.alternatives ?? []).map((/** @type {any} */ alternative) => [alternative.tags, alternative.expr])]);
    } catch (error) {
      if (!(error instanceof GencmuError)) throw error;
      this.deferred.push(error);
    }
    return copy;
  }

  /**
   * Marks a read handed to the recognizer with its row of the table of
   * observations, or refuses it.
   * @template T
   * @param {string} id
   * @param {string} kind the kind of the receiver
   * @param {T} emitted
   * @param {any} [at]
   * @returns {T}
   */
  observe(id, kind, emitted, at) {
    if (!observationRow(id, kind)) {
      const row = OBSERVATIONS.get(id);
      return this.fail(`read ${row ? row.form.charAt(0).toLowerCase() + row.form.slice(1) : "this form"} on ${KIND_NAMES[kind] ?? kind}`, at);
    }
    if (emitted && typeof emitted === "object") this.observed.add(/** @type {object} */ (emitted));
    return emitted;
  }

  /**
   * Fails on a read of a capture in a recognizer record that has no row of
   * the table of observations: a presence test, a method on a capture, and
   * a structural comparison of a capture.
   * @param {any} node
   */
  assertObserved(node) {
    /** @type {any[]} */
    const stack = [node];
    while (stack.length) {
      const item = stack.pop();
      if (!item || typeof item !== "object") continue;
      if (Array.isArray(item)) {
        for (const each of item) stack.push(each);
        continue;
      }
      const read = typeof item.captured === "string" || item.method !== undefined && typeof item.receiver?.capture === "string" ||
        (item.op === "≅" || item.op === "≇") && typeof item.left?.capture === "string";
      if (read && !this.observed.has(item)) {
        return this.fail(`read ${describeRead(item)}, which has no row in the table of recognition observations`, item.at);
      }
      for (const [key, value] of Object.entries(item)) if (key !== "at" && value && typeof value === "object") stack.push(value);
    }
  }

  /**
   * @param {any} alternative
   * @param {any} rule
   */
  alternative(alternative, rule) {
    const used = new Map();
    /** @param {any} each */
    const bodyOf = each => this.bodies?.get(each) ?? each.expr;
    for (const each of rule.alternatives) collectCaptureSymbols(bodyOf(each), used);
    const written = bodyOf(alternative);
    let synthetic = PRIMARY_CAPTURE;
    while ([...used.keys()].includes(synthetic)) synthetic += "_";
    /** @type {{name: any, synthetic: string, found?: boolean, used?: Set<string>}} */
    const primary = { name: null, synthetic, used: new Set(used.keys()) };
    const expr = this.body(written, primary);
    const record = { rule, alternative, ...(primary.name !== null ? { primary: primary.name, primarySynthetic: primary.name === synthetic } : {}) };
    // The recognizer validates instance definitions strictly, so the
    // alternatives of a template name no origin. The stage finds them by
    // the statement that writes them and the index of the alternative in
    // it, since a template can have several statements.
    /** @type {any} */
    let copy;
    if (rule.params) {
      this.origins.set(`template:${alternativeKey(this.path, rule.at, rule.alternatives.indexOf(alternative))}`, { ...record, document: this.path });
      copy = { gates: alternative.gates, expr };
    } else {
      this.origins.set(alternativeKey(this.path, rule.at, rule.alternatives.indexOf(alternative)), { ...record, document: this.path });
      copy = { gates: alternative.gates, expr };
    }
    // The keys of a primary or a sole symbol become the keys of this rule.
    const sources = primary.name !== null ? primaryNames(written)
      : !rule.term && !alternative.term && isSingleSymbol(written) ? symbolNames(written) : new Set();
    for (const source of sources) this.addTagSource(rule.name, source);
    let tags;
    // A term that reads a private ranked capture has no keys for an early
    // reader, which needs one expression from every option. A late read is
    // legal (engine §4). So it fails only where a recognizer test reads the
    // keys of the rule.
    const privateNames = rankedOnlyNames(written);
    const privateRead = [rule.term, alternative.term].filter(Boolean)
      .flatMap((/** @type {any} */ term) => termCaptures(term)).find((/** @type {any} */ read) => privateNames.has(read.capture));
    if (privateRead) {
      const at = privateRead.at ?? alternative.term?.at ?? rule.at;
      this.untranslated.set(rule.name, new GencmuError("grammar", `${this.path}: ranked-choice-export: A tag term cannot read a private ranked capture.`,
        { document: this.path, code: "ranked-choice-export", ...(at ? { line: at[0], column: at[1] } : {}) }));
      copy.tags = { emptySet: true };
      return copy;
    }
    try {
      tags = this.alternativeTags({ ...alternative, expr: written }, rule, primary.name);
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
    if (primary !== null) tags = this.observe("tag-term", this.receiverKind({ capture: primary }), { method: "tags", receiver: { capture: primary }, args: [] });
    else if (!terms.length) return isSingleSymbol(alternative.expr) ? undefined : { emptySet: true };
    const outer = this.inTagTerm;
    this.inTagTerm = rule.name;
    try {
      for (const term of terms) tags = this.bagTags(term, tags);
    } finally {
      this.inTagTerm = outer;
    }
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
    // The hidden tags of a key form one group by its name (methods.js,
    // NATIVE_KEYS). Each entry reads the earlier tags once: a write and a
    // copy splat the new group over them, and a deletion drops the group.
    /** @param {any} source */
    const splat = source => tags === null ? source : { method: NATIVE_KEYS, receiver: tags, args: [{ string: "splat" }, source] };
    for (const entry of this.inlined(term.bag)) {
      /** @param {any} key */
      const hidden = key => !isVisibleKey(key) && (this.hidden.demanded.has(key) || !!this.hidden.roots.get(key)?.has(this.currentRule));
      if (entry.gates.length && this.entryReadsKeys(entry, hidden)) this.fail("gate an entry of a bag", entry.at);
      // The guard is lowered only for an entry that changes the tags.
      /** @param {any} part */
      const guarded = part => entry.guard ? { if: this.truth(entry.guard), then: part } : part;
      switch (entry.kind) {
        case "bare":
          if (isVisibleKey(entry.key)) tags = union(tags, guarded({ tag: entry.key }));
          else if (hidden(entry.key)) tags = splat(guarded({ tag: presentTag(entry.key) }));
          break;
        case "write": {
          const visible = entry.keys.filter(isVisibleKey).map((/** @type {string} */ key) => ({ tag: key }));
          if (visible.length) tags = union(tags, guarded(visible.length === 1 ? visible[0] : { union: visible }));
          for (const key of entry.keys) if (!isVisibleKey(key) && hidden(key)) tags = splat(guarded(this.hiddenWrite(key, entry.value, entry.guard)));
          break;
        }
        case "copy": {
          if (!isVisibleKey(entry.key) && !hidden(entry.key)) break;
          const source = this.tagsOf(entry.source, entry.at);
          // A copy from a source without the key writes nothing, so the
          // earlier tags of the key stay.
          if (isVisibleKey(entry.key)) tags = union(tags, guarded({ intersection: [source, { tag: entry.key }] }));
          else tags = splat(guarded({ method: NATIVE_KEYS, receiver: source, args: [{ string: "take" }, { string: hex(entry.key) }] }));
          break;
        }
        case "splat":
          tags = splat(guarded(this.splatTags(entry.value, entry.at, hidden)));
          break;
        case "delete":
          if (tags === null) break;
          if (isVisibleKey(entry.key)) tags = { difference: [tags, guarded({ tag: entry.key })] };
          else if (hidden(entry.key)) {
            tags = !entry.guard ? { method: NATIVE_KEYS, receiver: tags, args: [{ string: "drop" }, { string: hex(entry.key) }] }
              : { method: NATIVE_KEYS, receiver: tags, args: [{ string: "dropif" }, guarded({ tag: presentTag(entry.key) }), { string: hex(entry.key) }] };
          }
          break;
        default:
          this.fail(`read the entry ${entry.kind}`, entry.at);
      }
    }
    return tags;
  }

  /**
   * The tags that a splat gives a bag, hidden key groups included. A nested
   * bag goes through the same steps as the bag around it. A selection of a
   * node by a mask takes each hidden group that the mask names, and the
   * visible tags of the mask. Every other value gives its tags.
   * @param {any} value
   * @param {any} at
   * @param {(key: string) => boolean} hidden
   * @returns {any}
   */
  splatTags(value, at, hidden) {
    if (value?.bag) return this.bagTags(value, null) ?? { emptySet: true };
    if (value?.method === "select") {
      const receiver = this.tagsOf(value.receiver, at);
      const keys = this.closedKeys(value.args[0]);
      const visible = { intersection: [receiver, this.tagsOf(value.args[0], at)] };
      if (keys === null) {
        // A mask whose keys are not closed can name a hidden key that a
        // recognizer test reads.
        if ([...this.hidden.demanded].length) return this.fail("splat a selection by a mask whose keys are not closed, where a test reads a hidden key", at);
        return visible;
      }
      const groups = keys.filter(key => !isVisibleKey(key) && hidden(key));
      if (!groups.length) return visible;
      const taken = { method: NATIVE_KEYS, receiver, args: [{ string: "take" }, ...groups.map(key => ({ string: hex(key) }))] };
      return { union: [visible, taken] };
    }
    return this.tagsOf(value, at);
  }

  /**
   * The keys of a mask that the document fixes: a bag of bare keys, or a
   * constant whose versions in this document are such bags. Null for any
   * other mask.
   * @param {any} mask
   * @returns {string[] | null}
   */
  closedKeys(mask) {
    if (mask?.bag) {
      if (!mask.bag.every((/** @type {any} */ entry) => entry.kind === "bare" && !entry.gates.length && !entry.guard)) return null;
      return mask.bag.map((/** @type {any} */ entry) => entry.key);
    }
    if (mask?.const !== undefined) {
      const versions = this.dom.constants.filter((/** @type {any} */ constant) => constant.name === mask.const);
      if (!versions.length) return null;
      const keys = new Set();
      for (const version of versions) {
        const own = this.closedKeys(version.value);
        if (own === null) return null;
        for (const key of own) keys.add(key);
      }
      return [...keys];
    }
    return null;
  }

  /**
   * Whether an entry writes, copies, splats or deletes a key that the tag
   * term holds.
   * @param {any} entry
   * @param {(key: string) => boolean} hidden
   */
  entryReadsKeys(entry, hidden) {
    const keys = entry.kind === "write" ? entry.keys : entry.kind === "splat" ? null : [entry.key];
    return keys === null || keys.some((/** @type {string} */ key) => isVisibleKey(key) || hidden(key));
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

  // The hidden tags that a write of an expression gives a key.
  /**
   * @param {any} key
   * @param {any} value
   * @param {any} guard
   */
  hiddenWrite(key, value, guard) {
    /** @type {any[]} */
    const parts = [{ tag: presentTag(key) }, { tag: payloadTag(key) }];
    // Recognition reads only the presence of this key, so no value tag. A
    // forest predicate reads the value of a root through its value tag.
    if (this.hidden.valued && !this.hidden.valued.has(key) && !this.hidden.roots.get(key)?.has(this.currentRule)) return { union: parts };
    const domain = this.hidden.domains.get(key);
    if (!domain) {
      // A string with no finite domain gets the tag of its value at run time.
      try {
        parts.push(nativePayload(key, this.string(value)));
      } catch (error) {
        if (!(error instanceof GencmuError)) throw error;
        this.untaggedPayloads.add(key);
      }
      return { union: parts };
    }
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
      return { op: "⊆", left: { tag: payloadTag(node.property, value) }, right: this.capturedTags(node.receiver.capture) };
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

  // The visible keys of a bag, a node, a span or a forest, as a tag term.
  /**
   * @param {any} node
   * @param {any} [at]
   * @returns {any}
   */
  tagsOf(node, at) {
    const inlined = this.inline(node);
    if (inlined) return this.tagsOf(inlined, at);
    if (node.capture !== undefined) return this.capturedTags(node.capture);
    if (node.param !== undefined) return { param: node.param, ...(node.at ? { at: node.at } : {}) };
    if (node.const !== undefined) {
      // A key set of visible keys has a tag term. A constant of another
      // document has its own, and the recognizer checks that it is a key set.
      const versions = this.dom.constants.filter((/** @type {any} */ constant) => constant.name === node.const);
      if (!versions.every((/** @type {any} */ constant) => this.setTerm(constant.value, "keys"))) {
        return this.fail("read the keys of the constant " + node.const, node.at ?? at);
      }
      this.noteConstantRead(node.const, node.at ?? at);
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
    // .keys holds the keys that are not visible too, which the tags of a
    // node hold only where recognition reads them (observations.js, "key-set").
    if (node.method === "keys") return this.fail("read .keys of a node, which holds keys that the recognizer does not tag", node.at ?? at);
    if (node.method === "flags" || node.method === "classes") {
      const receiver = node.receiver;
      const method = node.method === "classes" ? "classes" : "tags";
      // The tags of a node, a span or a forest in recognition hold hidden
      // keys beside the visible ones, which a key set of it leaves out.
      /** @param {any} term */
      const keys = term => method === "tags" ? visibleOf(term) : term;
      // A list of optional or repeated nodes has the union of their keys.
      if (receiver?.method === "union" && receiver.receiver?.map?.capture !== undefined &&
          receiver.receiver.by?.method === node.method) {
        const capture = receiver.receiver.map.capture;
        return { if: this.observe("presence", "list", { captured: capture }), then: keys(method === "tags" ? this.capturedTags(capture) : this.nodeKeys(method, capture)) };
      }
      if (receiver?.capture !== undefined) return keys(method === "tags" ? this.capturedTags(receiver.capture) : this.nodeKeys(method, receiver.capture));
      if (receiver?.method === "parse" || receiver?.method === "error-free") return keys(this.forestTags(receiver, method));
      // The keys of a span are those of its input tokens.
      if (receiver?.method !== undefined) return keys(this.observe("key-set", "span", { method, receiver: this.expression(receiver), args: [] }));
      return this.fail("read the keys of this expression", node.at ?? at);
    }
    // A list of optional or repeated nodes has the union of their keys.
    if (node.method === "union" && node.receiver?.map?.capture !== undefined && node.receiver.by?.method === "keys") {
      return this.fail("read .keys of a node, which holds keys that the recognizer does not tag", node.at ?? at);
    }
    if (node.method === "union" && node.receiver?.map?.capture !== undefined && ["flags", "classes"].includes(node.receiver.by?.method)) {
      const capture = node.receiver.map.capture;
      const method = node.receiver.by.method === "classes" ? "classes" : "tags";
      const term = method === "tags" ? visibleOf(this.capturedTags(capture)) : this.nodeKeys(method, capture);
      return { if: this.observe("presence", "list", { captured: capture }), then: term };
    }
    if (node.method === "select") {
      return { intersection: [this.tagsOf(node.receiver, at), this.tagsOf(node.args[0], at)] };
    }
    if (node.method === "classify" && node.receiver.const !== undefined) {
      return { method: "classify", receiver: this.string(node.args[0]), args: [{ classifier: classifierName(node.receiver.const) }] };
    }
    // A filtered forest is a forest too (docs/notation.md, "Conditions").
    if (node.method === "parse" || node.method === "error-free") return this.forestTags(node);
    return this.fail("read the keys of this expression", node.at ?? at);
  }

  /**
   * The recognizer's form of a message, or a fixed text where the message
   * has none. A message is late, so its lowering adds no recognition
   * obligation: no certificate, no domain, no key read.
   * @param {any} node
   */
  lateMessage(node) {
    const values = this.valueReads.length, domains = this.domainReads.length, compounds = this.compoundKeyReads.length;
    const readers = new Set(this.keyReaders);
    try {
      return this.message(node);
    } catch (error) {
      if (!(error instanceof GencmuError)) throw error;
      return { concat: [{ string: LATE_MESSAGE }] };
    } finally {
      this.valueReads.length = values;
      this.domainReads.length = domains;
      this.compoundKeyReads.length = compounds;
      this.keyReaders = readers;
    }
  }

  // A message is a concatenation for the recognizer, also of one part.
  /** @param {any} node */
  message(node) {
    const string = this.string(node);
    return string.concat ? string : { concat: [string] };
  }

  // Each template argument form, by its record kind. A form that the
  // recognizer reads as written passes as it is. An expression argument
  // becomes the recognizer's term for it. Any other form fails.
  /** @param {any} arg */
  argument(arg) {
    // The recognizer's argument records carry no position. The format 50
    // records keep it for the stage checks.
    const { at, ...rest } = arg;
    const kind = recordKind50(arg, "argument");
    switch (kind) {
      case "expressionArgument": {
        if (arg.expression.const !== undefined) this.noteConstantRead(arg.expression.const, arg.expression.at ?? at);
        const term = argumentTerm(arg.expression) ?? foldedArgument(arg.expression);
        if (term === null) this.fail("pass this expression to a template", at);
        return term;
      }
      case "literalArgument": return this.stringOperand(rest.literal);
      case "rangeArgument": return { range: rest.range.map((/** @type {any} */ item) => this.stringOperand(item)) };
      case "bodyArgument": return { body: this.body(rest.body, { name: null }) };
      // A call keeps its own position, which the recognizer needs where the
      // call stands in a body after substitution.
      case "call":
        this.noteCall(rest);
        return { ...rest, args: rest.args.map((/** @type {any} */ item) => this.argument(item)), ...(at ? { at } : {}) };
      case "targetsArgument": return { targets: rest.targets.map((/** @type {any} */ target) => this.target(target)) };
      case "requirementsArgument": return { requirements: rest.requirements.map((/** @type {any} */ item) => this.requirementItem(item)) };
      case "bodyTags": case "bodyTest": case "spliceArgument": return this.body(rest, { name: null });
      // A rule, a tag, a wildcard and a parameter hold only names.
      case "ruleArgument": case "tagArgument": case "wildcardArgument": case "parameter": return rest;
      default: return this.fail(`pass ${kind === undefined ? "this argument" : `the argument form ${kind}`} to a template`, at);
    }
  }

  // A target of a neighbor test: a rule, a terminal, a parameter or a call.
  /** @param {any} target */
  target(target) {
    const kind = recordKind50(target, "target");
    switch (kind) {
      case "ruleTarget": case "terminalTarget": case "parameter": return { ...target };
      case "call": return { ...target, args: target.args.map((/** @type {any} */ item) => this.argument(item)) };
      default: return this.fail(`read ${kind === undefined ? "this target" : `the target form ${kind}`}`, target.at);
    }
  }

  // A requirement of a filter. A test of _Elided on a terminal is a test of
  // the hidden key that every written token carries, with the opposite
  // sign. A template instance then passes the same check as a written test.
  /** @param {any} item */
  requirementItem(item) {
    return item.value.tag === "_Elided"
      ? { negated: !item.negated, value: { tag: WRITTEN } }
      : { negated: item.negated, value: this.requirement(item.value) };
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
    const kind = recordKind50(node, "body");
    switch (kind) {
      case "primary": {
        const inner = node.primary;
        primary.found = true;
        if (inner.capture !== undefined) {
          primary.name = inner.capture;
          return this.body(inner, primary);
        }
        primary.name = primary.synthetic ?? PRIMARY_CAPTURE;
        return { capture: primary.name, expr: this.body(inner, primary) };
      }
      case "bodyTags": case "bodyTest": {
        if (node.test === "tags") {
          let base = node.expr;
          while (base.capture !== undefined || base.test !== undefined) base = base.expr;
          for (const name of symbolNames(base)) this.readKeysOf(name);
        } else {
          // A value test on a rule compares the join of the input values.
          let base = node.expr;
          while (base.capture !== undefined && !isCompoundCapture50(base) || base.test !== undefined || base.primary) base = base.expr ?? base.primary;
          const target = valueTarget(base, this.currentRule);
          if (target) this.valueReads.push({ targets: [target], shown: `the value test on ${shownTarget(target)}`, at: node.at, term: null, template: this.currentTemplate });
        }
        /** @type {any} */
        const copy = { test: node.test };
        if (node.requirements) copy.requirements = node.requirements.map((/** @type {any} */ item) => this.requirementItem(item));
        if (node.value) copy.value = this.stringOperand(node.value);
        copy.expr = this.body(node.expr, primary);
        return copy;
      }
      case "literal": return { literal: this.stringOperand(node.literal) };
      case "range": return { range: node.range.map((/** @type {any} */ item) => this.stringOperand(item)) };
      case "elidable": {
        // The recognizer spells the omitted-only head [+T<_Elided>] as a test
        // that the head lacks the hidden key of written tokens.
        const rewritten = omittedOnlyHead(node.optional);
        /** @type {any} */
        const copy = { ...node, optional: this.body(rewritten, primary) };
        if (node.default) copy.default = this.stringOperand(node.default);
        return copy;
      }
      case "call":
        this.registerCall(node);
        return { ...node, args: node.args.map((/** @type {any} */ arg) => this.argument(arg)) };
      // A compound label (engine §3.5) lowers to the internal form of the
      // recognizer: its operand, then a capture of the empty expression,
      // which binds the name on each visit. Its tags are those of its
      // primary, or of the selected symbol of an unranked choice of plain
      // symbols, as for a termless rule.
      case "captureSymbol":
        if (isCompoundCapture50(node)) return this.compoundCapture(node, primary);
      // falls through
      // The composite forms hold only bodies, and the other leaves hold
      // only names, so each keeps its form.
      case "sequence": case "choice": case "ranked": case "subset": case "optional": case "chain": case "repeat":
      case "reference": case "wildcard": case "empty": case "remainder": case "splice": case "parameter": {
        /** @type {Record<string, any>} */
        const copy = {};
        for (const [key, value] of Object.entries(node)) copy[key] = this.body(value, primary);
        return copy;
      }
      default: return this.fail(`read ${kind === undefined ? "this body" : `the body form ${kind}`}`, node.at);
    }
  }

  /**
   * The internal form of a compound capture.
   * @param {any} node
   * @param {{name: any, synthetic: string, found?: boolean, used?: Set<string>}} primary
   * @returns {any}
   */
  compoundCapture(node, primary) {
    const outer = primary.found;
    primary.found = false;
    const choice = node.expr.choice;
    /** @type {string | undefined} */
    let sole;
    if (Array.isArray(choice) && choice.every((/** @type {any} */ route) => isSingleSymbol(route))) {
      sole = `${node.capture}_sole_`;
      while (primary.used?.has(sole)) sole += "_";
      primary.used?.add(sole);
    }
    const operand = sole === undefined ? this.body(node.expr, primary) :
      { choice: choice.map((/** @type {any} */ route) => {
        const lowered = this.body(route, primary);
        return lowered.capture !== undefined ? lowered : { capture: sole, expr: lowered };
      }) };
    const inside = !!primary.found;
    primary.found = outer || inside;
    /** @type {any} */
    let tags;
    if (inside && primary.name !== null) tags = this.observe("tag-term", "rule", { method: "tags", receiver: { capture: primary.name }, args: [] });
    else if (sole !== undefined) {
      const names = [...new Set(operand.choice.map((/** @type {any} */ route) => route.capture))];
      const parts = names.map(name => ({ if: this.observe("presence", "rule", { captured: name }), then: this.observe("tag-term", "rule", { method: "tags", receiver: { capture: name }, args: [] }) }));
      tags = parts.length === 1 ? parts[0] : { union: parts };
    }
    return { seq: [operand, { capture: node.capture, expr: { empty: true } }],
      compound50: { name: node.capture, ...(tags ? { tags } : {}), ...(this.structural?.has(node.capture) ? { structural: true } : {}) } };
  }

  /** @param {any} value */
  requirement(value) {
    if (value.tag !== undefined || value.param !== undefined) return { ...value };
    if (value.const !== undefined) return this.constantRead(value);
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
    // of the recognizer do not admit on a test (docs/output.md, "Source positions and nesting").
    return this.patternCalls(withoutTestPositions(node));
  }

  /**
   * A pattern with the arguments of each call atom in the recognizer's
   * form, as a call in a body has them.
   * @param {any} node
   * @returns {any}
   */
  patternCalls(node) {
    if (Array.isArray(node)) return node.map(item => this.patternCalls(item));
    if (!node || typeof node !== "object") return node;
    const copy = Object.fromEntries(Object.entries(node).map(([key, value]) => [key, key === "args" ? value : this.patternCalls(value)]));
    if (typeof node.call === "string" && Array.isArray(node.args)) {
      this.noteCall(node);
      copy.args = node.args.map((/** @type {any} */ arg) => this.argument(arg));
    }
    return copy;
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
        if (typeof base?.name === "string") this.readKeysOf(base.name);
        else if (typeof base?.call === "string") this.readKeysOf(base.call);
        else if (typeof base?.param === "string") this.readKeysOf("@" + base.param);
      } else if (node.test === "=" || node.test === "≠") {
        // A value test of a rule atom compares the join of the input values.
        let base = node.expr;
        while (base && (base.test !== undefined || base.capture !== undefined)) base = base.expr;
        const target = typeof base?.name === "string" ? { ref: base.name } : valueTarget(base, this.currentRule);
        if (target) this.valueReads.push({ targets: [target], shown: `the value test of the pattern atom ${shownTarget(target)}`, at: node.at, term: null, template: this.currentTemplate });
      }
      if (typeof node.call === "string" && Array.isArray(node.args)) this.noteCall(node);
      if (typeof node.constant === "string") this.noteConstantRead(node.constant, node.at);
      for (const [key, value] of Object.entries(node)) if (key !== "at" && value && typeof value === "object") stack.push(value);
    }
  }

  /**
   * The recognizer clauses of one written clause. A conjunction stays one
   * clause. A universal predicate on a capture inside
   * a repetition becomes the predicate on the capture: the recognizer
   * checks a clause that names such a capture on each of its items, and an
   * empty list has none, as `.all` requires (docs/notation.md, "Conditions").
   * @param {any} node
   * @returns {any[]}
   */
  clauses(node) {
    // A conjunction stays one condition. A shared condition applies where
    // the alternative declares every capture of the whole condition, and a
    // ranked check reads the whole condition (engine §3.6).
    if (Array.isArray(node.all)) {
      const parts = node.all.flatMap((/** @type {any} */ item) => this.clauses(item));
      // A constant part folds into the conjunction.
      if (parts.includes(DOM_FALSE)) return [DOM_FALSE];
      const kept = parts.filter((/** @type {any} */ part) => part !== DOM_TRUE);
      return kept.length === 0 ? [DOM_TRUE] : kept.length === 1 ? kept : [{ all: kept }];
    }
    if (isItemPredicate(node, this)) return [this.truth(itemAsCapture(node.args[0], node.receiver.capture))];
    // A guard outside the braces holds for each item: G ⟹ ∀x P(x) is
    // ∀x (G ⟹ P(x)), which an item condition of the braces tests.
    if (node.if !== undefined && node.else === undefined && isItemPredicate(node.then, this) && !capturesOfNode(node.if).has(node.then.receiver.capture)) {
      const test = this.truth(node.if);
      if (test === DOM_FALSE) return [DOM_TRUE];
      const item = this.truth(itemAsCapture(node.then.args[0], node.then.receiver.capture));
      return [test === DOM_TRUE ? item : { if: test, then: item }];
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
      let base = node;
      while (base.receiver) base = base.receiver;
      return this.observe("span", this.receiverKind(base), { method: "parse", receiver: this.expression(node), args: [{ body: { seq: [{ wildcard: true }, { remainder: true }] } }] }, node.at);
    }
    // A compound binding that each alternative binds once is present on
    // each visit, also around a ranked choice (docs/notation.md, "Ranked choices").
    if (node.capture !== undefined && this.compounds.has(node.capture) &&
        this.bindings?.every((/** @type {any} */ counts) => counts.min.get(node.capture) >= 1)) return DOM_TRUE;
    // The occurrence itself is present wherever a condition reads it.
    if (node.capture !== undefined) return node.capture === "" ? DOM_TRUE : this.observe("presence", this.receiverKind(node), { captured: node.capture }, node.at);
    // .present says what the bare name says, on a node and on a list
    // (docs/notation.md, "Captures"). The item of a predicate is bound.
    if (isPresence(node)) return node.receiver.item ? DOM_TRUE : this.truth(node.receiver);
    // A predicate of presence holds of each item of a list.
    if ((node.method === "all" || node.method === "any") && node.receiver?.capture && node.args[0]?.lambda !== undefined &&
        isPresence(node.args[0].body, node.args[0].lambda)) {
      return node.method === "all" ? DOM_TRUE : this.observe("presence", "list", { captured: node.receiver.capture }, node.at);
    }
    // A constant part folds into its connective, since the recognizer reads
    // a constant only as a whole condition.
    if (node.not) {
      const inner = this.truth(node.not);
      return inner === DOM_TRUE ? DOM_FALSE : inner === DOM_FALSE ? DOM_TRUE : { not: inner };
    }
    if (node.all || node.any) {
      const [unit, zero] = node.all ? [DOM_TRUE, DOM_FALSE] : [DOM_FALSE, DOM_TRUE];
      const parts = (node.all ?? node.any).map((/** @type {any} */ item) => this.truth(item));
      if (parts.includes(zero)) return zero;
      const kept = parts.filter((/** @type {any} */ part) => part !== unit);
      return kept.length === 0 ? unit : kept.length === 1 ? kept[0] : { [node.all ? "all" : "any"]: kept };
    }
    if (node.if !== undefined && node.else === undefined) {
      const test = this.truth(node.if);
      if (test === DOM_FALSE) return DOM_TRUE;
      const then = this.truth(node.then);
      return test === DOM_TRUE ? then : then === DOM_TRUE ? DOM_TRUE : { if: test, then };
    }
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
      const bound = this.observe("presence", this.receiverKind(node.receiver), { captured: node.receiver.capture }, node.at);
      return node.method === "all" ? { if: bound, then: test } : { all: [bound, test] };
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
        const set = test.op === "∈" ? this.strings(test.right) : setOf([this.string(test.right)]);
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
      return { op: "⊆", left: { tag: node.args[0].body.property }, right: this.forestTags(node.receiver) };
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
      if (symbol === flag) return this.observe("presence", this.receiverKind(node.receiver), { captured: node.receiver.capture }, node.at);
      return { op: "⊆", left: { tag: flag }, right: this.capturedTags(node.receiver.capture) };
    }
    // A list of strings is true where it is not empty, as in ¬(A ∖ B) or
    // ¬$s.ngrams(1).
    if (isStringList(node)) {
      return { op: "≠", left: this.strings(node), right: { emptySet: true } };
    }
    // A key set is true where it is not empty (engine §10).
    if (isKeySetRecord(node) && node.method !== "classify") {
      return { op: "≠", left: this.tagsOf(node, node.at), right: { emptySet: true } };
    }
    // A key read on a key set, as in $x.flags'K, tests that set.
    if (flag !== undefined && isVisibleKey(flag) && flag !== "_Elided" && node.receiver && isKeySetRecord(node.receiver)) {
      return { op: "⊆", left: { tag: flag }, right: this.tagsOf(node.receiver, node.at) };
    }
    return this.fail("test this expression", node.at);
  }

  /**
   * The key set of a captured node by .classes, as a tag term.
   * @param {string} method
   * @param {string} capture
   */
  nodeKeys(method, capture) {
    return this.observe("key-set", this.receiverKind({ capture }), { method, receiver: { capture }, args: [] });
  }

  /**
   * Notes a recognition read of the value of a node, with the symbols that
   * its receiver can bind.
   * @param {any} receiver
   * @param {any} at
   */
  noteValueRead(receiver, at) {
    const kind = this.receiverKind(receiver);
    if (kind === "token" || kind === "span") return;
    if (kind === "omitted") return this.fail(`read the value of ${this.shownReceiver(receiver)}, which can be an omitted leaf with a default`, at);
    const targets = receiver.capture === "" ? [{ ref: this.currentRule }] : this.captureTargets.get(receiver.capture) ?? [];
    if (!targets.length) return this.fail(`read the value of ${this.shownReceiver(receiver)}`, at);
    this.valueReads.push({ targets, shown: `the read of the value of ${this.shownReceiver(receiver)} in recognition`, at, term: this.inTagTerm, template: this.currentTemplate });
  }

  /**
   * The kind of a receiver of a read (observations.js).
   * @param {any} receiver
   * @returns {string}
   */
  receiverKind(receiver) {
    if (receiver?.capture === undefined) return receiver?.item ? "item" : "span";
    if (receiver.capture === "") return "self";
    if (this.forestRoot !== undefined && this.forestRoot !== null && receiver.capture === this.forestRoot) return "root";
    if (this.compounds.has(receiver.capture)) return "compound";
    const targets = this.captureTargets.get(receiver.capture) ?? [];
    if (targets.length && targets.every(target => target.leaf || target.ref !== undefined && /^[A-Z_]/.test(target.ref))) {
      return targets.some(target => target.omittedDefault) ? "omitted" : "token";
    }
    return "rule";
  }

  /** @param {any} receiver */
  shownReceiver(receiver) {
    if (receiver?.capture === "") return `$, the node of ${this.currentRule}`;
    if (receiver?.capture !== undefined) return `${this.compounds.has(receiver.capture) ? "the compound binding " : ""}$${receiver.capture}`;
    return "this receiver";
  }

  // The tags of the receiver of a key read: a capture, the rule, or the
  // root of a forest predicate.
  /** @param {any} receiver */
  receiverTags(receiver) {
    if (receiver?.capture !== undefined && this.forestRoot && receiver.capture === this.forestRoot) return { forestRoot: true };
    if (receiver?.item && this.forestRoot) return { forestRoot: true };
    if (receiver?.capture !== undefined) return this.capturedTags(receiver.capture);
    return this.fail("read the keys of this receiver", receiver?.at);
  }

  // The keys of the roots of a forest, as a tag term. The rules at the root
  // of its query become key readers.
  /** @param {any} forest @param {string} [method] */
  forestTags(forest, method = "tags") {
    let query = forest;
    while (query && query.method !== "parse" && query.receiver) query = query.receiver;
    if (method === "tags" && query?.method === "parse") {
      const body = query.args[0]?.body;
      const parts = (body?.seq ?? [body]).filter((/** @type {any} */ part) => part && !part.remainder);
      if (parts.length === 1) for (const name of symbolNames(parts[0])) this.readKeysOf(name);
    }
    return this.observe("root-key", "root", { method, receiver: this.expression(forest), args: [] });
  }

  // A recognizer test reads the keys of the rule that a name gives. A
  // parameter of the template being lowered stands for the actuals of its
  // calls, which the loader reads through the marker @template:param.
  /** @param {string} name */
  readKeysOf(name) {
    if (!isRuleName(name)) return;
    this.keyReaders.add(this.qualified(name));
  }

  /** @param {string} name */
  qualified(name) {
    return name.startsWith("@") && !name.includes(":") ? `@${this.currentRule}:${name.slice(1)}` : name;
  }

  // The keys of a rule flow into the keys of another, through its primary,
  // its sole symbol or its template.
  /** @param {string} rule @param {string} source */
  addTagSource(rule, source) {
    if (!isRuleName(source)) return;
    if (!this.tagSources.has(rule)) this.tagSources.set(rule, new Set());
    this.tagSources.get(rule)?.add(this.qualified(source));
  }

  // A call of a template, with the names that each of its actuals binds.
  /** @param {any} call */
  noteCall(call) {
    if (!Array.isArray(call.args)) return;
    const actuals = call.args.map((/** @type {any} */ arg) => {
      const kind = recordKind50(arg, "argument");
      /** @type {Set<string>} */
      let names = new Set();
      if (kind === "ruleArgument") names.add(arg.rule);
      else if (kind === "call") names.add(arg.call);
      else if (kind === "parameter") names.add("@" + arg.param);
      else if (kind === "bodyArgument") names = symbolNames(arg.body);
      else if (kind === "bodyTags" || kind === "bodyTest" || kind === "spliceArgument") names = symbolNames(arg);
      return [...names].filter(isRuleName).map(name => this.qualified(name));
    });
    this.templateCalls.push({ template: call.call, actuals });
  }

  // The binder of a forest predicate names a root of the forest, which the
  // recognizer reads only through its keys. Any other read of it fails.
  /** @param {string} capture */
  notForestRoot(capture) {
    if (this.forestRoot !== undefined && this.forestRoot !== null && capture === this.forestRoot) {
      this.fail(`read a root of a forest through $${capture} here`, undefined);
    }
  }

  // The keys of a captured node, as a tag term. The rules that the capture
  // can bind become key readers, so a rule whose keys the bridge cannot
  // translate fails at load, and is not read as empty.
  /** @param {string} capture */
  capturedTags(capture) {
    this.notForestRoot(capture);
    // The bag of a compound binding starts with the stage defaults.
    if (this.compounds.has(capture)) this.compoundKeyReads.push({ capture, rule: this.currentRule });
    const names = capture === "" ? [this.currentRule] : [...(this.captureRules.get(capture) ?? [])];
    for (const name of names) this.readKeysOf(name);
    const kind = this.receiverKind({ capture });
    // The tags of a node feed a key read or a tag term, by the rows of keys.
    return this.observe(kind === "token" || kind === "omitted" ? "token-key" : kind === "root" ? "root-key" : "rule-key", kind, { method: "tags", receiver: { capture }, args: [] });
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
    // The value or image of a root of a forest, where its rule writes the
    // hidden tag of that key.
    /** @param {any} side */
    const rootRead = side => (side?.property === "value" || side?.property === "image") && this.forestRoot !== undefined &&
      this.forestRoot !== null && (side.receiver?.capture === this.forestRoot || side.receiver?.item) &&
      this.forestRootRule !== undefined && !!this.hidden.roots.get(side.property)?.has(this.forestRootRule);
    /** @param {any} side */
    const read = side => rootRead(side) || side?.property !== undefined && side.property !== "value" && side.property !== "image" &&
      (!isVisibleKey(side.property) && (side.receiver?.capture !== undefined || side.receiver?.item) || tokenCapture(side.receiver)) ? side : null;
    const [left, right] = [read(node.left), read(node.right)];
    if (!left && !right) return null;
    // A read of the value of a root in recognition needs the certificate of
    // its rule, as any recognition read of a rule value does (docs/engine.md,
    // "Proof for a rule value").
    for (const side of [left, right]) {
      if (side && side.property === "value" && rootRead(side)) {
        this.valueReads.push({ targets: [{ ref: this.forestRootRule }], shown: `the read of the value of a root of a forest of ${this.forestRootRule}`,
          at: node.at, term: this.inTagTerm, template: this.currentTemplate });
      }
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
    // A payload and a string: every writer of a string or number payload
    // gives the tag of its value, so equality is one tag, and inequality a
    // payload without that tag (observations.js, "payload-string").
    if ((node.op === "=" || node.op === "≠") && !left !== !right) {
      const side = left ?? right;
      const other = literalPayload(left ? node.right : node.left);
      const tags = this.receiverTags(side.receiver);
      const valued = { op: "⊆", left: { tag: payloadTag(side.property) }, right: tags };
      let test;
      // A write of the stage that cannot tag its value makes the read fail.
      this.noteNativeRead(side.property, side.at ?? node.at);
      if (other !== undefined) test = tagTest(side, other);
      else test = { op: "⊆", left: nativePayload(side.property, this.string(left ? node.right : node.left)), right: tags };
      return node.op === "=" ? test : { all: [valued, { not: test }] };
    }
    // An order or a comparison of two payloads enumerates the values of the
    // keys, which the writes of the stage give. The loader refuses the read
    // where the stage input can carry the key (observations.js,
    // "payload-domain").
    /**
     * @param {any} side
     * @returns {any[]}
     */
    const domain = side => {
      const values = this.hidden.domains.get(side.property);
      if (!values) this.fail(`compare the payload ${side.property}, whose values are not known`, side.at);
      this.domainReads.push({ key: side.property, at: side.at ?? node.at });
      return values;
    };
    let tests;
    if (left && right) {
      tests = domain(left).flatMap(a => domain(right).filter(b => holds(a, b)).map(b => ({ all: [tagTest(left, a), tagTest(right, b)] })));
    } else {
      const side = left ?? right;
      const other = literalPayload(left ? node.right : node.left);
      if (other === undefined) return this.fail("compare a payload with this expression", node.at);
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
    const forest = this.forestTags(node.receiver);
    /** @type {any} */
    const saved = this.forestRoot;
    const savedRule = this.forestRootRule;
    this.forestRoot = predicate.lambda || " item";
    this.forestRootRule = forestRootRule(node.receiver);
    let body;
    try {
      body = this.truth(predicate.body);
    } finally {
      this.forestRoot = saved;
      this.forestRootRule = savedRule;
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
      // A root atom reads the union of the tags of the roots. That is
      // exact only for a test that one tag is among them: some root holds
      // the tag where the union holds it. Any other test of a root is not.
      if (kept.length > 1 || kept.some((/** @type {any} */ atom) => !isRootMembership(atom))) return null;
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
      const copy = Object.fromEntries(Object.entries(value).map(/** @returns {any} */ ([key, item]) => [key, replace(item)]));
      // A copy keeps the row of the read that it copies.
      if (this.observed.has(value)) this.observed.add(copy);
      return copy;
    };
    // .any is false on an empty forest, so each disjunct needs a root.
    const nonempty = this.truth(node.receiver);
    const any = replace({ any: disjuncts.map((/** @type {any} */ conjuncts) => ({ all: [nonempty, ...conjuncts] })) });
    if (node.method === "any") return any.any.length === 1 ? any.any[0] : any;
    return null;
  }

  /** @param {any} node */
  comparison(node) {
    const op = node.op;
    // The recognizer reads a compound binding as an anonymous node, and it
    // cannot yet match a list of its children.
    if ((op === "≅" || op === "≇") && node.left.capture !== undefined && this.compounds.has(node.left.capture) &&
        JSON.stringify(node.right).includes('"children":')) {
      return this.fail("compare the compound binding $" + node.left.capture + " with a pattern that lists children", node.at);
    }
    // Structural comparisons keep the pattern records of the recognizer.
    if ((op === "≅" || op === "≇") && node.left.capture !== undefined && (isPatternSet(node.right) || node.right.emptySet)) {
      // A set of patterns becomes one pattern of the recognizer. A set
      // that can match nothing makes the comparison a constant.
      const set = patternSet(node.right);
      if (set === EMPTY_PATTERN) return op === "≅" ? DOM_FALSE : DOM_TRUE;
      const pattern = this.patternCalls(set);
      this.notePatternReaders(pattern);
      return this.observe("pattern", this.receiverKind(node.left), { op, left: { capture: node.left.capture }, right: { pattern } }, node.at);
    }
    if ((op === "≅" || op === "≇") && (node.left.capture !== undefined || node.left.item)) {
      const right = node.right.pattern !== undefined ? { pattern: this.pattern(node.right.pattern) } :
        node.right.capture !== undefined ? { capture: node.right.capture } :
        node.right.const !== undefined ? this.constantRead(node.right) : null;
      if (right && node.left.capture !== undefined) return this.observe("pattern", this.receiverKind(node.left), { op, left: { capture: node.left.capture }, right }, node.at);
    }
    if (op === "∈" || op === "∉") {
      return { op, left: this.string(node.left), right: this.strings(node.right) };
    }
    // A key set of a node reads its visible keys (tagsOf), so a test that
    // needs the absence of other keys compares visible keys only.
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
      // A list that names constants keeps their references, so that it reads
      // their final versions.
      const referenced = mentionsConstant(node) ? this.setTerm(node, "strings") : null;
      if (referenced) return referenced;
      const closed = closedStringList(node, this.dom.constants);
      if (closed?.length) return setOf(closed.map(text => ({ string: text })));
      // A gate decides which items the list holds, after the choice of
      // the features.
      if (node.list.some((/** @type {any} */ item) => item.gates?.length)) return this.fail("read this list", node.at);
      if (!node.list.some((/** @type {any} */ item) => item.kind === "splat" || item.guard)) return setOf(node.list.map((/** @type {any} */ item) => this.string(item.value)));
      // A splat adds the strings of its list, and a guard keeps its item
      // only where it holds.
      const parts = node.list.map((/** @type {any} */ item) => {
        const part = item.kind === "splat" ? this.strings(item.value) : setOf([this.string(item.value)]);
        return item.guard ? { if: this.truth(item.guard), then: part } : part;
      });
      return parts.length === 1 ? parts[0] : { union: parts };
    }
    if (node.method === "split") return { method: "split", receiver: this.string(node.receiver), args: [this.string(node.args[0])] };
    if (node.method === "ngrams") return { method: "ngrams", receiver: this.string(node.receiver), args: [{ integer: node.args[0].integer }] };
    // A difference of two lists keeps the strings of the first that the
    // second lacks, and a set of strings needs only that.
    if (node.difference && node.difference.length === 2) return { difference: node.difference.map((/** @type {any} */ part) => this.strings(part)) };
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
    // substitutes in each instance (engine §2.3).
    if (node.param !== undefined) return { ...node };
    if (node.concat) return { concat: node.concat.map((/** @type {any} */ item) => this.string(item)) };
    // A leaf bound under T="s" has the value s, written or omitted.
    if (node.property === "value" && node.receiver?.capture !== undefined && typeof this.captureSymbols.get(`${node.receiver.capture}=`) === "string") {
      return this.observe("token-value", "token", { string: this.captureSymbols.get(`${node.receiver.capture}=`) }, node.at);
    }
    if (node.property === "value" && node.receiver) {
      if (node.receiver.capture !== undefined) this.notForestRoot(node.receiver.capture);
      this.noteValueRead(node.receiver, node.at);
      const kind = this.receiverKind(node.receiver);
      return this.observe(kind === "token" ? "token-value" : kind === "span" ? "input-join" : "certified-value", kind, { method: "value", receiver: this.expression(node.receiver), args: [] }, node.at);
    }
    if (node.property === "image" && node.receiver) {
      // Only a leaf has the image of its window in recognition
      // (observations.js, "token-image"). No certificate covers an image.
      const kind = this.receiverKind(node.receiver);
      if (kind !== "token" && kind !== "omitted") return this.fail(`read the image of ${this.shownReceiver(node.receiver)}, which no certificate covers`, node.at);
      return this.observe("token-image", kind, { method: "image", receiver: this.expression(node.receiver), args: [] }, node.at);
    }
    // The join of the input values or images of a span joins its original
    // tokens. A synthetic token of a reconstruction adds nothing to it
    // (engine §1).
    if (node.method === "join" && !node.args.length && node.receiver.map &&
        ["value", "image"].includes(node.receiver.by.property) && node.receiver.map.method === "tokens") {
      return this.observe("input-join", this.receiverKind(node.receiver.map.receiver.receiver ?? node.receiver.map.receiver),
        { method: NATIVE_JOIN, receiver: this.expression(node.receiver.map.receiver), args: [{ string: node.receiver.by.property }] }, node.at);
    }
    // .verbatim-text is late (notation, "Text of a span"), so recognition
    // cannot compute it.
    if (node.method === "source-text" || node.method === "decomposed-source-text") {
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
    if (node.capture !== undefined) {
      this.notForestRoot(node.capture);
      return { capture: node.capture };
    }
    if (node.method === "span") return this.expression(node.receiver);
    if (node.method !== undefined && SPAN_READS.has(node.method)) {
      const args = node.args.map((/** @type {any} */ arg) => {
        if (arg.body) return { body: this.body(arg.body, { name: null }) };
        if (arg.rule !== undefined || arg.terminal !== undefined || arg.call !== undefined || arg.param !== undefined) return this.target(arg);
        return this.fail(`pass this argument to .${node.method}`, node.at);
      });
      return this.observe("span", this.receiverKind(node.receiver), { method: node.method, receiver: this.expression(node.receiver), args }, node.at);
    }
    return this.fail("read this expression", node.at);
  }
}

// The head of an elidable optional with its positive _Elided requirement
// replaced by the negated requirement of the hidden key that every written
// token carries.
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
  return HIDDEN_PREFIXES.some(prefix => key.startsWith(prefix));
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
 * can stand in each place of the parameter (docs/notation.md, "Lists, functions and numbers"). Where bagsOnly
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
  noteFold(constants, node.apply, node.at);
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
 * @internal The keys that are not visible and that a recognizer test of the
 * documents reads, with the finite set of values that the documents can give
 * each one. A key whose values are not known has no domain. A test reads the
 * keys of a node that any document of its stage writes, so the loader passes
 * the documents of the stage.
 * @param {any[]} doms
 * @returns {HiddenKeys}
 */
export function hiddenKeys(doms) {
  const demanded = new Set();
  // The keys whose values recognition reads. A key that only .has(k) and
  // .has-value(k) read needs its presence and payload tags alone.
  const valued = new Set();
  /** @param {any} node */
  const reads = node => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(reads);
    if (node.property !== undefined && !isVisibleKey(node.property) && node.property !== "value" && node.property !== "image") {
      demanded.add(node.property);
      valued.add(node.property);
    }
    if ((node.method === "has" || node.method === "has-value") && node.args?.[0]?.key !== undefined && !isVisibleKey(node.args[0].key)) demanded.add(node.args[0].key);
    for (const value of Object.values(node)) if (value && typeof value === "object") reads(value);
  };
  // Each entry with the constants of its document, which its guard reads.
  /** @type {{entry: any, constants: any[]}[]} */
  const writes = [];
  for (const dom of doms) {
    // A guard reads the constants of its document. A fold that another
    // document can change is refused where the bridge folds it.
    const constants = dom.constants;
    for (const constant of dom.constants) {
      // A function is inlined where a condition calls it, so a key that its
      // body reads is read there.
      reads(constant.value.lambda !== undefined ? constant.value.body : constant.value);
      if (constant.value.lambda !== undefined && constant.value.body?.bag) {
        for (const entry of constant.value.body.bag) {
          reads(entry.guard);
          writes.push({ entry, constants });
        }
      }
    }
    for (const rule of dom.rules) {
      reads(rule.conditions);
      for (const term of [rule.term, ...(rule.alternatives ?? []).map((/** @type {any} */ alternative) => alternative.term)].filter(Boolean)) {
        for (const entry of term.bag) {
          reads(entry.guard);
          writes.push({ entry, constants });
        }
      }
    }
  }
  const entries = writes.map(write => write.entry);
  // The rules whose roots a forest predicate reads the value or image of.
  /** @type {Map<string, Set<string>>} */
  const roots = new Map();
  /** @param {any} node */
  const forests = node => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) forests(item);
      return;
    }
    if ((node.method === "any" || node.method === "all") && node.args?.[0]?.lambda !== undefined) {
      const rule = forestRootRule(node.receiver);
      if (rule !== undefined) {
        for (const key of rootKeysRead(node.args[0])) {
          if (!roots.has(key)) roots.set(key, new Set());
          roots.get(key)?.add(rule);
        }
      }
    }
    for (const value of Object.values(node)) if (value && typeof value === "object") forests(value);
  };
  for (const dom of doms) forests([dom.rules, dom.constants]);
  // The keys that the writer of a key whose value recognition reads reads
  // are read too.
  for (let size = -1; size !== demanded.size + valued.size;) {
    size = demanded.size + valued.size;
    for (const entry of entries) if (entry.kind === "write" && entry.keys.some((/** @type {any} */ key) => valued.has(key))) reads(entry.value);
  }
  /** @type {Map<string, any[]>} */
  const domains = new Map([...demanded].map(key => [key, []]));
  const unknown = new Set();
  for (let changed = true; changed;) {
    changed = false;
    for (const { entry, constants } of writes) {
      if (entry.kind !== "write") continue;
      for (const key of entry.keys.filter((/** @type {any} */ item) => demanded.has(item) && !unknown.has(item))) {
        let values = valuesOf(entry.value, domains, unknown);
        const allowed = guardValues(entry.guard, entry.value, constants);
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
  return { demanded, valued, domains, roots };
}

/**
 * Whether a node is `.present` of a capture or of the item of a predicate
 * with the binder.
 * @param {any} node
 * @param {string} [binder]
 */
function isPresence(node, binder) {
  if (node?.method !== "present" || node.args?.length !== 0) return false;
  const receiver = node.receiver;
  return receiver?.item === true || typeof receiver?.capture === "string" &&
    (binder === undefined || receiver.capture === binder);
}

/**
 * The names of the compound labels of bodies.
 * @param {any} node
 * @param {Set<string>} [into]
 */
function compoundLabels(node, into = new Set()) {
  if (!node || typeof node !== "object") return into;
  if (Array.isArray(node)) {
    for (const item of node) compoundLabels(item, into);
    return into;
  }
  if (isCompoundCapture50(node)) into.add(node.capture);
  for (const value of Object.values(node)) if (value && typeof value === "object") compoundLabels(value, into);
  return into;
}

/**
 * The rule at the root of the query of a forest, where the query has one
 * target and that target is one rule. Otherwise undefined.
 * @param {any} forest
 * @returns {string | undefined}
 */
function forestRootRule(forest) {
  let query = forest;
  while (query && query.method !== "parse" && query.receiver) query = query.receiver;
  if (query?.method !== "parse") return undefined;
  const body = query.args?.[0]?.body;
  const parts = (body?.seq ?? [body]).filter((/** @type {any} */ part) => part && !part.remainder);
  if (parts.length !== 1) return undefined;
  let base = parts[0];
  while (base?.test !== undefined) base = base.expr;
  return typeof base?.ref === "string" && isRuleName(base.ref) ? base.ref : undefined;
}

/**
 * The keys among value and image that a predicate reads of its item.
 * @param {any} predicate
 */
function rootKeysRead(predicate) {
  /** @type {Set<string>} */
  const keys = new Set();
  /** @param {any} node */
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if ((node.property === "value" || node.property === "image") &&
        (predicate.lambda ? node.receiver?.capture === predicate.lambda : node.receiver?.item)) keys.add(node.property);
    for (const value of Object.values(node)) if (value && typeof value === "object") visit(value);
  };
  visit(predicate.body);
  return keys;
}

/**
 * Whether the last entry of a bag that can change a key writes it with no
 * guard and no gate. A splat can change any key.
 * @param {any[]} entries
 * @param {string} key
 */
function writesLast(entries, key) {
  let last;
  for (const entry of entries) {
    if (entry.kind === "splat" || (entry.kind === "write" ? entry.keys.includes(key) : entry.key === key)) last = entry;
  }
  return last?.kind === "write" && !last.guard && !last.gates?.length;
}

/**
 * @internal The keys that are not visible and that a document reads or
 * writes anywhere. Only these keys change how the bridge lowers it.
 * @param {any} dom
 */
export function mentionedKeys(dom) {
  /** @type {Set<string>} */
  const keys = new Set();
  /** @param {any} node */
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node.property !== undefined && !isVisibleKey(node.property)) keys.add(node.property);
    if ((node.method === "has" || node.method === "has-value") && node.args?.[0]?.key !== undefined) keys.add(node.args[0].key);
    if (node.kind === "write") for (const key of node.keys) keys.add(key);
    if (["bare", "copy", "delete"].includes(node.kind) && typeof node.key === "string") keys.add(node.key);
    for (const value of Object.values(node)) if (value && typeof value === "object") visit(value);
  };
  visit([dom.rules, dom.constants]);
  for (const key of [...keys]) if (isVisibleKey(key)) keys.delete(key);
  return keys;
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
 * Whether a lowered atom tests that one tag is among the tags of a root.
 * @param {any} atom
 */
function isRootMembership(atom) {
  if (atom?.op !== "⊆" || atom.right?.forestRoot !== true) return false;
  const left = atom.left;
  // One tag: a written one, or the payload tag of a string, which the
  // recognizer computes.
  return typeof left?.tag === "string" && Object.keys(left).length === 1 || left?.method === NATIVE_PAYLOAD;
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
 * @returns {string[] | null}
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
    const keys = keySetKeys(versions[0].value, constants, new Set([...active, value.const]));
    if (keys !== null) noteFold(constants, value.const, value.at);
    return keys;
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
  // The recognizer's pattern check admits no position on a test or on a
  // set operation, which DOM 50 gives one.
  const isTest = node.test !== undefined && node.expr !== undefined;
  const isSet = ["union", "intersection", "difference"].some(key => Array.isArray(node[key]));
  return Object.fromEntries(Object.entries(node).filter(([key]) => !((isTest || isSet) && key === "at"))
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
    if (versions.length !== 1) return null;
    const strings = closedStringList(versions[0].value, constants, depth + 1);
    if (strings !== null) noteFold(constants, node.const, node.at);
    return strings;
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
    const first = !symbols.has(node.capture);
    if (!first && symbols.get(node.capture) !== found) symbols.set(node.capture, null);
    else symbols.set(node.capture, found);
    // A leaf bound under T="s" has the value s only where every binding of
    // the name has the same test. Any other binding leaves no fixed value.
    const fixed = equals !== undefined && found !== null && /^[A-Z]/.test(found) ? equals : null;
    const key = `${node.capture}=`;
    if (first) symbols.set(key, fixed);
    else if (symbols.get(key) !== fixed) symbols.set(key, null);
  }
  for (const value of Object.values(node)) if (value && typeof value === "object") collectCaptureSymbols(value, symbols);
}

// The run-time value tag of a payload whose values the document does not
// fix: the tag of payloadTag(key, value) for the string of the term.
/** @param {string} key @param {any} string */
function nativePayload(key, string) {
  return { method: NATIVE_PAYLOAD, receiver: string, args: [{ string: `Payload_${hex(key)}_` }] };
}

// A set of strings for the recognizer, whose unions take at least two
// operands. A set of one string repeats it, and a set of none is empty.
/** @param {any[]} items */
function setOf(items) {
  if (!items.length) return { emptySet: true };
  return { union: items.length === 1 ? [items[0], items[0]] : items };
}

// A form whose value is a list of strings: a list, a split or a list
// difference. A constant can hold a list too, and the recognizer checks its
// type.
/** @param {any} node @returns {boolean} */
function isStringList(node) {
  return Array.isArray(node?.list) || node?.method === "split" || node?.method === "ngrams" ||
    Array.isArray(node?.difference) && node.difference.every(isStringList);
}

// The capture reads of a term, each with the position of its entry.
/** @param {any} term @returns {{capture: string, at: any}[]} */
function termCaptures(term) {
  /** @type {{capture: string, at: any}[]} */
  const reads = [];
  /** @type {[any, any][]} */
  const pending = [[term, term?.at]];
  while (pending.length) {
    const [node, at] = /** @type {[any, any]} */ (pending.pop());
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const item of node) pending.push([item, at]);
      continue;
    }
    if (typeof node.capture === "string" && node.capture !== "" && !node.expr) reads.push({ capture: node.capture, at });
    const here = node.at ?? at;
    for (const [key, value] of Object.entries(node)) if (key !== "at" && value && typeof value === "object") pending.push([value, here]);
  }
  return reads;
}

// The note of each fold, by the array of constants that it reads. Only a
// document being lowered has one.
/** @type {WeakMap<any[], (name: string, at: any) => void>} */
const foldNotes = new WeakMap();

/** @param {any[]} constants @param {string} name @param {any} at */
function noteFold(constants, name, at) {
  foldNotes.get(constants)?.(name, at);
}

// Whether an expression names a constant, or the constant of that name.
/** @param {any} node @param {string} [name] @returns {boolean} */
function mentionsConstant(node, name) {
  /** @type {any[]} */
  const pending = [node];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== "object") continue;
    if (!Array.isArray(item) && typeof item.const === "string" && (name === undefined || item.const === name)) return true;
    for (const value of Object.values(item)) if (value && typeof value === "object") pending.push(value);
  }
  return false;
}

// The prefixes of the hidden recognizer keys: the written-token key, and
// the presence and value keys of each payload.
const HIDDEN_PREFIXES = [WRITTEN, "Payload_", "Present_"];

// The visible keys of a tag term of a node, a span or a forest.
/** @param {any} term */
function visibleOf(term) {
  return { method: NATIVE_VISIBLE, receiver: term, args: HIDDEN_PREFIXES.map(prefix => ({ string: prefix })) };
}

/** @param {string} name */
function isRuleName(name) {
  return !/^[A-Z_]/.test(name);
}

// The names that a single symbol, or each route of a choice of single
// symbols, reads: a rule, a template or a terminal.
/**
 * @param {any} node
 * @param {Set<string>} [into]
 * @returns {Set<string>}
 */
function symbolNames(node, into = new Set()) {
  if (!node || typeof node !== "object") return into;
  if (node.choice || node.ranked) {
    for (const route of node.choice ?? node.ranked) symbolNames(route, into);
    return into;
  }
  let base = node;
  while (base && (base.capture !== undefined && base.expr || base.test !== undefined || base.primary)) base = base.expr ?? base.primary;
  if (base?.ref !== undefined) into.add(base.ref);
  else if (base?.call !== undefined) into.add(base.call);
  else if (base?.param !== undefined) into.add("@" + base.param);
  else if (base?.splice !== undefined) symbolNames(base.splice, into);
  return into;
}

/**
 * The names that a rule compares with a pattern or another node, on the
 * left of the comparison.
 * @param {any} rule
 * @returns {Set<string>}
 */
function structurallyCompared(rule) {
  /** @type {Set<string>} */
  const names = new Set();
  // Every clause of the statement: its conditions, its messages, its
  // emission, and the terms of the statement and of each alternative.
  const stack = [rule.conditions, rule.error, rule.warning, rule.emit, rule.term,
    ...(rule.alternatives ?? []).map((/** @type {any} */ alternative) => alternative.term)];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    if ((node.op === "≅" || node.op === "≇") && typeof node.left?.capture === "string") names.add(node.left.capture);
    // A function can compare its argument, and its body can stand in
    // another document. So each capture that an argument reads counts.
    if (node.apply !== undefined) for (const name of capturesIn(node.arg ?? node.args)) names.add(name);
    for (const value of Object.values(node)) if (value && typeof value === "object") stack.push(value);
  }
  return names;
}

/**
 * The capture names that an expression reads.
 * @param {any} node
 * @returns {Set<string>}
 */
function capturesIn(node) {
  /** @type {Set<string>} */
  const names = new Set();
  const stack = [node];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    if (typeof current.capture === "string" && current.capture !== "") names.add(current.capture);
    for (const value of Object.values(current)) if (value && typeof value === "object") stack.push(value);
  }
  return names;
}

// The names that the primary symbols of a body read.
/** @param {any} node @param {Set<string>} [into] */
function primaryNames(node, into = new Set()) {
  if (!node || typeof node !== "object") return into;
  if (Array.isArray(node)) {
    for (const item of node) primaryNames(item, into);
    return into;
  }
  if (node.primary) return symbolNames(node.primary, into);
  for (const value of Object.values(node)) if (value && typeof value === "object") primaryNames(value, into);
  return into;
}

// The names that each capture of a body can bind.
/** @param {any} node @param {Map<string, Set<string>>} rules */
function collectCaptureRules(node, rules) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectCaptureRules(item, rules);
    return;
  }
  if (node.capture !== undefined && node.expr) {
    if (!rules.has(node.capture)) rules.set(node.capture, new Set());
    symbolNames(node.expr, rules.get(node.capture));
    if (isCompoundCapture50(node)) primaryNames(node.expr, rules.get(node.capture));
  }
  for (const value of Object.values(node)) if (value && typeof value === "object") collectCaptureRules(value, rules);
}

/**
 * Whether a clause is a universal predicate over a repeated capture, which an
 * item condition of its braces tests.
 * @param {any} node
 * @param {any} bridge
 */
function isItemPredicate(node, bridge) {
  return node?.method === "all" && node.receiver?.capture && !bridge.atMostOne?.has(node.receiver.capture) &&
    bridge.repeated?.has(node.receiver.capture) && node.args[0]?.lambda !== undefined;
}

/**
 * The capture names of an expression.
 * @param {any} node
 * @param {Set<string>} [into]
 * @returns {Set<string>}
 */
function capturesOfNode(node, into = new Set()) {
  if (!node || typeof node !== "object") return into;
  if (Array.isArray(node)) {
    for (const item of node) capturesOfNode(item, into);
    return into;
  }
  if (typeof node.capture === "string") into.add(node.capture);
  for (const value of Object.values(node)) if (value && typeof value === "object") capturesOfNode(value, into);
  return into;
}

// The text that the recognizer gets for a message, which the stage evaluates.
const LATE_MESSAGE = "a message that the stage evaluates";

/** @type {Record<string, string>} the receiver kinds of the table, as text */
const KIND_NAMES = {
  token: "a leaf", omitted: "a leaf that can be omitted with a default", rule: "a rule node", compound: "a compound binding",
  self: "$", list: "a list", root: "the root of a forest", span: "a span", item: "the item of a predicate",
};

/**
 * A recognizer read, as text for a message.
 * @param {any} item
 */
function describeRead(item) {
  if (typeof item.captured === "string") return `the presence of $${item.captured}`;
  if (item.method !== undefined) return `.${item.method} of $${item.receiver.capture}`;
  return `a structural comparison of $${item.left.capture}`;
}

/**
 * The name of the termless rule that a compound binding stands for in the
 * certificate of values.
 * @param {string} rule
 * @param {string} capture
 */
export function compoundRuleName(rule, capture) {
  return `\u0000compound:${rule}:${capture}`;
}

/**
 * The target of a value read on a body symbol: the symbol itself, or a
 * compound binding as its termless rule, or null for a leaf.
 * @param {any} base
 * @param {string | undefined} rule
 * @returns {any}
 */
function valueTarget(base, rule) {
  if (!base || typeof base !== "object") return null;
  if (isCompoundCapture50(base)) return { ref: compoundRuleName(rule ?? "", base.capture) };
  if (base.ref !== undefined) return /^[A-Z_]/.test(base.ref) ? null : { ref: base.ref };
  if (base.call !== undefined || base.splice !== undefined || base.param !== undefined) return base;
  return null;
}

/** @param {any} target */
function shownTarget(target) {
  if (typeof target.ref === "string") return target.ref.startsWith("\u0000compound:") ? `the compound binding $${target.ref.split(":").at(-1)}` : target.ref;
  if (target.call !== undefined) return `the call ${target.call}`;
  if (target.param !== undefined) return `@${target.param}`;
  return "the splice";
}

/**
 * The symbols that each capture of a body can bind: each written symbol,
 * and a compound binding as its termless rule. A leaf of an elidable head
 * with a default that is not empty is marked.
 * @param {any} node
 * @param {Map<string, any[]>} targets
 * @param {string} rule
 * @param {boolean} [elidable]
 */
function collectCaptureTargets(node, targets, rule, elidable = false) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectCaptureTargets(item, targets, rule, elidable);
    return;
  }
  if (node.capture !== undefined && node.expr) {
    if (!targets.has(node.capture)) targets.set(node.capture, []);
    const list = /** @type {any[]} */ (targets.get(node.capture));
    if (isCompoundCapture50(node)) list.push({ ref: compoundRuleName(rule, node.capture) });
    else {
      let base = node.expr;
      while (base && (base.test !== undefined || base.primary)) base = base.expr ?? base.primary;
      const choices = base?.choice ?? [base];
      for (const choice of choices) {
        let inner = choice;
        while (inner && (inner.test !== undefined || inner.primary || inner.capture !== undefined && inner.expr)) inner = inner.expr ?? inner.primary;
        if (inner?.ref !== undefined) list.push(elidable && /^[A-Z_]/.test(inner.ref) ? { ref: inner.ref, omittedDefault: true } : { ref: inner.ref });
        else if (inner?.call !== undefined || inner?.splice !== undefined || inner?.param !== undefined) list.push(inner);
        else if (inner?.literal !== undefined || inner?.range !== undefined || inner?.wildcard !== undefined) list.push({ leaf: true });
        else list.push({ unknown: true });
      }
    }
  }
  const nested = node.elidable && node.default && !(node.default.string === "") ? true : node.elidable ? false : elidable;
  for (const [key, value] of Object.entries(node)) if (value && typeof value === "object") collectCaptureTargets(value, targets, rule, key === "optional" ? nested : elidable);
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
    if (versions.length !== 1) return undefined;
    const text = closedConcat(versions[0].value, constants, depth + 1);
    if (text !== undefined) noteFold(constants, node.const, node.at);
    return text;
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
  // A constant inside a pattern of the recognizer is a constant atom, with
  // its place for the error of an undefined constant.
  if (node.const !== undefined) return { constant: node.const, ...(node.at ? { at: node.at } : {}) };
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
