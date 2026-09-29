// A stage's grammar: its documents stitched together (engine §2) and
// lowered to productions for one set of features (engine §3).

import { GencmuError } from "./errors.js";
import { simplify, DOM_TRUE, DOM_FALSE } from "./dom.js";
import { codeOfCharacterTag, propertyName, rangeName } from "./tags.js";

/**
 * @import { Condition, DomAlternative, Emission, ErrorLocation, Expr, GrammarDom, Guard, LoweredGrammar, Production, Resolution, Term } from "./types.js"
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
 * @property {boolean} verbatim
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
 * Where an expansion happens: the rule, and the helpers still to lower.
 * @typedef {{rule: StitchedRule, pending: PendingHelper[]}} Where
 */

/**
 * @typedef {object} PendingHelper
 * @property {string} name
 * @property {(where: Where) => SequenceItem[][]} build
 * @property {string | null} elided
 * @property {string | null} elidedSpelling
 */

const MAX_CAPTURES = 4;

// Stitches documents, each { path, dom }, into one grammar.
export class Grammar {
  /**
   * @param {string} stageName
   * @param {{path: string, dom: GrammarDom}[]} documents
   */
  constructor(stageName, documents) {
    this.stageName = stageName;
    /** @type {Map<string, StitchedRule>} */
    this.rules = new Map();
    /** @type {RuleChange[]} */
    this.changes = [];
    /** @type {Set<string>} */
    this.elidable = new Set();
    /** @type {Resolution | null} */
    this.resolution = null;
    for (const { path, dom } of documents) this.addDocument(path, dom);
    if (!this.resolution) {
      throw new GencmuError("grammar", `stage ${stageName} has no %ambiguity-resolution`, { stage: stageName });
    }
    this.checkReferences();
    /** @type {Map<string, LoweredGrammar>} */
    this.lowered = new Map();
  }

  /**
   * @param {string} path
   * @param {GrammarDom} dom
   */
  addDocument(path, dom) {
    for (const rule of dom.rules) {
      const at = { document: path, line: rule.at[0], column: rule.at[1] };
      const clauses = { tags: rule.tags, emit: rule.emit, conditions: rule.conditions || [], verbatim: rule.verbatim === true };
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
        base.alternatives = base.alternatives.concat(alternatives);
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
          if ((lean !== "greedy" && lean !== "lazy") || rest.length > 0) {
            throw new GencmuError("grammar", `${path}:${at.line}: %ambiguity-resolution takes greedy or lazy, then optionally elision-only, then optionally maximal`, at);
          }
          this.resolution = { lean, elisionOnly, maximal };
          break;
        }
        case "elidable":
          for (const terminal of directive.args) this.elidable.add(terminal);
          break;
        default:
          throw new GencmuError("grammar", `${path}:${at.line}: unknown directive %${directive.name}`, at);
      }
    }
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
    for (const rule of this.rules.values()) {
      for (const alternative of rule.alternatives) {
        visit(alternative.expr, rule, alternative);
        const { tags, conditions, emit } = alternative.clauses;
        const clauses = [alternative.tags, tags, conditions, emit ? emit.items.map((item) => item.tags) : []];
        for (const name of clauseRules(clauses)) check(name, rule, alternative);
        const top = "seq" in alternative.expr ? alternative.expr.seq : [alternative.expr];
        const names = top.flatMap((item) => ("capture" in item ? [item.capture] : []));
        const twice = names.find((name, index) => names.indexOf(name) !== index);
        if (twice !== undefined) {
          throw new GencmuError("grammar", `${alternative.document}: an alternative of ${rule.name} captures $${twice} twice`, alternative.at);
        }
      }
    }
    if (!this.rules.has("text")) throw new GencmuError("grammar", `stage ${this.stageName} has no rule text`, { stage: this.stageName });
  }

  /**
   * The productions for a set of enabled features; `strict` makes elidable
   * optionals mandatory (engine §3.8).
   * @param {Set<string>} features
   * @param {boolean} strict
   * @returns {LoweredGrammar}
   */
  lower(features, strict) {
    const key = [...features].sort().join(",") + (strict ? "|strict" : "");
    let lowered = this.lowered.get(key);
    if (!lowered) this.lowered.set(key, (lowered = new Lowering(this, features, strict).run()));
    return lowered;
  }
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
 * @param {Expr} expr
 * @returns {Expr[]}
 */
function childExpressions(expr) {
  if ("seq" in expr) return expr.seq;
  if ("choice" in expr) return expr.choice;
  if ("and" in expr) return expr.and;
  if ("optional" in expr) return [expr.optional];
  if ("repeat" in expr) return [expr.repeat];
  if ("capture" in expr || "spelling" in expr) return [expr.expr];
  return [];
}

// The lowered grammar: productions, numbered as engine §3 says.
class Lowering {
  /**
   * @param {Grammar} grammar
   * @param {Set<string>} features
   * @param {boolean} strict
   */
  constructor(grammar, features, strict) {
    this.grammar = grammar;
    this.features = features;
    this.strict = strict;
    /** @type {Production[]} */
    this.productions = [];
    /** @type {Map<string, Production[]>} */
    this.byLhs = new Map();
    this.helperCount = 0;
  }

  /** @returns {LoweredGrammar} */
  run() {
    for (const rule of this.grammar.rules.values()) {
      // Only gates drop an alternative; a warning keeps it (engine §3.1).
      const enabled = rule.alternatives.filter((alternative) => alternative.guards.every(
        (guard) => guard.kind === "warning" || this.features.has(guard.feature) !== guard.negated));
      for (const alternative of enabled) this.lowerAlternative(rule, alternative, enabled.length === 1);
    }
    return {
      productions: this.productions,
      byLhs: this.byLhs,
      elidable: this.grammar.elidable,
      resolution: /** @type {Resolution} */ (this.grammar.resolution),
    };
  }

  /**
   * Numbers a production and adds it.
   * @param {Omit<Production, "id">} fields
   * @returns {Production}
   */
  addProduction(fields) {
    /** @type {Production} */
    const production = { ...fields, id: this.productions.length };
    this.productions.push(production);
    let same = this.byLhs.get(production.lhs);
    if (!same) this.byLhs.set(production.lhs, (same = []));
    same.push(production);
    return production;
  }

  /**
   * @param {StitchedRule} rule
   * @param {StitchedAlternative} alternative
   * @param {boolean} only whether it is the rule's only enabled alternative
   */
  lowerAlternative(rule, alternative, only) {
    /** @type {PendingHelper[]} */
    const pending = [];
    const trailing = only ? trailingRepetition(alternative.expr) : null;
    // A trailing repetition's recursive productions could not have its
    // captures, whose parts lie inside the inner constituent (engine §3.3).
    if (trailing && ("seq" in alternative.expr ? alternative.expr.seq : [alternative.expr]).some((item) => "capture" in item)) {
      throw new GencmuError("grammar", `${alternative.document}: an alternative of ${rule.name} captures a part, and is lowered as a trailing repetition`, alternative.at);
    }
    /** @type {Where} */
    const where = { rule, pending };
    /** @type {SequenceItem[][]} */
    let sequences;
    /** @type {SequenceItem[][] | null} */
    let recursive = null;
    if (trailing) {
      const prefixes = this.expandSequence(trailing.prefix, where);
      const items = this.expand(trailing.item, where);
      sequences = trailing.min === 1 ? product(prefixes, items) : prefixes;
      recursive = items.map((sequence) => [{ symbol: { name: rule.name, terminal: false } }, ...sequence]);
    } else {
      sequences = this.expand(alternative.expr, where);
    }
    for (const sequence of sequences) this.addRuleProduction(rule, alternative, sequence, false);
    for (const sequence of recursive || []) this.addRuleProduction(rule, alternative, sequence, true);
    this.flushHelpers(pending, rule);
  }

  /**
   * @param {PendingHelper[]} pending
   * @param {StitchedRule} rule
   */
  flushHelpers(pending, rule) {
    for (let helper = pending.shift(); helper !== undefined; helper = pending.shift()) {
      /** @type {PendingHelper[]} */
      const nested = [];
      for (const sequence of helper.build({ rule, pending: nested })) {
        // A helper with one symbol has that symbol's tags, like any
        // production (engine §3.7).
        const single = sequence.length === 1;
        this.addProduction({
          lhs: helper.name,
          rhs: sequence.map((item) => item.symbol),
          helper: true,
          owner: rule.name,
          elided: helper.elided,
          elidedSpelling: helper.elidedSpelling,
          captures: single ? [{ name: "\u0000child", index: 0 }] : [],
          conditions: [],
          tags: single ? { call: "tags", args: [{ capture: "\u0000child" }] } : null,
          emit: null,
          verbatim: false,
          recursivePrefix: false,
          warnings: [],
        });
      }
      pending.unshift(...nested);
    }
  }

  /**
   * @param {StitchedRule} rule
   * @param {StitchedAlternative} alternative
   * @param {SequenceItem[]} sequence
   * @param {boolean} recursivePrefix
   */
  addRuleProduction(rule, alternative, sequence, recursivePrefix) {
    /** @type {import("./types.js").Capture[]} */
    const captures = [];
    sequence.forEach((item, index) => {
      if (item.capture) captures.push({ name: item.capture, index });
    });
    if (captures.length > MAX_CAPTURES) {
      throw new GencmuError("grammar", `${alternative.document}: an alternative of ${rule.name} has more than ${MAX_CAPTURES} captures`, alternative.at);
    }
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
      const readyAt = Math.max(-1, ...variables.map((name) => (name === "" ? sequence.length - 1
        : /** @type {import("./types.js").Capture} */ (captures.find((capture) => capture.name === name)).index)));
      conditions.push({ condition, readyAt });
    }
    let emit = clauses.emit || null;
    if (emit) {
      // An item naming a capture the production lacks is dropped (engine
      // §3.6); the reader has made sure the tags of those left use none.
      emit = {
        items: emit.items.filter((item) => item.capture === undefined || names.has(item.capture))
          .map((item) => (item.tags ? { ...item, tags: simplify(item.tags, has) } : item)),
      };
    }
    this.addProduction({
      lhs: rule.name,
      rhs: sequence.map((item) => item.symbol),
      helper: false,
      owner: rule.name,
      elided: null,
      elidedSpelling: null,
      captures,
      conditions,
      tags,
      emit,
      verbatim: clauses.verbatim,
      recursivePrefix,
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
          if (mask & (1 << index)) sequences = product(sequences, part);
        });
        result.push(...sequences);
      }
      return result;
    }
    if ("optional" in expr) {
      const inner = expr.optional;
      const elided = this.elidedTerminal(inner, where);
      const mandatory = this.strict && elided !== null;
      const name = this.helper(where, (context) => {
        const expansions = this.expand(inner, context);
        return mandatory ? expansions : [/** @type {SequenceItem[]} */ ([]), ...expansions];
      }, elided);
      return [[{ symbol: { name, terminal: false } }]];
    }
    if ("repeat" in expr) {
      const inner = expr.repeat;
      const min = expr.min;
      const name = this.helper(where, (context) => {
        const expansions = this.expand(inner, context);
        /** @type {SequenceItem} */
        const self = { symbol: { name, terminal: false } };
        const recursive = expansions.map((sequence) => [self, ...sequence]);
        return min === 1 ? [...expansions, ...recursive] : [/** @type {SequenceItem[]} */ ([]), ...recursive];
      }, null);
      return [[{ symbol: { name, terminal: false } }]];
    }
    if ("empty" in expr) return [[]];
    if ("spelling" in expr) {
      // A spelled symbol lowers to its symbol with the spelling, and adds
      // no helper (engine §3).
      const inner = this.expand(expr.expr, where);
      return [[{ symbol: { ...inner[0][0].symbol, spelling: expr.spelling } }]];
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
        throw new GencmuError("grammar", `${where.rule.document}: a capture in ${where.rule.name} must wrap one symbol`, where.rule.at);
      }
      return [[{ symbol: inner[0][0].symbol, capture: expr.capture }]];
    }
    throw new GencmuError("grammar", `${where.rule.document}: an unknown expression in ${where.rule.name}`, where.rule.at);
  }

  /**
   * @param {Expr[]} items
   * @param {Where} where
   * @returns {SequenceItem[][]}
   */
  expandSequence(items, where) {
    /** @type {SequenceItem[][]} */
    let sequences = [[]];
    for (const item of items) sequences = product(sequences, this.expand(item, where));
    return sequences;
  }

  /**
   * Names a helper rule, to be lowered when the alternative is done.
   * @param {Where} where
   * @param {(where: Where) => SequenceItem[][]} build
   * @param {{terminal: string, spelling: string | null} | null} elided
   * @returns {string}
   */
  helper(where, build, elided) {
    const name = `${where.rule.name}·${this.helperCount++}`;
    where.pending.push({ name, build, elided: elided ? elided.terminal : null, elidedSpelling: elided ? elided.spelling : null });
    return name;
  }

  /**
   * The elidable terminal an optional begins with, if any, and its
   * spelling: a spelled terminal is elidable when its terminal is (engine
   * §3.8, §12).
   * @param {Expr} expr
   * @param {Where} where
   * @returns {{terminal: string, spelling: string | null} | null}
   */
  elidedTerminal(expr, where) {
    void where;
    let first = expr;
    while ("seq" in first) first = first.seq[0];
    const spelling = "spelling" in first ? first.spelling : null;
    if ("spelling" in first) first = first.expr;
    const name = "ref" in first ? first.ref : "terminal" in first ? first.terminal : undefined;
    return name !== undefined && this.grammar.elidable.has(name) ? { terminal: name, spelling } : null;
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
 * A body ending in a repetition, split into what comes before it and what
 * repeats.
 * @param {Expr} expr
 * @returns {{prefix: Expr[], item: Expr, min: number} | null}
 */
function trailingRepetition(expr) {
  if ("repeat" in expr) return { prefix: [], item: expr.repeat, min: expr.min };
  if ("seq" in expr) {
    const last = expr.seq[expr.seq.length - 1];
    if ("repeat" in last) return { prefix: expr.seq.slice(0, -1), item: last.repeat, min: last.min };
  }
  return null;
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
