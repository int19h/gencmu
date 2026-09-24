// Choosing a parse (engine §6): the first-difference order over bottom-up
// action sequences, computed over the packed forest.

import { compareCodePoints } from "./tags.js";

/**
 * @import { Action, Derivation, Item, Lean, Production, ReadAction, Rope, RopeConcat, RopeLeaf, Token } from "./types.js"
 */

/**
 * An item's candidate (see Ranker.candidates).
 * @typedef {object} Candidate
 * @property {Rope} seq
 * @property {Rope[]} alts
 * @property {number} at
 */

/**
 * The first differing pair of two sequences' actions, null on the side
 * that ended, and the number of visible actions before it.
 * @typedef {{left: Action | null, right: Action | null, index: number}} Difference
 */

/**
 * What the ranking concluded.
 * @typedef {object} Ranking
 * @property {import("./types.js").Verdict} verdict
 * @property {Rope} chosen
 * @property {Rope | null} second
 * @property {[Action | null, Action | null] | null} witness
 */

/** @type {Rope} */
const EMPTY = { empty: true, size: 0 };

/**
 * @param {Action} action
 * @returns {RopeLeaf}
 */
function leaf(action) {
  return { leaf: action, size: visible(action) ? 1 : 0 };
}

/**
 * @param {Rope} left
 * @param {Rope} right
 * @returns {Rope}
 */
function concat(left, right) {
  if ("empty" in left) return right;
  if ("empty" in right) return left;
  return { left, right, size: left.size + right.size };
}

/**
 * The actions of a rope, in order.
 * @param {Rope} rope
 * @returns {Generator<Action>}
 */
function* actions(rope) {
  const stack = [rope];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if ("empty" in node) continue;
    if ("leaf" in node) {
      yield node.leaf;
      continue;
    }
    stack.push(node.right, node.left);
  }
}

/**
 * @param {Production} production
 * @returns {boolean}
 */
export function isTransparent(production) {
  return production.helper || production.rhs.length === 1;
}

/**
 * @param {Action} action
 * @returns {boolean}
 */
function visible(action) {
  return action.kind === "read" || !isTransparent(action.item.production);
}

/**
 * @param {Action} left
 * @param {Action} right
 * @returns {boolean}
 */
function sameAction(left, right) {
  if (left.kind === "read" || right.kind === "read") {
    return left.kind === "read" && right.kind === "read" && left.token === right.token && left.terminal === right.terminal;
  }
  return left.item.production.id === right.item.production.id && left.item.origin === right.item.origin && left.item.end === right.item.end;
}

// Walks a rope's actions, and can skip a whole subtree: two ropes built on
// the same prefix share it as one object, which a comparison need not walk.
class Cursor {
  /** @param {Rope} rope */
  constructor(rope) {
    /** @type {Rope[]} */
    this.stack = [rope];
  }
  /**
   * The node at the front, descending into concatenations, or null at the
   * end.
   * @returns {RopeLeaf | RopeConcat | null}
   */
  front() {
    while (this.stack.length > 0) {
      const node = this.stack[this.stack.length - 1];
      if ("empty" in node) {
        this.stack.pop();
        continue;
      }
      return node;
    }
    return null;
  }
  descend() {
    const node = /** @type {RopeConcat} */ (this.stack.pop());
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
/** @type {WeakMap<Rope, WeakSet<Rope>>} */
const visiblyEqual = new WeakMap();

/**
 * @param {Rope} x
 * @param {Rope} y
 * @returns {boolean}
 */
function knownEqual(x, y) {
  const set = visiblyEqual.get(x);
  return set !== undefined && set.has(y);
}

/**
 * @param {Rope} x
 * @param {Rope} y
 */
function rememberEqual(x, y) {
  for (const [from, to] of [[x, y], [y, x]]) {
    let set = visiblyEqual.get(from);
    if (!set) visiblyEqual.set(from, (set = new WeakSet()));
    set.add(to);
  }
}

/**
 * The first differing pair of two ropes' actions, visible ones only or all.
 * @param {Rope} left
 * @param {Rope} right
 * @param {boolean} onlyVisible
 * @returns {Difference | null}
 */
function firstDifference(left, right, onlyVisible) {
  const difference = walkDifference(left, right, onlyVisible);
  if (difference === null && onlyVisible && !("leaf" in left) && !("leaf" in right)) rememberEqual(left, right);
  return difference;
}

/**
 * @param {Rope} left
 * @param {Rope} right
 * @param {boolean} onlyVisible
 * @returns {Difference | null}
 */
function walkDifference(left, right, onlyVisible) {
  const a = new Cursor(left);
  const b = new Cursor(right);
  let index = 0;
  /** @type {(cursor: Cursor, other: Cursor | null) => Action | "shared" | null} */
  const nextLeaf = (cursor, other) => {
    for (;;) {
      const node = cursor.front();
      if (node === null) return null;
      const opposite = other ? other.front() : null;
      if (opposite && !("leaf" in node) && (node === opposite || (onlyVisible && knownEqual(node, opposite)))) return "shared";
      if ("leaf" in node) {
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
        index += x.size;
        a.skip();
        b.skip();
        continue;
      }
      if (!("leaf" in x) && !("leaf" in y)) {
        a.descend();
        b.descend();
        continue;
      }
      break;
    }
    const x = nextLeaf(a, b);
    if (x === "shared") continue;
    const y = /** @type {Action | null} */ (nextLeaf(b, null));
    if (x === null && y === null) return null;
    if (x === null || y === null) return { left: x, right: y, index };
    if (!sameAction(x, y)) return { left: x, right: y, index };
    if (!onlyVisible || visible(x)) index++;
  }
}

// -1 when left beats right, 1 when right beats left, 0 when they are tied
// (engine §6). `lean` is greedy, lazy, or none for elision-only's check.
// The order of two sequences, and whether it is settled: a tie at a real
// difference, or two equal sequences, stays a tie whatever follows, while
// two sequences one of which is a prefix of the other are still undecided.
/**
 * @param {Rope} left
 * @param {Rope} right
 * @param {Lean} lean
 * @returns {{order: number, settled: boolean}}
 */
function comparison(left, right, lean) {
  const difference = firstDifference(left, right, true);
  if (!difference) return { order: 0, settled: true };
  if (!difference.left || !difference.right) return { order: 0, settled: false };
  return { order: decide({ left: difference.left, right: difference.right }, lean), settled: true };
}

/**
 * @param {{left: Action, right: Action}} difference
 * @param {Lean} lean
 * @returns {number}
 */
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
/**
 * @param {Rope} left
 * @param {Rope} right
 * @param {Lean} lean
 * @returns {number}
 */
function totalOrder(left, right, lean) {
  let difference = firstDifference(left, right, true);
  if (difference && difference.left && difference.right) {
    const decided = decide({ left: difference.left, right: difference.right }, lean);
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
/**
 * @param {Action} x
 * @param {Action} y
 * @returns {number}
 */
function canonicalKey(x, y) {
  if (x.kind === "read" || y.kind === "read") {
    if (x.kind !== y.kind) return x.kind === "read" ? -1 : 1;
    return compareCodePoints(/** @type {ReadAction} */ (x).terminal, /** @type {ReadAction} */ (y).terminal);
  }
  return x.item.production.id - y.item.production.id || x.item.origin - y.item.origin || x.item.end - y.item.end;
}

/**
 * What is open above an item over exactly its span: items, and rules by
 * their name prefixed with U+0000.
 * @typedef {Set<Item | string>} TraversalContext
 */

/** @type {TraversalContext} */
const EMPTY_CONTEXT = new Set();

export class Ranker {
  /**
   * @param {Token[]} tokens
   * @param {Lean} lean
   */
  constructor(tokens, lean) {
    this.tokens = tokens;
    this.lean = lean;
    /** @type {Map<Item, Map<string, Candidate[]>>} */
    this.memo = new Map();
    /** @type {Map<Item, Map<string, number>>} */
    this.counts = new Map();
    /** @type {Map<Item, number>} */
    this.itemIds = new Map();
  }

  // An item's candidates: for each sequence the item's derivations could
  // still be decided by, the T-least of them, `seq`, and the derivations tied
  // with it that diverge from it earliest, `alts`, with `at`, the number of
  // visible actions before that divergence (Infinity for those that differ
  // only in transparent actions). Of those, the T-least is the one reported;
  // alternatives whose T-order a later action could still change are kept
  // side by side. Sequences one of which is a visible prefix
  // of the other are not yet decided and are kept side by side; everything
  // else is settled here, so the list stays short.
  /**
   * @param {Item} item
   * @returns {Candidate[]}
   */
  candidates(item) {
    return this.traverse(item, this.memo, (current, dependency) => {
      /** @type {Candidate[]} */
      let kept = [];
      for (const edge of current.edges) {
        /** @type {Candidate[]} */
        let produced;
        if (edge.kind === "seed") produced = [{ seq: EMPTY, alts: [], at: Infinity }];
        else if (edge.kind === "scan") {
          const token = this.tokens[edge.token];
          const read = leaf({ kind: "read", token: edge.token, terminal: edge.terminal, weak: token.tags.get(edge.terminal) === false });
          produced = dependency(edge.previous).map((entry) => extend(entry, read));
        } else {
          const close = leaf({ kind: "close", item: edge.child });
          const children = dependency(edge.child).map((entry) => extend(entry, close));
          produced = [];
          for (const before of dependency(edge.previous)) {
            for (const child of children) {
              // A derivation tied with the combination differs from it first
              // either in the earlier part or in the child.
              /** @type {Candidate} */
              let entry = { seq: concat(before.seq, child.seq), alts: [], at: Infinity };
              for (const alt of before.alts) entry = this.offer(entry, concat(alt, child.seq), before.at);
              for (const alt of child.alts) entry = this.offer(entry, concat(before.seq, alt), before.seq.size + child.at);
              produced.push(entry);
            }
          }
        }
        for (const entry of produced) kept = this.keep(kept, entry);
      }
      return kept;
    }, []);
  }

  /**
   * @param {Item} item
   * @returns {Candidate[]}
   */
  full(item) {
    const close = leaf({ kind: "close", item });
    return this.candidates(item).map((entry) => extend(entry, close));
  }

  // The entry with `alt`, which diverges after `at` visible actions, among
  // its tied alternatives: alone if it diverges earlier than they do,
  // beside them if as early, keeping the T-lesser of any two whose order is
  // settled.
  /**
   * @param {Candidate} entry
   * @param {Rope} alt
   * @param {number} at
   * @returns {Candidate}
   */
  offer(entry, alt, at) {
    if (entry.alts.length === 0 || at < entry.at) return { seq: entry.seq, alts: [alt], at };
    if (at > entry.at) return entry;
    /** @type {Rope[]} */
    const alts = [];
    /** @type {Rope | null} */
    let current = alt;
    for (const other of entry.alts) {
      if (current === null || !orderSettled(other, current)) {
        alts.push(other);
        continue;
      }
      if (totalOrder(other, current, this.lean) <= 0) {
        alts.push(other);
        current = null;
      }
    }
    if (current !== null) alts.push(current);
    return { seq: entry.seq, alts, at };
  }

  // Adds a candidate to a list, settling it against every candidate it can
  // be settled against.
  /**
   * @param {Candidate[]} kept
   * @param {Candidate} entry
   * @returns {Candidate[]}
   */
  keep(kept, entry) {
    const lean = this.lean;
    /** @type {Candidate[]} */
    const result = [];
    /** @type {Candidate | null} */
    let current = entry;
    for (const other of kept) {
      if (current === null) {
        result.push(other);
        continue;
      }
      const difference = firstDifference(other.seq, current.seq, true);
      if (difference !== null && (!difference.left || !difference.right)) {
        result.push(other);
        continue;
      }
      const order = difference === null ? 0 : decide({ left: /** @type {Action} */ (difference.left), right: /** @type {Action} */ (difference.right) }, lean);
      const at = difference === null ? Infinity : difference.index;
      if (order !== 0) {
        // One beats the other at `at`; the loser's tied alternative is tied
        // with the winner too when it diverged from the loser earlier, and
        // then diverges from the winner where it diverged from the loser.
        /** @type {Candidate[]} */
        const pair = order < 0 ? [other, current] : [current, other];
        let [winner, loser] = pair;
        if (loser.at <= at) {
          for (const alt of loser.alts) if (isTie(winner.seq, alt, lean)) winner = this.offer(winner, alt, loser.at);
        }
        if (order < 0) {
          result.push(winner);
          current = null;
        } else {
          current = winner;
        }
        continue;
      }
      // Tied at `at`: the T-lesser stays; the other diverges from it at
      // `at`, and the other's own tied alternative at the earlier of its
      // divergence and `at` (ties are transitive).
      const first = totalOrder(other.seq, current.seq, lean) <= 0;
      const [main, second] = first ? [other, current] : [current, other];
      let merged = this.offer(main, second.seq, at);
      for (const alt of second.alts) merged = this.offer(merged, alt, Math.min(second.at, at));
      current = merged;
    }
    if (current !== null) result.push(current);
    return result;
  }

  /**
   * The number of derivations, capped at two.
   * @param {Item} item
   * @returns {number}
   */
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
  //
  // A derivation is cyclic when a constituent has, below it, one of the same
  // rule over the same span (engine §4). Spans only grow going up, so what
  // decides whether a derivation below an item is cyclic is the set of items
  // and rules open above it over exactly its own span, its context: a
  // dependency whose item or rule is in its context yields `cut`, and a
  // result is remembered for its item and context together. For almost
  // every item the context is empty.
  /**
   * @template T
   * @param {Item} root
   * @param {Map<Item, Map<string, T>>} memo
   * @param {(item: Item, dependency: (item: Item) => T) => T} combine
   * @param {T} cut the value of a dependency that would close a cycle
   * @returns {T}
   */
  traverse(root, memo, combine, cut) {
    /** @type {(item: Item) => Item[]} */
    const dependenciesOf = (item) => {
      /** @type {Item[]} */
      const result = [];
      for (const edge of item.edges) {
        if (edge.kind === "scan") result.push(edge.previous);
        else if (edge.kind === "complete") result.push(edge.previous, edge.child);
      }
      return result;
    };
    /** @type {(item: Item) => boolean} */
    const complete = (item) => item.dot === item.production.rhs.length;
    /** @type {(item: Item) => string} */
    const ruleKey = (item) => `\u0000${item.production.lhs}`;
    /** @type {(item: Item, key: string) => T | undefined} */
    const lookup = (item, key) => {
      const byContext = memo.get(item);
      return byContext ? byContext.get(key) : undefined;
    };
    /** @type {(item: Item, key: string, value: T) => void} */
    const store = (item, key, value) => {
      let byContext = memo.get(item);
      if (!byContext) memo.set(item, (byContext = new Map()));
      byContext.set(key, value);
    };
    const itemIds = this.itemIds;
    /** @type {(item: Item) => number} */
    const idOf = (item) => {
      let id = itemIds.get(item);
      if (id === undefined) itemIds.set(item, (id = itemIds.size));
      return id;
    };
    // The context of `item` below a frame: the frame's context and the
    // frame's own item and rule if it spans the same, else nothing.
    /** @type {(frame: Frame, item: Item) => TraversalContext} */
    const contextBelow = (frame, item) => {
      if (frame.item.origin !== item.origin || frame.item.end !== item.end) return EMPTY_CONTEXT;
      const context = new Set(frame.context);
      context.add(frame.item);
      if (complete(frame.item)) context.add(ruleKey(frame.item));
      return context;
    };
    /** @type {(context: TraversalContext) => string} */
    const contextKey = (context) => {
      if (context.size === 0) return "";
      return [...context].map((entry) => (typeof entry === "string" ? entry : "#" + idOf(entry))).sort().join("\u0001");
    };
    /**
     * @typedef {object} Frame
     * @property {Item} item
     * @property {TraversalContext} context
     * @property {Map<Item, T>} results
     * @property {boolean} started
     * @property {string} [key]
     * @property {Item[]} [pending]
     */
    /** @type {Frame[]} */
    const stack = [{ item: root, context: EMPTY_CONTEXT, results: new Map(), started: false }];
    /** @type {T} */
    let answer = cut;
    /** @type {(value: T) => void} */
    const deliver = (value) => {
      const done = /** @type {Frame} */ (stack.pop());
      if (stack.length === 0) answer = value;
      else stack[stack.length - 1].results.set(done.item, value);
    };
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (!frame.started) {
        if (frame.context.has(frame.item) || (complete(frame.item) && frame.context.has(ruleKey(frame.item)))) {
          deliver(cut);
          continue;
        }
        frame.key = contextKey(frame.context);
        const known = lookup(frame.item, frame.key);
        if (known !== undefined) {
          deliver(known);
          continue;
        }
        frame.pending = dependenciesOf(frame.item);
        frame.started = true;
      }
      let pushed = false;
      const pending = /** @type {Item[]} */ (frame.pending);
      for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
        if (frame.results.has(next)) continue;
        stack.push({ item: next, context: contextBelow(frame, next), results: new Map(), started: false });
        pushed = true;
        break;
      }
      if (pushed) continue;
      const value = combine(frame.item, (item) => /** @type {T} */ (frame.results.get(item)));
      store(frame.item, /** @type {string} */ (frame.key), value);
      deliver(value);
    }
    return answer;
  }

  // Ranks the derivations of the root items: the verdict, the chosen
  // derivation, the tied derivation diverging from it earliest if the
  // result is a tie, and the witness.
  /**
   * @param {Item[]} roots
   * @returns {Ranking}
   */
  rank(roots) {
    const count = Math.min(2, roots.reduce((sum, item) => sum + this.count(item), 0));
    /** @type {Candidate[]} */
    let kept = [];
    for (const root of roots) for (const entry of this.full(root)) kept = this.keep(kept, entry);
    // At the root nothing follows: candidates still undecided are tied
    // (engine §6), and T orders them.
    kept.sort((left, right) => totalOrder(left.seq, right.seq, this.lean));
    let main = kept[0];
    for (const other of kept.slice(1)) {
      const difference = firstDifference(main.seq, other.seq, true);
      const at = difference ? difference.index : Infinity;
      main = this.offer(main, other.seq, at);
      for (const alt of other.alts) main = this.offer(main, alt, Math.min(other.at, at));
    }
    /** @type {import("./types.js").Verdict} */
    let verdict;
    if (count === 1) verdict = "unique";
    else if (main.alts.length === 0) verdict = "resolved";
    else verdict = "tie";
    /** @type {[Action | null, Action | null] | null} */
    let witness = null;
    const second = verdict === "tie"
      ? main.alts.slice().sort((left, right) => totalOrder(left, right, this.lean))[0]
      : null;
    if (second) {
      let difference = firstDifference(main.seq, second, true);
      if (!difference || !difference.left || !difference.right) difference = firstDifference(main.seq, second, false);
      witness = difference ? [difference.left, difference.right] : null;
    }
    return { verdict, chosen: main.seq, second, witness };
  }
}

/**
 * @param {Candidate} entry
 * @param {RopeLeaf} action
 * @returns {Candidate}
 */
function extend(entry, action) {
  return { seq: concat(entry.seq, action), alts: entry.alts.map((alt) => concat(alt, action)), at: entry.at };
}

// Whether the T-order of two sequences is settled whatever follows: they
// differ at a visible action both have, or, visibly equal, at an action of
// all both have.
/**
 * @param {Rope} left
 * @param {Rope} right
 * @returns {boolean}
 */
function orderSettled(left, right) {
  const shown = firstDifference(left, right, true);
  if (shown) return Boolean(shown.left && shown.right);
  const all = firstDifference(left, right, false);
  return all === null || Boolean(all.left && all.right);
}

/**
 * @param {Rope} left
 * @param {Rope} right
 * @param {Lean} lean
 * @returns {boolean}
 */
function isTie(left, right, lean) {
  const { order, settled } = comparison(left, right, lean);
  return order === 0 && settled;
}

// The raw derivation tree of a rope: every production closed, helpers and
// all, with its children in order.
/**
 * @param {Rope} rope
 * @returns {Derivation}
 */
export function derivationTree(rope) {
  /** @type {Derivation[]} */
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

// Exposed for the property test, which checks the ranking against an
// enumeration of every derivation.
export const internals = { actions, firstDifference, totalOrder, decide, visible, concat, leaf };
