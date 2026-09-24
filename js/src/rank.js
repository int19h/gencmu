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

// Walks a rope's actions, and can skip a whole subtree: two ropes built on
// the same prefix share it as one object, which a comparison need not walk.
class Cursor {
  constructor(rope) {
    this.stack = [rope];
  }
  // The node at the front, descending into concatenations, or null at the
  // end.
  front() {
    while (this.stack.length > 0) {
      const node = this.stack[this.stack.length - 1];
      if (node.empty) {
        this.stack.pop();
        continue;
      }
      return node;
    }
    return null;
  }
  descend() {
    const node = this.stack.pop();
    this.stack.push(node.right, node.left);
  }
  skip() {
    this.stack.pop();
  }
}

// Pairs of ropes already found equal in their visible actions. Candidates
// that differ only in transparent closes are extended by the same actions
// again and again, and are compared again each time; remembering the pair
// lets the next comparison skip it.
const visiblyEqual = new WeakMap();

function knownEqual(x, y) {
  const set = visiblyEqual.get(x);
  return set !== undefined && set.has(y);
}

function rememberEqual(x, y) {
  for (const [from, to] of [[x, y], [y, x]]) {
    let set = visiblyEqual.get(from);
    if (!set) visiblyEqual.set(from, (set = new WeakSet()));
    set.add(to);
  }
}

// The first differing pair of two ropes' actions, visible ones only or all.
function firstDifference(left, right, onlyVisible) {
  const difference = walkDifference(left, right, onlyVisible);
  if (difference === null && onlyVisible && !left.leaf && !right.leaf) rememberEqual(left, right);
  return difference;
}

function walkDifference(left, right, onlyVisible) {
  const a = new Cursor(left);
  const b = new Cursor(right);
  const nextLeaf = (cursor, other) => {
    for (;;) {
      const node = cursor.front();
      if (node === null) return null;
      const opposite = other ? other.front() : null;
      if (opposite && !node.leaf && (node === opposite || (onlyVisible && knownEqual(node, opposite)))) return "shared";
      if (node.leaf) {
        cursor.skip();
        if (!onlyVisible || visible(node.leaf)) return node.leaf;
        continue;
      }
      cursor.descend();
    }
  };
  for (;;) {
    // Skip what both sides share, descending both together while both are
    // concatenations, so that a shared or known-equal subtree is met at the
    // same depth on each side rather than after walking one side's spine.
    for (;;) {
      const x = a.front();
      const y = b.front();
      if (x === null || y === null) break;
      if (x === y || (onlyVisible && knownEqual(x, y))) {
        a.skip();
        b.skip();
        continue;
      }
      if (!x.leaf && !y.leaf) {
        a.descend();
        b.descend();
        continue;
      }
      break;
    }
    const x = nextLeaf(a, b);
    if (x === "shared") continue;
    const y = nextLeaf(b, null);
    if (x === null && y === null) return null;
    if (x === null || y === null) return { left: x, right: y };
    if (!sameAction(x, y)) return { left: x, right: y };
  }
}

// -1 when left beats right, 1 when right beats left, 0 when they are tied
// (engine §6). `lean` is greedy, lazy, or none for elision-only's check.
// The order of two sequences, and whether it is settled: a tie at a real
// difference, or two equal sequences, stays a tie whatever follows, while
// two sequences one of which is a prefix of the other are still undecided.
function comparison(left, right, lean) {
  const difference = firstDifference(left, right, true);
  if (!difference) return { order: 0, settled: true };
  if (!difference.left || !difference.right) return { order: 0, settled: false };
  return { order: decide(difference, lean), settled: true };
}

function decide(difference, lean) {
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

// The total order T (engine §6): at the first visible difference, the
// pair's decision by tag strength and lean, and where that is a tie, the
// canonical keys; sequences equal in their visible actions are ordered at
// their first difference among all actions. The chosen derivation is T's
// minimum.
function totalOrder(left, right, lean) {
  let difference = firstDifference(left, right, true);
  if (difference && difference.left && difference.right) {
    const decided = decide(difference, lean);
    if (decided !== 0) return decided;
    return canonicalKey(difference.left, difference.right);
  }
  if (difference) return difference.left ? 1 : -1;
  difference = firstDifference(left, right, false);
  if (!difference) return 0;
  if (!difference.left) return -1;
  if (!difference.right) return 1;
  return canonicalKey(difference.left, difference.right);
}

// Two differing actions in canonical order: a read before a close, reads
// by terminal, closes by production, then span.
function canonicalKey(x, y) {
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

  // An item's candidates: for each sequence the item's derivations could
  // still be decided by, the T-least of them, `seq`, and the T-least
  // derivations tied with it, `alts`. Sequences whose order a later action
  // could still change, one a visible prefix of another or equal to it up to
  // one's end, are kept side by side, both as candidates and as tied
  // alternatives; everything else is settled here, so the lists stay short.
  candidates(item) {
    return this.traverse(item, this.memo, (current, dependency) => {
      let kept = [];
      for (const edge of current.edges) {
        let produced;
        if (edge.kind === "seed") produced = [{ seq: EMPTY, alts: [] }];
        else if (edge.kind === "scan") {
          const token = this.tokens[edge.token];
          const read = leaf({ kind: "read", token: edge.token, terminal: edge.terminal, weak: token.tags.get(edge.terminal) === false });
          produced = dependency(edge.previous).map((entry) => ({
            seq: concat(entry.seq, read),
            alts: entry.alts.map((alt) => concat(alt, read)),
          }));
        } else {
          const close = leaf({ kind: "close", item: edge.child });
          const children = dependency(edge.child).map((entry) => ({
            seq: concat(entry.seq, close),
            alts: entry.alts.map((alt) => concat(alt, close)),
          }));
          produced = [];
          for (const before of dependency(edge.previous)) {
            for (const child of children) {
              // A derivation tied with the combination differs from it first
              // either in the earlier part or in the child.
              let alts = [];
              for (const alt of before.alts) alts = this.addAlt(alts, concat(alt, child.seq));
              for (const alt of child.alts) alts = this.addAlt(alts, concat(before.seq, alt));
              produced.push({ seq: concat(before.seq, child.seq), alts });
            }
          }
        }
        for (const entry of produced) kept = this.keep(kept, entry);
      }
      return kept;
    }, []);
  }

  full(item) {
    const close = leaf({ kind: "close", item });
    return this.candidates(item).map((entry) => ({
      seq: concat(entry.seq, close),
      alts: entry.alts.map((alt) => concat(alt, close)),
    }));
  }

  // Adds a tied alternative, keeping the T-least of those whose order is
  // settled and every one whose order is not.
  addAlt(alts, alt) {
    const result = [];
    let current = alt;
    for (const other of alts) {
      if (current === null || !orderSettled(other, current)) {
        result.push(other);
        continue;
      }
      if (totalOrder(other, current, this.lean) <= 0) {
        result.push(other);
        current = null;
      }
    }
    if (current !== null) result.push(current);
    return result;
  }

  // Adds a candidate to a list, settling it against every candidate it can
  // be settled against.
  keep(kept, entry) {
    const lean = this.lean;
    const result = [];
    let current = { seq: entry.seq, alts: entry.alts };
    for (const other of kept) {
      if (current === null) {
        result.push(other);
        continue;
      }
      const { order, settled } = comparison(other.seq, current.seq, lean);
      if (!settled || (order === 0 && !orderSettled(other.seq, current.seq))) {
        result.push(other);
        continue;
      }
      if (order !== 0) {
        // One beats the other; the loser's tied alternatives may still be
        // tied with the winner.
        const [winner, loser] = order < 0 ? [{ ...other }, current] : [{ ...current }, other];
        for (const alt of loser.alts) if (isTie(winner.seq, alt, lean)) winner.alts = this.addAlt(winner.alts, alt);
        if (order < 0) {
          result.push(winner);
          current = null;
        } else {
          current = winner;
        }
        continue;
      }
      // Tied: the T-lesser stays, and the other, with its own tied
      // alternatives, is tied with it (ties are transitive).
      const first = totalOrder(other.seq, current.seq, lean) <= 0;
      const [main, second] = first ? [{ ...other }, current] : [{ ...current }, other];
      main.alts = this.addAlt(main.alts, second.seq);
      for (const alt of second.alts) main.alts = this.addAlt(main.alts, alt);
      current = main;
    }
    if (current !== null) result.push(current);
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
  // derivation, the second in canonical order if the result is a tie, and
  // the witness.
  rank(roots) {
    const count = Math.min(2, roots.reduce((sum, item) => sum + this.count(item), 0));
    let kept = [];
    for (const root of roots) for (const entry of this.full(root)) kept = this.keep(kept, entry);
    // At the root nothing follows: candidates still undecided are tied
    // (engine §6), and T orders every pair.
    const byOrder = (left, right) => totalOrder(left, right, this.lean);
    kept.sort((left, right) => byOrder(left.seq, right.seq));
    const main = kept[0];
    const tied = [...kept.slice(1).flatMap((entry) => [entry.seq, ...entry.alts]), ...main.alts].sort(byOrder);
    let verdict;
    if (count === 1) verdict = "unique";
    else if (tied.length === 0) verdict = "resolved";
    else verdict = "tie";
    let witness = null;
    const second = verdict === "tie" ? tied[0] : null;
    if (second) {
      let difference = firstDifference(main.seq, second, true);
      if (!difference || !difference.left || !difference.right) difference = firstDifference(main.seq, second, false);
      witness = difference ? [difference.left, difference.right] : null;
    }
    return { verdict, chosen: main.seq, second, witness };
  }
}

// Whether the T-order of two sequences is settled whatever follows: they
// differ at a visible action both have, or, visibly equal, at an action of
// all both have.
function orderSettled(left, right) {
  const visible = firstDifference(left, right, true);
  if (visible) return Boolean(visible.left && visible.right);
  const all = firstDifference(left, right, false);
  return all === null || Boolean(all.left && all.right);
}

function isTie(left, right, lean) {
  const { order, settled } = comparison(left, right, lean);
  return order === 0 && settled;
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
