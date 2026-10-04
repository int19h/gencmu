// Recognition (engine §4) and the terms and conditions it evaluates
// (engine §10).

import { GencmuError } from "./errors.js";
import { Sources } from "./tokens.js";
import { eligibleWitnesses } from "./eligible.js";
import { countWork, fault, hooks } from "./testing.js";
import { conditionVariables } from "./grammar.js";
import { tagKey, tagUnion, tagIntersection, tagDifference, isSubset, sameTags, tagSet, compareCodePoints, codeOfCharacterTag, rangeTags, isName, splitString } from "./tags.js";

/**
 * @import { Argument, CharacterClass, Condition, Edge, Expectation, GrammarSymbol, LoweredGrammar, Production, Scope, Captured, SpanValue, SymbolTest, TagSet, Term, TermValue } from "./types.js"
 * @import { Token } from "./tokens.js"
 * @import { UnicodeTable } from "./unicode.js"
 */

/**
 * A chart: one set per position of the span it was run over.
 * @typedef {object} Chart
 * @property {ChartSet[]} sets
 * @property {number} start
 * @property {number} end
 * @property {(position: number) => ChartSet} setAt reads a set without
 *   making it: a set the recognizer never reached is empty
 * @property {number} furthest the last position whose set holds an item
 * @property {ParseContext} context
 */

// Interns tag sets, so that an item names a captured part's tags by number.
export class TagInterner {
  constructor() {
    /** @type {TagSet[]} */
    this.sets = [];
    /** @type {Map<string, number>} */
    this.ids = new Map();
  }
  /**
   * @param {TagSet} tags
   * @returns {number}
   */
  intern(tags) {
    const key = tagKey(tags);
    let id = this.ids.get(key);
    if (id === undefined) {
      id = this.sets.length;
      this.sets.push(tags);
      this.ids.set(key, id);
    }
    return id;
  }
  /**
   * @param {number} id
   * @returns {TagSet}
   */
  get(id) {
    return this.sets[id];
  }
}

// How many items the recognizer has made, in parses and nested parses
// alike: a measure of work that tests compare across input lengths.
export const recognizerCounters = { items: 0, captures: 0 };

// What a parse and every nested parse it starts share.
export class ParseContext {
  /**
   * @param {LoweredGrammar} lowered
   * @param {Token[]} tokens
   * @param {string[]} sourceText the text's code points
   * @param {UnicodeTable} unicode
   * @param {TagInterner} [interner] the interner of another context whose
   *   tag numbers this one shares, as the check of engine §7 shares the
   *   main parse's
   */
  constructor(lowered, tokens, sourceText, unicode, interner) {
    this.lowered = lowered;
    this.tokens = tokens;
    /** Where each run of the tokens lies in the text (engine §1). */
    this.sources = new Sources(tokens);
    this.sourceText = sourceText;
    this.unicode = unicode;
    this.interner = interner || new TagInterner();
    // Each sequence of captured parts that an item of this context has,
    // made once (captureAfter).
    /** @type {Map<string, NonNullable<Captured>>} */
    this.captured = new Map();
    /**
     * How the recognizer reads elidable optionals: null as engine §4 says,
     * "reconstruction" in the mode of engine §7.4, or "mandatory", the old
     * contract, where an elidable optional is never empty (a fault).
     * @type {null | "reconstruction" | "mandatory"}
     */
    this.mode = null;
    /**
     * For each token, whether it is a synthetic token of engine §7.2, by
     * its provenance; null where none is.
     * @type {boolean[] | null}
     */
    this.synthetic = null;
    /**
     * On the context of the reconstructed input of engine §7, how its
     * observations reach the stage's input; null elsewhere.
     * @type {Reconstruction | null}
     */
    this.recon = null;
    /** Whether the check of engine §7 is running over this context's input. */
    this.checking = false;
    /**
     * Each token's phonemes in canonical form, for the sound tests of
     * symbols and for phonemes(), computed when one first looks at the
     * token (engine §4, §5).
     * @type {(string | undefined)[]}
     */
    this.sounds = new Array(tokens.length);
    // The most places a dot can be in one production, for numbering the
    // items of a set (see itemKey).
    this.dots = lowered.productions.reduce((most, production) => Math.max(most, production.rhs.length + 1), 1);
    /** @type {Map<string, boolean | TagSet>} */
    this.nested = new Map();
    /** @type {Set<string>} */
    this.inProgress = new Set();
    /** Where the input of the recognition now running begins. */
    this.inputStart = 0;
    /** Where it ends. */
    this.inputEnd = tokens.length;
    /**
     * When set, the recognizer records what happens at one position of the
     * top-level parse, for diagnostics (see diagnostics.js, trace).
     * @type {{position: number, events: TraceEvent[], depth: number} | null}
     */
    this.trace = null;
  }
}

/**
 * How the recognition of the reconstructed input R observes the stage's
 * input O (engine §7.3, §7.5).
 * @typedef {object} Reconstruction
 * @property {ParseContext} observed the context of O, the main parse's,
 *   whose memo and active queries the check shares
 * @property {number[]} project π: for each position of R, the number of
 *   original tokens before it
 * @property {boolean} raw whether observations read R itself, as the old
 *   contract did (a fault)
 * @property {Map<string, ParseContext>} faulty the contexts of queries
 *   that a fault sends elsewhere, by fault
 */

/**
 * Something the recognizer did at the traced position: an item predicted,
 * advanced or completed there, or an advance that a condition refused.
 * @typedef {object} TraceEvent
 * @property {"predicted" | "advanced" | "completed" | "dropped"} kind
 * @property {Production} production
 * @property {number} dot the dot of the item made, or of the item refused
 * @property {number} origin
 * @property {Condition} [condition] for a drop, the condition that failed
 * @property {SymbolTest} [test] for a drop, the test of the symbol the item
 *   would have advanced over, which did not hold
 */

// A chart item: a production with a dot, its origin, and its captured
// parts; `end` is the position of the set that holds it.
//
// A long text makes millions of items, almost every one built one way only,
// so an item holds its first way itself rather than as an edge in a list:
// the item it advanced, `previous`, null for a prediction, and the completed
// item it advanced over, `child`, null for a read, whose token and terminal
// the item implies. Each further way is an edge in `more`.
export class Item {
  /**
   * @param {Production} production
   * @param {number} dot
   * @param {number} origin
   * @param {Captured} slots
   * @param {Item | null} previous
   * @param {Item | null} child
   */
  constructor(production, dot, origin, slots, previous, child) {
    this.production = production;
    this.dot = dot;
    this.origin = origin;
    this.slots = slots;
    this.tagId = -1;
    this.end = -1;
    this.previous = previous;
    this.child = child;
    /** @type {Edge[] | null} */
    this.more = null;
    // In the reconstruction mode (engine §7.4): whether every step that
    // made the item is strict, and whether the item is the restoration of
    // an elidable optional, a read of the synthetic token at its origin.
    this.strict = false;
    this.restores = false;
    this.queued = true;
  }
  get complete() {
    return this.dot === this.production.rhs.length;
  }
  /**
   * Every way the item was built, in the order they were found.
   * @returns {Edge[]}
   */
  get edges() {
    /** @type {Edge} */
    let first;
    if (this.restores) first = { kind: "restore", token: this.origin, terminal: /** @type {string} */ (this.production.elided) };
    else if (this.previous === null) first = SEED;
    else if (this.child === null) first = { kind: "scan", previous: this.previous, token: this.end - 1, terminal: this.production.rhs[this.dot - 1].name };
    else first = { kind: "complete", previous: this.previous, child: this.child };
    return this.more === null ? [first] : [first, ...this.more];
  }
}

export class ChartSet {
  /** @param {number} position */
  constructor(position) {
    this.position = position;
    /** @type {Item[]} */
    this.items = [];
    /** @type {Map<number | string, Item>} */
    this.index = new Map();
    /** @type {Item[]} */
    this.queue = [];
    this.head = 0;
    /** @type {Map<string, Item[]>} */
    this.waiting = new Map();
    /** @type {Map<string, Item[]>} */
    this.nullable = new Map();
    /**
     * The rules already predicted here, each with whether that prediction
     * was strict (engine §7.4).
     * @type {Map<string, boolean>}
     */
    this.predicted = new Map();
    /**
     * The rules predicted here with productions not made items, since they
     * begin with a terminal the next token does not carry; kept for saying
     * what could have come next (see expectedAt). A rule, not each of its
     * productions: a long text skips millions.
     * @type {string[]}
     */
    this.skipped = [];
  }
}

/**
 * Runs the recognizer over tokens[start, end) with `rule` as the start rule.
 * @param {ParseContext} context
 * @param {string} rule
 * @param {number} start
 * @param {number} end
 * @returns {Chart}
 */
export function recognize(context, rule, start, end) {
  const outer = context.inputStart;
  const outerEnd = context.inputEnd;
  context.inputStart = start;
  context.inputEnd = end;
  try {
    return recognizeFrom(context, rule, start, end);
  } finally {
    context.inputStart = outer;
    context.inputEnd = outerEnd;
  }
}

/**
 * @param {ParseContext} context
 * @param {string} rule
 * @param {number} start
 * @param {number} end
 * @returns {Chart}
 */
function recognizeFrom(context, rule, start, end) {
  const { lowered, tokens } = context;
  /** @type {ChartSet[]} */
  const sets = [];
  // A set is made when something first looks at it: once a set is empty,
  // every later one is, and a nested parse over the rest of a long text
  // stops there.
  /** @type {(position: number) => ChartSet} */
  const setAt = (position) => sets[position - start] || (sets[position - start] = new ChartSet(position));
  const dots = context.dots;
  const width = end - start + 1;

  // The reconstruction mode of engine §7.4, or the old contract's
  // mandatory optionals (a fault); null for the ordinary mode of §4.
  const mode = context.mode;
  const synthetic = context.synthetic;
  const reading = mode === "reconstruction" ? readingOf(lowered) : null;
  const twoItems = mode === "reconstruction" && fault("F17");

  // Adds the item `previous` makes advanced over `child`, or over the token
  // before the set when `child` is null; a prediction when both are null.
  // `strict` says whether the step that makes it is strict (engine §7.4).
  /** @type {(set: ChartSet, production: Production, dot: number, origin: number, slots: Captured, previous: Item | null, child: Item | null, tagId: number, strict?: boolean) => void} */
  const add = (set, production, dot, origin, slots, previous, child, tagId, strict = false) => {
    // A strict item never completes (engine §7.4).
    if (strict && dot === production.rhs.length) return;
    let key = itemKey((production.id * dots + dot) * width + origin - start, slots);
    if (twoItems && strict) key = "strict" + key;
    let item = set.index.get(key);
    if (item) {
      // One ordinary step makes an item ordinary. It is then processed
      // again, for what strictness held back (engine §7.4), unless a fault
      // leaves it as it was processed (F32:queue).
      if (item.strict && !strict && !fault("F32:queue")) {
        item.strict = false;
        if (!item.queued) {
          item.queued = true;
          set.queue.push(item);
        }
      }
      // The symbol before an item's dot fixes the kind of all its edges,
      // and the item fixes a read's token and terminal: two edges are the
      // same when they have the same `previous` and `child`. A prediction
      // has no other edge, since nothing else puts a dot at the start.
      if ((item.previous === previous && item.child === child) || previous === null) return;
      const more = item.more || (item.more = []);
      for (const edge of more) {
        if (edge.kind === "scan" && edge.previous === previous) return;
        if (edge.kind === "complete" && edge.previous === previous && edge.child === child) return;
      }
      if (child === null) more.push({ kind: "scan", previous, token: set.position - 1, terminal: production.rhs[dot - 1].name });
      else more.push({ kind: "complete", previous, child });
      return;
    }
    item = new Item(production, dot, origin, slots, previous, child);
    item.strict = strict;
    if (hooks.work) countWork(hooks.work, "items");
    item.end = set.position;
    const trace = context.trace;
    if (trace && trace.depth === 0 && set.position === trace.position) {
      const kind = dot === production.rhs.length ? "completed" : dot === 0 ? "predicted" : "advanced";
      trace.events.push({ kind, production, dot, origin });
    }
    item.tagId = tagId;
    set.items.push(item);
    set.index.set(key, item);
    set.queue.push(item);
    const next = production.rhs[dot];
    if (next && !next.terminal) {
      // Most lists hold one item, and an array made with its first element
      // is a fraction of the size an empty one grows to on its first push.
      const waiting = set.waiting.get(next.name);
      if (waiting) waiting.push(item);
      else set.waiting.set(next.name, [item]);
    }
    if (dot === production.rhs.length && origin === set.position) {
      let nullable = set.nullable.get(production.lhs);
      if (!nullable) set.nullable.set(production.lhs, (nullable = []));
      nullable.push(item);
    }
  };

  // The restoration of an elidable optional at a position (engine §7.4):
  // its empty production read over the one synthetic token there, where
  // that token is compatible with the optional. It has no tags.
  /** @type {(set: ChartSet, production: Production) => void} */
  const restore = (set, production) => {
    const position = set.position;
    if (position >= end || !(/** @type {boolean[]} */ (synthetic)[position])) return;
    // A fault loses the restoration of the first synthetic token, and with
    // it the witness of the chosen derivation, while other readings can
    // survive (F28).
    if (fault("F28") && /** @type {boolean[]} */ (synthetic).indexOf(true) === position) return;
    const token = tokens[position];
    if (!token.tags.has(/** @type {string} */ (production.elided))) return;
    const test = production.elidedTest;
    if (test && !fault("F11", "restore") && !testHolds(context, test, position, position + 1, token.tags)) return;
    const target = setAt(position + 1);
    const key = itemKey((production.id * dots) * width + position - start, null);
    if (target.index.has(key)) return;
    const item = new Item(production, 0, position, null, null, null);
    item.restores = true;
    if (hooks.work) countWork(hooks.work, "items");
    item.end = position + 1;
    // It has the tags of the empty production, none, unless a fault gives
    // it the synthetic token's (F7:restoration).
    item.tagId = context.interner.intern(fault("F7:restoration") ? token.tags : tagSet());
    target.items.push(item);
    target.index.set(key, item);
    target.queue.push(item);
  };

  /** @type {(set: ChartSet, name: string, strict?: boolean) => void} */
  const predict = (set, name, strict = false) => {
    // A rule's productions are the same at every prediction in one set:
    // predicting them again would only rebuild items that already exist. A
    // strict prediction (engine §7.4) leaves some out, so an ordinary one
    // after it adds them.
    const before = set.predicted.get(name);
    // A fault keeps the strict prediction, and predicts nothing more
    // (F32:predict).
    if (before === false || (before === true && (strict || fault("F32:predict")))) return;
    set.predicted.set(name, strict);
    const next = set.position < end ? tokens[set.position] : null;
    let skipped = false;
    for (const production of lowered.byLhs.get(name) || []) {
      // In the reconstruction mode, the empty production of an elidable
      // optional is its restoration, and it never derives the empty
      // sequence. Under the old contract it is not there at all.
      if (mode !== null && production.rhs.length === 0 && production.helper && production.elided !== null) {
        // A fault leaves the restoration out of a strict prediction (F29).
        if (mode === "reconstruction" && !(strict && fault("F29", "predict"))) restore(set, production);
        continue;
      }
      // A strict prediction predicts only the productions that can read.
      if (strict && !fault("F16", "predict") && /** @type {Reading} */ (reading).last.get(production) === -1) continue;
      const slots = null;
      // One scope for the step, which evaluates the tag term at most once
      // (engine §4).
      /** @type {StepScope} */
      const step = { scope: null };
      // The tag term comes after the conditions (engine §4), unless a fault
      // evaluates it first (order:tags).
      if (production.rhs.length === 0 && fault("order:tags", "predict")) completeTags(context, production, slots, set.position, set.position, step);
      const failed = failedCondition(context, production, -1, slots, set.position, set.position, step);
      if (failed) {
        const trace = context.trace;
        if (trace && trace.depth === 0 && set.position === trace.position) {
          trace.events.push({ kind: "dropped", production, dot: 0, origin: set.position, condition: failed });
        }
        continue;
      }
      // The conditions above run first, as they did when every prediction
      // was made an item, so that a trace shows the production as dropped.
      if (lookaheadSkips(context, production, next)) {
        skipped = true;
        continue;
      }
      const tagId = production.rhs.length === 0 ? completeTags(context, production, slots, set.position, set.position, step) : -1;
      add(set, production, 0, set.position, slots, null, null, tagId, strict && !fault("F16", "item"));
    }
    if (skipped && before === undefined) set.skipped.push(name);
  };

  // The item advanced over its next symbol, which spans [from, to) and was
  // built by `child`, or read as a token; null when a condition fails.
  /** @type {(item: Item, from: number, to: number, child: Item | null) => {dot: number, slots: Captured, tagId: number} | null} */
  const advance = (item, from, to, child) => {
    const production = item.production;
    // A tested symbol's test must hold of its own span and tags, which is
    // checked before any condition the advance makes ready (engine §4).
    const test = production.rhs[item.dot].test;
    if (test !== undefined && !symbolTestHolds(context, test, from, to, child)) {
      const trace = context.trace;
      if (trace && trace.depth === 0 && to === trace.position) {
        trace.events.push({ kind: "dropped", production, dot: item.dot, origin: item.origin, test });
      }
      return null;
    }
    let slots = item.slots;
    const captureIndex = production.captures.findIndex((capture) => capture.index === item.dot);
    if (captureIndex >= 0) {
      // A terminal that reads a synthetic token captures no tags (engine
      // §7.5), unless a fault gives it the token's, to a capture and to a
      // production that inherits from the terminal (F7:capture).
      const tags = child ? child.tagId
        : context.interner.intern(synthetic !== null && synthetic[from] && !rawObservations(context) && !fault("F7:capture") ? tagSet() : tokens[from].tags);
      slots = captureAfter(context, slots, captureIndex, from, to, tags);
    }
    /** @type {StepScope} */
    const step = { scope: null };
    if (item.dot + 1 === production.rhs.length && fault("order:tags", "advance")) completeTags(context, production, slots, item.origin, to, step);
    const failed = failedCondition(context, production, item.dot, slots, item.origin, to, step);
    if (failed) {
      const trace = context.trace;
      if (trace && trace.depth === 0 && to === trace.position) {
        trace.events.push({ kind: "dropped", production, dot: item.dot, origin: item.origin, condition: failed });
      }
      return null;
    }
    const dot = item.dot + 1;
    const tagId = dot === production.rhs.length ? completeTags(context, production, slots, item.origin, to, step) : -1;
    return { dot, slots, tagId };
  };

  // Whether a symbol after an item's next symbol can read (engine §7.4).
  /** @type {(item: Item) => boolean} */
  const readsLater = (item) => /** @type {number} */ (/** @type {Reading} */ (reading).last.get(item.production)) > item.dot;
  // Whether an advance from an item over an empty constituent is held back:
  // a strict item does it only where a later symbol can read.
  /** @type {(item: Item) => boolean} */
  const emptyHeldBack = (item) => item.strict && !fault("F16", "empty") && !readsLater(item);

  predict(setAt(start), rule);
  let furthest = start;
  for (let position = start; position <= end; position++) {
    const set = setAt(position);
    if (position > start && set.items.length === 0) break;
    furthest = position;
    if (position > start) {
      // Nothing is added to a set once the next one is being built: its
      // index, queue and predictions can go, which a long text needs, and
      // the lists it keeps can be copied to arrays of their own length,
      // rather than of the length growing them by pushes left.
      const done = setAt(position - 1);
      done.index = new Map();
      done.queue = [];
      done.predicted = new Map();
      done.nullable = new Map();
      done.items = done.items.slice();
      done.skipped = done.skipped.slice();
      for (const [name, waiting] of done.waiting) if (waiting.length > 1) done.waiting.set(name, waiting.slice());
    }
    while (set.head < set.queue.length) {
      const item = set.queue[set.head++];
      item.queued = false;
      const next = item.production.rhs[item.dot];
      if (!next) {
        const origin = setAt(item.origin);
        const empty = item.origin === position;
        for (const waiting of origin.waiting.get(item.production.lhs) || []) {
          if (empty && mode === "reconstruction" && emptyHeldBack(waiting)) continue;
          const advanced = advance(waiting, item.origin, position, item);
          if (advanced) {
            add(set, waiting.production, advanced.dot, waiting.origin, advanced.slots, waiting, item, advanced.tagId, empty && waiting.strict);
          }
        }
      } else if (!next.terminal) {
        // A strict item predicts its next symbol strictly where no symbol
        // after it can read (engine §7.4).
        predict(set, next.name, mode === "reconstruction" && item.strict && !readsLater(item));
        if (mode === "reconstruction" && emptyHeldBack(item)) continue;
        for (const done of set.nullable.get(next.name) || []) {
          const advanced = advance(item, position, position, done);
          if (advanced) {
            add(set, item.production, advanced.dot, item.origin, advanced.slots, item, done, advanced.tagId, item.strict);
          }
        }
      } else if (position < end && (next.characters === undefined ? tokens[position].tags.has(next.name) : carries(context.unicode, next.characters, tokens[position].tags))) {
        // The written routes of an elidable optional (engine §7.4): from an
        // original token, or from a synthetic one, after which the rest of
        // the optional must read, so the item after it is strict.
        let strict = false;
        if (mode === "reconstruction" && item.dot === 0 && item.production.helper && item.production.elided !== null) {
          const fromSynthetic = /** @type {boolean[]} */ (synthetic)[position];
          if (fromSynthetic && fault("F14")) continue;
          if (!fromSynthetic && fault("F24")) continue;
          // A fault makes the item after T ordinary where a strict item
          // read T (F31).
          strict = fromSynthetic && !fault("F15") && !(fault("F31") && item.strict);
          // An optional whose content is T alone would complete here, which
          // a strict item never does: drop the item before evaluating its
          // test or its tags (engine §7.4).
          if (strict && item.dot + 1 === item.production.rhs.length) continue;
        }
        const advanced = advance(item, position, position + 1, null);
        if (advanced) {
          add(setAt(position + 1), item.production, advanced.dot, item.origin, advanced.slots, item, null, advanced.tagId, strict);
        }
      }
    }
  }
  /** @type {(position: number) => ChartSet} */
  const peek = (position) => sets[position - start] || new ChartSet(position);
  return { sets, start, end, setAt: peek, furthest, context };
}

/** @type {Edge} */
const SEED = { kind: "seed" };

/**
 * A symbol as the diagnostics write it: its name, followed by its test if
 * it has one, such as LE="la" (docs/output.md).
 * @param {{name: string, test?: SymbolTest | null}} symbol
 * @returns {string}
 */
export function writtenSymbol(symbol) {
  return symbol.test ? symbol.name + symbol.test.written : symbol.name;
}

/**
 * Which productions can read in the reconstruction mode (engine §7.4): for
 * each production, the index of its last symbol that can read, or -1. A
 * terminal can read; so can a rule or helper with a production that can,
 * and the empty production of an elidable helper, the restoration.
 * @typedef {{last: Map<Production, number>}} Reading
 */

/** @type {WeakMap<LoweredGrammar, Map<string, Reading>>} */
const readings = new WeakMap();

/**
 * @param {LoweredGrammar} lowered
 * @returns {Reading}
 */
export function readingOf(lowered) {
  // A fault leaves the restorations out (F29). Another takes the greatest
  // answer in place of the least (F30).
  const withoutRestorations = fault("F29", "reading");
  const greatest = fault("F30");
  let known = readings.get(lowered);
  if (!known) readings.set(lowered, (known = new Map()));
  const which = `${withoutRestorations} ${greatest}`;
  let found = known.get(which);
  if (found) return found;
  /** @type {Set<string>} */
  const rules = new Set();
  /** @type {(symbol: GrammarSymbol) => boolean} */
  const reads = (symbol) => symbol.terminal || rules.has(symbol.name);
  /** @type {(production: Production) => boolean} */
  const productionReads = (production) => {
    const restoration = production.rhs.length === 0 && production.helper && production.elided !== null;
    return (restoration && !withoutRestorations) || production.rhs.some(reads);
  };
  if (greatest) {
    // Everything can read, until nothing more is removed.
    for (const production of lowered.productions) rules.add(production.lhs);
    for (let changed = true; changed;) {
      changed = false;
      for (const name of [...rules]) {
        if (!(lowered.byLhs.get(name) || []).some(productionReads)) {
          rules.delete(name);
          changed = true;
        }
      }
    }
  }
  // Nothing can read, until nothing more is added (engine §7.4).
  for (let changed = !greatest; changed;) {
    changed = false;
    for (const production of lowered.productions) {
      if (rules.has(production.lhs)) continue;
      if (productionReads(production)) {
        rules.add(production.lhs);
        changed = true;
      }
    }
  }
  /** @type {Map<Production, number>} */
  const last = new Map();
  for (const production of lowered.productions) {
    let at = -1;
    production.rhs.forEach((symbol, index) => {
      if (reads(symbol)) at = index;
    });
    last.set(production, at);
  }
  found = { last };
  known.set(which, found);
  return found;
}

/**
 * Whether the test of a symbol holds where an item advances over it, the
 * tokens [from, to), read as a token when `child` is null. A test of a
 * terminal reads the token, with its recognition values. In the check of
 * engine §7, a test of a reference reads its projected span and its
 * constituent's tags (engine §7.5).
 * @param {ParseContext} context
 * @param {SymbolTest} test
 * @param {number} from
 * @param {number} to
 * @param {Item | null} child
 * @returns {boolean}
 */
function symbolTestHolds(context, test, from, to, child) {
  const recon = context.recon;
  if (child === null) {
    const synthetic = context.synthetic !== null && context.synthetic[from];
    if (synthetic && fault("F11", "test")) return true;
    if (recon !== null && synthetic && fault("F10")) {
      const observed = recon.observed;
      const start = recon.project[from];
      const end = recon.project[to];
      return testHolds(observed, test, start, end, tokensTags(observed.tokens, start, end));
    }
    return testHolds(context, test, from, to, context.tokens[from].tags);
  }
  const tags = context.interner.get(child.tagId);
  if (recon === null) return testHolds(context, test, from, to, tags);
  if (recon.raw || fault("F9")) return testHolds(context, test, from, to, tagUnion(tags, syntheticTags(context, from, to)));
  return testHolds(recon.observed, test, recon.project[from], recon.project[to], tags);
}

/**
 * The union of the tags of the synthetic tokens of R in [from, to), which
 * no correct observation reads (faults F7 and F9).
 * @param {ParseContext} context
 * @param {number} from
 * @param {number} to
 * @returns {TagSet}
 */
function syntheticTags(context, from, to) {
  let result = tagSet();
  const synthetic = context.synthetic;
  if (synthetic === null) return result;
  for (let index = from; index < to; index++) if (synthetic[index]) result = tagUnion(result, context.tokens[index].tags);
  return result;
}

/**
 * Whether the observations of a context read the reconstructed tokens
 * themselves, as the old contract did (a fault).
 * @param {ParseContext} context
 * @returns {boolean}
 */
function rawObservations(context) {
  return context.recon !== null && context.recon.raw;
}

/**
 * Whether a test holds of a symbol's own span, the tokens [from, to), and
 * its own tags (engine §4): a token's for a terminal, the completed item's
 * for a reference. An empty span sounds like the empty string.
 * @param {ParseContext} context
 * @param {SymbolTest} test
 * @param {number} from
 * @param {number} to
 * @param {TagSet} tags
 * @returns {boolean}
 */
export function testHolds(context, test, from, to, tags) {
  switch (test.op) {
    case "=":
    case "≠":
      return soundIs(context, /** @type {string} */ (test.sound), from, to) === (test.op === "=");
    case "⊇":
    case "⊉":
      return isSubset(/** @type {TagSet} */ (test.tags), tags) === (test.op === "⊇");
    default: {
      let meets = false;
      for (const tag of /** @type {TagSet} */ (test.tags)) {
        if (tags.has(tag)) {
          meets = true;
          break;
        }
      }
      return meets === (test.op === "∩≠∅");
    }
  }
}

/**
 * Whether the tokens [from, to) sound like a string: their canonical sound
 * is exactly it (engine §4, §5). A token with no phonemes adds nothing.
 * @param {ParseContext} context
 * @param {string} sound
 * @param {number} from
 * @param {number} to
 * @returns {boolean}
 */
function soundIs(context, sound, from, to) {
  let offset = 0;
  for (let index = from; index < to; index++) {
    const part = canonicalSound(context, index);
    if (!sound.startsWith(part, offset)) return false;
    offset += part.length;
  }
  return offset === sound.length;
}

/**
 * A token's phonemes in canonical form (engine §5), remembered for the
 * parse. The lowercase mapping and the removal of commas act on each code
 * point alone, so the canonical sound of a span is its tokens' joined.
 * @param {ParseContext} context
 * @param {number} index
 * @returns {string}
 */
function canonicalSound(context, index) {
  let sound = context.sounds[index];
  if (sound === undefined) sound = context.sounds[index] = context.unicode.canonical(context.tokens[index].phonemes || "");
  return sound;
}

// One token of lookahead: an item whose first symbol is a terminal the next
// token lacks could never advance, so a prediction of it is not made.
/**
 * @param {ParseContext} context
 * @param {Production} production
 * @param {Token | null} next
 * @returns {boolean}
 */
function lookaheadSkips(context, production, next) {
  const first = production.rhs[0];
  return Boolean(first && first.terminal && !(next && reads(context, first, next)));
}

/**
 * Whether a terminal matches a token (engine §4): a tag it carries, or, for
 * a range or a property, one of its character tags.
 * @param {ParseContext} context
 * @param {GrammarSymbol} symbol
 * @param {Token} token
 * @returns {boolean}
 */
function reads(context, symbol, token) {
  return symbol.characters === undefined ? token.tags.has(symbol.name) : carries(context.unicode, symbol.characters, token.tags);
}

/**
 * Whether tags hold a character tag of a range or a property (engine §4).
 * @param {UnicodeTable} unicode
 * @param {CharacterClass} characters
 * @param {TagSet} tags
 * @returns {boolean}
 */
function carries(unicode, characters, tags) {
  for (const tag of tags) {
    const code = codeOfCharacterTag(tag);
    if (code < 0) continue;
    if ("property" in characters ? unicode.hasProperty(characters.property, code) : code >= characters.from && code <= characters.to) return true;
  }
  return false;
}

// The tags of each range that a term holds, made once (engine §10).
/** @type {WeakMap<object, TagSet>} */
const rangeSets = new WeakMap();

/**
 * The captured parts of an item after it reads one more: the parts before
 * it, extended by the capture at `index` of its production, with its span
 * and tags. Each sequence of parts is made once per context and shared by
 * every item that has it and by every longer sequence, so an item adds one
 * part to the one it advanced, and equal sequences are one object, whose
 * number is in the item's identity (engine §4).
 * @param {ParseContext} context
 * @param {Captured} parent
 * @param {number} index
 * @param {number} start
 * @param {number} end
 * @param {number} tags
 * @returns {Captured}
 */
function captureAfter(context, parent, index, start, end, tags) {
  const key = (parent === null ? "" : parent.id) + ":" + index + ":" + start + ":" + end + ":" + tags;
  let found = context.captured.get(key);
  if (!found) {
    found = { parent, index, start, end, tags, id: context.captured.size };
    context.captured.set(key, found);
    recognizerCounters.captures++;
  }
  return found;
}

// An item's key in its set's index: `base`, a number unique to its
// production, dot and origin, and for an item that has captured something,
// a string adding the number of its captured parts. Almost no item has,
// and a number is no allocation.
/**
 * @param {number} base
 * @param {Captured} captured
 * @returns {number | string}
 */
function itemKey(base, captured) {
  return captured === null ? base : base + "," + captured.id;
}

/**
 * The completed items of `rule` spanning [start, end).
 * @param {Chart} chart
 * @param {string} rule
 * @returns {Item[]}
 */
export function rootItems(chart, rule) {
  return chart.setAt(chart.end).items.filter((item) =>
    item.complete && item.origin === chart.start && item.production.lhs === rule);
}

/**
 * The first condition of a production that is ready at `readyAt` and fails,
 * or null when they all hold.
 * @param {ParseContext} context
 * @param {Production} production
 * @param {number} readyAt
 * @param {Captured} slots
 * @param {number} origin where the item began
 * @param {number} end where it ends once it has read the symbol at `readyAt`
 * @param {StepScope} [step] the scope of the step, shared with its tag term
 * @returns {Condition | null}
 */
function failedCondition(context, production, readyAt, slots, origin, end, step = { scope: null }) {
  // In written order (engine §4), unless a fault takes the conditions that
  // read only captures before those that read `$` (order:conditions).
  const conditions = fault("order:conditions")
    ? [...production.conditions].sort((a, b) => Number(conditionVariables(a.condition).includes("")) - Number(conditionVariables(b.condition).includes("")))
    : production.conditions;
  for (const { condition, readyAt: at } of conditions) {
    if (at !== readyAt) continue;
    const scope = step.scope ??= new ChartScope(context, production, slots, origin, end);
    if (!holds(scope.observing, condition, scope)) return condition;
  }
  return null;
}

/**
 * @param {ParseContext} context
 * @param {Production} production
 * @param {Captured} slots
 * @param {number} origin
 * @param {number} end
 * @param {StepScope} step the scope of the step, which holds the tag set
 *   once a condition has read it
 * @returns {number}
 */
function completeTags(context, production, slots, origin, end, step) {
  const scope = step.scope ??= new ChartScope(context, production, slots, origin, end);
  return context.interner.intern(scope.constituent());
}

/**
 * The scope that one step of the recognizer makes on demand, and shares
 * between its conditions and its tag term, so that the tag term runs at
 * most once in the step. This saves time only: how many times a step
 * evaluates its tag term is not observable (engine §4).
 * @typedef {{scope: ChartScope | null}} StepScope
 */

/**
 * A completed constituent's tags: its production's tag term, which cannot
 * read `$`'s own (engine §9).
 * @param {ParseContext} context
 * @param {Production} production
 * @param {Scope} scope
 * @returns {TagSet}
 */
function constituentTags(context, production, scope) {
  return production.tags ? asSet(evaluate(context, production.tags, scope)) : tagSet();
}

/** @implements {Scope} */
class ChartScope {
  /**
   * @param {ParseContext} context
   * @param {Production} production
   * @param {Captured} slots
   * @param {number} origin
   * @param {number} end
   */
  constructor(context, production, slots, origin, end) {
    this.context = context;
    this.production = production;
    this.slots = slots;
    this.origin = origin;
    this.end = end;
    // In the check of engine §7, the spans of R, which every observation
    // projects to the stage's input, where it is evaluated (engine §7.5).
    /** @type {ParseContext | null} */
    this.reconstructed = context.recon ? context : null;
    this.observing = context.recon ? context.recon.observed : context;
    /** @type {SpanValue["space"]} */
    this.space = context.recon ? (context.recon.raw ? "raw" : "R") : undefined;
    /** @type {TagSet | null} the constituent's tags, once evaluated */
    this.tagSet = null;
  }
  /**
   * The constituent's tags, from its production's tag term, evaluated at
   * most once.
   * @returns {TagSet}
   */
  constituent() {
    return this.tagSet ??= constituentTags(this.observing, this.production, this);
  }
  /**
   * @param {string} name
   * @returns {SpanValue}
   */
  capture(name) {
    // `$` is the whole constituent, whose tags are read only once it is
    // complete, by a condition or an emission (engine §4).
    if (name === "") {
      const scope = this;
      return {
        start: this.origin,
        end: this.end,
        get tags() { return scope.constituent(); },
        space: this.space,
      };
    }
    const index = this.production.captures.findIndex((capture) => capture.name === name);
    let part = this.slots;
    while (part !== null && part.index !== index) part = part.parent;
    const found = /** @type {NonNullable<Captured>} */ (part);
    return { start: found.start, end: found.end, tags: this.context.interner.get(found.tags), space: this.space };
  }
}

// A span value: [start, end) of the stage's tokens, and the tags of the
// captured constituent if it is a whole capture.
/**
 * @param {ParseContext} context
 * @param {Argument} span
 * @param {Scope} scope
 * @returns {SpanValue}
 */
function spanOf(context, span, scope) {
  if ("capture" in span) return scope.capture(span.capture);
  if ("call" in span && (span.call === "head" || span.call === "tail" || span.call === "last")) {
    // In the check, the projection comes first, then the function (engine
    // §7.5), unless a fault applies the function first (F1).
    const argument = spanOf(context, span.args[0], scope);
    const first = functionFirst(argument, scope, span.call);
    if (first) return first;
    const inner = projectedArgument(argument, scope, span.call);
    const { start, end, space } = inner;
    /** @type {SpanValue} */
    let result;
    if (span.call === "head") result = { start, end: Math.min(start + 1, end), space };
    else if (span.call === "tail") result = { start: Math.min(start + 1, end), end, space };
    else result = { start: Math.max(end - 1, start), end, space };
    if (inner.reconstructed) result.reconstructed = reconstructedPart(scope, inner.reconstructed, span.call);
    if (inner.exact) result.exact = exactPart(scope, inner.exact, span.call);
    return result;
  }
  if ("call" in span && (span.call === "from" || span.call === "after")) {
    const argument = spanOf(context, span.args[0], scope);
    const first = functionFirst(argument, scope, span.call);
    if (first) return first;
    const inner = projectedArgument(argument, scope, span.call);
    const r = reconstructionOf(scope);
    const end = inner.space === "raw" ? /** @type {ParseContext} */ (r).inputEnd : context.inputEnd;
    /** @type {SpanValue} */
    const result = { start: span.call === "from" ? inner.start : inner.end, end, space: inner.space };
    if (inner.reconstructed) {
      const [a, b] = inner.reconstructed;
      result.reconstructed = [span.call === "from" ? a : b, /** @type {ParseContext} */ (r).inputEnd];
    }
    if (inner.exact) result.exact = exactPart(scope, inner.exact, span.call);
    return result;
  }
  throw new GencmuError("grammar", `expected a span, found ${JSON.stringify(span)}`);
}

/**
 * The context of R behind a scope that reads the reconstruction, or null.
 * @param {Scope} scope
 * @returns {ParseContext | null}
 */
function reconstructionOf(scope) {
  return /** @type {{reconstructed?: ParseContext | null}} */ (scope).reconstructed || null;
}

/**
 * The argument of a span function in the check: projected to the stage's
 * input. A projected span remembers the span of R that it came from, and
 * the exact span of R behind it, which only faults read. Under a fault of
 * the function's positions (F1pos), or the old contract, the function reads
 * R itself at the positions it has (raw).
 * @param {SpanValue} span
 * @param {Scope} scope
 * @param {string} observer
 * @returns {SpanValue}
 */
function projectedArgument(span, scope, observer) {
  const r = reconstructionOf(scope);
  if (r === null || span.space === "raw") return span;
  if (fault("F1pos:" + observer, "observe")) return { start: span.start, end: span.end, space: "raw" };
  if (span.space !== "R") return span;
  const project = /** @type {Reconstruction} */ (r.recon).project;
  return { start: project[span.start], end: project[span.end], reconstructed: [span.start, span.end], exact: [span.start, span.end] };
}

/**
 * The exact span of R behind a span of the check, which only faults read
 * (F1, F7:union): a capture's own span, or the one that a function of it
 * computed (exactPart). Null where there is none.
 * @param {SpanValue} span
 * @returns {[number, number] | null}
 */
function exactBehind(span) {
  if (span.space === "R") return [span.start, span.end];
  if (span.space === "raw") return null;
  return span.exact || null;
}

/**
 * Under a fault of a span function (F1), the function applied to the
 * tokens of R behind its argument, and the projection after it, in place of
 * the order of engine §7.5. Null where the fault is off or the argument has
 * no span of R behind it.
 * @param {SpanValue} argument
 * @param {Scope} scope
 * @param {string} call
 * @returns {SpanValue | null}
 */
function functionFirst(argument, scope, call) {
  const r = reconstructionOf(scope);
  if (r === null || !fault("F1:" + call, "function")) return null;
  const behind = exactBehind(argument);
  if (behind === null) return null;
  const [a, b] = behind;
  /** @type {[number, number]} */
  let part;
  if (call === "head") part = [a, Math.min(a + 1, b)];
  else if (call === "tail") part = [Math.min(a + 1, b), b];
  else if (call === "last") part = [Math.max(b - 1, a), b];
  else if (call === "from") part = [a, r.inputEnd];
  else part = [b, r.inputEnd];
  const project = /** @type {Reconstruction} */ (r.recon).project;
  return { start: project[part[0]], end: project[part[1]], reconstructed: part, exact: part };
}

/**
 * The exact span of R behind a function of a span whose exact span of R is
 * `span`: the one original token for head and last, and from the first
 * original token of the result for tail, from and after. Only faults read
 * it (F1, F7:union).
 * @param {Scope} scope
 * @param {[number, number]} span
 * @param {string} call
 * @returns {[number, number]}
 */
function exactPart(scope, span, call) {
  const r = /** @type {ParseContext} */ (reconstructionOf(scope));
  const synthetic = /** @type {boolean[]} */ (r.synthetic);
  const [a, b] = span;
  /** @type {(at: number, limit: number) => number} */
  const original = (at, limit) => {
    while (at < limit && synthetic[at]) at++;
    return at;
  };
  if (call === "last") {
    let at = b - 1;
    while (at >= a && synthetic[at]) at--;
    return at >= a ? [at, at + 1] : [b, b];
  }
  if (call === "head") {
    const at = original(a, b);
    return at < b ? [at, at + 1] : [b, b];
  }
  if (call === "tail") {
    const first = original(a, b);
    return [first < b ? original(first + 1, b) : b, b];
  }
  const end = r.inputEnd;
  return [original(call === "from" ? a : b, end), end];
}

/**
 * The part of a span of R that a function of its projection covers: up to
 * and including the first original token for head, after it for tail, and
 * from the last one for last. Only the faults of queries read it (F3, F4
 * and F21).
 * @param {Scope} scope
 * @param {[number, number]} span
 * @param {string} call
 * @returns {[number, number]}
 */
function reconstructedPart(scope, span, call) {
  const r = /** @type {ParseContext} */ (reconstructionOf(scope));
  const synthetic = /** @type {boolean[]} */ (r.synthetic);
  const [a, b] = span;
  if (call === "last") {
    let at = b - 1;
    while (at >= a && synthetic[at]) at--;
    return [Math.max(at, a), b];
  }
  let at = a;
  while (at < b && synthetic[at]) at++;
  return call === "head" ? [a, Math.min(at + 1, b)] : [Math.min(at + 1, b), b];
}

/**
 * Where an observation reads a span (engine §7.5): the context and the span
 * in its positions. A span of R projects to the stage's input. A raw span,
 * or any span under a fault of the observation's positions (F1pos), reads
 * R itself at the positions it has. Under a fault of the observation (F1),
 * it reads the exact span of R behind the span. `exact` is that span, where
 * there is one.
 * @param {ParseContext} context
 * @param {SpanValue} span
 * @param {Scope} scope
 * @param {string} observer
 * @returns {{context: ParseContext, start: number, end: number, exact: [number, number] | null}}
 */
function observe(context, span, scope, observer) {
  const r = reconstructionOf(scope);
  if (r === null) return { context, start: span.start, end: span.end, exact: null };
  if (span.space === "raw" || fault("F1pos:" + observer, "argument")) return { context: r, start: span.start, end: span.end, exact: null };
  const exact = exactBehind(span);
  if (exact !== null && fault("F1:" + observer, "argument")) return { context: r, start: exact[0], end: exact[1], exact: null };
  if (span.space === "R") {
    const project = /** @type {Reconstruction} */ (r.recon).project;
    return { context, start: project[span.start], end: project[span.end], exact };
  }
  return { context, start: span.start, end: span.end, exact };
}

/**
 * The tags of a span's tokens where an observation reads them, with the
 * synthetic tokens' tags of the exact span of R behind it under a fault
 * (F7:union).
 * @param {{context: ParseContext, start: number, end: number, exact: [number, number] | null}} where
 * @param {Scope} scope
 * @returns {TagSet}
 */
function observedTokenTags(where, scope) {
  const tags = tokensTags(where.context.tokens, where.start, where.end);
  const r = reconstructionOf(scope);
  if (where.exact === null || r === null || !fault("F7:union")) return tags;
  return tagUnion(tags, syntheticTags(r, where.exact[0], where.exact[1]));
}

/**
 * Where a query that a condition starts runs (engine §7.6): in the check,
 * over the projected span, with the main grammar in its ordinary mode and
 * the main parse's memo. A fault can send it elsewhere.
 * @param {ParseContext} context
 * @param {SpanValue} span
 * @param {Scope} scope
 * @returns {{context: ParseContext, start: number, end: number, key: [number, number] | null, fromCheck: boolean}}
 */
function queryTarget(context, span, scope) {
  const r = reconstructionOf(scope);
  if (r === null) return { context, start: span.start, end: span.end, key: null, fromCheck: false };
  const recon = /** @type {Reconstruction} */ (r.recon);
  if (span.space === "raw") return { context: faultyContext(r, recon.raw ? "F13" : "F3"), start: span.start, end: span.end, key: null, fromCheck: true };
  // The span in R and its projection.
  const rspan = span.space === "R" ? [span.start, span.end] : span.reconstructed || [span.start, span.end];
  const [start, end] = span.space === "R" ? [recon.project[span.start], recon.project[span.end]] : [span.start, span.end];
  if (fault("F3")) return { context: faultyContext(r, "F3"), start: rspan[0], end: rspan[1], key: null, fromCheck: true };
  for (const name of ["F2", "F5", "F6"]) {
    if (fault(name)) return { context: faultyContext(r, name), start, end, key: null, fromCheck: true };
  }
  if (fault("F4")) {
    const length = context.tokens.length;
    return { context, start: Math.min(rspan[0], length), end: Math.min(rspan[1], length), key: null, fromCheck: true };
  }
  return { context, start, end, key: fault("F21") ? [rspan[0], rspan[1]] : null, fromCheck: true };
}

/**
 * The context of the queries that a fault sends away from the main parse,
 * made once per check.
 * @param {ParseContext} r the context of R
 * @param {string} name
 * @returns {ParseContext}
 */
function faultyContext(r, name) {
  const recon = /** @type {Reconstruction} */ (r.recon);
  let found = recon.faulty.get(name);
  if (found) return found;
  const observed = recon.observed;
  let lowered = observed.lowered;
  if (name === "F5") lowered = { ...lowered, maximalHelpers: new Set() };
  if (name === "F6") lowered = { ...lowered, maximalHelpers: new Set(lowered.productions.flatMap((production) => (production.helper && production.elided !== null ? [production.lhs] : []))) };
  const tokens = name === "F3" || name === "F13" ? r.tokens : observed.tokens;
  found = new ParseContext(lowered, tokens, observed.sourceText, observed.unicode);
  if (name === "F13" || name === "F2") {
    found.mode = "mandatory";
    found.synthetic = name === "F13" ? r.synthetic : tokens.map(() => false);
  }
  recon.faulty.set(name, found);
  return found;
}

/**
 * @param {ParseContext} context
 * @param {number} start
 * @param {number} end
 * @returns {string}
 */
export function textOf(context, start, end) {
  if (start >= end) return "";
  const [from, to] = context.sources.of(start, end);
  return context.sourceText.slice(from, to).join("");
}

/**
 * @param {Token[]} tokens
 * @param {number} start
 * @param {number} end
 * @returns {TagSet}
 */
function tokensTags(tokens, start, end) {
  let result = tagSet();
  for (let index = start; index < end; index++) result = tagUnion(result, tokens[index].tags);
  return result;
}

/**
 * A term's value (engine §10): a string, or a set, of strings or of tags.
 * The reader has made sure that the types agree, so a set's kind needs no
 * mark here.
 * @param {ParseContext} context
 * @param {Argument} term
 * @param {Scope} scope
 * @returns {TermValue}
 */
export function evaluate(context, term, scope) {
  if ("string" in term) return { string: term.string };
  if ("tag" in term) return { set: tagSet([term.tag]) };
  // A constant holds its final value once the stage is stitched (engine §2).
  if ("const" in term) {
    if (!term.value) throw new GencmuError("grammar", `the constant $${term.const} has no value`);
    return term.value;
  }
  if ("range" in term) {
    let tags = rangeSets.get(term);
    if (!tags) rangeSets.set(term, (tags = rangeTags(term.range, context.unicode)));
    return { set: tags };
  }
  if ("if" in term) return holds(context, term.if, scope) ? evaluate(context, term.then, scope) : { set: tagSet() };
  if ("emptySet" in term) return { set: tagSet() };
  if ("union" in term) return { set: term.union.reduce((acc, item) => tagUnion(acc, asSet(evaluate(context, item, scope))), tagSet()) };
  if ("intersection" in term) {
    const [first, ...rest] = term.intersection.map((item) => asSet(evaluate(context, item, scope)));
    return { set: rest.reduce((acc, item) => tagIntersection(acc, item), first) };
  }
  if ("difference" in term) {
    const [left, right] = term.difference.map((item) => asSet(evaluate(context, item, scope)));
    return { set: tagDifference(left, right) };
  }
  if ("call" in term) {
    const args = term.args;
    switch (term.call) {
      case "phonemes": {
        // The canonical sound (engine §5).
        const where = observe(context, spanOf(context, args[0], scope), scope, "phonemes");
        let sound = "";
        for (let index = where.start; index < where.end; index++) sound += canonicalSound(where.context, index);
        return { string: sound };
      }
      case "text": {
        const where = observe(context, spanOf(context, args[0], scope), scope, "text");
        return { string: textOf(where.context, where.start, where.end) };
      }
      case "split": {
        // A set of strings (engine §10); an empty delimiter that only a
        // parse sees is an error of the grammar.
        const string = asString(evaluate(context, args[0], scope));
        const delimiter = asString(evaluate(context, args[1], scope));
        if (delimiter === "") throw new GencmuError("grammar", "split has an empty delimiter");
        return { set: splitString(string, delimiter) };
      }
      case "tag": {
        const name = asString(evaluate(context, args[0], scope));
        if (!isName(name)) throw new GencmuError("grammar", `tag(${JSON.stringify(name)}): the string is not a name`);
        return { set: tagSet([name]) };
      }
      case "tags": {
        const span = spanOf(context, args[0], scope);
        if (args.length === 2) {
          const target = queryTarget(context, span, scope);
          return { set: nestedTags(target.context, ruleName(args[1]), target.start, target.end, target) };
        }
        if (span.tags && "capture" in args[0]) return { set: span.tags };
        return { set: observedTokenTags(observe(context, span, scope, "tags"), scope) };
      }
      case "classify": {
        // The classes that the classifier gives the string, for the
        // features of the parse, or none for an unknown key (engine §10).
        const key = asString(evaluate(context, args[0], scope));
        const name = /** @type {{classifier: string}} */ (args[1]).classifier;
        const table = context.lowered.classifiers.get(name);
        return { set: (table && table.get(key)) || tagSet() };
      }
      case "classes": {
        const span = spanOf(context, args[0], scope);
        const tags = span.tags && "capture" in args[0] ? span.tags : observedTokenTags(observe(context, span, scope, "classes"), scope);
        const result = tagSet();
        for (const tag of tags) {
          const first = tag.charCodeAt(0);
          if (first >= 0x41 && first <= 0x5a) result.add(tag);
        }
        return { set: result };
      }
      default:
        throw new GencmuError("grammar", `unknown function ${term.call}`);
    }
  }
  throw new GencmuError("grammar", `unknown term ${JSON.stringify(term)}`);
}

/**
 * The rule an argument names.
 * @param {Argument} argument
 * @returns {string}
 */
function ruleName(argument) {
  if ("rule" in argument) return argument.rule;
  throw new GencmuError("grammar", `expected a rule name, found ${JSON.stringify(argument)}`);
}

/**
 * @param {TermValue} value
 * @returns {Set<string>}
 */
export function asSet(value) {
  if ("set" in value) return value.set;
  throw new GencmuError("grammar", "expected a set");
}

/**
 * @param {TermValue} value
 * @returns {string}
 */
function asString(value) {
  if ("string" in value) return value.string;
  throw new GencmuError("grammar", "expected a string");
}

/**
 * @param {ParseContext} context
 * @param {Condition} condition
 * @param {Scope} scope
 * @returns {boolean}
 */
export function holds(context, condition, scope) {
  if ("any" in condition) return condition.any.some((item) => holds(context, item, scope));
  if ("all" in condition) return condition.all.every((item) => holds(context, item, scope));
  // The consequent is evaluated only where the antecedent holds (engine §10).
  if ("if" in condition) return !holds(context, condition.if, scope) || holds(context, /** @type {Condition} */ (condition.then), scope);
  if ("not" in condition) return !holds(context, condition.not, scope);
  // A presence test is decided when the grammar is lowered (engine §3.6).
  if ("captured" in condition) throw new GencmuError("grammar", "a presence test outlived lowering");
  if ("matches" in condition) {
    const target = queryTarget(context, spanOf(context, condition.matches, scope), scope);
    return nestedMatches(target.context, condition.rule, target.start, target.end, target);
  }
  if ("begins" in condition) {
    const target = queryTarget(context, spanOf(context, condition.begins, scope), scope);
    return nestedBegins(target.context, condition.rule, target.start, target.end, target);
  }
  // Where the input of the parse that reads the condition begins (engine §10).
  if ("initial" in condition) {
    const where = observe(context, spanOf(context, condition.initial, scope), scope, "initial");
    return where.start === where.context.inputStart;
  }
  const left = evaluate(context, condition.left, scope);
  const right = evaluate(context, condition.right, scope);
  switch (condition.op) {
    case "=":
    case "≠": {
      let equal;
      if ("string" in left && "string" in right) equal = left.string === right.string;
      else equal = sameTags(asSet(left), asSet(right));
      return equal === (condition.op === "=");
    }
    case "∈":
    case "∉":
      return asSet(right).has(asString(left)) === (condition.op === "∈");
    case "⊆":
    case "⊈":
      return isSubset(asSet(left), asSet(right)) === (condition.op === "⊆");
    default:
      throw new GencmuError("grammar", `unknown comparison ${condition.op}`);
  }
}

// The longest span whose answers are remembered by content, so that a word
// repeated at many places is looked up once; a longer span is remembered by
// position, since a key of content costs as much as the span is long, and the
// span of `from` or `after` runs to the end of the input (engine §4).
const CONTENT_KEY_LIMIT = 64;

// The key under which a nested parse's answer is remembered: everything the
// nested parse can observe (engine §4).
/**
 * @param {ParseContext} context
 * @param {string} kind
 * @param {string} rule
 * @param {number} start
 * @param {number} end
 * @returns {string}
 */
function nestedKey(context, kind, rule, start, end) {
  if (end - start > CONTENT_KEY_LIMIT) return JSON.stringify(["at", kind, rule, start, end]);
  // The text over the span's source (engine §1), and each token's tags,
  // text, phonemes, and where it begins and ends in that text, which text()
  // of a part of the span reads.
  const [low, high] = start < end ? context.sources.of(start, end) : [0, 0];
  /** @type {(string | number)[]} */
  const key = ["of", kind, rule, context.sourceText.slice(low, high).join("")];
  for (let index = start; index < end; index++) {
    const token = context.tokens[index];
    key.push(tagKey(token.tags), token.text, token.phonemes || "", token.source[0] - low, token.source[1] - low);
  }
  return JSON.stringify(key);
}

// How deep the queries that fault F25 lets through nest before they end.
const UNSEEN_DEPTH = 64;
let unseenDepth = 0;

/**
 * @template {boolean | TagSet} T
 * @param {ParseContext} context
 * @param {string} kind
 * @param {string} rule
 * @param {number} start
 * @param {number} end
 * @param {(chart: Chart) => T} compute
 * @param {{key: [number, number] | null, fromCheck: boolean} | null} [target]
 *   where a query of the check came from
 * @returns {T}
 */
function nested(context, kind, rule, start, end, compute, target = null) {
  // A fault keys a long query of the check by its span in R (F21).
  const key = target !== null && target.key !== null && end - start > CONTENT_KEY_LIMIT
    ? JSON.stringify(["at", kind, rule, target.key[0], target.key[1]])
    : nestedKey(context, kind, rule, start, end);
  if (context.nested.has(key)) return /** @type {T} */ (context.nested.get(key));
  // A fault finds no query cycle while the check runs (F25). The recursion
  // that it lets through ends at a bound, not in a stack overflow.
  const unseen = context.checking && fault("F25");
  if (unseen && unseenDepth >= UNSEEN_DEPTH) throw new Error("F25: the queries of the check recurse without end");
  // A parse in progress is known by its rule and span, whatever the kind of
  // query, so that alternating kinds cannot hide a query about a span from
  // inside its own parse (engine §4).
  const circular = "parse\u0001" + rule + "\u0001" + start + "\u0001" + end;
  if (context.inProgress.has(circular)) {
    throw new GencmuError("grammar",
      `a condition asks whether ${JSON.stringify(textOf(context, start, end))} parses as ${rule} from inside the parse of that span as ${rule}: ` +
      `the grammar defines ${rule} in terms of itself over the same text`, { rule });
  }
  if (!unseen) context.inProgress.add(circular);
  else unseenDepth++;
  if (context.trace) context.trace.depth++;
  try {
    const chart = recognize(context, rule, start, end);
    const answer = compute(chart);
    context.nested.set(key, answer);
    return answer;
  } finally {
    if (!unseen) context.inProgress.delete(circular);
    else unseenDepth--;
    if (context.trace) context.trace.depth--;
  }
}

/**
 * @param {ParseContext} context
 * @param {string} rule
 * @param {number} start
 * @param {number} end
 * @param {{key: [number, number] | null, fromCheck: boolean} | null} [target]
 * @returns {boolean}
 */
function nestedMatches(context, rule, start, end, target = null) {
  return nested(context, "matches", rule, start, end, (chart) => eligibleWitnesses(chart, rootItems(chart, rule), testHolds).length > 0, target);
}

/**
 * Whether a prefix of [start, end) parses as `rule`: a completed item of it
 * with an eligible witness has its origin at `start`, in any set (engine
 * §4).
 * @param {ParseContext} context
 * @param {string} rule
 * @param {number} start
 * @param {number} end
 * @param {{key: [number, number] | null, fromCheck: boolean} | null} [target]
 * @returns {boolean}
 */
function nestedBegins(context, rule, start, end, target = null) {
  return nested(context, "begins", rule, start, end, (chart) => {
    /** @type {Item[]} */
    const witnesses = [];
    for (const set of chart.sets) {
      if (set === undefined) continue;
      for (const item of set.items) if (item.complete && item.origin === start && item.production.lhs === rule) witnesses.push(item);
    }
    return eligibleWitnesses(chart, witnesses, testHolds).length > 0;
  }, target);
}

/**
 * @param {ParseContext} context
 * @param {string} rule
 * @param {number} start
 * @param {number} end
 * @param {{key: [number, number] | null, fromCheck: boolean} | null} [target]
 * @returns {TagSet}
 */
function nestedTags(context, rule, start, end, target = null) {
  return nested(context, "tags", rule, start, end, (chart) =>
    eligibleWitnesses(chart, rootItems(chart, rule), testHolds).reduce((acc, item) => tagUnion(acc, context.interner.get(item.tagId)), tagSet()), target);
}

// The furthest position the parse reached, and what could have been read
// there, with the rules that could have read it.
/**
 * @param {Chart} chart
 * @returns {{position: number, expected: Expectation[]}}
 */
export function rejectionOf(chart) {
  const position = chart.furthest;
  return { position, expected: expectedAt(chart, position) };
}

/**
 * The terminals the parse could have read at a position, each with the
 * rules whose items could have read it: the items there whose next symbol
 * is a terminal, and the predictions the lookahead did not make items of.
 * @param {Chart} chart
 * @param {number} position
 * @returns {Expectation[]}
 */
export function expectedAt(chart, position) {
  const set = chart.setAt(position);
  /** @type {Map<string, Set<string>>} */
  const expected = new Map();
  /** @type {(terminal: string, rule: string) => void} */
  const note = (terminal, rule) => {
    let rules = expected.get(terminal);
    if (!rules) expected.set(terminal, (rules = new Set()));
    rules.add(rule);
  };
  for (const item of set.items) {
    const next = item.production.rhs[item.dot];
    if (next && next.terminal) note(writtenSymbol(next), item.production.owner);
  }
  // A skipped prediction passed its conditions before it was skipped. Those
  // it checked then use no captures, so they hold again now.
  const context = chart.context;
  const next = position < chart.end ? context.tokens[position] : null;
  for (const rule of set.skipped) {
    for (const production of context.lowered.byLhs.get(rule) || []) {
      if (!lookaheadSkips(context, production, next) || failedCondition(context, production, -1, null, position, position)) continue;
      note(writtenSymbol(production.rhs[0]), production.owner);
    }
  }
  return [...expected].sort((left, right) => compareCodePoints(left[0], right[0])).map(([terminal, rules]) => ({
    terminal,
    rules: [...rules].sort(compareCodePoints),
  }));
}
