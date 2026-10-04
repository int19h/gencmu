// A stage's grammar: its documents stitched together (engine §2) and
// lowered to productions for one set of features (engine §3).

import { GencmuError } from "./errors.js";
import { simplify, constantsIn, constantValueType, definitionProblem, expectedProblem, isSoundTest, ruleTypeFault, soundProblem, termType, testsIn, DOM_TRUE, DOM_FALSE } from "./dom.js";
import { codeOfCharacterTag, compareCodePoints, isName, propertyName, rangeName, rangeTags, splitString, tagDifference, tagIntersection, tagSet, TagUnion, writtenTest } from "./tags.js";

/**
 * @import { Condition, ConstantTerm, DomAlternative, DomClassifier, DomConstant, DomImplication, DomRule, Emission, ErrorLocation, Expr, GrammarDom, Guard, LoweredGrammar, Production, Resolution, SymbolTest, TagSet, Term, TermValue, TestOp } from "./types.js"
 * @import { TermType } from "./dom.js"
 */

/**
 * A constant of a stage (engine §2): its value and type now, and the
 * document of its last definition.
 * @typedef {object} StageConstant
 * @property {TermValue} value
 * @property {TermType} type
 * @property {string} document
 */

/**
 * An implication of a stage with its two sides' values (engine §2, §11).
 * @typedef {object} StageImplication
 * @property {TagSet} if
 * @property {TagSet} then
 */

/**
 * A rule body's alternative as stitched: its own parts, its rule's clauses,
 * and the document and position of the definition that wrote it.
 * @typedef {DomAlternative & {clauses: RuleClauses, document: string, at: ErrorLocation}} StitchedAlternative
 */

/**
 * @typedef {object} RuleClauses
 * @property {Term | undefined} tags
 * @property {Emission | undefined} emit
 * @property {Condition[]} conditions
 * @property {boolean} opaque
 */

/**
 * A rule of the stitched grammar.
 * @typedef {object} StitchedRule
 * @property {string} name
 * @property {string} document
 * @property {ErrorLocation} at
 * @property {StitchedAlternative[]} alternatives
 */

/**
 * How a later document changed a rule an earlier one defined.
 * @typedef {object} RuleChange
 * @property {"replaced" | "extended"} kind
 * @property {string} rule
 * @property {string} document
 * @property {string} previous
 */

/**
 * A symbol of an expanded sequence, and the capture that names it.
 * @typedef {{symbol: import("./types.js").GrammarSymbol, capture?: string}} SequenceItem
 */

/**
 * Where an expansion happens: the rule and the alternative, and the
 * helpers still to lower.
 * @typedef {{rule: StitchedRule, alternative: StitchedAlternative, pending: PendingHelper[]}} Where
 */

/**
 * @typedef {object} PendingHelper
 * @property {string} name
 * @property {(where: Where) => SequenceItem[][]} build
 * @property {string | null} elided
 * @property {SymbolTest | null} elidedTest
 */


// The most lowered grammars, and the most classifier tables, that a stage
// keeps. Each set of the stage's gates that is on has its own, so a stage
// with k gates can have 2^k of them. The least recently used goes first.
const MAX_LOWERED = 16;

// Stitches documents, each { path, dom }, into one grammar.
export class Grammar {
  /**
   * @param {string} stageName
   * @param {{path: string, dom: GrammarDom}[]} documents
   * @param {{isMark(code: number): boolean, lowercase(text: string): string}} unicode
   *   the loader's table, for the tags of a range in a constant's value and
   *   the canonical sound of a string constant in a test
   */
  constructor(stageName, documents, unicode) {
    this.stageName = stageName;
    this.unicode = unicode;
    /** @type {Map<string, StageConstant>} */
    this.constants = new Map();
    /**
     * The definitions of rules that use constants, which the loader checks
     * once the constants have their final values.
     * @type {{path: string, rule: DomRule}[]}
     */
    this.constantUsers = [];
    /** @type {Map<string, StitchedRule>} */
    this.rules = new Map();
    /** @type {RuleChange[]} */
    this.changes = [];
    /** @type {Resolution | null} */
    this.resolution = null;
    /**
     * The stage's `%classifier` items in stitching order, each with its
     * document (engine §2).
     * @type {{path: string, classifier: DomClassifier}[]}
     */
    this.classifierItems = [];
    /** @type {{path: string, implication: DomImplication}[]} */
    this.implicationItems = [];
    for (const { path, dom } of documents) this.addDocument(path, dom);
    this.resolveConstants();
    /** @type {StageImplication[]} */
    this.implications = this.implicationItems.map(({ path, implication }) => this.resolveImplication(path, implication));
    /**
     * The features that gate an entry of a classifier. Only these change
     * the classifiers' values.
     * @type {string[]}
     */
    this.classifierGates = gateNames(this.classifierItems.flatMap(({ classifier }) => classifier.entries.flatMap((entry) => entry.guards)));
    /**
     * The classifiers resolved for each set of the classifier gates that is
     * on (engine §2).
     * @type {Map<string, Map<string, Map<string, TagSet>>>}
     */
    this.classifierTables = new Map();
    /**
     * Each test of a body with its value, made once for every lowering.
     * @type {WeakMap<object, SymbolTest>}
     */
    this.tests = new WeakMap();
    if (!this.resolution) {
      throw new GencmuError("grammar", `stage ${stageName} has no %ambiguity-resolution`, { stage: stageName });
    }
    this.checkReferences();
    /**
     * The features that gate an alternative or an entry of a classifier.
     * Only these change a lowered grammar. A warning keeps its alternative
     * (engine §3.1), and any other name matches no guard (engine §13).
     * @type {string[]}
     */
    this.gates = gateNames([
      ...[...this.rules.values()].flatMap((rule) => rule.alternatives.flatMap((alternative) => alternative.guards)),
      ...this.classifierItems.flatMap(({ classifier }) => classifier.entries.flatMap((entry) => entry.guards)),
    ]);
    /**
     * The lowered grammars, keyed by the gates that are on.
     * @type {Map<string, LoweredGrammar>}
     */
    this.lowered = new Map();
  }

  /**
   * @param {string} path
   * @param {GrammarDom} dom
   */
  addDocument(path, dom) {
    for (const rule of dom.rules) {
      if (constantsIn(rule).length > 0) this.constantUsers.push({ path, rule });
      const at = { document: path, line: rule.at[0], column: rule.at[1] };
      const clauses = { tags: rule.tags, emit: rule.emit, conditions: rule.conditions || [], opaque: rule.opaque === true };
      const alternatives = rule.alternatives.map((alternative) => ({ ...alternative, clauses, document: path, at }));
      const previous = this.rules.get(rule.name);
      if (rule.op === "define") {
        if (previous) {
          throw new GencmuError("grammar", `${path}:${at.line}: %rule ${rule.name} is already defined, in ${previous.document}; %redefine-rule replaces a rule`, at);
        }
        this.rules.set(rule.name, { name: rule.name, document: path, at, alternatives });
      } else if (rule.op === "redefine") {
        if (!previous) {
          throw new GencmuError("grammar", `${path}:${at.line}: %redefine-rule ${rule.name} replaces no rule defined before it`, at);
        }
        this.changes.push({ kind: "replaced", rule: rule.name, document: path, previous: previous.document });
        this.rules.set(rule.name, { name: rule.name, document: path, at, alternatives });
      } else {
        const base = previous;
        if (!base) {
          throw new GencmuError("grammar", `${path}:${at.line}: %extend-rule ${rule.name} extends a rule that is not defined before it`, at);
        }
        this.changes.push({ kind: "extended", rule: rule.name, document: path, previous: base.document });
        // Added in place: a copy of the list for each %extend-rule would
        // cost the square of their number.
        for (const alternative of alternatives) base.alternatives.push(alternative);
      }
    }
    for (const directive of dom.directives) {
      const at = { document: path, line: directive.at[0], column: directive.at[1] };
      switch (directive.name) {
        case "ambiguity-resolution": {
          if (this.resolution) {
            throw new GencmuError("grammar", `${path}:${at.line}: stage ${this.stageName} has a second %ambiguity-resolution`, at);
          }
          const [lean, ...rest] = directive.args;
          const elisionOnly = rest[0] === "elision-only";
          if (elisionOnly) rest.shift();
          const maximal = rest[0] === "maximal";
          if (maximal) rest.shift();
          if ((lean !== "greedy" && lean !== "lazy" && lean !== "late-elision") || rest.length > 0) {
            throw new GencmuError("grammar", `${path}:${at.line}: %ambiguity-resolution takes greedy, lazy or late-elision, then optionally elision-only, then optionally maximal`, at);
          }
          this.resolution = { lean, elisionOnly, maximal };
          break;
        }
        default:
          throw new GencmuError("grammar", `${path}:${at.line}: unknown directive %${directive.name}`, at);
      }
    }
    for (const constant of dom.constants) this.addConstant(path, constant);
    for (const classifier of dom.classifiers) this.classifierItems.push({ path, classifier });
    for (const implication of dom.implications) this.implicationItems.push({ path, implication });
  }

  /**
   * An implication's two sides, with the constants' final values: closed
   * terms whose type is a tag set (engine §2, §9).
   * @param {string} path
   * @param {DomImplication} implication
   * @returns {StageImplication}
   */
  resolveImplication(path, implication) {
    /** @type {(name: string) => TermType} */
    const types = (name) => /** @type {StageConstant} */ (this.constants.get(name)).type;
    /** @type {TagSet[]} */
    const sides = [];
    for (const side of [implication.if, implication.then]) {
      for (const reference of constantsIn(side)) {
        if (!this.constants.has(reference.const)) {
          throw this.documentError(path, reference.at, `$${reference.const} is not defined in stage ${this.stageName}`);
        }
      }
      const found = termType(side, types);
      const problem = "problem" in found ? found.problem : expectedProblem(found.type, "tags");
      if (problem) throw this.faultError(path, "problem" in found ? found.node : side, implication.at, `a side of an implication is a tag set: ${problem}`);
      const value = this.evaluateClosed(path, side, implication.at);
      sides.push("set" in value ? value.set : tagSet());
    }
    return { if: sides[0], then: sides[1] };
  }

  /**
   * Each classifier of the stage for one set of features: each key's
   * classes after every entry whose gates hold, in stitching order (engine
   * §2). An entry that adds a membership that holds, or removes one that
   * does not, is an error of the grammar for these features.
   * @param {Set<string>} features
   * @returns {Map<string, Map<string, TagSet>>}
   */
  classifiers(features) {
    const key = JSON.stringify(this.classifierGates.filter((name) => features.has(name)));
    let tables = recall(this.classifierTables, key);
    if (tables) return tables;
    tables = new Map();
    for (const { path, classifier } of this.classifierItems) {
      let table = tables.get(classifier.name);
      if (!table) tables.set(classifier.name, (table = new Map()));
      for (const entry of classifier.entries) {
        if (!entry.guards.every((guard) => features.has(guard.feature) !== guard.negated)) continue;
        for (const word of entry.keys) {
          let classes = table.get(word);
          if (!classes) table.set(word, (classes = tagSet()));
          if ((entry.op === "∈") === classes.has(entry.class)) {
            const [line, column] = entry.at;
            const message = entry.op === "∈" ? `${JSON.stringify(word)} is already in ${entry.class}` : `${JSON.stringify(word)} is not in ${entry.class}, so ∉ has nothing to remove`;
            throw new GencmuError("grammar", `${path}:${line}:${column}: the classifier ${classifier.name}: ${message}`, { document: path, line, column });
          }
          // Each table's sets are its own, so an entry changes one in place:
          // a copy for each entry would cost the square of a key's entries.
          if (entry.op === "∈") classes.add(entry.class);
          else classes.delete(entry.class);
        }
      }
    }
    remember(this.classifierTables, key, tables);
    return tables;
  }

  /**
   * An error of the document at a position of it (engine §2).
   * @param {string} path
   * @param {[number, number]} position
   * @param {string} message
   * @returns {GencmuError}
   */
  documentError(path, position, message) {
    const [line, column] = position;
    return new GencmuError("grammar", `${path}:${line}:${column}: ${message}`, { document: path, line, column });
  }

  /**
   * Defines or redefines a constant, with the value its term has at this
   * point of the stage (engine §2).
   * @param {string} path
   * @param {DomConstant} constant
   */
  addConstant(path, constant) {
    const { name, op, value } = constant;
    const previous = this.constants.get(name);
    if (op === "define" && previous) {
      throw this.documentError(path, constant.at, `%const $${name} is already defined in stage ${this.stageName}, in ${previous.document}; %redefine-const gives it a new value`);
    }
    if (op === "redefine" && !previous) {
      throw this.documentError(path, constant.at, `%redefine-const $${name} gives a value to no constant defined before it in stage ${this.stageName}`);
    }
    // A reference sees the constants defined before this point (engine §2).
    for (const reference of constantsIn(value)) {
      if (!this.constants.has(reference.const)) {
        throw this.documentError(path, reference.at, `$${reference.const} is not defined before this point of stage ${this.stageName}`);
      }
    }
    const found = constantValueType(value, op === "redefine", (other) => /** @type {StageConstant} */ (this.constants.get(other)).type);
    if ("problem" in found) throw this.faultError(path, found.node, constant.at, found.problem);
    let type = found.type;
    if (previous) {
      // A redefinition keeps the type, which gives ∅ its kind.
      if (type === "set" && (previous.type === "strings" || previous.type === "tags")) type = previous.type;
      if (type !== previous.type) {
        throw this.documentError(path, constant.at, `%redefine-const $${name} keeps the type of the constant, and cannot make it ${TYPE_PHRASES[type]}`);
      }
    }
    this.constants.set(name, { value: this.evaluateClosed(path, value, constant.at), type, document: path });
  }

  /**
   * The error for a construct whose types disagree: at its first constant,
   * which the loader alone could type, or else at the item (engine §9).
   * @param {string} path
   * @param {unknown} node
   * @param {[number, number]} item
   * @param {string} problem
   * @returns {GencmuError}
   */
  faultError(path, node, item, problem) {
    const first = constantsIn(node)[0];
    return this.documentError(path, first ? first.at : item, problem);
  }

  /**
   * The value of a closed term, with the constants' values now (engine §2,
   * §10). An empty delimiter or a tag's string that is not a name comes
   * from a constant here, since the reader refuses a literal one, and the
   * error stands at that constant.
   * @param {string} path
   * @param {Term} term
   * @param {[number, number]} item the position of the definition
   * @returns {TermValue}
   */
  evaluateClosed(path, term, item) {
    /** @type {(term: Term) => Set<string>} */
    const set = (part) => {
      const value = this.evaluateClosed(path, part, item);
      return "set" in value ? value.set : tagSet();
    };
    /** @type {(term: Term) => string} */
    const string = (part) => {
      const value = this.evaluateClosed(path, part, item);
      return "string" in value ? value.string : "";
    };
    if ("string" in term) return { string: term.string };
    if ("tag" in term) return { set: tagSet([term.tag]) };
    if ("range" in term) return { set: rangeTags(term.range, this.unicode) };
    if ("emptySet" in term) return { set: tagSet() };
    if ("const" in term) return /** @type {StageConstant} */ (this.constants.get(term.const)).value;
    if ("union" in term) {
      const result = new TagUnion();
      for (const part of term.union) result.add(set(part));
      return { set: result.result() };
    }
    if ("intersection" in term) {
      const [first, ...rest] = term.intersection.map(set);
      return { set: rest.reduce(tagIntersection, first) };
    }
    if ("difference" in term) return { set: tagDifference(set(term.difference[0]), set(term.difference[1])) };
    if ("call" in term && term.call === "split") {
      // Left to right, as a parse evaluates a term (engine §10).
      const [text, delimiter] = /** @type {Term[]} */ (term.args);
      const pieces = string(text);
      const seen = string(delimiter);
      if (seen === "") throw this.faultError(path, delimiter, item, "split has an empty delimiter");
      return { set: splitString(pieces, seen) };
    }
    if ("call" in term && term.call === "tag") {
      const name = string(/** @type {Term} */ (term.args[0]));
      if (!isName(name)) throw this.faultError(path, term.args[0], item, `tag(${JSON.stringify(name)}): the string is not a name`);
      return { set: tagSet([name]) };
    }
    throw new GencmuError("grammar", `${path}: a constant's value is not a closed term`, { document: path });
  }

  /**
   * Gives every constant in a rule its final value, once the stage is
   * stitched, and checks what the reader could not: that each is defined,
   * that the types agree, and that a constant that split or tag reads
   * directly is a delimiter that is not empty, or a name (engine §2, §9,
   * §10).
   */
  resolveConstants() {
    /** @type {(name: string) => TermType} */
    const types = (name) => /** @type {StageConstant} */ (this.constants.get(name)).type;
    for (const { path, rule } of this.constantUsers) {
      for (const reference of constantsIn(rule)) {
        if (!this.constants.has(reference.const)) {
          throw this.documentError(path, reference.at, `$${reference.const} is not defined in stage ${this.stageName}`);
        }
      }
      const fault = ruleTypeFault(rule, types);
      if (fault) throw this.faultError(path, fault.node, rule.at, fault.problem);
      // The checks that simplification decides, which the reader left to
      // the loader, now with the constants' values (engine §9).
      const problem = definitionProblem(resolveNode(rule, this.constants));
      if (problem) throw this.documentError(path, rule.at, problem);
      // A string constant in a sound test must be a canonical sound (engine
      // §2, §9); the error stands at the constant.
      for (const alternative of rule.alternatives) {
        for (const test of testsIn(alternative.expr)) {
          const first = constantsIn(test.value)[0];
          if (!isSoundTest(test.test) || !first) continue;
          const value = this.evaluateClosed(path, test.value, rule.at);
          const wrong = soundProblem("string" in value ? value.string : "", this.unicode);
          if (wrong) throw this.documentError(path, first.at, wrong);
        }
      }
      for (const call of callsIn(rule)) {
        const argument = call.call === "split" ? call.args[1] : call.call === "tag" ? call.args[0] : undefined;
        if (!argument || !("const" in argument)) continue;
        const value = /** @type {StageConstant} */ (this.constants.get(argument.const)).value;
        const seen = "string" in value ? value.string : "";
        if (call.call === "split" && seen === "") throw this.documentError(path, argument.at, "split has an empty delimiter");
        if (call.call === "tag" && !isName(seen)) throw this.documentError(path, argument.at, `tag(${JSON.stringify(seen)}): the string is not a name`);
      }
    }
    if (this.constantUsers.length === 0) return;
    // Each reference holds the final value; the clauses that a definition's
    // alternatives share stay shared.
    /** @type {Map<object, RuleClauses>} */
    const resolved = new Map();
    /** @type {<T>(node: T) => T} */
    const resolve = (node) => /** @type {any} */ (resolveNode(node, this.constants));
    for (const rule of this.rules.values()) {
      rule.alternatives = rule.alternatives.map((alternative) => {
        const { clauses } = alternative;
        if (constantsIn(alternative.tags).length === 0 && constantsIn([clauses.tags, clauses.conditions, clauses.emit]).length === 0) return alternative;
        let shared = resolved.get(clauses);
        if (!shared) {
          shared = { ...clauses, tags: resolve(clauses.tags), conditions: resolve(clauses.conditions), emit: resolve(clauses.emit) };
          resolved.set(clauses, shared);
        }
        return { ...alternative, tags: resolve(alternative.tags), clauses: shared };
      });
    }
  }

  /**
   * A test of a body with its value, from the constants' final values
   * (engine §2, §4).
   * @param {{test: TestOp, value: Term}} test
   * @param {string} path
   * @param {ErrorLocation} at
   * @returns {SymbolTest}
   */
  symbolTest(test, path, at) {
    let found = this.tests.get(test);
    if (!found) {
      const value = this.evaluateClosed(path, test.value, [at.line ?? 0, at.column ?? 0]);
      const written = writtenTest(test.test, value);
      found = "string" in value ? { op: test.test, sound: value.string, written } : { op: test.test, tags: "set" in value ? value.set : tagSet(), written };
      this.tests.set(test, found);
    }
    return found;
  }

  checkReferences() {
    // A rule named anywhere must be defined: in a body, and in a clause as the
    // rule of matches, begins or tags (engine §2). The error stands at the
    // definition that wrote the alternative.
    /** @type {(name: string, rule: StitchedRule, alternative: StitchedAlternative) => void} */
    const check = (name, rule, alternative) => {
      if (!this.rules.has(name)) {
        throw new GencmuError("grammar", `${alternative.document}: ${rule.name} refers to ${name}, which is not defined`, alternative.at);
      }
    };
    /** @type {(expr: Expr, rule: StitchedRule, alternative: StitchedAlternative) => void} */
    const visit = (expr, rule, alternative) => {
      if ("ref" in expr && !isTerminalName(expr.ref)) check(expr.ref, rule, alternative);
      for (const child of childExpressions(expr)) visit(child, rule, alternative);
    };
    // The stage's classifiers by name, rather than a scan of them for each
    // classifier a clause names.
    const classifierNames = new Set(this.classifierItems.map((item) => item.classifier.name));
    for (const rule of this.rules.values()) {
      for (const alternative of rule.alternatives) {
        visit(alternative.expr, rule, alternative);
        const { tags, conditions, emit } = alternative.clauses;
        const clauses = [alternative.tags, tags, conditions, emit ? emit.items.map((item) => item.tags) : []];
        for (const name of clauseRules(clauses)) check(name, rule, alternative);
        // A classifier that classify names belongs to the stage (engine §2).
        for (const name of clauseClassifiers(clauses)) {
          if (!classifierNames.has(name)) {
            throw new GencmuError("grammar", `${alternative.document}: ${rule.name} classifies with ${name}, which no %classifier of stage ${this.stageName} names`, alternative.at);
          }
        }
      }
    }
    if (!this.rules.has("text")) throw new GencmuError("grammar", `stage ${this.stageName} has no rule text`, { stage: this.stageName });
  }

  /**
   * The productions for a set of enabled features. The check of
   * elision-only reads the same productions in a mode of its own (engine
   * §3.8, §7.4).
   * @param {Set<string>} features
   * @returns {LoweredGrammar}
   */
  lower(features) {
    // Only the gates that are on change the productions. So two sets of
    // features with the same gates on share one lowered grammar.
    const on = new Set(this.gates.filter((name) => features.has(name)));
    const key = JSON.stringify([...on]);
    let lowered = recall(this.lowered, key);
    if (!lowered) {
      // The stage resolves its classifiers for the same features, before it
      // lowers its rules (engine §2, §3).
      const classifiers = this.classifiers(on);
      lowered = { ...new Lowering(this, on).run(), classifiers, implications: this.implications };
      remember(this.lowered, key, lowered);
    }
    return lowered;
  }
}

/**
 * The names of the features that gate, in code point order, each once.
 * @param {Guard[]} guards
 * @returns {string[]}
 */
function gateNames(guards) {
  const names = new Set(guards.filter((guard) => guard.kind !== "warning").map((guard) => guard.feature));
  return [...names].sort(compareCodePoints);
}

/**
 * The value of a key in a bounded cache, now the most recently used.
 * @template T
 * @param {Map<string, T>} cache
 * @param {string} key
 * @returns {T | undefined}
 */
function recall(cache, key) {
  const value = cache.get(key);
  if (value !== undefined) {
    cache.delete(key);
    cache.set(key, value);
  }
  return value;
}

/**
 * Adds a value to a bounded cache, and drops the least recently used
 * value when the cache is full.
 * @template T
 * @param {Map<string, T>} cache
 * @param {string} key
 * @param {T} value
 */
function remember(cache, key, value) {
  cache.set(key, value);
  if (cache.size > MAX_LOWERED) cache.delete(/** @type {string} */ (cache.keys().next().value));
}

const TYPE_PHRASES = { string: "a string", strings: "a set of strings", tags: "a tag set", span: "a span", set: "a set", any: "a value" };

/**
 * A copy of a clause in which every reference to a constant holds the
 * constant's value (engine §2).
 * @param {unknown} node
 * @param {Map<string, StageConstant>} constants
 * @returns {unknown}
 */
function resolveNode(node, constants) {
  if (Array.isArray(node)) return node.map((item) => resolveNode(item, constants));
  if (node === null || typeof node !== "object") return node;
  const record = /** @type {Record<string, unknown>} */ (node);
  if (typeof record.const === "string") {
    /** @type {ConstantTerm} */
    const reference = { const: record.const, at: /** @type {[number, number]} */ (record.at), value: /** @type {StageConstant} */ (constants.get(record.const)).value };
    return reference;
  }
  /** @type {Record<string, unknown>} */
  const copy = {};
  for (const [key, value] of Object.entries(record)) copy[key] = resolveNode(value, constants);
  return copy;
}

/**
 * The calls of split and tag in a rule's clauses.
 * @param {unknown} node
 * @returns {{call: string, args: any[]}[]}
 */
function callsIn(node) {
  /** @type {{call: string, args: any[]}[]} */
  const found = [];
  /** @param {unknown} current */
  const walk = (current) => {
    if (Array.isArray(current)) {
      for (const item of current) walk(item);
    } else if (current !== null && typeof current === "object") {
      const record = /** @type {Record<string, unknown>} */ (current);
      if ((record.call === "split" || record.call === "tag") && Array.isArray(record.args)) found.push(/** @type {any} */ (record));
      for (const value of Object.values(record)) walk(value);
    }
  };
  walk(node);
  return found;
}

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isTerminalName(name) {
  const first = name.codePointAt(0);
  return first !== undefined && first >= 0x41 && first <= 0x5a;
}

/**
 * The tag of a symbol that matches by a tag: a terminal, or a reference
 * whose name begins with a capital. A reference in lower case names a rule,
 * so it is never the terminator of an elidable optional (engine §2, §3.8).
 * @param {Expr} expr
 * @returns {string | undefined}
 */
function tagName(expr) {
  if ("terminal" in expr) return expr.terminal;
  return "ref" in expr && isTerminalName(expr.ref) ? expr.ref : undefined;
}

/**
 * The rules that terms and conditions name: the rule of a matches or begins
 * condition, and the rule argument of a call such as tags(span, rule).
 * @param {unknown} value
 * @returns {Generator<string>}
 */
function* clauseRules(value) {
  if (Array.isArray(value)) {
    for (const item of value) yield* clauseRules(item);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "rule" && typeof child === "string") yield child;
      else yield* clauseRules(child);
    }
  }
}

/**
 * The classifiers that terms name, as the second argument of classify.
 * @param {unknown} value
 * @returns {Generator<string>}
 */
function* clauseClassifiers(value) {
  if (Array.isArray(value)) {
    for (const item of value) yield* clauseClassifiers(item);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "classifier" && typeof child === "string") yield child;
      else yield* clauseClassifiers(child);
    }
  }
}

/**
 * @param {Expr} expr
 * @returns {Expr[]}
 */
function childExpressions(expr) {
  if ("seq" in expr) return expr.seq;
  if ("choice" in expr) return expr.choice;
  if ("and" in expr) return expr.and;
  if ("optional" in expr) return [expr.optional];
  if ("repeat" in expr) return expr.separator === undefined ? [expr.repeat] : [expr.repeat, expr.separator];
  if ("capture" in expr || "test" in expr) return [expr.expr];
  return [];
}

// The lowered grammar: productions, numbered as engine §3 says.
class Lowering {
  /**
   * @param {Grammar} grammar
   * @param {Set<string>} features
   */
  constructor(grammar, features) {
    this.grammar = grammar;
    this.features = features;
    /** @type {Production[]} */
    this.productions = [];
    /** @type {Map<string, Production[]>} */
    this.byLhs = new Map();
    this.helperCount = 0;
    // The helpers of the optionals written [++T x], whose terminators are
    // maximal (engine §3.8, §4).
    /** @type {Set<string>} */
    this.maximalHelpers = new Set();
    // The structural grammar (engine §3.3): every production that the gates
    // and the expansion make, before a false condition removes any, with
    // its symbols' tests ignored.
    /** @type {{lhs: string, rhs: import("./types.js").GrammarSymbol[]}[]} */
    this.structural = [];
    // The item of each pair of braces, as its expansions, with the
    // definition that wrote it.
    /** @type {{items: SequenceItem[][], rule: StitchedRule, alternative: StitchedAlternative}[]} */
    this.braceItems = [];
  }

  /** @returns {Omit<LoweredGrammar, "classifiers" | "implications">} */
  run() {
    for (const rule of this.grammar.rules.values()) {
      // Only gates drop an alternative; a warning keeps it (engine §3.1).
      const enabled = rule.alternatives.filter((alternative) => alternative.guards.every(
        (guard) => guard.kind === "warning" || this.features.has(guard.feature) !== guard.negated));
      // A chain is the only alternative of its rule that the gates leave
      // (engine §3.3); a %extend-rule can add another.
      const chain = enabled.find((alternative) => isChain(alternative.expr));
      if (chain && enabled.length > 1) {
        throw loweringError(chain.at, `${rule.name} is a chain, which is the whole of its rule, but another alternative stands beside it`);
      }
      for (const alternative of enabled) this.lowerAlternative(rule, alternative);
    }
    this.checkBraceItems();
    return {
      productions: this.productions,
      byLhs: this.byLhs,
      maximalHelpers: this.maximalHelpers,
      resolution: /** @type {Resolution} */ (this.grammar.resolution),
    };
  }

  /**
   * Numbers a production and adds it, with its captures indexed by
   * position and by name: every advance and every read of a capture looks
   * one up, so a scan of the list would cost its length each time.
   * The conditions are grouped by when they are ready, so that an advance
   * looks only at its own.
   * @param {Omit<Production, "id" | "captureAt" | "captureSlot" | "conditionsAt">} fields
   * @returns {Production}
   */
  addProduction(fields) {
    if (fields.helper) this.structural.push({ lhs: fields.lhs, rhs: fields.rhs });
    const captureAt = new Array(fields.rhs.length).fill(-1);
    /** @type {Map<string, number>} */
    const captureSlot = new Map();
    fields.captures.forEach((capture, slot) => {
      if (captureAt[capture.index] === -1) captureAt[capture.index] = slot;
      if (!captureSlot.has(capture.name)) captureSlot.set(capture.name, slot);
    });
    /** @type {import("./types.js").ReadyCondition[][]} */
    const conditionsAt = Array.from({ length: fields.rhs.length + 1 }, () => []);
    for (const condition of fields.conditions) conditionsAt[condition.readyAt + 1].push(condition);
    /** @type {Production} */
    const production = { ...fields, captureAt, captureSlot, conditionsAt, id: this.productions.length };
    this.productions.push(production);
    let same = this.byLhs.get(production.lhs);
    if (!same) this.byLhs.set(production.lhs, (same = []));
    same.push(production);
    return production;
  }

  /**
   * @param {StitchedRule} rule
   * @param {StitchedAlternative} alternative
   */
  lowerAlternative(rule, alternative) {
    /** @type {PendingHelper[]} */
    const pending = [];
    /** @type {Where} */
    const where = { rule, alternative, pending };
    const expr = alternative.expr;
    if (isChain(expr)) {
      // A chain is recursion on the rule itself, with no helper: its base
      // productions first, one for each expansion of the item, then its
      // recursive ones (engine §3.3).
      const items = this.expand(expr.repeat, where);
      this.braceItems.push({ items, rule, alternative });
      const separators = expr.separator === undefined ? [[]] : this.expand(expr.separator, where);
      /** @type {SequenceItem[][]} */
      const self = [[{ symbol: { name: rule.name, terminal: false } }]];
      const recursive = expr.chain === "left" ? product(self, product(separators, items)) : product(product(items, separators), self);
      for (const sequence of [...items, ...recursive]) this.addRuleProduction(rule, alternative, sequence);
    } else {
      for (const sequence of this.expand(expr, where)) this.addRuleProduction(rule, alternative, sequence);
    }
    this.flushHelpers(pending, rule, alternative);
  }

  /**
   * An item of braces that can derive the empty sequence is an error of
   * the grammar (engine §3.3). Nullability is decided over the structural
   * grammar, every production that the gates leave, reachable or not.
   */
  checkBraceItems() {
    /** @type {Set<string>} */
    const nullable = new Set();
    /** @type {(rhs: import("./types.js").GrammarSymbol[]) => boolean} */
    const empty = (rhs) => rhs.every((symbol) => !symbol.terminal && nullable.has(symbol.name));
    for (let changed = true; changed;) {
      changed = false;
      for (const production of this.structural) {
        if (nullable.has(production.lhs) || !empty(production.rhs)) continue;
        nullable.add(production.lhs);
        changed = true;
      }
    }
    for (const { items, rule, alternative } of this.braceItems) {
      if (items.some((sequence) => empty(sequence.map((item) => item.symbol)))) {
        throw loweringError(alternative.at, `an item of braces in ${rule.name} can match no tokens`);
      }
    }
  }

  /**
   * @param {PendingHelper[]} pending
   * @param {StitchedRule} rule
   * @param {StitchedAlternative} alternative
   */
  flushHelpers(pending, rule, alternative) {
    for (let helper = pending.shift(); helper !== undefined; helper = pending.shift()) {
      /** @type {PendingHelper[]} */
      const nested = [];
      for (const sequence of helper.build({ rule, alternative, pending: nested })) {
        // A helper with one symbol has that symbol's tags, like any
        // production (engine §3.7).
        const single = sequence.length === 1;
        this.addProduction({
          lhs: helper.name,
          rhs: sequence.map((item) => item.symbol),
          helper: true,
          owner: rule.name,
          elided: helper.elided,
          elidedTest: helper.elidedTest,
          captures: single ? [{ name: "\u0000child", index: 0 }] : [],
          conditions: [],
          tags: single ? { call: "tags", args: [{ capture: "\u0000child" }] } : null,
          emit: null,
          opaque: false,
          warnings: [],
        });
      }
      for (let index = nested.length - 1; index >= 0; index--) pending.unshift(nested[index]);
    }
  }

  /**
   * @param {StitchedRule} rule
   * @param {StitchedAlternative} alternative
   * @param {SequenceItem[]} sequence
   */
  addRuleProduction(rule, alternative, sequence) {
    this.structural.push({ lhs: rule.name, rhs: sequence.map((item) => item.symbol) });
    /** @type {import("./types.js").Capture[]} */
    const captures = [];
    sequence.forEach((item, index) => {
      if (item.capture) captures.push({ name: item.capture, index });
    });
    // `$`, the whole constituent, is a capture every production has.
    const names = new Set(["", ...captures.map((capture) => capture.name)]);
    const clauses = alternative.clauses;
    // The clauses simplified for this production: presence tests and the
    // guards over them decided (engine §3.6).
    /** @type {(name: string) => boolean} */
    const has = (name) => names.has(name);
    // The union of the alternative's own tags and the rule's (engine §3.7);
    // the reader has made sure neither uses a capture this production lacks.
    const written = [alternative.tags, clauses.tags].filter((term) => term !== undefined).map((term) => simplify(term, has));
    /** @type {Term | null} */
    let tags = written.length === 0 ? null : written.length === 1 ? written[0] : { union: written };
    if (!tags && sequence.length === 1) {
      // A production with one symbol has that symbol's tags (engine §3.7),
      // whether or not the author captured it.
      if (captures.length === 0) {
        captures.push({ name: "\u0000child", index: 0 });
        names.add("\u0000child");
      }
      tags = { call: "tags", args: [{ capture: captures[0].name }] };
    }
    // Each capture's position, looked up once for every variable of every
    // condition.
    /** @type {Map<string, number>} */
    const positionOf = new Map();
    for (const capture of captures) if (!positionOf.has(capture.name)) positionOf.set(capture.name, capture.index);
    /** @type {import("./types.js").ReadyCondition[]} */
    const conditions = [];
    for (const written of clauses.conditions) {
      const condition = simplify(written, has);
      if (condition === DOM_TRUE) continue;
      // A condition false for this production removes it (engine §3.6).
      if (condition === DOM_FALSE) return;
      const variables = conditionVariables(condition);
      if (!variables.every((name) => names.has(name))) continue;
      // A condition is ready once its last capture is read, and one that
      // reads `$` once the constituent is complete (engine §4).
      let readyAt = -1;
      for (const name of variables) {
        readyAt = Math.max(readyAt, name === "" ? sequence.length - 1 : /** @type {number} */ (positionOf.get(name)));
      }
      conditions.push({ condition, readyAt });
    }
    let emit = clauses.emit || null;
    if (emit) {
      // An item whose carrier the production lacks is dropped, and so is
      // each attachment capture it lacks (engine §3.6); the reader has made
      // sure the tags of those left use none.
      emit = {
        items: emit.items.filter((item) => item.capture === undefined || names.has(item.capture))
          .map((item) => {
            /** @type {import("./types.js").EmitItem} */
            const kept = item.tags ? { ...item, tags: simplify(item.tags, has) } : { ...item };
            const before = (item.before ?? []).filter(has);
            const after = (item.after ?? []).filter(has);
            if (before.length) kept.before = before;
            else delete kept.before;
            if (after.length) kept.after = after;
            else delete kept.after;
            return kept;
          }),
      };
    }
    this.addProduction({
      lhs: rule.name,
      rhs: sequence.map((item) => item.symbol),
      helper: false,
      owner: rule.name,
      elided: null,
      elidedTest: null,
      captures,
      conditions,
      tags,
      emit,
      opaque: clauses.opaque,
      warnings: alternative.guards.filter((guard) => guard.kind === "warning").map((guard) => guard.feature),
    });
  }

  /**
   * The sequences of symbols an expression expands to.
   * @param {Expr} expr
   * @param {Where} where
   * @returns {SequenceItem[][]}
   */
  expand(expr, where) {
    if ("seq" in expr) return this.expandSequence(expr.seq, where);
    if ("choice" in expr) return expr.choice.flatMap((item) => this.expand(item, where));
    if ("and" in expr) {
      const parts = expr.and.map((item) => this.expand(item, where));
      /** @type {SequenceItem[][]} */
      const result = [];
      for (let mask = 1; mask < 1 << parts.length; mask++) {
        /** @type {SequenceItem[][]} */
        let sequences = [[]];
        parts.forEach((part, index) => {
          if (mask & (1 << index)) sequences = extendAll(sequences, part);
        });
        for (const sequence of sequences) result.push(sequence);
      }
      return result;
    }
    if ("optional" in expr) {
      const inner = expr.optional;
      // A plain optional that holds a capture expands in place, as (ε | x)
      // would: first the empty sequence, then each expansion of x
      // (engine §3.2).
      if (expr.elidable !== true && holdsCapture(inner)) return [/** @type {SequenceItem[]} */ ([]), ...this.expand(inner, where)];
      // Any other optional is a helper, and a marked one is elidable, with
      // the terminal that its marker names; ++ makes it maximal
      // (engine §3.8).
      const elided = expr.elidable === true ? this.elidedTerminal(inner, where) : null;
      const name = this.helper(where, (context) => [/** @type {SequenceItem[]} */ ([]), ...this.expand(inner, context)], elided);
      if (expr.maximal === true) this.maximalHelpers.add(name);
      return [[{ symbol: { name, terminal: false } }]];
    }
    if ("repeat" in expr) {
      // Flat braces are a helper, `h → x | h s x`, its base productions
      // first; the places inside the item come before those inside the
      // separator (engine §3.2).
      if (isChain(expr)) throw loweringError(where.alternative.at, `a chain in ${where.rule.name} is not the whole of its rule`);
      const item = expr.repeat;
      const separator = expr.separator;
      const name = this.helper(where, (context) => {
        const items = this.expand(item, context);
        this.braceItems.push({ items, rule: context.rule, alternative: context.alternative });
        const separators = separator === undefined ? [[]] : this.expand(separator, context);
        /** @type {SequenceItem[]} */
        const self = [{ symbol: { name, terminal: false } }];
        return [...items, ...product(product([self], separators), items)];
      }, null);
      return [[{ symbol: { name, terminal: false } }]];
    }
    if ("empty" in expr) return [[]];
    if ("test" in expr) {
      // A tested symbol lowers to its symbol with the test, and adds no
      // helper (engine §3).
      const inner = this.expand(expr.expr, where);
      const test = this.grammar.symbolTest(expr, where.rule.document, where.rule.at);
      return [[{ symbol: { ...inner[0][0].symbol, test } }]];
    }
    if ("ref" in expr) return [[{ symbol: { name: expr.ref, terminal: isTerminalName(expr.ref) } }]];
    if ("terminal" in expr) return [[{ symbol: { name: expr.terminal, terminal: true } }]];
    // A range or a property is a terminal whose name is its written form,
    // and which matches by its characters rather than by a tag (engine §4).
    if ("range" in expr) {
      const characters = { from: codeOfCharacterTag(expr.range[0]), to: codeOfCharacterTag(expr.range[1]) };
      return [[{ symbol: { name: rangeName(expr.range), terminal: true, characters } }]];
    }
    if ("property" in expr) return [[{ symbol: { name: propertyName(expr.property), terminal: true, characters: { property: expr.property } } }]];
    if ("capture" in expr) {
      const inner = this.expand(expr.expr, where);
      if (inner.length !== 1 || inner[0].length !== 1) {
        throw loweringError(where.alternative.at, `a capture in ${where.rule.name} must wrap one symbol`);
      }
      return [[{ symbol: inner[0][0].symbol, capture: expr.capture }]];
    }
    throw loweringError(where.alternative.at, `an unknown expression in ${where.rule.name}`);
  }

  /**
   * @param {Expr[]} items
   * @param {Where} where
   * @returns {SequenceItem[][]}
   */
  expandSequence(items, where) {
    /** @type {SequenceItem[][]} */
    let sequences = [[]];
    for (const item of items) sequences = extendAll(sequences, this.expand(item, where));
    return sequences;
  }

  /**
   * Names a helper rule, to be lowered when the alternative is done.
   * @param {Where} where
   * @param {(where: Where) => SequenceItem[][]} build
   * @param {{terminal: string, test: SymbolTest | null} | null} elided
   * @returns {string}
   */
  helper(where, build, elided) {
    const name = `${where.rule.name}·${this.helperCount++}`;
    where.pending.push({ name, build, elided: elided ? elided.terminal : null, elidedTest: elided ? elided.test : null });
    return name;
  }

  /**
   * The terminal of an elidable optional, the first item of its content,
   * and its `=` test, if any (engine §3.8, §12).
   * @param {Expr} expr
   * @param {Where} where
   * @returns {{terminal: string, test: SymbolTest | null}}
   */
  elidedTerminal(expr, where) {
    const first = "seq" in expr ? expr.seq[0] : expr;
    const tested = "test" in first ? first : null;
    const name = tagName(tested ? tested.expr : first);
    if (name === undefined) throw loweringError(where.alternative.at, `an elidable optional in ${where.rule.name} does not begin with its terminator`);
    return { terminal: name, test: tested ? this.grammar.symbolTest(tested, where.rule.document, where.rule.at) : null };
  }
}

/**
 * @param {SequenceItem[][]} left
 * @param {SequenceItem[][]} right
 * @returns {SequenceItem[][]}
 */
function product(left, right) {
  /** @type {SequenceItem[][]} */
  const result = [];
  for (const a of left) for (const b of right) result.push([...a, ...b]);
  return result;
}

/**
 * The product of sequences that the caller owns with others, made by
 * extending each owned sequence in place where it continues one way. A
 * copy of the growing prefix at each item would cost the square of a
 * sequence's length. A sequence that continues several ways is copied for
 * all but the last.
 * @param {SequenceItem[][]} left owned, and changed
 * @param {SequenceItem[][]} right only read
 * @returns {SequenceItem[][]}
 */
function extendAll(left, right) {
  /** @type {SequenceItem[][]} */
  const result = [];
  for (const a of left) {
    for (let index = 0; index < right.length; index++) {
      const sequence = index === right.length - 1 ? a : a.slice();
      for (const item of right[index]) sequence.push(item);
      result.push(sequence);
    }
  }
  return result;
}

/**
 * An error of the grammar that lowering finds (engine §3). A parse reports
 * it as a result, whose error has no position of its own (docs/output.md),
 * so the message names the document, line and column of the definition
 * that wrote the alternative.
 * @param {ErrorLocation} at
 * @param {string} message
 * @returns {GencmuError}
 */
function loweringError(at, message) {
  return new GencmuError("grammar", `${at.document}:${at.line}:${at.column}: ${message}`, at);
}

/**
 * Whether an expression holds a capture, at any depth (engine §3.5).
 * @param {Expr} expr
 * @returns {boolean}
 */
function holdsCapture(expr) {
  if ("capture" in expr) return true;
  return childExpressions(expr).some(holdsCapture);
}

/**
 * Whether an expression is a chain, `{... x \ s}` or `{x ... \ s}`.
 * @param {Expr} expr
 * @returns {expr is {repeat: Expr, separator?: Expr, chain: "left" | "right"}}
 */
function isChain(expr) {
  return "repeat" in expr && expr.chain !== undefined;
}

/**
 * The captures a term or condition names.
 * @param {Term | Condition} term
 * @returns {string[]}
 */
export function termVariables(term) {
  /** @type {string[]} */
  const names = [];
  /** @type {(node: unknown) => void} */
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    const record = /** @type {Record<string, unknown>} */ (node);
    if (typeof record.capture === "string" && Object.keys(record).length === 1) names.push(record.capture);
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(term);
  return names;
}

/**
 * @param {Condition} condition
 * @returns {string[]}
 */
export function conditionVariables(condition) {
  return termVariables(condition);
}
