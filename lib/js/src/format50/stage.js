// @ts-nocheck
// One stage of a format 50 pipeline. The format 49 recognizer finds and
// ranks the derivations. This module builds the chosen tree of
// occurrences, gives each rule node its bag (engine §3.7) and publishes
// the selected nodes as tokens (engine §5).

import { GencmuError, runtimeGrammarError } from "../errors.js";
import { ParseContext, recognize, rootItems, rejectionOf } from "../earley.js";
import { Ranker, derivationTree } from "../rank.js";
import { Stage as RecognizerStage } from "../stage.js";
import { restorationForest } from "../restoration-forest.js";
import { canCountProfiles, requiresElided } from "../ranking-patterns.js";
import { RankedAdmission } from "../ranked-admission.js";
import { Token as RecognizerToken } from "../tokens.js";
import { compareCodePoints } from "../tags.js";
import { BARE, Bag, valued } from "./bag.js";
import { Evaluator, Occurrence, Span, evaluationError } from "./evaluate.js";
import { isVisibleKey, alternativeKey, payloadTag, argumentExpression } from "./bridge.js";
import { DOM_TRUE, DOM_FALSE } from "../dom.js";
import { evaluate, holds, settled, asSet, workingStructure, structuralRead, terminalObservation } from "../earley.js";
import { derivationIdentity } from "../tree-identities.js";
import { capturedNode } from "../strings.js";
import { Bridge } from "./bridge.js";
import { keySet } from "./bag.js";

const SYMBOL_KEYS = ["ref", "call", "param", "literal", "range", "wildcard", "splice", "test"];

/**
 * The ranker of a chart, configured as the format 49 stage configures it.
 * @param {any} chart
 * @param {any[]} tokens
 * @param {any[]} steps
 * @param {any} lean
 */
function slotRanker(chart, tokens, steps, lean) {
  const ranker = new Ranker(tokens, steps, lean, null);
  ranker.erasures.closes = chart.context.closes;
  ranker.restorationForest = restorationForest(chart);
  if (ranker.restorationForest) chart = ranker.restorationForest.chart;
  ranker.profiles ||= canCountProfiles(chart.context.lowered) && !(chart.context.mode === "reconstruction" &&
    !chart.context.lowered.productions.some(p => p.error) && steps.every(step => requiresElided(step.pattern)));
  ranker.configured = true;
  ranker.interner = chart.context.interner;
  ranker.space.interner = chart.context.interner;
  ranker.space.tokens = chart.context.recon && !chart.context.recon.raw ? chart.context.recon.observed.tokens : tokens;
  if (chart.context.lowered.ranked?.groups.length) ranker.admission = new RankedAdmission(chart, chart.context.lowered.ranked);
  return ranker;
}

/** A token that a stage hands on, or a token of the origin table. */
export class Token50 {
  /**
   * @param {object} fields
   * @param {string} fields.text
   * @param {Bag} fields.props the public bag, with `value` and `image`
   * @param {[number, number]} fields.span
   * @param {[number, number]} fields.source
   * @param {Occurrence | null} [fields.node] the node that the token publishes
   * @param {string} [fields.insertedBy]
   */
  constructor({ text, props, span, source, node = null, insertedBy }) {
    this.text = text;
    this.props = props;
    this.span = span;
    this.source = source;
    this.node = node;
    if (insertedBy !== undefined) this.insertedBy = insertedBy;
    this.value = props.value("value");
    this.image = props.value("image");
  }

  /** The token as the recognizer reads it: its visible keys and its value. */
  recognizerToken() {
    const tags = new Set(this.props.keys().filter(isVisibleKey));
    // A recognizer test reads a literal payload of an input token through
    // hidden keys, as it reads the payloads of rules.
    for (const key of this.props.keys()) {
      if (!this.props.hasValue(key) || key === "value" || key === "image") continue;
      const value = this.props.value(key);
      tags.add(payloadTag(key));
      if (typeof value === "string" || typeof value === "number") tags.add(payloadTag(key, value));
    }
    return new RecognizerToken(tags, this.span, this.source, this.text, this.value, this.insertedBy, this.image);
  }
}

/**
 * The capture slots of an alternative: whether each capture is one node or
 * a list of nodes (engine §3.5).
 * @param {any} body
 * @returns {Map<string, "one" | "list">}
 */
export function captureKinds(body) {
  /** @type {Map<string, "one" | "list">} */
  const kinds = new Map();
  // Each route binds each name some number of times. A name bound once on
  // every route is one node. Any other name is a list.
  const counts = node => {
    if (!node || typeof node !== "object") return new Map();
    if (node.capture !== undefined && node.expr) {
      const inner = counts(node.expr);
      inner.set(node.capture, (inner.get(node.capture) ?? 0) + 1);
      return inner;
    }
    if (node.primary) return counts(node.primary);
    if (node.seq || node.and) {
      const total = new Map();
      for (const part of node.seq ?? node.and) for (const [name, count] of counts(part)) total.set(name, (total.get(name) ?? 0) + count);
      return total;
    }
    if (node.choice || node.ranked) {
      const branches = (node.choice ?? node.ranked).map(counts);
      const names = new Set(branches.flatMap(branch => [...branch.keys()]));
      const total = new Map();
      for (const name of names) {
        const values = branches.map(branch => branch.get(name) ?? 0);
        total.set(name, values.every(value => value === 1) ? 1 : 2);
      }
      return total;
    }
    if (node.optional || node.repeat) {
      const total = new Map();
      for (const part of [node.optional ?? node.repeat, node.separator]) {
        for (const name of counts(part).keys()) total.set(name, 2);
      }
      return total;
    }
    if (node.test !== undefined) return counts(node.expr);
    return new Map();
  };
  for (const [name, count] of counts(body)) kinds.set(name, count === 1 ? "one" : "list");
  return kinds;
}

/** Whether an alternative is one plain symbol (part 1 §5). */
export function isPlainSymbol(node) {
  if (node.capture !== undefined && node.expr) return isPlainSymbol(node.expr);
  if (node.choice) return node.choice.every(isPlainSymbol);
  if (node.test !== undefined) return isPlainSymbol(node.expr);
  return SYMBOL_KEYS.some(key => Object.hasOwn(node, key));
}

export class Stage50 {
  /**
   * @param {string} name
   * @param {import("../grammar.js").Grammar} grammar the recognizer's grammar
   * @param {Map<string, any>} origins the format 50 records of each bridged alternative
   * @param {Map<string, any[]>} constants the versions of each constant of the stage
   */
  constructor(name, runs, origins, constants, makeGrammar) {
    this.name = name;
    this.runs = runs;
    this.origins = origins;
    this.constants = constants;
    this.makeGrammar = makeGrammar;
    this.publishes = constants.has("OUTPUTS");
    /** @type {Map<string, any>} the recognizer grammar for each outcome of the closed conditions */
    this.grammars = new Map();
    this.closed = [];
    const visit = node => {
      if (!node || typeof node !== "object") return;
      if (node.closed50 !== undefined) this.closed.push(node.closed50);
      for (const value of Object.values(node)) if (value && typeof value === "object") visit(value);
    };
    for (const run of runs) {
      for (const rule of run.dom.rules) visit([rule.conditions, (rule.alternatives ?? []).map(alternative => alternative.tags)]);
      for (const directive of run.dom.directives) visit(directive.conditions);
    }
    // Stitching errors belong to loading, so the grammar is built now. The
    // outcome of a closed condition does not change the stitched grammar.
    const probe = makeGrammar(this.folded(() => true));
    if (!this.closed.length) this.grammars.set("", probe);
  }

  /** The runs with each closed condition replaced by its truth. */
  folded(truth) {
    if (!this.closed.length) return this.runs;
    const replace = node => {
      if (Array.isArray(node)) return node.map(replace);
      if (!node || typeof node !== "object") return node;
      if (node.closed50 !== undefined) return truth(node.closed50) ? DOM_TRUE : DOM_FALSE;
      return Object.fromEntries(Object.entries(node).map(([name, value]) => [name, replace(value)]));
    };
    return this.runs.map(run => ({ ...run, dom: { ...run.dom,
      rules: run.dom.rules.map(rule => ({ ...rule, conditions: replace(rule.conditions),
        ...(rule.alternatives ? { alternatives: rule.alternatives.map(alternative => alternative.tags ? { ...alternative, tags: replace(alternative.tags) } : alternative) } : {}) })),
      directives: run.dom.directives.map(directive => directive.conditions ? { ...directive, conditions: replace(directive.conditions) } : directive) } }));
  }

  /**
   * The stage-local %features declarations, in their order (engine §13).
   * A declaration with conditions turns its features on where every
   * condition holds on the input span. A declaration without conditions
   * turns them on always. Returns a failed report on a conflict with a
   * feature that the caller turns off.
   */
  declareFeatures(tokens, sourceText, features, off, inputKeys) {
    for (const { directive, document } of this.featureDeclarations ?? []) {
      const conditions = directive.conditions50;
      let holds = true;
      if (conditions?.length) {
        try {
          const data = this.stageData(tokens, sourceText, { features, inputKeys });
          const scope = { node: new Span(data, 0, tokens.length), items: [], names: new Map(), document };
          holds = conditions.every(condition => data.evaluator.truth(condition, scope));
        } catch (error) {
          if (!(error instanceof GencmuError)) throw error;
          return { name: this.name, verdict: null, root: null, output: null, errors: [], warnings: [], input: tokens,
            error: runtimeGrammarError(error.withLocation({ stage: undefined }), this.name) };
        }
      }
      if (!holds) continue;
      for (const feature of directive.args) {
        if (off.has(feature)) {
          if (conditions?.length) {
            return { name: this.name, verdict: null, root: null, output: null, errors: [], warnings: [], input: tokens,
              error: { kind: "feature-conflict", stage: this.name, feature, message: `the ${this.name} stage requires disabled feature ${feature}` } };
          }
        } else features.add(feature);
      }
    }
    return null;
  }

  /**
   * The recognizer grammar, with each closed condition replaced by its
   * truth for these features and this input interface.
   */
  grammarFor(data) {
    const values = new Map();
    for (const id of this.closed) {
      const { closed, document } = this.origins.get(id);
      values.set(id, data.evaluator.truth(closed, { items: [], names: new Map(), document }));
    }
    const key = [...values.values()].map(value => value ? "1" : "0").join("");
    if (!this.grammars.has(key)) this.grammars.set(key, this.makeGrammar(this.folded(id => values.get(id))));
    return this.grammars.get(key);
  }

  /**
   * Runs the stage over its input tokens.
   * @param {Token50[]} tokens
   * @param {string[]} sourceText
   * @param {any} unicode
   * @param {{features: Set<string>, inputKeys: Set<string>}} options
   */
  run(tokens, sourceText, unicode, options) {
    const report = { name: this.name, verdict: null, witness: null, root: null, output: null, error: null, errors: [], warnings: [] };
    let lowered, context, chart, roots, data;
    const recognizerTokens = tokens.map(token => token.recognizerToken());
    try {
      if (this.loweringErrors?.length) throw this.loweringErrors[0];
      data = this.stageData(tokens, sourceText, options);
      data.grammar = this.grammarFor(data);
      lowered = data.grammar.lower(options.features);
      context = new ParseContext(lowered, recognizerTokens, sourceText, unicode);
      chart = recognize(context, "text", 0, recognizerTokens.length);
      roots = rootItems(chart, "text");
      data.context = context;
    } catch (error) {
      if (error instanceof GencmuError) {
        report.error = runtimeGrammarError(error.withLocation({ stage: undefined }), this.name);
        return report;
      }
      throw error;
    }
    const resolution = lowered.resolution;
    const ranking = roots.length === 0 ? null : slotRanker(chart, recognizerTokens, resolution.steps, resolution.lean).rank(roots);
    if (ranking === null) {
      const rejection = rejectionOf(chart);
      report.error = {
        kind: "rejected", stage: this.name, token: rejection.position,
        expected: rejection.expected,
        message: `the ${this.name} stage could not continue at token ${rejection.position}` +
          (rejection.expected.length ? `; expected ${rejection.expected.map(item => item.terminal).join(", ")}` : ""),
      };
      return report;
    }
    if (ranking.verdict === "tie") {
      report.verdict = "tie";
      report.readings = [ranking.first, ranking.second].map(rope => this.tree(derivationTree(rope), data, context));
      report.witness = ranking.witness.map(wireAction);
      report.error = { kind: "ambiguous", stage: this.name, reason: "tie", message: `the ${this.name} stage's text has two best readings, a tie` };
      return report;
    }
    report.verdict = ranking.verdict;
    const derivation = derivationTree(ranking.first);
    const root = this.tree(derivation, data, context);
    report.root = root;
    let own;
    try {
      own = this.diagnostics(root, data);
    } catch (error) {
      if (!(error instanceof GencmuError)) throw error;
      report.error = runtimeGrammarError(error.withLocation({ stage: undefined }), this.name);
      return report;
    }
    report.own = own;
    if (this.publishes) {
      try {
        report.output = this.publish(root, data);
        this.assignDiagnostics(report, root, data);
        report.outputKeys = data.outputKeys;
      } catch (error) {
        if (!(error instanceof GencmuError)) throw error;
        report.output = null;
        report.error = runtimeGrammarError(error.withLocation({ stage: undefined }), this.name);
        return report;
      }
    }
    this.elisionOnly(report, derivation, root, context, lowered, options);
    return report;
  }

  /**
   * The check of elision-only (engine §7), run by the format 49 checker on
   * the chosen derivation. Its readings become occurrence trees.
   */
  elisionOnly(report, derivation, root, context, lowered, options) {
    const on = options.elisionOnly ?? lowered.resolution.elisionOnly;
    if (!on || options.pendingErrors) return;
    const elided = hasElided(root);
    if (!(report.verdict === "resolved" || report.verdict === "unique" && elided)) return;
    let check;
    try {
      check = RecognizerStage.prototype.elisionCheck.call(null, derivation, root, context, options.features);
    } catch (error) {
      if (!(error instanceof GencmuError)) throw error;
      report.output = null;
      report.error = runtimeGrammarError(error.withLocation({ stage: undefined }), this.name);
      return;
    }
    if (check.kind === "lost") {
      report.output = null;
      report.error = { kind: "grammar", stage: this.name, code: "elision-witness-lost",
        message: `the ${this.name} stage could not reconstruct its chosen derivation for elision-only`, completion: check.completion };
    } else if (check.kind === "ambiguous") {
      report.readings = check.readings.map(fromResultTree);
      report.error = { kind: "ambiguous", stage: this.name, reason: "elision-only",
        ...(check.witness ? { witness: check.witness.map(wireWitness) } : {}),
        message: `the ${this.name} stage's text is ambiguous with every elided terminator written out` };
    }
  }

  /**
   * A query after the choice of a parse: its truth or its keys, by the
   * recognizer's evaluator on the derivation of the occurrence that the
   * query reads. The query's receiver starts at a capture or at `$`.
   */
  lateQuery(data, kind, node, scope) {
    let base = node;
    while (base.receiver) base = base.receiver;
    if (base.capture === undefined) throw evaluationError("this query has no occurrence to read", node.at, scope.document);
    const target = base.capture === "" ? scope.node : data.evaluator.capture(base, scope, false);
    const occurrence = Array.isArray(target) ? (target.length === 1 ? target[0] : null) : target;
    if (!occurrence?.derivation || !data.context) {
      throw evaluationError("the format 50 engine cannot yet run this query after the choice of a parse", node.at, scope.document);
    }
    const rebase = item => item === base ? { capture: "" } : item.receiver ? { ...item, receiver: rebase(item.receiver) } : item;
    const bridge = new Bridge({ rules: [], directives: [], constants: [] }, scope.document ?? "", new Map());
    bridge.hidden = { demanded: new Set(), domains: new Map() };
    const recognizerScope = new LateScope(occurrence.derivation, data.context);
    if (kind === "keys") {
      const term = bridge.tagsOf(rebase(node), node.at);
      return keySet(asSet(settled(() => evaluate(data.context, term, recognizerScope))));
    }
    const condition = bridge.truth(rebase(node));
    return settled(() => holds(data.context, condition, recognizerScope));
  }

  /**
   * The messages of the chosen tree (engine §6): each %error, and each
   * %warning whose code is on and not suppressed, in preorder. Erased
   * subtrees evaluate no message.
   */
  diagnostics(root, data) {
    const found = [];
    const stack = [{ node: root, suppressed: new Set() }];
    while (stack.length) {
      const { node, suppressed: inherited } = stack.pop();
      if ((node.kind !== "rule" && node.kind !== "splice") || node.erased) continue;
      const rule = node.origin?.rule;
      const suppressed = rule?.suppressWarnings?.length ? new Set([...inherited, ...rule.suppressWarnings]) : inherited;
      const code = node.rule;
      const kind = rule?.error ? "errors" : rule?.warning && data.features.has(code) && !suppressed.has("_") && !suppressed.has(code) ? "warnings" : null;
      if (kind) {
        const scope = { node, captures: present(node.captures), declared: new Set(node.captures.keys()), items: [], names: new Map(), document: node.origin.document };
        const message = data.evaluator.string(kind === "errors" ? rule.error : rule.warning, scope);
        found.push({ kind, node, diagnostic: { stage: this.name, code, rule: code, span: [...node.span], source: [...node.source], message } });
      }
      for (let index = node.children.length - 1; index >= 0; index--) stack.push({ node: node.children[index], suppressed });
    }
    return found;
  }

  /**
   * Gives each report an owner among the output tokens (engine §6): the
   * first token whose input meets the report's input, else the first token
   * that starts at or after it, else the last token. An input token's
   * carried reports pass to the output token that covers it. A report with
   * no output token stays on the stage.
   */
  assignDiagnostics(report, root, data) {
    const tokens = report.output;
    const unowned = { errors: [], warnings: [] };
    const owner = (start, end) => tokens.find(token => token.span[1] > start && token.span[0] < end) ??
      tokens.find(token => token.span[0] >= start) ?? tokens.at(-1);
    const add = (token, kind, diagnostic) => {
      if (!token) {
        unowned[kind].push(diagnostic);
        return;
      }
      if (!Object.hasOwn(token, kind)) token[kind] = [];
      token[kind].push(diagnostic);
    };
    // Carried reports of the input tokens that live leaves read.
    const live = new Set();
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (node.erased) continue;
      if (node.kind === "token") live.add(node.token);
      for (const child of node.children) stack.push(child);
    }
    for (const index of [...live].sort((a, b) => a - b)) {
      const input = data.tokens[index];
      for (const kind of ["errors", "warnings"]) {
        for (const diagnostic of input[kind] ?? []) add(owner(index, index + 1), kind, diagnostic);
      }
    }
    for (const { kind, node, diagnostic } of report.own) add(owner(node.span[0], Math.max(node.span[1], node.span[0] + 1)), kind, diagnostic);
    report.errors = unowned.errors;
    report.warnings = unowned.warnings;
  }

  stageData(tokens, sourceText, options) {
    const leaves = new Map();
    const data = {
      tokens, sourceText, features: options.features, constants: this.constants, inputKeys: options.inputKeys,
      leaf: (token, index) => {
        if (!leaves.has(index)) {
          leaves.set(index, new Occurrence("token", {
            terminal: null, token: index, span: [index, index + 1], source: token.source, input: token,
            makeBag: () => token.props,
          }));
        }
        return leaves.get(index);
      },
    };
    data.lateQuery = (kind, node, scope) => this.lateQuery(data, kind, node, scope);
    data.evaluator = new Evaluator(data);
    data.evaluator.inputs = () => this.inputKeySet(data);
    const inputs = data.constants.get("INPUTS");
    if (inputs) throw new GencmuError("grammar", "a grammar cannot define $INPUTS");
    data.constants = new Map(data.constants);
    data.constants.set("INPUTS", [{ record: { value: { inputs: true } }, document: undefined }]);
    return data;
  }

  inputKeySet(data) {
    return Bag.from([...data.inputKeys].sort(compareCodePoints).map(key => [key, BARE]));
  }

  /**
   * The occurrence tree of a derivation.
   * @param {any} root
   */
  tree(root, data, context) {
    // A left-recursive rule makes a tree as deep as its text, so the build
    // uses its own stack and visits each node after its children.
    const made = new Map();
    const stack = [[root, false]];
    while (stack.length) {
      const [derivation, expanded] = stack.pop();
      if ("read" in derivation || isOmission(derivation)) {
        made.set(derivation, this.leaf(derivation, data));
        continue;
      }
      const parts = expandHelpers(derivation);
      if (!expanded) {
        stack.push([derivation, true]);
        for (let index = parts.items.length - 1; index >= 0; index--) stack.push([parts.items[index], false]);
        continue;
      }
      made.set(derivation, this.ruleOccurrence(derivation, parts, made, data));
    }
    return made.get(root);
  }

  /** The records of a written alternative, by its definition and index. */
  writtenOrigin(production, source, data) {
    if (!source?.document || !source.at) return undefined;
    const rule = data.grammar?.rules.get(production.spliceOf ?? production.lhs);
    const same = rule ? rule.alternatives.filter(item => item.document === source.document &&
      item.at.line === source.at.line && item.at.column === source.at.column) : [];
    const index = same.indexOf(source);
    if (index < 0) return undefined;
    return this.origins.get(alternativeKey(source.document, [source.at.line, source.at.column], index));
  }

  /**
   * The records of an alternative of a template instance: the template's
   * records with each parameter replaced by its argument.
   */
  instanceOrigin(production, source, data) {
    const grammar = data.grammar;
    const instance = grammar?.instances?.find(item => (item.name ?? item.canonical) === production.lhs);
    if (!instance) return undefined;
    const rule = grammar.rules.get(production.lhs);
    const index = rule ? rule.alternatives.indexOf(source) : -1;
    const template = this.origins.get(`template:${instance.call.call}#${index}`);
    if (!template) return undefined;
    const env = new Map(template.rule.params.map((param, position) => {
      const arg = instance.call.args[position];
      return [param, argumentExpression(arg)];
    }));
    const substitute = node => {
      if (Array.isArray(node)) return node.map(substitute);
      if (!node || typeof node !== "object") return node;
      if (node.param !== undefined && env.has(node.param)) return env.get(node.param);
      return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, substitute(value)]));
    };
    return {
      ...template,
      rule: substitute(template.rule),
      alternative: substitute(template.alternative),
    };
  }

  leaf(derivation, data) {
    if ("read" in derivation) {
      const index = derivation.read.token;
      const token = data.tokens[index];
      return new Occurrence("token", {
        terminal: derivation.read.terminal, token: index, span: [derivation.start, derivation.end],
        source: token.source, input: token, makeBag: () => token.props,
      });
    }
    const production = derivation.production;
    const at = this.emptySource(data.tokens, derivation.start);
    const value = production.elidedValue ?? "";
    const occurrence = new Occurrence("elided", {
      terminal: production.elided, span: [derivation.start, derivation.start], source: [at, at],
      ...(production.elidedValue !== undefined ? { default: production.elidedValue, value: production.elidedValue } : {}),
    });
    occurrence.makeBag = () => Bag.from([[production.elided, BARE], ["image", valued("")], ["value", valued(value)]]
      .sort((a, b) => compareCodePoints(a[0], b[0])));
    return occurrence;
  }

  ruleOccurrence(derivation, parts, made, data) {
    const production = derivation.production;
    const source = production.logicalSource ?? production.source;
    const origin = this.writtenOrigin(production, source, data) ?? this.instanceOrigin(production, source, data);
    const children = parts.items.map(item => made.get(item));
    // A spliced call is an occurrence of its own, named by its rule.
    const occurrence = new Occurrence(production.spliceOf ? "splice" : "rule", {
      rule: production.spliceOf ?? production.lhs, span: [derivation.start, derivation.end],
      source: this.sourceOf(data.tokens, derivation.start, derivation.end),
      erased: production.erased, origin, children, derivation,
    });
    const kinds = origin ? captureKinds(origin.alternative.expr) : new Map();
    const captures = new Map();
    for (const [name, kind] of kinds) captures.set(name, kind === "one" ? null : []);
    let primary = null;
    for (const { name, start, end } of parts.bindings) {
      const nodes = children.slice(start, end);
      if (name === origin?.primary) primary = nodes[0] ?? null;
      if (name === origin?.primary && origin.primarySynthetic) continue;
      if (kinds.get(name) === "list") for (const each of nodes) captures.get(name).push(each);
      else captures.set(name, nodes[0] ?? null);
    }
    occurrence.captures = captures;
    occurrence.primary = origin?.primary !== undefined ? primary : null;
    occurrence.makeBag = () => this.ruleBag(occurrence, data);
    return occurrence;
  }

  ruleBag(occurrence, data) {
    const bag = new Bag();
    const origin = occurrence.origin;
    const evaluator = data.evaluator;
    if (!origin) return bag;
    const document = origin.document;
    if (!occurrence.erased && data.constants.has("DEFAULTS")) {
      bag.splat(() => {
        const fn = evaluator.constantReference("DEFAULTS", origin.rule, { items: [], names: new Map(), document });
        return evaluator.bagOf(evaluator.applyFunction(fn, occurrence, origin.rule), origin.rule, { document });
      }, null);
    }
    const terms = [origin.rule.term, origin.alternative.term].filter(Boolean);
    if (occurrence.primary) bag.splat(() => occurrence.primary.bag(), null);
    else if (!terms.length && isPlainSymbol(origin.alternative.expr) && occurrence.children.length === 1) {
      const sole = occurrence.children[0];
      bag.splat(() => sole.bag(), null);
    }
    const declared = new Set(occurrence.captures.keys());
    for (const [index, term] of terms.entries()) {
      const shared = index === 0 && origin.rule.term === term;
      evaluator.bag(term.bag, { node: occurrence, captures: present(occurrence.captures), declared, shared, items: [], names: new Map(), document }, bag);
    }
    if (occurrence.erased) bag.write(["image", "value"], valued(""), null);
    return bag;
  }

  sourceOf(tokens, start, end) {
    if (start === end) {
      const at = this.emptySource(tokens, start);
      return [at, at];
    }
    let from = Infinity, to = -Infinity;
    for (let index = start; index < end; index++) {
      from = Math.min(from, tokens[index].source[0]);
      to = Math.max(to, tokens[index].source[1]);
    }
    return [from, to];
  }

  emptySource(tokens, at) {
    if (at > 0) return tokens[at - 1].source[1];
    return tokens.length ? tokens[0].source[0] : 0;
  }

  /** The tokens that the root hands on (part 1 §10). */
  publish(root, data) {
    const mask = this.outputMask(data);
    data.outputKeys = mask;
    const tokens = [];
    const synthetic = [];
    // A rule with no %emit hands on what its children hand on. Such chains
    // can be as deep as the text, so the walk uses its own stack.
    const outputs = (start) => {
      const result = [];
      const stack = [start];
      while (stack.length) {
        const node = stack.pop();
        if ((node.kind !== "rule" && node.kind !== "splice") || node.erased) continue;
        if (!node.origin?.rule.emit) {
          for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]);
          continue;
        }
        for (const entry of emitted(node)) result.push(entry);
      }
      return result;
    };
    const emitted = (node) => {
      const emit = node.origin.rule.emit;
      if (!emit.items.length) {
        if (node.kind !== "splice") return [{ node, token: this.token(node, node, data, mask) }];
        // A splice has no node to publish, so bare emission makes one at
        // the place of the call, with the whole bag of the call.
        const projection = new Occurrence("projection", { producer: node, part: node, item: 0, span: node.span, source: node.source });
        projection.makeBag = () => node.bag();
        synthetic.push(projection);
        return [{ node: projection, token: this.token(projection, node, data, mask) }];
      }
      const list = [];
      const scope = { node, captures: present(node.captures), declared: new Set(node.captures.keys()), items: [], names: new Map(), document: node.origin.document };
      emit.items.forEach((item, itemIndex) => {
        if (!item.gates.every(gate => data.features.has(gate.feature) !== gate.negated)) return;
        if (item.guard && !data.evaluator.truth(item.guard, scope)) return;
        if (item.insert) {
          const inserted = new Occurrence("insertion", { producer: node, item: itemIndex, span: null, source: null });
          inserted.makeBag = () => data.evaluator.bag(item.term.bag, scope);
          synthetic.push(inserted);
          list.push({ insertion: inserted });
          return;
        }
        const part = item.capture === "" ? node : scope.captures.get(item.capture);
        if (item.term === undefined) {
          const parts = Array.isArray(part) ? part : part ? [part] : [];
          for (const each of parts) for (const entry of outputs(each)) list.push(entry);
          return;
        }
        if (Array.isArray(part)) throw evaluationError("a braced item needs one node as its part", item.at, node.origin.document);
        const projection = new Occurrence("projection", { producer: node, part, item: itemIndex, span: part.span, source: part.source });
        projection.makeBag = () => {
          const bag = new Bag();
          bag.copy("value", () => part.bag(), null);
          bag.copy("image", () => part.bag(), null);
          return data.evaluator.bag(item.term.bag, scope, bag);
        };
        synthetic.push(projection);
        list.push({ node: projection, token: this.token(projection, part, data, mask) });
      });
      // An insertion stands at the start of the first token that the items
      // after it hand on, or at the end of the node.
      for (let index = list.length - 1, anchor = null; index >= 0; index--) {
        const entry = list[index];
        if (entry.insertion) {
          const inserted = entry.insertion;
          const at = anchor ? anchor.span[0] : node.span[1];
          const point = anchor ? anchor.source[0] : this.sourceOf(data.tokens, node.span[0], node.span[1])[1];
          const source = anchor ? [point, point] : (node.span[1] > node.span[0] ? [data.tokens[node.span[1] - 1].source[1], data.tokens[node.span[1] - 1].source[1]] : [point, point]);
          inserted.span = [at, at];
          inserted.source = source;
          list[index] = { node: inserted, token: this.token(inserted, inserted, data, mask, node.rule) };
        } else anchor = entry.token;
      }
      return list;
    };
    for (const { node, token } of outputs(root)) tokens.push(Object.assign(token, { node }));
    root.synthetic = synthetic;
    for (let index = 1; index < tokens.length; index++) {
      const previous = tokens[index - 1], current = tokens[index];
      if (current.span[0] < previous.span[1] && previous.span[0] < previous.span[1] && current.span[0] < current.span[1] ||
          current.span[0] < previous.span[0]) {
        throw new GencmuError("grammar", "two tokens have places that overlap or stand out of order");
      }
    }
    return tokens;
  }

  outputMask(data) {
    const value = data.evaluator.constantReference("OUTPUTS", null, { items: [], names: new Map() });
    if (!(value instanceof Bag)) throw new GencmuError("grammar", "$OUTPUTS must be a key set");
    return new Set([...value.keys(), "value", "image"]);
  }

  token(node, place, data, mask, insertedBy) {
    const bag = node.bag();
    const entries = [];
    for (const key of bag.keys()) {
      if (!mask.has(key)) continue;
      const entry = bag.entry(key);
      entries.push([key, entry === BARE ? BARE : valued(entry.deferred.force())]);
    }
    for (const key of ["value", "image"]) {
      const value = bag.value(key);
      if (typeof value !== "string") {
        throw new GencmuError("grammar", `the token of ${node.rule ?? node.producer?.rule ?? "a node"} has no ${key}`);
      }
    }
    const props = Bag.from(entries);
    const text = data.sourceText.slice(place.source[0], place.source[1]).join("");
    return new Token50({ text, props, span: place.span, source: place.source, insertedBy });
  }
}

/**
 * The scope of the recognizer's evaluator on a chosen derivation, as the
 * format 49 stage builds it for emission.
 */
class LateScope {
  constructor(node, context) {
    this.node = node;
    this.context = context;
  }

  treeIdentityOf(name) {
    if (name === "") return derivationIdentity(this.context, this.node, true);
    return derivationIdentity(this.context, capturedNode(this.node, name));
  }

  boundary() {
    throw new GencmuError("grammar", "the format 50 engine cannot yet test a neighbor after the choice of a parse");
  }

  capture(name) {
    const tagsOf = node => "read" in node ? this.context.tokens[node.read.token].tags : this.context.interner.get(node.item.tagId);
    if (name === "") {
      return { observation: this.node.item.observation, structure: workingStructure(this.context, this.node.item),
        patterns: this.context.patterns, start: this.node.start, end: this.node.end, tags: tagsOf(this.node) };
    }
    const production = this.node.production;
    const child = capturedNode(this.node, name);
    let captured = this.node.item.slots;
    while (captured && captured.index !== production.captureSlot.get(name)) captured = captured.parent;
    const observation = captured?.observation ?? ("read" in child
      ? terminalObservation(this.context, child.read.terminal, child.start)
      : child.item.observation);
    return { observation, structure: captured?.structure ?? ("read" in child ? structuralRead(this.context, child.read.terminal, child.start) : child.item.structure),
      patterns: this.context.patterns, start: child.start, end: child.end, tags: tagsOf(child) };
  }
}

function hasElided(root) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (node.kind === "elided") return true;
    for (const child of node.children) stack.push(child);
  }
  return false;
}

// A tree of the format 49 result as occurrences, for a displayed reading.
function fromResultTree(root) {
  const build = node => {
    if (node.kind === "token") return new Occurrence("token", { terminal: node.terminal, token: node.token, span: node.span, source: node.source });
    if (node.kind === "elided") {
      return new Occurrence("elided", { terminal: node.terminal, span: node.span, source: node.source,
        ...(node.value !== undefined ? { default: node.value } : {}) });
    }
    return new Occurrence("rule", { rule: node.rule, span: node.span, source: node.source, children: node.children.map(build) });
  };
  return build(root);
}

// A ranking action as the wire spells it in a witness.
function wireAction(action) {
  if (action.kind === "read") return { read: { token: action.token, terminal: action.terminal } };
  const { production, origin, end } = action.item;
  return { close: { rule: production.owner, production: production.sourceId ?? production.id, span: [origin, end] } };
}

function wireWitness(action) {
  if (action.kind === "read") return { read: { token: action.token, terminal: action.terminal } };
  if (action.kind === "elided") return { elided: { at: action.at, terminal: action.terminal } };
  return { close: { rule: action.rule, production: action.production, span: action.span } };
}

function present(captures) {
  const map = new Map();
  for (const [name, value] of captures) if (value !== null) map.set(name, value);
  return map;
}

function isOmission(derivation) {
  const production = derivation.production;
  return production.helper && production.elided && derivation.children.length === 0;
}

/**
 * The children of a rule derivation with its helpers expanded in place,
 * and the range of children that each capture binds.
 */
function expandHelpers(derivation) {
  const items = [];
  const bindings = [];
  const stack = [{ node: derivation, index: 0, open: [] }];
  while (stack.length) {
    const frame = stack.at(-1);
    if (frame.index >= frame.node.children.length) {
      stack.pop();
      for (const binding of frame.closing ?? []) binding.end = items.length;
      continue;
    }
    const index = frame.index++;
    const child = frame.node.children[index];
    const names = frame.node.production.captures.filter(capture => capture.index === index).map(capture => capture.name);
    if (!("read" in child) && child.production.helper && !child.production.spliceOf && !isOmission(child)) {
      const opened = names.map(name => ({ name, start: items.length, end: items.length }));
      for (const binding of opened) bindings.push(binding);
      stack.push({ node: child, index: 0, closing: opened });
      continue;
    }
    items.push(child);
    for (const name of names) bindings.push({ name, start: items.length - 1, end: items.length });
  }
  return { items, bindings };
}
