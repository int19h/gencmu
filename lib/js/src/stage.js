// Running one stage: recognition, the choice of a parse, the result tree
// (engine §12), emission (engine §11) and elision-only (engine §7).

import { GencmuError } from "./errors.js";
import { ParseContext, recognize, rootItems, rejectionOf, evaluate, asSet, writtenSymbol } from "./earley.js";
import { Ranker, derivationTree } from "./rank.js";
import { maximalRule } from "./maximal.js";
import { Token, Sources, attached, hasAttachments } from "./tokens.js";
import { tagSet, compareCodePoints, isPhonemeTag } from "./tags.js";
import { foldTree } from "./walk.js";
import { fault, hooks } from "./testing.js";

/**
 * @import { Action, Derivation, DerivationRule, ElidedNode, EmitItem, ResultNode, Scope, Span, StageReport, TagSet } from "./types.js"
 * @import { Grammar } from "./grammar.js"
 * @import { UnicodeTable } from "./unicode.js"
 */

/**
 * The options of one stage's run.
 * @typedef {object} StageOptions
 * @property {Set<string>} features
 * @property {boolean | null | undefined} elisionOnly
 * @property {boolean} last whether this is the pipeline's last stage
 */

export class Stage {
  /**
   * @param {string} name
   * @param {Grammar} grammar
   */
  constructor(name, grammar) {
    this.name = name;
    this.grammar = grammar;
  }

  /**
   * Runs the stage over `tokens`.
   * @param {Token[]} tokens
   * @param {string[]} sourceText the original text as an array of code points
   * @param {UnicodeTable} unicode
   * @param {StageOptions} options
   * @returns {StageReport}
   */
  run(tokens, sourceText, unicode, options) {
    const features = options.features;
    /** @type {StageReport} */
    const report = { name: this.name, verdict: null, witness: null, output: null, tree: null, error: null };
    let lowered;
    let context;
    let chart;
    let roots;
    try {
      // Lowering for these features may itself find an error of the grammar
      // (engine §3.3), which is a result like any found while parsing.
      lowered = this.grammar.lower(features);
      context = new ParseContext(lowered, tokens, sourceText, unicode);
      chart = recognize(context, "text", 0, tokens.length);
      roots = rootItems(chart, "text");
    } catch (error) {
      if (error instanceof GencmuError) {
        report.error = { kind: "grammar", stage: this.name, message: error.message };
        return report;
      }
      throw error;
    }
    // An input whose every derivation is cyclic (engine §4) has none to
    // count, and is rejected like one with no item of `text` at all.
    const resolution = lowered.resolution;
    // Maximality: stage-wide, or for the maximal terminators alone, before
    // the ranking (engine §4).
    const maximal = resolution.maximal || lowered.maximalTerminals.size > 0 ? maximalRule(chart, lowered, resolution.maximal) : null;
    const ranking = roots.length === 0 ? null : new Ranker(tokens, resolution.lean, maximal).rank(roots);
    if (ranking === null) {
      // A text that maximal leaves with no derivation is rejected at the
      // first terminator it forbids in the first reading, m, of the ranking
      // without maximal, whatever its verdict (engine §4).
      const rejection = (maximal && roots.length > 0 && forbiddenTerminator(new Ranker(tokens, resolution.lean).rank(roots), maximal))
        || rejectionOf(chart);
      report.error = {
        kind: "rejected",
        stage: this.name,
        token: rejection.position,
        source: sourceAt(tokens, rejection.position),
        expected: rejection.expected,
        message: `the ${this.name} stage could not continue at token ${rejection.position}` +
          (rejection.expected.length ? `; expected ${rejection.expected.map((e) => e.terminal).join(", ")}` : ""),
      };
      return report;
    }
    if (ranking.verdict === "tie") {
      // A tie is an error: the stage keeps its verdict and witness, has no
      // chosen tree, no output and no warnings, and the error holds the
      // first and the second reading (engine §6). A tie always has a second
      // derivation, and so a witness.
      const readings = [ranking.first, /** @type {import("./types.js").Rope} */ (ranking.second)]
        .map((rope) => resultTree(derivationTree(rope), context)[0]);
      Object.assign(report, {
        verdict: "tie",
        witness: witnessOf(/** @type {[Action | null, Action | null]} */ (ranking.witness)),
      });
      report.error = {
        kind: "ambiguous",
        stage: this.name,
        reason: "tie",
        readings,
        message: `the ${this.name} stage's text has two best readings, a tie`,
      };
      return report;
    }
    Object.assign(report, { verdict: ranking.verdict, witness: null });
    const derivation = derivationTree(ranking.first);
    report.tree = resultTree(derivation, context)[0];
    report.warnings = warningsOf(derivation, context, features, this.name);
    try {
      report.output = emit(derivation, context);
    } catch (error) {
      if (error instanceof GencmuError) {
        report.error = { kind: "grammar", stage: this.name, message: error.message };
        return report;
      }
      throw error;
    }
    const elisionOnly = options.elisionOnly === undefined || options.elisionOnly === null
      ? lowered.resolution.elisionOnly : options.elisionOnly;
    // The check runs only for a stage that chose one of several
    // derivations (engine §7.1).
    if (elisionOnly && report.verdict === "resolved") {
      /** @type {ElisionCheck} */
      let check;
      try {
        check = this.elisionCheck(derivation, report.tree, context, features);
      } catch (error) {
        // An error of the grammar in the check ends the stage as one found
        // while emitting does: no output, the rest kept (engine §7.7).
        if (error instanceof GencmuError) {
          if (fault("F26")) return report;
          report.output = null;
          report.error = { kind: "grammar", stage: this.name, message: error.message };
          return report;
        }
        throw error;
      }
      if (check.competitorWarnings) report.warnings = [...(report.warnings || []), ...check.competitorWarnings];
      if (check.kind === "lost") {
        // The witness of the chosen derivation is lost: a defect of the
        // engine, which ends the stage with no output (engine §7.9).
        report.output = null;
        report.error = {
          kind: "grammar",
          stage: this.name,
          code: "elision-witness-lost",
          message: `the ${this.name} stage could not reconstruct its chosen derivation for elision-only`,
          chosen: report.tree,
          completion: check.completion,
        };
      } else if (check.kind === "ambiguous") {
        report.error = {
          kind: "ambiguous",
          stage: this.name,
          reason: "elision-only",
          readings: check.readings,
          message: `the ${this.name} stage's text is ambiguous with every elided terminator written out`,
        };
      }
    }
    return report;
  }

  /**
   * Engine §7: the check of elision-only. It writes the chosen derivation's
   * elided terminators back into the stage's input as synthetic tokens and
   * recognizes that input, R, with the main lowering in the reconstruction
   * mode. Every observation reads the stage's input through the projection
   * π. The check passes where R has one derivation, and gives two readings
   * where it has more. With none, the witness of the chosen derivation is
   * lost.
   * @param {Derivation} chosen D, the chosen derivation
   * @param {ResultNode} tree D's tree
   * @param {ParseContext} main the context of the main parse, whose memo
   *   the check's queries share
   * @param {Set<string>} features
   * @returns {ElisionCheck}
   */
  elisionCheck(chosen, tree, main, features) {
    const tokens = main.tokens;
    const lowered = main.lowered;
    // The old contract, as a whole (a fault, F13): every elidable optional
    // mandatory, observations of R itself, and no reading a pass.
    const old = fault("F13");
    /** @type {ElidedNode[]} */
    const elided = [];
    // In text order: the leaves left to right (engine §7.2).
    const pending = [tree];
    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
      if (node.kind === "elided") elided.push(node);
      if (node.kind === "rule") for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]);
    }
    /** @type {RestorationRecord[]} */
    const records = elided.map((node) => {
      /** @type {RestorationRecord} */
      const record = { terminal: node.terminal, at: node.span[0], source: [node.source[0], node.source[1]] };
      if (node.sound !== undefined) record.sound = node.sound;
      return record;
    });
    // The order of insertion: the records' own, or, under a fault, each run
    // at one position reversed (F27).
    let order = records.map((_, index) => index);
    if (fault("F27:order")) {
      order = [];
      for (let index = 0; index < records.length;) {
        let end = index;
        while (end < records.length && records[end].at === records[index].at) end++;
        for (let at = end - 1; at >= index; at--) order.push(at);
        index = end;
      }
    }
    // R: the stage's input with one synthetic token before the input token
    // at each record's position, or at the end. A synthetic token's
    // recognition tags are its terminal, and its recognition sound is its
    // saved sound. Its provenance, kept apart, is what marks it (engine
    // §7.2), unless a fault tells it by an empty source (F12).
    /** @type {Token[]} */
    const restored = [];
    /** @type {boolean[]} */
    const synthetic = [];
    /** @type {number[]} */
    const originalAt = [];
    /** @type {number[]} */
    const recordAt = new Array(records.length);
    /** @type {(number | undefined)[]} */
    const recordOf = [];
    let next = 0;
    for (let index = 0; index <= tokens.length; index++) {
      while (next < order.length && records[order[next]].at === index) {
        const record = records[order[next++]];
        recordAt[order[next - 1]] = restored.length;
        recordOf.push(order[next - 1]);
        synthetic.push(true);
        restored.push(new Token(tagSet([record.terminal]), [restored.length, restored.length], [record.source[0], record.source[1]], "", record.sound ?? null, undefined));
      }
      if (index < tokens.length) {
        const token = tokens[index];
        originalAt.push(restored.length);
        recordOf.push(undefined);
        synthetic.push(fault("F12") && token.source[0] === token.source[1]);
        restored.push(token);
      }
    }
    // π: the number of original tokens before each position of R (engine
    // §7.3).
    /** @type {number[]} */
    const project = [0];
    for (let index = 0; index < restored.length; index++) project.push(project[index] + (synthetic[index] ? 0 : 1));
    const r = new ParseContext(lowered, restored, main.sourceText, main.unicode, main.interner);
    r.mode = old ? "mandatory" : "reconstruction";
    r.synthetic = synthetic;
    r.recon = { observed: main, project, raw: old, faulty: new Map() };
    // The recognition of R is not a query (engine §4, §7.6), unless a fault
    // makes it one (F18).
    const active = "parse\u0001text\u00010\u0001" + tokens.length;
    const asQuery = (old || fault("F18")) && !main.inProgress.has(active);
    if (asQuery) main.inProgress.add(active);
    let chart;
    main.checking = true;
    try {
      chart = recognize(r, "text", 0, restored.length);
    } finally {
      main.checking = false;
      if (asQuery) main.inProgress.delete(active);
    }
    let roots = rootItems(chart, "text");
    if (fault("lost:roots")) roots = [];
    // Neither form of maximality applies to the derivations of R (engine
    // §7.7), unless a fault applies them (F20). Cycles are over spans of R,
    // unless a fault finds them over projected spans (F19).
    const maximal = fault("F20") && (lowered.resolution.maximal || lowered.maximalTerminals.size > 0)
      ? maximalRule(chart, lowered, lowered.resolution.maximal) : null;
    let ranking = roots.length === 0 ? null : new Ranker(restored, "none", maximal, fault("F19") ? project : null).rank(roots);
    if (fault("lost:count")) ranking = null;
    if (fault("F23")) {
      // A fault leaves the main grammar in the mode of the check.
      for (const [name, productions] of lowered.byLhs) {
        lowered.byLhs.set(name, productions.filter((production) => !(production.rhs.length === 0 && production.helper && production.elided !== null)));
      }
    }
    if (hooks.elisionCheck) hooks.elisionCheck({ chosen, chart, roots, synthetic, originalAt, recordAt });
    if (ranking === null) return old ? { kind: "pass" } : { kind: "lost", completion: records };
    if (ranking.verdict !== "tie") return { kind: "pass" };
    // The readings, mapped to the stage's input (engine §7.10).
    const original = new Sources(tokens);
    /** @type {Map<string, TagSet>} */
    const chosenTags = new Map();
    if (fault("F8")) {
      foldTree(tree, () => null, (node) => {
        chosenTags.set(`${node.rule}\u0000${node.span[0]}\u0000${node.span[1]}`, node.tags);
        return null;
      });
    }
    /** @type {(root: ResultNode) => ResultNode} */
    const remap = (root) => foldTree(root,
      /** @returns {ResultNode} */
      (node) => {
        if (node.kind === "token" && synthetic[node.token]) {
          // A read of a synthetic token is an elided node of its record's
          // terminal, at the record's position, with the record's source.
          const at = project[node.token];
          const index = recordOf[node.token];
          if (fault("F27:bare")) return { kind: "token", terminal: node.terminal, token: at, span: [at, at + 1], source: node.source };
          if (index === undefined) return { kind: "elided", terminal: node.terminal, span: [at, at], source: node.source };
          const record = records[index];
          /** @type {ElidedNode} */
          const result = { kind: "elided", terminal: record.terminal, span: [at, at], source: [record.source[0], record.source[1]] };
          if (record.sound !== undefined) result.sound = record.sound;
          return result;
        }
        if (node.kind === "token") return { ...node, token: project[node.token], span: [project[node.span[0]], project[node.span[0]] + 1] };
        return node;
      },
      /** @returns {ResultNode} */
      (node, children) => {
        const start = project[node.span[0]];
        const end = project[node.span[1]];
        const tags = chosenTags.get(`${node.rule}\u0000${start}\u0000${end}`) || node.tags;
        return { ...node, span: [start, end], source: sourceOf(original, start, end), tags, children };
      });
    const ropes = [ranking.first, /** @type {import("./types.js").Rope} */ (ranking.second)];
    /** @type {ElisionCheck} */
    const result = { kind: "ambiguous", readings: ropes.map((rope) => remap(resultTree(derivationTree(rope), r)[0])) };
    // A competing reading gives no warning (engine §7.10), unless a fault
    // takes its warnings (F22).
    if (fault("F22")) result.competitorWarnings = warningsOf(derivationTree(ropes[1]), r, features, this.name);
    return result;
  }
}

/**
 * A restoration record (engine §7.2): the terminal, its position in the
 * stage's input, the empty source of its elided node, and the saved sound
 * of a terminator with an `=` test.
 * @typedef {{terminal: string, at: number, source: Span, sound?: string}} RestorationRecord
 */

/**
 * What the check of engine §7 found: one reading, two, or none.
 * @typedef {({kind: "pass"} | {kind: "ambiguous", readings: ResultNode[]} | {kind: "lost", completion: RestorationRecord[]})
 *   & {competitorWarnings?: import("./types.js").ParseWarning[]}} ElisionCheck
 */

/**
 * @param {Token[]} tokens
 * @param {number} position
 * @returns {Span}
 */
function sourceAt(tokens, position) {
  if (position < tokens.length) return [tokens[position].source[0], tokens[position].source[1]];
  const end = tokens.length ? tokens[tokens.length - 1].source[1] : 0;
  return [end, end];
}

// Where an empty span at token index `at` lies in the source.
/**
 * @param {Token[]} tokens
 * @param {number} at
 * @returns {number}
 */
function emptySource(tokens, at) {
  if (at > 0) return tokens[at - 1].source[1];
  return tokens.length ? tokens[0].source[0] : 0;
}

// The source of tokens [start, end): the source of the tokens (engine §1),
// or, for an empty span, the point where it lies (engine §12).
/**
 * @param {Sources} sources
 * @param {number} start
 * @param {number} end
 * @returns {Span}
 */
function sourceOf(sources, start, end) {
  if (start >= end) {
    const position = emptySource(sources.tokens, start);
    return [position, position];
  }
  return sources.of(start, end);
}

/**
 * @param {Derivation} node
 * @param {ParseContext} context
 * @returns {TagSet}
 */
function nodeTags(node, context) {
  if ("read" in node) return context.tokens[node.read.token].tags;
  return context.interner.get(node.item.tagId);
}

// The nodes of a left-recursive chain, from the top down: a node whose first
// child is a node of the same production's left side, as `r ≔ r x` and the
// helper of `x ...` make. Walking them in a loop keeps the walks of a long
// text from nesting as deep as the text is long.
/**
 * @param {DerivationRule} node
 * @returns {DerivationRule[]}
 */
function spine(node) {
  const chain = [node];
  let current = node;
  while (current.children.length > 0) {
    const first = current.children[0];
    if ("read" in first || first.production.lhs !== current.production.lhs) break;
    chain.push(first);
    current = first;
  }
  return chain;
}

// The result tree of a derivation (engine §12), as a list: a spliced node
// yields its children.
/**
 * The children a node's result is built from, in order: a node's own, or,
 * for a repetition's helper and a rule's left-recursive prefix, those of
 * the whole chain, the bottom node's first.
 * @param {DerivationRule} node
 * @returns {Derivation[]}
 */
function orderedChildren(node) {
  const production = node.production;
  if (!production.helper && !production.recursivePrefix) return node.children;
  let chain = spine(node);
  if (!production.helper) chain = chain.filter((member, index, all) => index === 0 || all[index - 1].production.recursivePrefix);
  /** @type {Derivation[]} */
  const result = [];
  for (let index = chain.length - 1; index >= 0; index--) {
    const own = chain[index].children;
    for (let at = index === chain.length - 1 ? 0 : 1; at < own.length; at++) result.push(own[at]);
  }
  return result;
}

/**
 * The warnings of a chosen derivation (engine §12): each rule node of its
 * tree gives one for each warning of its alternative whose feature is on, in
 * the order a walk meets the nodes, parent before children and children left
 * to right. The walk splices helpers and the prefixes of a trailing
 * repetition as the tree does, with its own stack for the same reason.
 * @param {Derivation} root
 * @param {ParseContext} context
 * @param {Set<string>} features
 * @param {string} stage
 * @returns {import("./types.js").ParseWarning[]}
 */
function warningsOf(root, context, features, stage) {
  /** @type {import("./types.js").ParseWarning[]} */
  const warnings = [];
  /** @type {Derivation[]} */
  const stack = [root];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if ("read" in node) continue;
    const production = node.production;
    if (!production.helper) {
      for (const feature of production.warnings) {
        if (features.has(feature)) {
          warnings.push({ stage, feature, rule: production.lhs, span: [node.start, node.end], source: sourceOf(context.sources, node.start, node.end) });
        }
      }
    }
    const children = orderedChildren(node);
    for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
  }
  return warnings;
}

/**
 * Of a ranking's first reading, the first elided terminator, in the order
 * of the tree's leaves, that maximal forbids: its position, and its terminal
 * with the rule its optional is written in as the one expected there (engine
 * §4). Null for no ranking, or none forbidden.
 * @param {import("./rank.js").Ranking | null} ranking
 * @param {import("./maximal.js").Maximal} maximal
 * @returns {{position: number, expected: import("./types.js").Expectation[]} | null}
 */
function forbiddenTerminator(ranking, maximal) {
  if (ranking === null) return null;
  /** @type {{node: Derivation, next: number}[]} */
  const stack = [{ node: derivationTree(ranking.first), next: 0 }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const node = frame.node;
    if ("read" in node || frame.next >= node.children.length) {
      stack.pop();
      continue;
    }
    const index = frame.next++;
    const child = node.children[index];
    if (!("read" in child) && maximal.elided(child.item)) {
      const rhs = node.production.rhs;
      const own = index === 1 && !rhs[0].terminal && rhs[0].name === node.production.lhs;
      const before = index > 0 && !own ? node.children[index - 1] : null;
      if (before && !("read" in before) && maximal.forbids(before.item, rhs[index - 1].test)) {
        const production = child.production;
        const terminal = /** @type {string} */ (production.elided);
        const written = writtenSymbol({ name: terminal, test: production.elidedTest });
        return { position: child.start, expected: [{ terminal: written, rules: [production.owner] }] };
      }
    }
    stack.push({ node: child, next: 0 });
  }
  return null;
}

/**
 * The result tree of a derivation (engine §12), as a list: a spliced node
 * yields its children. The walk keeps its own stack, since a right-recursive
 * rule over a long text, such as paragraphs joined by `ni'o`, nests as deep
 * as the text is long.
 * @param {Derivation} root
 * @param {ParseContext} context
 * @returns {ResultNode[]}
 */
export function resultTree(root, context) {
  const tokens = context.tokens;
  /** @typedef {{node: Derivation, children: Derivation[] | null, next: number, out: ResultNode[]}} TreeFrame */
  /** @type {TreeFrame[]} */
  const stack = [{ node: root, children: null, next: 0, out: [] }];
  /** @type {ResultNode[]} */
  let result = [];
  /** @param {ResultNode[]} list */
  const finish = (list) => {
    stack.pop();
    if (stack.length === 0) {
      result = list;
      return;
    }
    const out = stack[stack.length - 1].out;
    for (const item of list) out.push(item);
  };
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const node = frame.node;
    if ("read" in node) {
      finish([{ kind: "token", terminal: node.read.terminal, token: node.read.token, span: [node.start, node.end], source: sourceOf(context.sources, node.start, node.end) }]);
      continue;
    }
    const production = node.production;
    if (frame.children === null) {
      if (production.helper && production.elided && node.children.length === 0) {
        const position = emptySource(tokens, node.start);
        /** @type {ElidedNode} */
        const elided = { kind: "elided", terminal: production.elided, span: [node.start, node.start], source: [position, position] };
        // The string of an `=` test is kept for elision-only's restored
        // token; the output does not show it (engine §7).
        if (production.elidedTest && production.elidedTest.op === "=" && production.elidedTest.sound !== undefined) elided.sound = production.elidedTest.sound;
        finish([elided]);
        continue;
      }
      frame.children = orderedChildren(node);
    }
    if (frame.next < frame.children.length) {
      stack.push({ node: frame.children[frame.next++], children: null, next: 0, out: [] });
      continue;
    }
    if (production.helper) {
      finish(frame.out);
      continue;
    }
    finish([{
      kind: "rule",
      rule: production.lhs,
      span: [node.start, node.end],
      source: sourceOf(context.sources, node.start, node.end),
      tags: nodeTags(node, context),
      children: frame.out,
    }]);
  }
  return result;
}

/**
 * A witness as plain data of the result's own: an action that closes a
 * production names it by its rule and number, and holds no chart item.
 * @param {[Action | null, Action | null]} actions
 * @returns {import("./types.js").Witness}
 */
function witnessOf(actions) {
  /** @type {(action: Action | null) => import("./types.js").WitnessAction | null} */
  const plain = (action) => {
    if (action === null) return null;
    if (action.kind === "read") return { kind: "read", token: action.token, terminal: action.terminal };
    const { production, origin, end } = action.item;
    return { kind: "close", rule: production.owner, production: production.id, helper: production.helper, span: [origin, end] };
  };
  return [plain(actions[0]), plain(actions[1])];
}

/** @implements {Scope} */
class TreeScope {
  /**
   * @param {DerivationRule} node
   * @param {ParseContext} context
   */
  constructor(node, context) {
    this.node = node;
    this.context = context;
  }
  /** @param {string} name */
  capture(name) {
    if (name === "") return { start: this.node.start, end: this.node.end, tags: nodeTags(this.node, this.context) };
    const capture = /** @type {import("./types.js").Capture} */ (this.node.production.captures.find((entry) => entry.name === name));
    const child = this.node.children[capture.index];
    return { start: child.start, end: child.end, tags: nodeTags(child, this.context) };
  }
}

/**
 * @param {TagSet} tags
 * @returns {string | null}
 */
function phonemeTag(tags) {
  /** @type {string[]} */
  const found = [];
  for (const tag of tags) if (isPhonemeTag(tag)) found.push(tag);
  if (found.length > 1) {
    throw new GencmuError("grammar", `a token carries two phoneme tags, ${found.sort(compareCodePoints).join(" and ")}`);
  }
  return found.length ? [...found[0]][1] : null;
}

/**
 * The source and the text of an opaque part (engine §11).
 * @typedef {{source: Span, text: string}} OpaquePart
 */

/**
 * The opaque parts of a chosen derivation, with their sources and texts
 * (engine §11): the constituents of `%opaque` productions inside no
 * constituent that emits `ε` and no other opaque part. The stage fixes them
 * before it emits anything, so that every token over a part holds the same
 * text. The walk keeps its own stack, as the tree's does.
 * @param {Derivation} root
 * @param {ParseContext} context
 * @returns {Map<Derivation, OpaquePart>}
 */
function opaqueParts(root, context) {
  /** @type {DerivationRule[]} */
  const parts = [];
  const stack = [root];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if ("read" in node || countsForNothing(node.production)) continue;
    if (node.production.opaque) {
      parts.push(node);
      continue;
    }
    for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]);
  }
  const tokens = context.tokens;
  // Text between two input tokens belongs to the part with a non-empty span
  // that ends there, before one that starts there.
  const ends = new Set(parts.filter((part) => part.start < part.end).map((part) => part.end));
  /** @type {Map<Derivation, OpaquePart>} */
  const result = new Map();
  for (const part of parts) {
    if (part.start === part.end) {
      // An empty part takes in no text. Its source is that of an empty node.
      result.set(part, { source: sourceOf(context.sources, part.start, part.end), text: "" });
      continue;
    }
    const before = part.start > 0 ? tokens[part.start - 1].source[1] : 0;
    // It always holds its own tokens' sources, which the tokens next to it
    // may share, and takes in the text next to it that no input token covers.
    const own = sourceOf(context.sources, part.start, part.end);
    const start = ends.has(part.start) ? own[0] : Math.min(own[0], before);
    const after = part.end < tokens.length ? tokens[part.end].source[0] : context.sourceText.length;
    const end = Math.max(own[1], after);
    result.set(part, { source: [start, end], text: context.sourceText.slice(start, end).join("") });
  }
  return result;
}

/**
 * A join of the phonemes or of the labels of a token's parts (engine §5): a
 * part with an empty string is left out, of each run of adjacent pause parts
 * only the first is kept, and a pause part at either end is left out. Pauses
 * are counted by part, so a part keeps its own periods and spaces.
 */
class Join {
  constructor() {
    /** @type {string[]} */
    this.pieces = [];
    this.pause = false;
  }
  /**
   * @param {string} piece
   * @param {boolean} pause whether the part is a pause part
   */
  add(piece, pause) {
    if (piece === "") return;
    if (pause && (this.pieces.length === 0 || this.pause)) return;
    this.pieces.push(piece);
    this.pause = pause;
  }
  /** @returns {string} */
  result() {
    if (this.pause) this.pieces.pop();
    return this.pieces.join("");
  }
}

// What a node says and shows: the phonemes and the labels of its parts,
// joined (engine §5, §11). A part is a read input token or an opaque part.
// Nothing inside a constituent that does not count is a part, and the walk
// does not enter an opaque part.
/**
 * @param {Derivation} node
 * @param {ParseContext} context
 * @param {Map<Derivation, OpaquePart>} opaque
 * @returns {{phonemes: string, label: string}}
 */
function spoken(node, context, opaque) {
  const phonemes = new Join();
  const label = new Join();
  const stack = [node];
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    if ("read" in current) {
      const token = context.tokens[current.read.token];
      const sound = token.phonemes || "";
      phonemes.add(sound, sound === ".");
      label.add(token.label, sound === ".");
      continue;
    }
    if (countsForNothing(current.production)) continue;
    const part = opaque.get(current);
    if (part) {
      phonemes.add("?", false);
      label.add(part.text, false);
      continue;
    }
    for (let index = current.children.length - 1; index >= 0; index--) stack.push(current.children[index]);
  }
  return { phonemes: phonemes.result(), label: label.result() };
}

/**
 * Whether a production's constituent does not count: its emission is `ε`
 * (engine §11).
 * @param {import("./types.js").Production} production
 * @returns {boolean}
 */
function countsForNothing(production) {
  return production.emit !== null && production.emit.items.length === 0;
}

/**
 * The phonemes and the label of a phoneme tag `/p/` (engine §5): `p` and
 * `p`, but a space for the label of the pause.
 * @param {string} phoneme
 * @returns {{phonemes: string, label: string}}
 */
function sounded(phoneme) {
  return { phonemes: phoneme, label: phoneme === "." ? " " : phoneme };
}

/**
 * What one derivation's emission needs: the parse, its opaque parts, and
 * whether any input token has attachments to forward (engine §11).
 * @typedef {object} Emitter
 * @property {ParseContext} context
 * @property {Map<Derivation, OpaquePart>} opaque the derivation's opaque
 *   parts
 * @property {boolean} forwards whether any input token has attachments
 * @property {Set<import("./tokens.js").AttachedToken>} inherited the input
 *   tokens whose attachments a token of this emission has inherited
 */

/**
 * @param {Derivation} node
 * @param {TagSet} explicit the tags that the emission gives the token
 * @param {Emitter} emitter
 * @returns {Token}
 */
function makeToken(node, explicit, emitter) {
  const { context, opaque } = emitter;
  // The stage's implications apply before the phonemes and the label
  // (engine §11).
  const tags = implied(explicit, context.lowered.implications);
  // Two phoneme tags are an error on any token (engine §5).
  const phoneme = phonemeTag(tags);
  // A token over an opaque part has the part's source and text (engine §11).
  const part = opaque.get(node);
  const source = part ? part.source : sourceOf(context.sources, node.start, node.end);
  const text = part ? part.text : context.sourceText.slice(source[0], source[1]).join("");
  // A phoneme tag decides the sound and the label, over `?` (engine §5).
  const said = phoneme !== null ? sounded(phoneme) : spoken(node, context, opaque);
  const token = new Token(tags, [node.start, node.end], source, text, said.phonemes, undefined, said.label);
  // The parts decide the attachments too, after the phoneme tags are
  // checked (engine §11).
  const from = emitter.forwards ? forwarded(node, context, opaque) : null;
  if (from) {
    // Attachments belong to one token: an input token that is the one part
    // of a second token is an error of the grammar (engine §11).
    if (emitter.inherited.has(from)) {
      throw new GencmuError("grammar", "a token with attachments is the one part of two emitted tokens, and its attachments cannot belong to both");
    }
    emitter.inherited.add(from);
    token.before = from.before;
    token.after = from.after;
  }
  return token;
}

/**
 * The one input token whose attachments a token over `node` inherits, or
 * null (engine §11). The parts are those of the join (engine §5): a read
 * input token, or an opaque part as one piece, and nothing inside a
 * constituent that emits `ε`. A token with attachments among other parts,
 * or an opaque part that holds one, is an error of the grammar.
 * @param {Derivation} node
 * @param {ParseContext} context
 * @param {Map<Derivation, OpaquePart>} opaque
 * @returns {import("./tokens.js").AttachedToken | null}
 */
function forwarded(node, context, opaque) {
  let parts = 0;
  /** @type {import("./tokens.js").AttachedToken | null} */
  let found = null;
  const stack = [node];
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    if ("read" in current) {
      parts++;
      const token = context.tokens[current.read.token];
      if (hasAttachments(token)) found = token;
      continue;
    }
    if (countsForNothing(current.production)) continue;
    if (opaque.has(current)) {
      parts++;
      if (holdsAttachments(current, context)) {
        throw new GencmuError("grammar", `${current.production.owner} is an opaque part over a token with attachments, which a token over it cannot place`);
      }
      continue;
    }
    for (let index = current.children.length - 1; index >= 0; index--) stack.push(current.children[index]);
  }
  if (found && parts > 1) {
    throw new GencmuError("grammar", "a token over a token with attachments and another part cannot say which part each attachment belongs to");
  }
  return found;
}

/**
 * Whether an opaque part holds an input token with attachments: one that it
 * reads outside any constituent that emits `ε` (engine §11).
 * @param {Derivation} node
 * @param {ParseContext} context
 * @returns {boolean}
 */
function holdsAttachments(node, context) {
  const stack = [node];
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    if ("read" in current) {
      if (hasAttachments(context.tokens[current.read.token])) return true;
      continue;
    }
    if (countsForNothing(current.production)) continue;
    for (let index = current.children.length - 1; index >= 0; index--) stack.push(current.children[index]);
  }
  return false;
}

/**
 * @param {string} tag
 * @param {number} at
 * @param {DerivationRule} node
 * @param {ParseContext} context
 * @param {string} owner
 * @returns {Token}
 */
function insertedToken(tag, at, node, context, owner) {
  const tokens = context.tokens;
  const position = at > node.start ? tokens[at - 1].source[1] : sourceOf(context.sources, node.start, node.end)[0];
  const tags = implied(tagSet([tag]), context.lowered.implications);
  // An inserted token has no parts: a phoneme tag gives its phonemes and its
  // label, or both are empty (engine §5).
  const phoneme = phonemeTag(tags);
  const said = phoneme !== null ? sounded(phoneme) : { phonemes: "", label: "" };
  return new Token(tags, [at, at], [position, position], "", said.phonemes, owner, said.label);
}

/**
 * A token's explicit tags with the tags of the stage's implications, added
 * until no tag changes (engine §11). An implication only adds tags, so the
 * loop ends, also over a cycle.
 * @param {TagSet} tags
 * @param {{if: TagSet, then: TagSet}[]} implications
 * @returns {TagSet}
 */
function implied(tags, implications) {
  let result = tags;
  for (let changed = implications.length > 0; changed;) {
    changed = false;
    for (const implication of implications) {
      let meets = false;
      for (const tag of implication.if) {
        if (result.has(tag)) {
          meets = true;
          break;
        }
      }
      if (!meets) continue;
      for (const tag of implication.then) {
        if (result.has(tag)) continue;
        if (result === tags) result = new Set(tags);
        result.add(tag);
        changed = true;
      }
    }
  }
  return result;
}

// The tokens a derivation emits for the next stage (engine §11). The walk
// keeps its own stack of tasks, in text order, rather than recursing. So
// attachments nest as deep as the text is long: each attachment's tokens
// gather in a list of their own on a stack of lists.
/**
 * @typedef {{walk: Derivation} | {run: () => void}} EmitTask
 */

/**
 * @param {Derivation} root
 * @param {ParseContext} context
 * @returns {Token[]}
 */
export function emit(root, context) {
  // The opaque parts and their texts, fixed before any token (engine §11).
  const opaque = opaqueParts(root, context);
  return emitted(root, { context, opaque, forwards: context.tokens.some(hasAttachments), inherited: new Set() });
}

/**
 * The tokens the root of a derivation emits (engine §11), with the
 * attachments of its captured parts.
 * @param {Derivation} root
 * @param {Emitter} emitter
 * @returns {Token[]}
 */
function emitted(root, emitter) {
  const { context, opaque } = emitter;
  // The tokens emitted so far: the output, and above it the attachments
  // being gathered, the innermost last.
  /** @type {Token[][]} */
  const lists = [[]];
  /** @type {(token: Token) => void} */
  const put = (token) => lists[lists.length - 1].push(token);
  /** @type {EmitTask[]} */
  const tasks = [{ walk: root }];
  for (let task = tasks.pop(); task !== undefined; task = tasks.pop()) {
    if ("run" in task) {
      task.run();
      continue;
    }
    const node = task.walk;
    if ("read" in node) continue;
    const production = node.production;
    const clause = production.emit;
    if (!clause) {
      for (let index = node.children.length - 1; index >= 0; index--) tasks.push({ walk: node.children[index] });
      continue;
    }
    const scope = new TreeScope(node, context);
    /** @type {(item: EmitItem, fallback: TagSet) => TagSet} */
    const valueTags = (item, fallback) => {
      if (!item.tags) return fallback;
      const tags = asSet(evaluate(context, item.tags, scope));
      // A token no terminal can read is a mistake; `%emits ε` is how a
      // grammar emits nothing (engine §11).
      if (tags.size === 0) throw new GencmuError("grammar", `${production.owner} emits a token with no tags`);
      return tags;
    };
    if (clause.items.length === 0) continue;
    if (clause.items[0].capture === "") {
      // One token covering the constituent per `$`: a digit that is two
      // phonemes is emitted as two tokens over the same character.
      for (const item of clause.items) put(makeToken(node, valueTags(item, nodeTags(node, context)), emitter));
      continue;
    }
    // The items, in the order listed, and nothing else of the constituent
    // but their attachments (engine §11). An inserted tag's position is the
    // start of its anchor, the first written part of the capture item listed
    // next after it, or the constituent's end.
    /** @type {(name: string) => Derivation} */
    const part = (name) => node.children[/** @type {import("./types.js").Capture} */ (production.captures.find((entry) => entry.name === name)).index];
    // An attachment: what its captured parts emit in their place, walked
    // into a list of their own (engine §11).
    /** @type {(names: string[] | undefined) => EmitTask[]} */
    const walks = (names) => (names ?? []).map((name) => ({ walk: part(name) }));
    // The attachments gathered last, each token without its span.
    const gathered = () => /** @type {Token[]} */ (lists.pop()).map(attached);
    /** @type {EmitTask[]} */
    const ordered = [];
    clause.items.forEach((item, index) => {
      if (item.insert !== undefined) {
        const insert = item.insert;
        const next = clause.items.slice(index + 1).find((later) => later.capture !== undefined);
        const at = next && next.capture !== undefined ? part(next.before?.[0] ?? next.capture).start : node.end;
        ordered.push({ run: () => put(insertedToken(insert, at, node, context, production.owner)) });
      } else if (item.capture !== undefined) {
        const child = part(item.capture);
        // Before-attachments, then the carrier with its tag term, then
        // after-attachments; the first error ends the emission. New
        // attachments are outer to inherited ones (engine §11).
        /** @type {import("./tokens.js").AttachedToken[]} */
        let before = [];
        /** @type {Token | undefined} */
        let token;
        ordered.push(
          { run: () => lists.push([]) },
          ...walks(item.before),
          { run: () => {
            before = gathered();
            token = makeToken(child, valueTags(item, nodeTags(child, context)), emitter);
            lists.push([]);
          } },
          ...walks(item.after),
          { run: () => {
            const after = gathered();
            const carrier = /** @type {Token} */ (token);
            if (before.length) carrier.before = [...before, ...carrier.before];
            if (after.length) carrier.after = [...carrier.after, ...after];
            put(carrier);
          } },
        );
      }
    });
    for (let index = ordered.length - 1; index >= 0; index--) tasks.push(ordered[index]);
  }
  return lists[0];
}


