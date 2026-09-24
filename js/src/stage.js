// Running one stage: recognition, the choice of a parse, the result tree
// (engine §12), emission (engine §11) and elision-only (engine §7).

import { GencmuError } from "./errors.js";
import { ParseContext, recognize, rootItems, rejectionOf, evaluate, phonemesOf } from "./earley.js";
import { Ranker, derivationTree } from "./rank.js";
import { Token } from "./tokens.js";
import { tagSet, strongTag, compareCodePoints } from "./tags.js";

export class Stage {
  constructor(name, grammar) {
    this.name = name;
    this.grammar = grammar;
  }

  // Runs the stage over `tokens`. `sourceText` is the original text as an
  // array of code points. Returns a stage report.
  run(tokens, sourceText, unicode, options) {
    const features = options.features;
    const lowered = this.grammar.lower(features, false);
    const context = new ParseContext(lowered, tokens, sourceText, unicode);
    const report = { name: this.name, verdict: null, witness: null, output: null, tree: null, error: null };
    let chart;
    let roots;
    try {
      chart = recognize(context, "text", 0, tokens.length);
      roots = rootItems(chart, "text");
    } catch (error) {
      if (error instanceof GencmuError) {
        report.error = { kind: "grammar", stage: this.name, message: error.message };
        return report;
      }
      throw error;
    }
    if (roots.length === 0) {
      const rejection = rejectionOf(chart, lowered);
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
    const ranker = new Ranker(tokens, lowered.resolution.lean);
    const ranking = ranker.rank(roots);
    report.verdict = ranking.verdict;
    report.witness = ranking.witness;
    const derivation = derivationTree(ranking.chosen);
    report.tree = resultTree(derivation, context)[0];
    if (ranking.second) report.tied = resultTree(derivationTree(ranking.second), context)[0];
    report.derivation = derivation;
    report.context = context;
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
      const readings = this.elisionCheck(report.tree, tokens, sourceText, unicode, features);
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

  // Engine §7: null when the check passes, else the two first readings of
  // the input with its elided terminators written out.
  elisionCheck(tree, tokens, sourceText, unicode, features) {
    const elided = [];
    const collect = (node) => {
      if (node.kind === "elided") elided.push(node);
      for (const child of node.children || []) collect(child);
    };
    collect(tree);
    // The input with the chosen parse's elided terminators written back, in
    // text order, inner before outer where several are at one position; and
    // which positions of it are those synthetic terminators.
    const restored = [];
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
    if (ranking.verdict !== "tie") return null;
    // The readings are shown over the original input: a synthetic
    // terminator becomes an elided node where it was inserted.
    const isSynthetic = new Set(synthetic);
    const toOriginal = (index) => index - synthetic.filter((position) => position < index).length;
    const remap = (node) => {
      if (node.kind === "token" && isSynthetic.has(node.token)) {
        const at = toOriginal(node.token);
        return { kind: "elided", terminal: node.terminal, span: [at, at], source: node.source };
      }
      if (node.kind === "token") return { ...node, token: toOriginal(node.token), span: [toOriginal(node.span[0]), toOriginal(node.span[0]) + 1] };
      if (node.kind === "elided") return { ...node, span: [toOriginal(node.span[0]), toOriginal(node.span[0])] };
      return { ...node, span: [toOriginal(node.span[0]), toOriginal(node.span[1])], children: node.children.map(remap) };
    };
    return [ranking.chosen, ranking.second].map((rope) => remap(resultTree(derivationTree(rope), context)[0]));
  }
}

function sourceAt(tokens, position) {
  if (position < tokens.length) return tokens[position].source.slice();
  const end = tokens.length ? tokens[tokens.length - 1].source[1] : 0;
  return [end, end];
}

// Where an empty span at token index `at` lies in the source.
function emptySource(tokens, at) {
  if (at > 0) return tokens[at - 1].source[1];
  return tokens.length ? tokens[0].source[0] : 0;
}

function sourceOf(tokens, start, end) {
  if (start >= end) {
    const position = emptySource(tokens, start);
    return [position, position];
  }
  return [tokens[start].source[0], tokens[end - 1].source[1]];
}

function nodeTags(node, context) {
  if (node.read) return context.tokens[node.read.token].tags;
  return context.interner.get(node.item.tagId);
}

// The nodes of a left-recursive chain, from the top down: a node whose first
// child is a node of the same production's left side, as `r ≔ r x` and the
// helper of `x ...` make. Walking them in a loop keeps the walks of a long
// text from nesting as deep as the text is long.
function spine(node) {
  const chain = [node];
  let current = node;
  while (current.children && current.children.length > 0) {
    const first = current.children[0];
    if (first.read || first.production.lhs !== current.production.lhs) break;
    chain.push(first);
    current = first;
  }
  return chain;
}

// The result tree of a derivation (engine §12), as a list: a spliced node
// yields its children.
export function resultTree(node, context) {
  const tokens = context.tokens;
  if (node.read) {
    return [{ kind: "token", terminal: node.read.terminal, token: node.read.token, span: [node.start, node.end], source: sourceOf(tokens, node.start, node.end) }];
  }
  const production = node.production;
  if (production.helper) {
    if (production.elided && node.children.length === 0) {
      const position = emptySource(tokens, node.start);
      return [{ kind: "elided", terminal: production.elided, span: [node.start, node.start], source: [position, position] }];
    }
    // A repetition's helper is left-recursive: its items are the bottom
    // node's children, then each node's other children going up.
    const chain = spine(node);
    const result = [];
    for (let index = chain.length - 1; index >= 0; index--) {
      const children = index === chain.length - 1 ? chain[index].children : chain[index].children.slice(1);
      for (const child of children) result.push(...resultTree(child, context));
    }
    return result;
  }
  let children;
  if (production.recursivePrefix) {
    const chain = spine(node).filter((member, index, all) => index === 0 || all[index - 1].production.recursivePrefix);
    children = [];
    for (let index = chain.length - 1; index >= 0; index--) {
      const own = index === chain.length - 1 ? chain[index].children : chain[index].children.slice(1);
      for (const child of own) children.push(...resultTree(child, context));
    }
  } else {
    children = node.children.flatMap((child) => resultTree(child, context));
  }
  return [{
    kind: "rule",
    rule: production.lhs,
    span: [node.start, node.end],
    source: sourceOf(tokens, node.start, node.end),
    tags: nodeTags(node, context),
    children,
  }];
}

class TreeScope {
  constructor(node, context) {
    this.node = node;
    this.context = context;
  }
  capture(name) {
    const capture = this.node.production.captures.find((entry) => entry.name === name);
    const child = this.node.children[capture.index];
    return { start: child.start, end: child.end, tags: nodeTags(child, this.context) };
  }
}

function phonemeTag(tags) {
  const found = [];
  for (const [tag, strong] of tags) {
    if (strong && tag.length >= 3 && tag[0] === "/" && tag[tag.length - 1] === "/" && [...tag].length === 3) found.push(tag);
  }
  if (found.length > 1) {
    throw new GencmuError("grammar", `a token carries two phoneme tags, ${found.sort(compareCodePoints).join(" and ")}`);
  }
  return found.length ? [...found[0]][1] : null;
}

// What a node says: its tokens' phonemes, less every part that emits
// nothing (engine §5).
function spoken(node, context) {
  let result = "";
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current.read) {
      result += context.tokens[current.read.token].phonemes || "";
      continue;
    }
    if (current.production.emit && current.production.emit.nothing) continue;
    for (let index = current.children.length - 1; index >= 0; index--) stack.push(current.children[index]);
  }
  return result;
}

function makeToken(node, tags, context) {
  const tokens = context.tokens;
  const source = sourceOf(tokens, node.start, node.end);
  const phoneme = phonemeTag(tags);
  const phonemes = phoneme !== null ? phoneme : spoken(node, context).trim();
  return new Token(tags, [node.start, node.end], source, context.sourceText.slice(source[0], source[1]).join(""), phonemes, undefined);
}

function insertedToken(tag, at, node, context, owner) {
  const tokens = context.tokens;
  const position = at > node.start ? tokens[at - 1].source[1] : sourceOf(tokens, node.start, node.end)[0];
  const tags = strongTag(tag);
  const phoneme = phonemeTag(tags);
  return new Token(tags, [at, at], [position, position], "", phoneme !== null ? phoneme : "", owner);
}

// The tokens a derivation emits for the next stage (engine §11). The walk
// keeps its own stack of tasks, in text order, rather than recursing.
export function emit(root, context) {
  const out = [];
  const tasks = [{ walk: root }];
  while (tasks.length > 0) {
    const task = tasks.pop();
    if (task.token) {
      out.push(task.token());
      continue;
    }
    const node = task.walk;
    if (node.read) continue;
    const production = node.production;
    const clause = production.emit;
    if (!clause) {
      for (let index = node.children.length - 1; index >= 0; index--) tasks.push({ walk: node.children[index] });
      continue;
    }
    if (clause.nothing) continue;
    const scope = new TreeScope(node, context);
    const valueTags = (item, fallback) => (item.tags ? asTags(evaluate(context, item.tags, scope)) : fallback);
    const thisItem = clause.items.find((item) => item.this);
    if (thisItem) {
      out.push(makeToken(node, valueTags(thisItem, nodeTags(node, context)), context));
      continue;
    }
    const named = new Map();
    for (const item of clause.items) {
      if (item.capture !== undefined) {
        const capture = production.captures.find((entry) => entry.name === item.capture);
        named.set(capture.index, item);
      }
    }
    // The node's tasks in text order, then pushed in reverse.
    const ordered = [];
    let next = 0;
    let cursor = node.start;
    node.children.forEach((child, index) => {
      if (named.has(index)) {
        while (next < clause.items.length) {
          const item = clause.items[next];
          if (item.insert !== undefined) {
            const at = cursor;
            ordered.push({ token: () => insertedToken(item.insert, at, node, context, production.owner) });
            next++;
          } else if (named.get(index) === item) {
            ordered.push({ token: () => makeToken(child, valueTags(item, nodeTags(child, context)), context) });
            next++;
            break;
          } else {
            break;
          }
        }
      } else {
        ordered.push({ walk: child });
      }
      cursor = child.end;
    });
    for (; next < clause.items.length; next++) {
      const item = clause.items[next];
      const at = cursor;
      if (item.insert !== undefined) ordered.push({ token: () => insertedToken(item.insert, at, node, context, production.owner) });
    }
    for (let index = ordered.length - 1; index >= 0; index--) tasks.push(ordered[index]);
  }
  return out;
}

function asTags(value) {
  if (value.tags) return value.tags;
  if (value.string !== undefined) return strongTag(value.string);
  return tagSet(value.list.map((item) => [item, true]));
}


void phonemesOf;
