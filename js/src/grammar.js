// A stage's grammar: its documents stitched together (engine §2) and
// lowered to productions for one set of features (engine §3).

import { GencmuError } from "./errors.js";

const MAX_CAPTURES = 4;

// Stitches documents, each { path, dom }, into one grammar.
export class Grammar {
  constructor(stageName, documents) {
    this.stageName = stageName;
    this.rules = new Map();
    this.changes = [];
    this.elidable = new Set();
    this.resolution = null;
    this.freeModifiers = null;
    for (const { path, dom } of documents) this.addDocument(path, dom);
    if (!this.resolution) {
      throw new GencmuError("grammar", `stage ${stageName} has no %ambiguity-resolution`, { stage: stageName });
    }
    this.checkReferences();
    this.lowered = new Map();
  }

  addDocument(path, dom) {
    const definedHere = new Set();
    for (const rule of dom.rules) {
      const at = { document: path, line: rule.at[0], column: rule.at[1] };
      const clauses = { tags: rule.tags, emit: rule.emit, conditions: rule.conditions || [] };
      const alternatives = rule.alternatives.map((alternative) => ({ ...alternative, clauses, document: path }));
      if (rule.op === "define") {
        if (definedHere.has(rule.name)) {
          throw new GencmuError("grammar", `${path}:${at.line}: ${rule.name} is defined twice with ≔`, at);
        }
        definedHere.add(rule.name);
        if (this.rules.has(rule.name)) {
          this.changes.push({ kind: "replaced", rule: rule.name, document: path, previous: this.rules.get(rule.name).document });
        }
        this.rules.set(rule.name, { name: rule.name, document: path, at, alternatives });
      } else {
        const base = this.rules.get(rule.name);
        if (!base) {
          throw new GencmuError("grammar", `${path}:${at.line}: ${rule.name} |≔ extends a rule that is not defined before it`, at);
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
          if ((lean !== "greedy" && lean !== "lazy") || rest.some((word) => word !== "elision-only") || rest.length > 1) {
            throw new GencmuError("grammar", `${path}:${at.line}: %ambiguity-resolution takes greedy or lazy, then optionally elision-only`, at);
          }
          this.resolution = { lean, elisionOnly: rest.length === 1 };
          break;
        }
        case "elidable":
          for (const terminal of directive.args) this.elidable.add(terminal);
          break;
        case "free-modifiers":
          if (this.freeModifiers || directive.args.length !== 1) {
            throw new GencmuError("grammar", `${path}:${at.line}: %free-modifiers names one rule, once per stage`, at);
          }
          this.freeModifiers = directive.args[0];
          break;
        default:
          throw new GencmuError("grammar", `${path}:${at.line}: unknown directive %${directive.name}`, at);
      }
    }
  }

  checkReferences() {
    const visit = (expr, rule) => {
      if (expr.ref !== undefined && !isTerminalName(expr.ref) && !this.rules.has(expr.ref)) {
        throw new GencmuError("grammar", `${rule.document}: ${rule.name} refers to ${expr.ref}, which is not defined`, rule.at);
      }
      if (expr.hash && !this.freeModifiers) {
        throw new GencmuError("grammar", `${rule.document}: ${rule.name} uses # without %free-modifiers`, rule.at);
      }
      for (const child of childExpressions(expr)) visit(child, rule);
    };
    for (const rule of this.rules.values()) for (const alternative of rule.alternatives) visit(alternative.expr, rule);
    if (!this.rules.has("text")) throw new GencmuError("grammar", `stage ${this.stageName} has no rule text`, { stage: this.stageName });
  }

  // The productions for a set of enabled features; `strict` makes elidable
  // optionals mandatory (engine §3.8).
  lower(features, strict) {
    const key = [...features].sort().join(",") + (strict ? "|strict" : "");
    if (!this.lowered.has(key)) this.lowered.set(key, new Lowering(this, features, strict).run());
    return this.lowered.get(key);
  }
}

export function isTerminalName(name) {
  const first = name.codePointAt(0);
  return first >= 0x41 && first <= 0x5a;
}

function childExpressions(expr) {
  if (expr.seq) return expr.seq;
  if (expr.choice) return expr.choice;
  if (expr.and) return expr.and;
  if (expr.optional) return [expr.optional];
  if (expr.repeat) return [expr.repeat];
  if (expr.capture) return [expr.expr];
  return [];
}

// The lowered grammar: productions, numbered as engine §3 says.
class Lowering {
  constructor(grammar, features, strict) {
    this.grammar = grammar;
    this.features = features;
    this.strict = strict;
    this.productions = [];
    this.byLhs = new Map();
    this.helperCount = 0;
  }

  run() {
    for (const rule of this.grammar.rules.values()) {
      const enabled = rule.alternatives.filter((alternative) => alternative.guards.every(
        (guard) => this.features.has(guard.feature) !== guard.negated));
      for (const alternative of enabled) this.lowerAlternative(rule, alternative, enabled.length === 1);
    }
    return {
      productions: this.productions,
      byLhs: this.byLhs,
      elidable: this.grammar.elidable,
      resolution: this.grammar.resolution,
    };
  }

  addProduction(production) {
    production.id = this.productions.length;
    this.productions.push(production);
    if (!this.byLhs.has(production.lhs)) this.byLhs.set(production.lhs, []);
    this.byLhs.get(production.lhs).push(production);
    return production;
  }

  lowerAlternative(rule, alternative, only) {
    const pending = [];
    const trailing = only ? trailingRepetition(alternative.expr) : null;
    const where = { rule, pending };
    let sequences;
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

  flushHelpers(pending, rule) {
    while (pending.length > 0) {
      const helper = pending.shift();
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
          captures: single ? [{ name: "\u0000child", index: 0 }] : [],
          conditions: [],
          tags: single ? { call: "tags", args: [{ capture: "\u0000child" }] } : null,
          emit: null,
          recursivePrefix: false,
        });
      }
      pending.unshift(...nested);
    }
  }

  addRuleProduction(rule, alternative, sequence, recursivePrefix) {
    const captures = [];
    sequence.forEach((item, index) => {
      if (item.capture) captures.push({ name: item.capture, index });
    });
    if (captures.length > MAX_CAPTURES) {
      throw new GencmuError("grammar", `${alternative.document}: an alternative of ${rule.name} has more than ${MAX_CAPTURES} captures`, rule.at);
    }
    const names = new Set(captures.map((capture) => capture.name));
    const clauses = alternative.clauses;
    let tags = alternative.tags || clauses.tags || null;
    if (tags && !termVariables(tags).every((name) => names.has(name))) tags = null;
    if (!tags && sequence.length === 1 && captures.length === 0) {
      // A production with one symbol has that symbol's tags (engine §3.7).
      captures.push({ name: "\u0000child", index: 0 });
      names.add("\u0000child");
      tags = { call: "tags", args: [{ capture: "\u0000child" }] };
    }
    const conditions = [];
    for (const condition of clauses.conditions) {
      const variables = conditionVariables(condition);
      if (!variables.every((name) => names.has(name))) continue;
      const readyAt = Math.max(-1, ...variables.map((name) => captures.find((capture) => capture.name === name).index));
      conditions.push({ condition, readyAt });
    }
    let emit = clauses.emit || null;
    if (emit && emit.items) {
      emit = { items: emit.items.filter((item) => item.capture === undefined || names.has(item.capture)) };
    }
    this.addProduction({
      lhs: rule.name,
      rhs: sequence.map((item) => item.symbol),
      helper: false,
      owner: rule.name,
      elided: null,
      captures,
      conditions,
      tags,
      emit,
      recursivePrefix,
    });
  }

  // The sequences of symbols an expression expands to; each item is
  // { symbol: { name, terminal }, capture? }.
  expand(expr, where) {
    if (expr.seq) return this.expandSequence(expr.seq, where);
    if (expr.choice) return expr.choice.flatMap((item) => this.expand(item, where));
    if (expr.and) {
      const parts = expr.and.map((item) => this.expand(item, where));
      const result = [];
      for (let mask = 1; mask < 1 << parts.length; mask++) {
        let sequences = [[]];
        parts.forEach((part, index) => {
          if (mask & (1 << index)) sequences = product(sequences, part);
        });
        result.push(...sequences);
      }
      return result;
    }
    if (expr.optional) {
      const inner = expr.optional;
      const elided = this.elidedTerminal(inner, where);
      const mandatory = this.strict && elided !== null;
      const name = this.helper(where, (context) => {
        const expansions = this.expand(inner, context);
        return mandatory ? expansions : [[], ...expansions];
      }, elided);
      return [[{ symbol: { name, terminal: false } }]];
    }
    if (expr.repeat) {
      const inner = expr.repeat;
      const min = expr.min;
      const name = this.helper(where, (context) => {
        const expansions = this.expand(inner, context);
        if (expansions.some((sequence) => sequence.length === 0)) {
          throw new GencmuError("grammar", `${where.rule.document}: a repetition in ${where.rule.name} can match nothing`, where.rule.at);
        }
        const self = { symbol: { name, terminal: false } };
        const recursive = expansions.map((sequence) => [self, ...sequence]);
        return min === 1 ? [...expansions, ...recursive] : [[], ...recursive];
      }, null);
      return [[{ symbol: { name, terminal: false } }]];
    }
    if (expr.hash) {
      return this.expand({ repeat: { ref: this.grammar.freeModifiers }, min: 0 }, where);
    }
    if (expr.empty) return [[]];
    if (expr.ref !== undefined) return [[{ symbol: { name: expr.ref, terminal: isTerminalName(expr.ref) } }]];
    if (expr.terminal !== undefined) return [[{ symbol: { name: expr.terminal, terminal: true } }]];
    if (expr.capture !== undefined) {
      const inner = this.expand(expr.expr, where);
      if (inner.length !== 1 || inner[0].length !== 1) {
        throw new GencmuError("grammar", `${where.rule.document}: a capture in ${where.rule.name} must wrap one symbol`, where.rule.at);
      }
      return [[{ symbol: inner[0][0].symbol, capture: expr.capture }]];
    }
    throw new GencmuError("grammar", `${where.rule.document}: an unknown expression in ${where.rule.name}`, where.rule.at);
  }

  expandSequence(items, where) {
    let sequences = [[]];
    for (const item of items) sequences = product(sequences, this.expand(item, where));
    return sequences;
  }

  helper(where, build, elided) {
    const name = `${where.rule.name}·${this.helperCount++}`;
    where.pending.push({ name, build, elided });
    return name;
  }

  // The elidable terminal an optional begins with, if any (engine §12).
  elidedTerminal(expr, where) {
    let first = expr;
    while (first.seq) first = first.seq[0];
    const name = first.ref !== undefined ? first.ref : first.terminal;
    return name !== undefined && this.grammar.elidable.has(name) ? name : null;
  }
}

function product(left, right) {
  const result = [];
  for (const a of left) for (const b of right) result.push([...a, ...b]);
  return result;
}

function trailingRepetition(expr) {
  if (expr.repeat) return { prefix: [], item: expr.repeat, min: expr.min };
  if (expr.seq) {
    const last = expr.seq[expr.seq.length - 1];
    if (last.repeat) return { prefix: expr.seq.slice(0, -1), item: last.repeat, min: last.min };
  }
  return null;
}

export function termVariables(term) {
  const names = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.capture !== undefined && Object.keys(node).length === 1) names.push(node.capture);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(term);
  return names;
}

export function conditionVariables(condition) {
  return termVariables(condition);
}
