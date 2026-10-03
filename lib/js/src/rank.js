// Choosing a parse (engine §6): the first-difference order over bottom-up
// action sequences under greedy and lazy, and the order of elision vectors
// under late-elision, both computed over the packed forest.

import { compareCodePoints } from "./tags.js";
import { fault } from "./testing.js";

/**
 * @import { Action, Derivation, Item, Lean, Production, ReadAction, Rope, RopeConcat, RopeLeaf, Token } from "./types.js"
 * @import { Maximal } from "./maximal.js"
 */

/**
 * A value over an item's derivations, and over those an elided terminator
 * may follow (see Ranker.allowedCandidates).
 * @template T
 * @typedef {{all: T, allowed: T}} Allowed
 */

/**
 * An item's candidate (see Ranker.candidates).
 * @typedef {object} Candidate
 * @property {Rope} seq
 * @property {Rope[]} alts
 * @property {Count} at
 */

/**
 * The first differing pair of two sequences' actions, null on the side
 * that ended, and the number of visible actions before it.
 * @typedef {{left: Action | null, right: Action | null, index: Count}} Difference
 */

/**
 * A count of actions or of elided terminators. It is a number while it is
 * a safe integer, and a bigint beyond, since a shared sequence can hold
 * exponentially many. Infinity stands for no divergence. Counts compare
 * exactly with < and >, whatever their types.
 * @typedef {number | bigint} Count
 */

/**
 * The sum of two counts, exact however large.
 * @param {Count} left
 * @param {Count} right
 * @returns {Count}
 */
function add(left, right) {
  if (typeof left === "number" && typeof right === "number") {
    const sum = left + right;
    if (sum <= Number.MAX_SAFE_INTEGER || sum === Infinity) return sum;
  }
  if (left === Infinity || right === Infinity) return Infinity;
  return BigInt(left) + BigInt(right);
}

/**
 * The difference of two finite counts, the right one no greater.
 * @param {Count} left
 * @param {Count} right
 * @returns {Count}
 */
function subtract(left, right) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  const difference = BigInt(left) - BigInt(right);
  return difference <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(difference) : difference;
}

/**
 * The lesser of two counts.
 * @param {Count} left
 * @param {Count} right
 * @returns {Count}
 */
function lesser(left, right) {
  return right < left ? right : left;
}

/**
 * What the ranking concluded: the verdict, the first reading, m, which is
 * the chosen derivation unless the verdict is a tie, and for a tie the
 * second reading and the witness (engine §6).
 * @typedef {object} Ranking
 * @property {import("./types.js").Verdict} verdict
 * @property {Rope} first
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
  return { left, right, size: add(left.size, right.size) };
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
  /** @type {Count} */
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
        index = add(index, x.size);
        a.skip();
        b.skip();
        continue;
      }
      if (!("leaf" in x) && !("leaf" in y)) {
        // Descend the larger side first, so that a subtree the two share is
        // met at the front of both rather than walked leaf by leaf because
        // it sits at different depths. Only a skip of both sides or a leaf
        // from each consumes anything, so the order of descent cannot change
        // the result.
        if (x.size >= y.size) a.descend();
        if (y.size >= x.size) b.descend();
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
    if (!onlyVisible || visible(x)) index = add(index, 1);
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
  // Two reads of one token as different terminals are tied (engine §6).
  if (x.kind === "read" && y.kind === "read") return 0;
  if (x.kind !== y.kind) {
    if (lean === "none") return 0;
    const leftReads = x.kind === "read";
    const readWins = lean === "greedy";
    return leftReads === readWins ? -1 : 1;
  }
  return 0;
}

// The total order T (engine §6): at the first visible difference, the
// pair's decision by lean, and where that is a tie, the
// canonical keys; sequences equal in their visible actions are ordered at
// their first difference among all actions. The first reading is T's
// minimum. T orders the diagnostics and picks the terminator that a
// maximal rejection reports, and never turns a tie into a choice.
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
 * The rules of the constituents above an item over exactly its span, each
 * by its name prefixed with U+0000: its cycle context (engine §6).
 * @typedef {Set<string>} TraversalContext
 */

/** @type {TraversalContext} */
const EMPTY_CONTEXT = new Set();

export class Ranker {
  /**
   * @param {Token[]} tokens
   * @param {Lean} lean
   * @param {Maximal | null} [maximal] the resolution's maximal, if it has
   *   it (engine §4)
   * @param {number[] | null} [project] positions to find cycles over in
   *   place of the items' own, which only a fault of the check of engine
   *   §7 gives (F19)
   */
  constructor(tokens, lean, maximal = null, project = null) {
    this.tokens = tokens;
    /** @type {(left: Item, right: Item) => boolean} */
    this.sameSpan = project === null
      ? (left, right) => left.origin === right.origin && left.end === right.end
      : (left, right) => project[left.origin] === project[right.origin] && project[left.end] === project[right.end];
    // Under late-elision, the readings come from a ranking with no lean
    // over the forest of the best derivations (engine §6).
    this.elisions = lean === "late-elision";
    /** @type {Lean} */
    this.lean = this.elisions ? "none" : lean;
    this.maximal = maximal;
    /** @type {{plain: Map<Item, Allowed<ElisionSummary>>, contextual: Map<Item, Map<string, Allowed<ElisionSummary>>>}} */
    this.summaries = { plain: new Map(), contextual: new Map() };
    /** @type {Map<number, ElisionSeq>} */
    this.elisionLeaves = new Map();
    /** @type {Map<string, number>} */
    this.ruleGroups = new Map();
    // The group of a rule: its strongly connected group in the graph of
    // groupRules, or undefined for a rule that cannot reach itself there.
    /** @type {(rule: string) => number | undefined} */
    this.groups = (rule) => this.ruleGroups.get(rule);
    /** @type {{plain: Map<Item, Allowed<Candidate[]>>, contextual: Map<Item, Map<string, Allowed<Candidate[]>>>}} */
    this.memo = { plain: new Map(), contextual: new Map() };
    /** @type {{plain: Map<Item, Allowed<number>>, contextual: Map<Item, Map<string, Allowed<number>>>}} */
    this.counts = { plain: new Map(), contextual: new Map() };
    /** @type {Map<Item, RopeLeaf>} */
    this.closes = new Map();
    /** @type {Map<string, RopeLeaf>} */
    this.reads = new Map();
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
    return this.allowedCandidates(item).all;
  }

  // An item's candidates twice: over all its derivations, and, under maximal
  // (engine §4, §6), for an item whose next symbol is an elidable optional,
  // over only the ways of building it whose last symbol's node maximal does
  // not forbid, which an elided terminator may follow. An elided
  // terminator's edge takes the second of the item before it.
  /**
   * @param {Item} item
   * @returns {Allowed<Candidate[]>}
   */
  allowedCandidates(item) {
    const maximal = this.maximal;
    return this.traverse(item, this.memo, (current, dependency, key) => {
      const guarded = maximal !== null && maximal.guards(current);
      // Under late-elision, only the edges that attain the least vector of
      // the item in its context (engine §6).
      const summary = this.elisions ? this.summaryAt(current, key) : null;
      /** @type {Candidate[]} */
      let all = [];
      /** @type {Candidate[]} */
      let allowed = [];
      current.edges.forEach((edge, index) => {
        const inAll = summary === null || summary.all.kept.has(index);
        const inAllowed = summary === null || summary.allowed.kept.has(index);
        if (!inAll && !inAllowed) return;
        /** @type {Candidate[]} */
        let produced;
        let permitted = true;
        if (edge.kind === "seed") produced = [{ seq: EMPTY, alts: [], at: Infinity }];
        // A restoration reads its synthetic token, and its own close
        // follows (engine §7.4, §7.7).
        // A fault gives a restoration no derivation in the ranking
        // (lost:rank), here and in the summaries and the counts below.
        else if (edge.kind === "restore") produced = fault("lost:rank") ? [] : [{ seq: this.readLeaf(edge.token, edge.terminal), alts: [], at: Infinity }];
        else if (edge.kind === "scan") {
          const read = this.readLeaf(edge.token, edge.terminal);
          produced = dependency(edge.previous).all.map((entry) => extend(entry, read));
        } else {
          const close = this.closeLeaf(edge.child);
          const children = dependency(edge.child).all.map((entry) => extend(entry, close));
          const earlier = maximal !== null && maximal.elided(edge.child) ? dependency(edge.previous).allowed : dependency(edge.previous).all;
          produced = [];
          for (const before of earlier) {
            for (const child of children) {
              // A derivation tied with the combination differs from it first
              // either in the earlier part or in the child.
              /** @type {Candidate} */
              let entry = { seq: concat(before.seq, child.seq), alts: [], at: Infinity };
              for (const alt of before.alts) entry = this.offer(entry, concat(alt, child.seq), before.at);
              for (const alt of child.alts) entry = this.offer(entry, concat(before.seq, alt), add(before.seq.size, child.at));
              produced.push(entry);
            }
          }
          if (guarded) permitted = !(/** @type {Maximal} */ (maximal)).forbids(edge.child, current.production.rhs[current.dot - 1].test);
        }
        for (const entry of produced) {
          if (inAll) all = this.keep(all, entry);
          if (guarded && permitted && inAllowed) allowed = this.keep(allowed, entry);
        }
      });
      return { all, allowed: guarded ? allowed : all };
    }, { all: [], allowed: [] }, this.elisions ? (current, key) => this.keptEdges(current, key) : null);
  }

  // Under late-elision, an item's summaries in one context (engine §6).
  // As for the candidates, one summary covers all its derivations, and the
  // other only those that an elided terminator can follow. Each holds the
  // least elision vector, the number of derivations that attain it and the
  // number of all derivations, both capped at two. It also holds the edges
  // that attain the least vector.
  /**
   * @param {Item} item
   * @returns {Allowed<ElisionSummary>}
   */
  elisionSummary(item) {
    const maximal = this.maximal;
    return this.traverse(item, this.summaries, (current, dependency) => {
      const guarded = maximal !== null && maximal.guards(current);
      const all = noDerivation();
      const allowed = guarded ? noDerivation() : all;
      current.edges.forEach((edge, index) => {
        /** @type {ElisionSeq} */
        let vector;
        let least;
        let total;
        let permitted = true;
        if (edge.kind === "restore" && fault("lost:rank")) return;
        if (edge.kind === "seed" || edge.kind === "restore") {
          // The helper of an elidable optional that derives ε elides its
          // terminator where it is empty. A restoration elides nothing.
          vector = edge.kind === "seed" && isElided(current) ? this.elisionLeaf(current.origin) : NO_ELISIONS;
          least = 1;
          total = 1;
        } else if (edge.kind === "scan") {
          const before = dependency(edge.previous).all;
          if (before.total === 0) return;
          vector = /** @type {ElisionSeq} */ (before.vector);
          least = before.least;
          total = before.total;
        } else {
          const earlier = dependency(edge.previous);
          const before = maximal !== null && maximal.elided(edge.child) ? earlier.allowed : earlier.all;
          const child = dependency(edge.child).all;
          if (before.total === 0 || child.total === 0) return;
          vector = concatElisions(/** @type {ElisionSeq} */ (before.vector), /** @type {ElisionSeq} */ (child.vector));
          least = Math.min(2, before.least * child.least);
          total = Math.min(2, before.total * child.total);
          if (guarded) permitted = !(/** @type {Maximal} */ (maximal)).forbids(edge.child, current.production.rhs[current.dot - 1].test);
        }
        addEdge(all, index, vector, least, total);
        if (guarded && permitted) addEdge(allowed, index, vector, least, total);
      });
      return { all, allowed };
    }, { all: noDerivation(), allowed: noDerivation() });
  }

  /**
   * The summaries of an item in the context that `key` names, which
   * elisionSummary has already computed.
   * @param {Item} item
   * @param {string} key
   * @returns {Allowed<ElisionSummary>}
   */
  summaryAt(item, key) {
    const found = key === "" ? this.summaries.plain.get(item) : this.summaries.contextual.get(item)?.get(key);
    if (found === undefined) throw new Error(`no elision summary for an item in context ${JSON.stringify(key)}`);
    return found;
  }

  /**
   * The edges of an item that attain a least vector in its context.
   * @param {Item} item
   * @param {string} key
   * @returns {import("./types.js").Edge[]}
   */
  keptEdges(item, key) {
    const summary = this.summaryAt(item, key);
    return item.edges.filter((_, index) => summary.all.kept.has(index) || summary.allowed.kept.has(index));
  }

  /**
   * The one sequence of a single elision at a position.
   * @param {number} at
   * @returns {ElisionSeq}
   */
  elisionLeaf(at) {
    let found = this.elisionLeaves.get(at);
    if (!found) this.elisionLeaves.set(at, (found = { size: 1, first: at, last: at }));
    return found;
  }

  /**
   * The one leaf for closing an item: every sequence that closes it shares
   * it, rather than each making its own.
   * @param {Item} item
   * @returns {RopeLeaf}
   */
  closeLeaf(item) {
    let found = this.closes.get(item);
    if (!found) this.closes.set(item, (found = leaf({ kind: "close", item })));
    return found;
  }

  /**
   * The one leaf for reading a token as a terminal.
   * @param {number} token
   * @param {string} terminal
   * @returns {RopeLeaf}
   */
  readLeaf(token, terminal) {
    const key = `${token}\u0000${terminal}`;
    let found = this.reads.get(key);
    if (!found) this.reads.set(key, (found = leaf({ kind: "read", token, terminal })));
    return found;
  }

  /**
   * An item's candidates, each ended by the item's own close.
   * @param {Item} item
   * @returns {Candidate[]}
   */
  full(item) {
    const close = this.closeLeaf(item);
    return this.candidates(item).map((entry) => extend(entry, close));
  }

  // The entry with `alt`, which diverges after `at` visible actions, among
  // its tied alternatives: alone if it diverges earlier than they do,
  // beside them if as early, keeping the T-lesser of any two whose order is
  // settled.
  /**
   * @param {Candidate} entry
   * @param {Rope} alt
   * @param {Count} at
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
      for (const alt of second.alts) merged = this.offer(merged, alt, lesser(second.at, at));
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
    const maximal = this.maximal;
    return this.traverse(item, this.counts, (current, dependency) => {
      const guarded = maximal !== null && maximal.guards(current);
      let all = 0;
      let allowed = 0;
      for (const edge of current.edges) {
        let ways;
        if (edge.kind === "restore" && fault("lost:rank")) continue;
        if (edge.kind === "seed" || edge.kind === "restore") ways = 1;
        else if (edge.kind === "scan") ways = dependency(edge.previous).all;
        else {
          const before = dependency(edge.previous);
          ways = (maximal !== null && maximal.elided(edge.child) ? before.allowed : before.all) * dependency(edge.child).all;
        }
        all = Math.min(2, all + ways);
        if (guarded && (edge.kind !== "complete" || !(/** @type {Maximal} */ (maximal)).forbids(edge.child, current.production.rhs[current.dot - 1].test))) allowed = Math.min(2, allowed + ways);
        if (all === 2 && (!guarded || allowed === 2)) break;
      }
      return { all, allowed: guarded ? allowed : all };
    }, { all: 0, allowed: 0 }).all;
  }

  // Computes `combine(item, dependency)` for an item after every item it
  // depends on, with an explicit stack rather than recursion, since a
  // left-recursive rule over a long text nests as deep as the text is long.
  //
  // A derivation is cyclic when a constituent has, below it, one of the same
  // rule over the same span (engine §4). Spans only grow going up, so what
  // decides whether a derivation below an item is cyclic is the set of rules
  // of the constituents above it over exactly its own span, its context. A
  // completed item whose rule is in its context yields `cut`, and a result is
  // remembered for its item and context together. For almost every item the
  // context is empty.
  /**
   * @template T
   * @param {Item} root
   * @param {{plain: Map<Item, T>, contextual: Map<Item, Map<string, T>>}} memo
   * @param {(item: Item, dependency: (item: Item) => T, key: string) => T} combine
   *   `key` names the item's context
   * @param {T} cut the value of a dependency that would close a cycle
   * @param {((item: Item, key: string) => import("./types.js").Edge[]) | null} [edgesOf]
   *   the edges whose children `combine` reads, if not all
   * @returns {T}
   */
  traverse(root, memo, combine, cut, edgesOf = null) {
    /** @type {(item: Item, key: string) => Item[]} */
    const dependenciesOf = (item, key) => {
      /** @type {Item[]} */
      const result = [];
      for (const edge of edgesOf ? edgesOf(item, key) : item.edges) {
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
    // Almost every item is looked up with no context, so those results are
    // kept in a plain map and only the rest by context.
    const lookup = (item, key) => {
      if (key === "") return memo.plain.get(item);
      const byContext = memo.contextual.get(item);
      return byContext ? byContext.get(key) : undefined;
    };
    /** @type {(item: Item, key: string, value: T) => void} */
    const store = (item, key, value) => {
      if (key === "") {
        memo.plain.set(item, value);
        return;
      }
      let byContext = memo.contextual.get(item);
      if (!byContext) memo.contextual.set(item, (byContext = new Map()));
      byContext.set(key, value);
    };
    // The context of `item` below a frame: the frame's context and, for a
    // complete frame, its rule, if the frame spans the same, else nothing.
    // The context holds rules only (engine §6). Keyed by the items above as
    // well, the contexts of one item would differ by the path that reaches
    // it, and their number could grow exponentially. Of those rules, it
    // keeps only the ones in the item's group (see groups), since no other
    // rule can complete again over the same span below the item. Keyed by
    // every rule above, the contexts would still differ by path wherever
    // two rules lead to the same one.
    const group = this.groups;
    /** @type {(frame: Frame, item: Item) => TraversalContext} */
    const contextBelow = (frame, item) => {
      if (!this.sameSpan(frame.item, item)) return EMPTY_CONTEXT;
      const own = group(item.production.lhs);
      if (own === undefined) return EMPTY_CONTEXT;
      /** @type {TraversalContext} */
      const context = new Set();
      for (const key of frame.context) if (group(key.slice(1)) === own) context.add(key);
      if (complete(frame.item) && group(frame.item.production.lhs) === own) context.add(ruleKey(frame.item));
      return context.size === 0 ? EMPTY_CONTEXT : context;
    };
    /** @type {(context: TraversalContext) => string} */
    const contextKey = (context) => {
      if (context.size === 0) return "";
      return [...context].sort().join("\u0001");
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
        if (complete(frame.item) && frame.context.has(ruleKey(frame.item))) {
          deliver(cut);
          continue;
        }
        frame.key = contextKey(frame.context);
        const known = lookup(frame.item, frame.key);
        if (known !== undefined) {
          deliver(known);
          continue;
        }
        frame.pending = dependenciesOf(frame.item, frame.key);
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
      const value = combine(frame.item, (item) => /** @type {T} */ (frame.results.get(item)), /** @type {string} */ (frame.key));
      store(frame.item, /** @type {string} */ (frame.key), value);
      deliver(value);
    }
    return answer;
  }

  // Groups the rules of the forest below the roots for the cycle context.
  // The graph has an arc from a rule to another when an item of the first
  // has a completed child of the second over the same span. A rule above an
  // item over its span can complete again below it only if the two rules
  // reach each other in this graph, that is, are in one strongly connected
  // group. So a context needs only the rules of its item's group, and an
  // item whose rule cannot reach itself has none.
  /**
   * @param {Item[]} roots
   */
  groupRules(roots) {
    /** @type {Map<string, Set<string>>} */
    const arcs = new Map();
    /** @type {Set<Item>} */
    const seen = new Set();
    const pending = [...roots];
    for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
      if (seen.has(item)) continue;
      seen.add(item);
      for (const edge of item.edges) {
        if (edge.kind === "seed" || edge.kind === "restore") continue;
        pending.push(edge.previous);
        if (edge.kind !== "complete") continue;
        pending.push(edge.child);
        if (!this.sameSpan(edge.child, item)) continue;
        let targets = arcs.get(item.production.lhs);
        if (!targets) arcs.set(item.production.lhs, (targets = new Set()));
        targets.add(edge.child.production.lhs);
      }
    }
    // Tarjan's algorithm, with an explicit stack.
    /** @type {Map<string, number>} */
    const index = new Map();
    /** @type {Map<string, number>} */
    const low = new Map();
    /** @type {string[]} */
    const open = [];
    /** @type {Set<string>} */
    const onOpen = new Set();
    const groups = this.ruleGroups;
    groups.clear();
    let next = 0;
    let found = 0;
    for (const start of arcs.keys()) {
      if (index.has(start)) continue;
      /** @type {{rule: string, targets: Iterator<string>}[]} */
      const frames = [];
      /** @type {(rule: string) => void} */
      const enter = (rule) => {
        index.set(rule, next);
        low.set(rule, next);
        next++;
        open.push(rule);
        onOpen.add(rule);
        frames.push({ rule, targets: (arcs.get(rule) || new Set()).values() });
      };
      enter(start);
      while (frames.length > 0) {
        const frame = frames[frames.length - 1];
        const step = frame.targets.next();
        if (!step.done) {
          const target = step.value;
          if (!index.has(target)) enter(target);
          else if (onOpen.has(target)) low.set(frame.rule, Math.min(/** @type {number} */ (low.get(frame.rule)), /** @type {number} */ (index.get(target))));
          continue;
        }
        frames.pop();
        if (frames.length > 0) {
          const parent = frames[frames.length - 1].rule;
          low.set(parent, Math.min(/** @type {number} */ (low.get(parent)), /** @type {number} */ (low.get(frame.rule))));
        }
        if (low.get(frame.rule) === index.get(frame.rule)) {
          /** @type {string[]} */
          const members = [];
          for (;;) {
            const member = /** @type {string} */ (open.pop());
            onOpen.delete(member);
            members.push(member);
            if (member === frame.rule) break;
          }
          // A group of one rule without an arc to itself has no cycle.
          if (members.length > 1 || (arcs.get(frame.rule) || new Set()).has(frame.rule)) {
            for (const member of members) groups.set(member, found);
            found++;
          }
        }
      }
    }
  }

  // Ranks the derivations of the root items: the verdict, the first
  // reading, and for a tie the second reading, the tied derivation that
  // diverges from the first earliest, and the witness.
  /**
   * @param {Item[]} roots
   * @param {Item[]} [groupsOf] the roots whose forest gives the rules'
   *   groups, and so the contexts of cycles: by default `roots`. The witness
   *   hook of the check ranks a part of a forest in the contexts of the
   *   whole.
   * @returns {Ranking | null} null when every derivation is cyclic
   */
  rank(roots, groupsOf = roots) {
    this.groupRules(groupsOf);
    let count;
    let ranked = roots;
    let tied = false;
    if (this.elisions) {
      // Every complete item of `text` is an edge of one root (engine §6).
      const root = noDerivation();
      roots.forEach((item, index) => {
        const summary = this.elisionSummary(item).all;
        if (summary.total > 0) addEdge(root, index, /** @type {ElisionSeq} */ (summary.vector), summary.least, summary.total);
      });
      count = root.total;
      tied = root.least === 2;
      ranked = roots.filter((_, index) => root.kept.has(index));
    } else {
      count = Math.min(2, roots.reduce((sum, item) => sum + this.count(item), 0));
    }
    /** @type {Candidate[]} */
    let kept = [];
    for (const root of ranked) for (const entry of this.full(root)) kept = this.keep(kept, entry);
    // At the root nothing follows: candidates still undecided are tied
    // (engine §6), and T orders them.
    if (kept.length === 0) return null;
    kept.sort((left, right) => totalOrder(left.seq, right.seq, this.lean));
    let main = kept[0];
    for (const other of kept.slice(1)) {
      const difference = firstDifference(main.seq, other.seq, true);
      const at = difference ? difference.index : Infinity;
      main = this.offer(main, other.seq, at);
      for (const alt of other.alts) main = this.offer(main, alt, lesser(other.at, at));
    }
    /** @type {import("./types.js").Verdict} */
    let verdict;
    if (count === 1) verdict = "unique";
    else if (this.elisions ? !tied : main.alts.length === 0) verdict = "resolved";
    else verdict = "tie";
    // The forest of the best derivations holds a second one exactly when
    // the least count is two.
    if (this.elisions && tied !== main.alts.length > 0) throw new Error("the least count of late-elision disagrees with its forest");
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
    return { verdict, first: main.seq, second, witness };
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
      // A restoration closes its empty production over the one token that
      // it read (engine §7.4).
      const arity = action.item.restores ? 1 : action.item.production.rhs.length;
      const children = stack.splice(stack.length - arity, arity);
      stack.push({ item: action.item, production: action.item.production, children, start: action.item.origin, end: action.item.end });
    }
  }
  return stack[stack.length - 1];
}

// Under late-elision, a derivation's elided terminators as the sequence of
// their positions, in text order: its elision vector (engine §6). The
// elisions of an edge's children are those of the item before it and then
// those of the child, so the sequence of an edge is the two concatenated,
// and sequences built on one prefix share it.
// Each node knows its size and its first and last positions. A node whose
// first and last positions are equal is a run: all its elisions stand at one
// position. A comparison takes a run whole, so it never walks a run's
// elisions one by one, however many a shared sequence holds.
/**
 * @typedef {ElisionNode | {size: 0}} ElisionSeq
 */

/**
 * A sequence that holds at least one elision: one elision, or two
 * sequences joined.
 * @typedef {{size: Count, first: number, last: number, left?: ElisionSeq, right?: ElisionSeq}} ElisionNode
 */

/**
 * An item's derivations in one context under late-elision: the least
 * vector and the number of derivations that attain it, the number of all
 * derivations, both capped at two, and the indices of the edges that attain
 * the least vector.
 * @typedef {object} ElisionSummary
 * @property {ElisionSeq | null} vector null when there is no derivation
 * @property {number} least
 * @property {number} total
 * @property {Set<number>} kept
 */

/** @type {ElisionSeq} */
const NO_ELISIONS = { size: 0 };

/** @returns {ElisionSummary} */
function noDerivation() {
  return { vector: null, least: 0, total: 0, kept: new Set() };
}

/**
 * @param {ElisionSeq} left
 * @param {ElisionSeq} right
 * @returns {ElisionSeq}
 */
function concatElisions(left, right) {
  if (!("first" in left)) return right;
  if (!("first" in right)) return left;
  return { left, right, size: add(left.size, right.size), first: left.first, last: right.last };
}

// Adds an edge's derivations to a summary. The total counts every edge,
// losing ones included. The least count and the kept edges count only the
// edges that attain the least vector.
/**
 * @param {ElisionSummary} summary
 * @param {number} index
 * @param {ElisionSeq} vector
 * @param {number} least
 * @param {number} total
 */
function addEdge(summary, index, vector, least, total) {
  summary.total = Math.min(2, summary.total + total);
  const order = summary.vector === null ? -1 : compareElisions(vector, summary.vector);
  if (order < 0) {
    summary.vector = vector;
    summary.least = least;
    summary.kept = new Set([index]);
  } else if (order === 0) {
    summary.least = Math.min(2, summary.least + least);
    summary.kept.add(index);
  }
}

// -1 when the left vector is less, 1 when the right one is, 0 when they are
// equal. Two sequences of positions compare at their first difference. The
// one that elides at the earlier position has the greater count there, so
// the later position is less. A sequence that ends first has fewer
// elisions after the shared part, so it is less. The comparison goes run by
// run, and counts what it has taken of the run at the front of each side.
/**
 * @param {ElisionSeq} left
 * @param {ElisionSeq} right
 * @returns {number}
 */
export function compareElisions(left, right) {
  /** @type {ElisionCursor} */
  const a = { stack: [left], taken: 0 };
  /** @type {ElisionCursor} */
  const b = { stack: [right], taken: 0 };
  for (;;) {
    const x = elisionFront(a);
    const y = elisionFront(b);
    if (x === null || y === null) return x === null ? (y === null ? 0 : -1) : 1;
    // A part that both share, at the same point, is equal.
    if (x === y && !(a.taken < b.taken) && !(a.taken > b.taken)) {
      dropFront(a);
      dropFront(b);
      continue;
    }
    const xRun = x.first === x.last;
    const yRun = y.first === y.last;
    if (!xRun || !yRun) {
      // Descend the larger side first, so that a part both share is met at
      // the front of both. Only a node that is no run is descended, and
      // nothing of it has been taken.
      if (!xRun && (yRun || !(x.size < y.size))) descendFront(a, x);
      if (!yRun && (xRun || !(y.size < x.size))) descendFront(b, y);
      continue;
    }
    if (x.first !== y.first) return x.first > y.first ? -1 : 1;
    const xLeft = subtract(x.size, a.taken);
    const yLeft = subtract(y.size, b.taken);
    if (xLeft < yLeft) {
      dropFront(a);
      b.taken = add(b.taken, xLeft);
    } else if (yLeft < xLeft) {
      dropFront(b);
      a.taken = add(a.taken, yLeft);
    } else {
      dropFront(a);
      dropFront(b);
    }
  }
}

/**
 * A walk over an elision sequence: the nodes still to take, and how much of
 * the run at the front it has taken.
 * @typedef {{stack: ElisionSeq[], taken: Count}} ElisionCursor
 */

/**
 * The node at the front of a walk, or null at its end.
 * @param {ElisionCursor} cursor
 * @returns {ElisionNode | null}
 */
function elisionFront(cursor) {
  while (cursor.stack.length > 0) {
    const node = cursor.stack[cursor.stack.length - 1];
    if ("first" in node) return node;
    cursor.stack.pop();
  }
  return null;
}

/** @param {ElisionCursor} cursor */
function dropFront(cursor) {
  cursor.stack.pop();
  cursor.taken = 0;
}

/**
 * @param {ElisionCursor} cursor
 * @param {ElisionNode} node
 */
function descendFront(cursor, node) {
  cursor.stack.pop();
  cursor.stack.push(/** @type {ElisionSeq} */ (node.right), /** @type {ElisionSeq} */ (node.left));
}

/**
 * Whether a completed item is an elided terminator: the empty production
 * of an elidable optional's helper (engine §4).
 * @param {Item} item
 * @returns {boolean}
 */
function isElided(item) {
  return item.production.helper && item.production.elided !== null && item.production.rhs.length === 0;
}

// Exposed for the property test, which checks the ranking against an
// enumeration of every derivation.
export const internals = { actions, firstDifference, totalOrder, decide, visible, concat, leaf, concatElisions };
