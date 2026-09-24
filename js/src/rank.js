// Choosing a parse (engine §6): the first-difference order over bottom-up
// action sequences, computed over the packed forest.

import { compareCodePoints } from "./tags.js";

const EMPTY = { empty: true };

function leaf(action) {
  return { leaf: action };
}

function concat(left, right) {
  if (left.empty) return right;
  if (right.empty) return left;
  return { left, right };
}

// The actions of a rope, in order.
function* actions(rope) {
  const stack = [rope];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.empty) continue;
    if (node.leaf) {
      yield node.leaf;
      continue;
    }
    stack.push(node.right, node.left);
  }
}

export function isTransparent(production) {
  return production.helper || production.rhs.length === 1;
}

function visible(action) {
  return action.kind === "read" || !isTransparent(action.item.production);
}

function sameAction(left, right) {
  if (left.kind !== right.kind) return false;
  if (left.kind === "read") return left.token === right.token && left.terminal === right.terminal;
  return left.item.production.id === right.item.production.id && left.item.origin === right.item.origin && left.item.end === right.item.end;
}

// The first differing pair of two ropes' actions, visible ones only or all.
function firstDifference(left, right, onlyVisible) {
  const a = actions(left);
  const b = actions(right);
  for (;;) {
    let x = a.next();
    while (onlyVisible && !x.done && !visible(x.value)) x = a.next();
    let y = b.next();
    while (onlyVisible && !y.done && !visible(y.value)) y = b.next();
    if (x.done && y.done) return null;
    if (x.done || y.done) return { left: x.done ? null : x.value, right: y.done ? null : y.value };
    if (!sameAction(x.value, y.value)) return { left: x.value, right: y.value };
  }
}

// -1 when left beats right, 1 when right beats left, 0 when they are tied
// (engine §6). `lean` is greedy, lazy, or none for elision-only's check.
function compare(left, right, lean) {
  const difference = firstDifference(left, right, true);
  if (!difference || !difference.left || !difference.right) return 0;
  const { left: x, right: y } = difference;
  if (x.kind === "read" && y.kind === "read") {
    if (x.weak && !y.weak) return 1;
    if (!x.weak && y.weak) return -1;
    return 0;
  }
  if (x.kind !== y.kind) {
    if (lean === "none") return 0;
    const leftReads = x.kind === "read";
    const readWins = lean === "greedy";
    return leftReads === readWins ? -1 : 1;
  }
  return 0;
}

// The canonical order of tied derivations (engine §6).
function canonical(left, right) {
  let difference = firstDifference(left, right, true);
  if (!difference) difference = firstDifference(left, right, false);
  if (!difference) return 0;
  const { left: x, right: y } = difference;
  if (!x) return -1;
  if (!y) return 1;
  if (x.kind !== y.kind) return x.kind === "read" ? -1 : 1;
  if (x.kind === "read") return compareCodePoints(x.terminal, y.terminal);
  return x.item.production.id - y.item.production.id || x.item.origin - y.item.origin || x.item.end - y.item.end;
}

// What makes a derivation cyclic (engine §4, derivations): the same item
// again, or a constituent of the same rule over the same span again below a
// single-symbol production.
function cycleKeys(item) {
  if (item.dot === item.production.rhs.length && item.production.rhs.length === 1) {
    return [item, `${item.production.lhs}\u0000${item.origin}\u0000${item.end}`];
  }
  return [item];
}

export class Ranker {
  constructor(tokens, lean) {
    this.tokens = tokens;
    this.lean = lean;
    this.memo = new Map();
    this.counts = new Map();
  }

  // The undominated action sequences of an item's children so far.
  candidates(item) {
    return this.traverse(item, this.memo, (current, dependency) => {
      let kept = [];
      for (const edge of current.edges) {
        let produced;
        if (edge.kind === "seed") produced = [EMPTY];
        else if (edge.kind === "scan") {
          const token = this.tokens[edge.token];
          const read = leaf({ kind: "read", token: edge.token, terminal: edge.terminal, weak: token.tags.get(edge.terminal) === false });
          produced = dependency(edge.previous).map((rope) => concat(rope, read));
        } else {
          const close = leaf({ kind: "close", item: edge.child });
          const children = dependency(edge.child).map((rope) => concat(rope, close));
          produced = [];
          for (const before of dependency(edge.previous)) for (const child of children) produced.push(concat(before, child));
        }
        for (const rope of produced) kept = this.keep(kept, rope);
      }
      return kept;
    }, []);
  }

  full(item) {
    const close = leaf({ kind: "close", item });
    return this.candidates(item).map((rope) => concat(rope, close));
  }

  keep(kept, rope) {
    const result = [];
    for (const other of kept) {
      const order = compare(other, rope, this.lean);
      if (order < 0) return kept;
      if (order === 0) result.push(other);
    }
    result.push(rope);
    return result;
  }

  // The number of derivations, capped at two.
  count(item) {
    return this.traverse(item, this.counts, (current, dependency) => {
      let total = 0;
      for (const edge of current.edges) {
        if (edge.kind === "seed") total += 1;
        else if (edge.kind === "scan") total += dependency(edge.previous);
        else total += dependency(edge.previous) * dependency(edge.child);
        if (total >= 2) break;
      }
      return Math.min(total, 2);
    }, 0);
  }

  // Computes `combine(item, dependency)` for an item after every item it
  // depends on, with an explicit stack rather than recursion, since a
  // left-recursive rule over a long text nests as deep as the text is long.
  // A dependency that would close a cycle (engine §4, derivations) yields
  // `cut`; a result computed while a cycle through an item still open was
  // cut short, or a single-symbol item's, depends on what is open above it
  // and is not remembered.
  traverse(root, memo, combine, cut) {
    const visiting = new Set();
    const hits = new Set();
    const dependenciesOf = (item) => {
      const result = [];
      for (const edge of item.edges) {
        if (edge.kind === "scan") result.push(edge.previous);
        else if (edge.kind === "complete") result.push(edge.previous, edge.child);
      }
      return result;
    };
    const rootFrame = { item: root, results: new Map(), started: false };
    const stack = [rootFrame];
    let answer;
    const deliver = (value) => {
      const done = stack.pop();
      if (stack.length === 0) answer = value;
      else stack[stack.length - 1].results.set(done.item, value);
    };
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (!frame.started) {
        frame.keys = cycleKeys(frame.item);
        if (frame.keys.some((key) => visiting.has(key))) {
          for (const key of frame.keys) if (visiting.has(key)) hits.add(key);
          deliver(cut);
          continue;
        }
        if (memo.has(frame.item)) {
          deliver(memo.get(frame.item));
          continue;
        }
        for (const key of frame.keys) visiting.add(key);
        frame.pending = dependenciesOf(frame.item);
        frame.started = true;
      }
      let pushed = false;
      while (frame.pending.length > 0) {
        const next = frame.pending.pop();
        if (frame.results.has(next)) continue;
        stack.push({ item: next, results: new Map(), started: false });
        pushed = true;
        break;
      }
      if (pushed) continue;
      const value = combine(frame.item, (item) => frame.results.get(item));
      for (const key of frame.keys) {
        visiting.delete(key);
        hits.delete(key);
      }
      if (hits.size === 0 && frame.keys.length === 1) memo.set(frame.item, value);
      deliver(value);
    }
    return answer;
  }

  // Ranks the derivations of the root items: the verdict, the chosen
  // derivation, every undominated one in canonical order, and the witness.
  rank(roots) {
    const count = Math.min(2, roots.reduce((sum, item) => sum + this.count(item), 0));
    let kept = [];
    for (const root of roots) for (const rope of this.full(root)) kept = this.keep(kept, rope);
    kept.sort(canonical);
    let verdict;
    if (count === 1) verdict = "unique";
    else if (kept.length === 1) verdict = "resolved";
    else verdict = "tie";
    let witness = null;
    if (verdict === "tie") {
      let difference = firstDifference(kept[0], kept[1], true);
      if (!difference || !difference.left || !difference.right) difference = firstDifference(kept[0], kept[1], false);
      witness = difference ? [difference.left, difference.right] : null;
    }
    return { verdict, chosen: kept[0], undominated: kept, witness };
  }
}

// The raw derivation tree of a rope: every production closed, helpers and
// all, with its children in order.
export function derivationTree(rope) {
  const stack = [];
  for (const action of actions(rope)) {
    if (action.kind === "read") {
      stack.push({ read: action, start: action.token, end: action.token + 1 });
    } else {
      const arity = action.item.production.rhs.length;
      const children = stack.splice(stack.length - arity, arity);
      stack.push({ item: action.item, production: action.item.production, children, start: action.item.origin, end: action.item.end });
    }
  }
  return stack[stack.length - 1];
}
