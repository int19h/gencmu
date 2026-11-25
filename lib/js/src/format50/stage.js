// @ts-nocheck
// One stage of a format 50 pipeline. The format 49 recognizer finds and
// ranks the derivations. This module builds the chosen tree of
// occurrences, gives each rule node its bag (engine §3.7) and publishes
// the selected nodes as tokens (engine §5).

import { GencmuError, runtimeGrammarError } from "../errors.js";
import { ParseContext, recognize, rootItems, rejectionOf } from "../earley.js";
import { Ranker, derivationTree } from "../rank.js";
import { restorationForest } from "../restoration-forest.js";
import { canCountProfiles, requiresElided } from "../ranking-patterns.js";
import { RankedAdmission } from "../ranked-admission.js";
import { Token as RecognizerToken } from "../tokens.js";
import { compareCodePoints } from "../tags.js";
import { BARE, Bag, valued } from "./bag.js";
import { Evaluator, Occurrence, Span, evaluationError } from "./evaluate.js";
import { PRIMARY_CAPTURE, isVisibleKey } from "./bridge.js";

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
  constructor(name, grammar, origins, constants) {
    this.name = name;
    this.grammar = grammar;
    this.origins = origins;
    this.constants = constants;
    this.publishes = constants.has("OUTPUTS");
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
    let lowered, context, chart, roots;
    const recognizerTokens = tokens.map(token => token.recognizerToken());
    try {
      lowered = this.grammar.lower(options.features);
      context = new ParseContext(lowered, recognizerTokens, sourceText, unicode);
      chart = recognize(context, "text", 0, recognizerTokens.length);
      roots = rootItems(chart, "text");
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
    const data = this.stageData(tokens, sourceText, options);
    if (ranking.verdict === "tie") {
      report.verdict = "tie";
      report.readings = [ranking.first, ranking.second].map(rope => this.tree(derivationTree(rope), data, context));
      report.error = { kind: "ambiguous", stage: this.name, reason: "tie", message: `the ${this.name} stage's text has two best readings, a tie` };
      return report;
    }
    report.verdict = ranking.verdict;
    const root = this.tree(derivationTree(ranking.first), data, context);
    report.root = root;
    if (!this.publishes) return report;
    try {
      report.output = this.publish(root, data);
      report.outputKeys = data.outputKeys;
    } catch (error) {
      if (!(error instanceof GencmuError)) throw error;
      report.output = null;
      report.error = runtimeGrammarError(error.withLocation({ stage: undefined }), this.name);
    }
    return report;
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
      ...(production.elidedValue !== undefined ? { default: production.elidedValue } : {}),
    });
    occurrence.makeBag = () => Bag.from([[production.elided, BARE], ["image", valued("")], ["value", valued(value)]]
      .sort((a, b) => compareCodePoints(a[0], b[0])));
    return occurrence;
  }

  ruleOccurrence(derivation, parts, made, data) {
    const production = derivation.production;
    const origin = this.origins.get((production.logicalSource ?? production.source)?.origin50);
    const children = parts.items.map(item => made.get(item));
    const occurrence = new Occurrence("rule", {
      rule: production.lhs, span: [derivation.start, derivation.end],
      source: this.sourceOf(data.tokens, derivation.start, derivation.end),
      erased: production.erased, origin, children,
    });
    const kinds = origin ? captureKinds(origin.alternative.expr) : new Map();
    const captures = new Map();
    for (const [name, kind] of kinds) captures.set(name, kind === "one" ? null : []);
    let primary = null;
    for (const { name, start, end } of parts.bindings) {
      const nodes = children.slice(start, end);
      if (name === PRIMARY_CAPTURE || name === origin?.primary) primary = nodes[0] ?? null;
      if (name === PRIMARY_CAPTURE) continue;
      if (kinds.get(name) === "list") captures.get(name).push(...nodes);
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
        return evaluator.bagOf(evaluator.apply(fn, occurrence, origin.rule), origin.rule, { document });
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
        if (node.kind !== "rule" || node.erased) continue;
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
      if (!emit.items.length) return [{ node, token: this.token(node, node, data, mask) }];
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
          for (const each of parts) list.push(...outputs(each));
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
    if (!("read" in child) && child.production.helper && !isOmission(child)) {
      const opened = names.map(name => ({ name, start: items.length, end: items.length }));
      bindings.push(...opened);
      stack.push({ node: child, index: 0, closing: opened });
      continue;
    }
    items.push(child);
    for (const name of names) bindings.push({ name, start: items.length - 1, end: items.length });
  }
  return { items, bindings };
}
