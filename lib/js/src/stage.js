// Running one stage: recognition, the choice of a parse, the result tree
// (engine §12), emission (engine §11) and elision-only (engine §7).

import { GencmuError } from "./errors.js";
import { ParseContext, recognize, rootItems, rejectionOf, evaluate } from "./earley.js";
import { Ranker, derivationTree } from "./rank.js";
import { maximalRule } from "./maximal.js";
import { Token, Sources } from "./tokens.js";
import { tagSet, strongTag, compareCodePoints } from "./tags.js";
import { foldTree } from "./walk.js";

/**
 * @import { Derivation, DerivationRule, ElidedNode, EmitItem, ResultNode, Scope, Span, StageReport, TagSet, TermValue } from "./types.js"
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
      lowered = this.grammar.lower(features, false);
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
    const maximal = resolution.maximal ? maximalRule(chart, lowered) : null;
    const ranking = roots.length === 0 ? null : new Ranker(tokens, resolution.lean, maximal).rank(roots);
    if (ranking === null) {
      // A text that maximal leaves with no derivation is rejected at the
      // first terminator it forbids in the derivation the stage would
      // otherwise have chosen (engine §4).
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
      // A tie always has a second derivation, and so a witness.
      Object.assign(report, {
        verdict: "tie",
        witness: /** @type {import("./types.js").Witness} */ (ranking.witness),
        tied: resultTree(derivationTree(/** @type {import("./types.js").Rope} */ (ranking.second)), context)[0],
      });
    } else {
      Object.assign(report, { verdict: ranking.verdict, witness: null });
    }
    const derivation = derivationTree(ranking.chosen);
    report.tree = resultTree(derivation, context)[0];
    report.derivation = derivation;
    report.context = context;
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
    if (elisionOnly && report.verdict !== "unique") {
      let readings;
      try {
        readings = this.elisionCheck(report.tree, tokens, sourceText, unicode, features);
      } catch (error) {
        // An error of the grammar in the reparse ends the stage as one found
        // while emitting does: no output, the rest kept (engine §7).
        if (error instanceof GencmuError) {
          report.output = null;
          report.error = { kind: "grammar", stage: this.name, message: error.message };
          return report;
        }
        throw error;
      }
      if (readings) {
        report.error = {
          kind: "ambiguous",
          stage: this.name,
          readings,
          message: `the ${this.name} stage's text is ambiguous with every elided terminator written out`,
        };
      }
    }
    return report;
  }

  /**
   * Engine §7: null when the check passes, else the two first readings of
   * the input with its elided terminators written out.
   * @param {ResultNode} tree
   * @param {Token[]} tokens
   * @param {string[]} sourceText
   * @param {UnicodeTable} unicode
   * @param {Set<string>} features
   * @returns {ResultNode[] | null}
   */
  elisionCheck(tree, tokens, sourceText, unicode, features) {
    /** @type {ElidedNode[]} */
    const elided = [];
    // In text order: the leaves left to right.
    const pending = [tree];
    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
      if (node.kind === "elided") elided.push(node);
      if (node.kind === "rule") for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]);
    }
    // The input with the chosen parse's elided terminators written back, in
    // text order, inner before outer where several are at one position; and
    // which positions of it are those synthetic terminators.
    /** @type {Token[]} */
    const restored = [];
    /** @type {number[]} */
    const synthetic = [];
    let next = 0;
    for (let index = 0; index <= tokens.length; index++) {
      while (next < elided.length && elided[next].span[0] === index) {
        const node = elided[next++];
        const position = node.source[0];
        synthetic.push(restored.length);
        restored.push(new Token(strongTag(node.terminal), [restored.length, restored.length], [position, position], "", null, undefined));
      }
      if (index < tokens.length) restored.push(tokens[index]);
    }
    const lowered = this.grammar.lower(features, true);
    const context = new ParseContext(lowered, restored, sourceText, unicode);
    const chart = recognize(context, "text", 0, restored.length);
    const roots = rootItems(chart, "text");
    if (roots.length === 0) return null;
    const ranking = new Ranker(restored, "none").rank(roots);
    if (ranking === null || ranking.verdict !== "tie") return null;
    // The readings are shown over the original input: a synthetic
    // terminator becomes an elided node where it was inserted.
    const isSynthetic = new Set(synthetic);
    /** @type {(index: number) => number} */
    const toOriginal = (index) => index - synthetic.filter((position) => position < index).length;
    // A node's source is taken again over the original input, since the
    // synthetic terminators have sources too.
    const original = new Sources(tokens);
    /** @type {(node: ResultNode) => ResultNode} */
    const remap = (root) => foldTree(root,
      /** @returns {ResultNode} */
      (node) => {
        if (node.kind === "token" && isSynthetic.has(node.token)) {
          const at = toOriginal(node.token);
          return { kind: "elided", terminal: node.terminal, span: [at, at], source: node.source };
        }
        if (node.kind === "token") return { ...node, token: toOriginal(node.token), span: [toOriginal(node.span[0]), toOriginal(node.span[0]) + 1] };
        const at = toOriginal(node.span[0]);
        return { ...node, span: [at, at], source: sourceOf(original, at, at) };
      },
      /** @returns {ResultNode} */
      (node, children) => {
        const start = toOriginal(node.span[0]);
        const end = toOriginal(node.span[1]);
        return { ...node, span: [start, end], source: sourceOf(original, start, end), children };
      });
    return [ranking.chosen, /** @type {import("./types.js").Rope} */ (ranking.second)].map((rope) => remap(resultTree(derivationTree(rope), context)[0]));
  }
}

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
 * Of a ranking's chosen derivation, the first elided terminator, in the order
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
  const stack = [{ node: derivationTree(ranking.chosen), next: 0 }];
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
      if (before && !("read" in before) && maximal.forbids(before.item)) {
        const production = child.production;
        return { position: child.start, expected: [{ terminal: /** @type {string} */ (production.elided), rules: [production.owner] }] };
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
        finish([{ kind: "elided", terminal: production.elided, span: [node.start, node.start], source: [position, position] }]);
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
  for (const [tag, strong] of tags) {
    if (strong && tag.length >= 3 && tag[0] === "/" && tag[tag.length - 1] === "/" && [...tag].length === 3) found.push(tag);
  }
  if (found.length > 1) {
    throw new GencmuError("grammar", `a token carries two phoneme tags, ${found.sort(compareCodePoints).join(" and ")}`);
  }
  return found.length ? [...found[0]][1] : null;
}

// What a node says: the phonemes of the tokens it covers, less those inside
// a constituent that does not count, with each run of pause tokens made one
// and a pause token at either end left out (engine §5). The pauses are
// counted by token, so that a verbatim token keeps its periods.
/**
 * @param {Derivation} node
 * @param {ParseContext} context
 * @returns {string}
 */
function spoken(node, context) {
  /** @type {string[]} */
  const pieces = [];
  const stack = [node];
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    if ("read" in current) {
      const phonemes = context.tokens[current.read.token].phonemes || "";
      if (phonemes === "") continue;
      if (phonemes === "." && (pieces.length === 0 || pieces[pieces.length - 1] === ".")) continue;
      pieces.push(phonemes);
      continue;
    }
    if (countsForNothing(current.production)) continue;
    for (let index = current.children.length - 1; index >= 0; index--) stack.push(current.children[index]);
  }
  if (pieces[pieces.length - 1] === ".") pieces.pop();
  return pieces.join("");
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
 * @param {Derivation} node
 * @param {TagSet} tags
 * @param {ParseContext} context
 * @param {Set<number>} widenedEnds where the widened tokens emitted before
 *   this one end
 * @returns {Token}
 */
function makeToken(node, tags, context, widenedEnds) {
  const tokens = context.tokens;
  // Two phoneme tags are an error on any token, verbatim or not (engine §5).
  const phoneme = phonemeTag(tags);
  if ("production" in node && node.production.verbatim) {
    // A widened token takes in the text next to it that no input token
    // covers, but not text that a widened token before it has taken, and
    // sounds like its text (engine §5, §11).
    const before = node.start > 0 ? tokens[node.start - 1].source[1] : 0;
    if (node.start === node.end) return new Token(tags, [node.start, node.end], [before, before], "", "", undefined, true);
    // It always holds its own tokens' sources, which the tokens next to it
    // may share.
    const own = sourceOf(context.sources, node.start, node.end);
    const start = widenedEnds.has(node.start) ? own[0] : Math.min(own[0], before);
    const after = node.end < tokens.length ? tokens[node.end].source[0] : context.sourceText.length;
    const end = Math.max(own[1], after);
    widenedEnds.add(node.end);
    const text = context.sourceText.slice(start, end).join("");
    return new Token(tags, [node.start, node.end], [start, end], text, text, undefined, true);
  }
  if (node.end - node.start === 1 && tokens[node.start].verbatim) {
    // A token over one verbatim token is verbatim, with its source.
    const only = tokens[node.start];
    return new Token(tags, [node.start, node.end], [only.source[0], only.source[1]], only.text, only.text, undefined, true);
  }
  const source = sourceOf(context.sources, node.start, node.end);
  const phonemes = phoneme !== null ? phoneme : spoken(node, context);
  return new Token(tags, [node.start, node.end], source, context.sourceText.slice(source[0], source[1]).join(""), phonemes, undefined);
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
  const tags = strongTag(tag);
  const phoneme = phonemeTag(tags);
  return new Token(tags, [at, at], [position, position], "", phoneme !== null ? phoneme : "", owner);
}

// The tokens a derivation emits for the next stage (engine §11). The walk
// keeps its own stack of tasks, in text order, rather than recursing.
/**
 * @typedef {{walk: Derivation} | {token: () => Token}} EmitTask
 */

/**
 * @param {Derivation} root
 * @param {ParseContext} context
 * @returns {Token[]}
 */
export function emit(root, context) {
  /** @type {Token[]} */
  const out = [];
  // Where the widened tokens emitted so far end (engine §11).
  /** @type {Set<number>} */
  const widenedEnds = new Set();
  /** @type {EmitTask[]} */
  const tasks = [{ walk: root }];
  for (let task = tasks.pop(); task !== undefined; task = tasks.pop()) {
    if ("token" in task) {
      out.push(task.token());
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
      const tags = asTags(evaluate(context, item.tags, scope));
      // A token no terminal can read is a mistake; `%emits ε` is how a
      // grammar emits nothing (engine §11).
      if (tags.size === 0) throw new GencmuError("grammar", `${production.owner} emits a token with no tags`);
      return tags;
    };
    if (clause.items.length === 0) continue;
    if (clause.items[0].capture === "") {
      // One token covering the constituent per `$`: a digit that is two
      // phonemes is emitted as two tokens over the same character.
      for (const item of clause.items) out.push(makeToken(node, valueTags(item, nodeTags(node, context)), context, widenedEnds));
      continue;
    }
    // The items, in the order listed, and nothing else of the constituent
    // (engine §11). An inserted tag's position is the start of the part of
    // the capture listed next after it, or the constituent's end.
    /** @type {(name: string) => Derivation} */
    const part = (name) => node.children[/** @type {import("./types.js").Capture} */ (production.captures.find((entry) => entry.name === name)).index];
    /** @type {EmitTask[]} */
    const ordered = [];
    clause.items.forEach((item, index) => {
      if (item.insert !== undefined) {
        const insert = item.insert;
        const next = clause.items.slice(index + 1).find((later) => later.capture !== undefined);
        const at = next && next.capture !== undefined ? part(next.capture).start : node.end;
        ordered.push({ token: () => insertedToken(insert, at, node, context, production.owner) });
      } else if (item.capture !== undefined) {
        const child = part(item.capture);
        ordered.push({ token: () => makeToken(child, valueTags(item, nodeTags(child, context)), context, widenedEnds) });
      }
    });
    for (let index = ordered.length - 1; index >= 0; index--) tasks.push(ordered[index]);
  }
  return out;
}

/**
 * @param {TermValue} value
 * @returns {TagSet}
 */
function asTags(value) {
  if ("tags" in value) return value.tags;
  return strongTag(value.string);
}
