// Recognition (engine §4) and the terms and conditions it evaluates
// (engine §10).

import { PatternMachine, leafTest } from "./patterns.js";
import { GencmuError } from "./errors.js";
import { Sources } from "./tokens.js";
import { eligibleWitnesses } from "./eligible.js";
import { countWork, fault, hooks } from "./testing.js";
import { conditionVariables } from "./grammar.js";
import { tagKey, tagUnion, TagUnion, tagIntersection, tagDifference, isSubset, sameTags, tagSet, compareCodePoints, codeOfCharacterTag, rangeTags, isName, splitString } from "./tags.js";

/**
 * @import { Argument, CharacterClass, Condition, Edge, Expectation, GrammarSymbol, LoweredGrammar, Production, ReadyCondition, Scope, Captured, SpanValue, SymbolTest, TagSet, Term, TermValue } from "./types.js"
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

// An item with more than a few further ways, built in an ambiguous grammar,
// gets an index of them by `previous` and then `child`. A scan of its list
// for each new way would cost the square of their number. Most items have
// one way, so the index is made only when the list grows past this.
const EDGE_SCAN_LIMIT = 8;
/** @type {WeakMap<Item, Map<Item, Set<Item | null>>>} */
const edgeIndexes = new WeakMap();

/**
 * @param {Map<Item, Set<Item | null>>} index
 * @param {Item} previous
 * @param {Item | null} child
 */
function indexEdge(index, previous, child) {
  const children = index.get(previous);
  if (children) children.add(child);
  else index.set(previous, new Set([child]));
}

/** @type {WeakMap<object, any[]>} */
const patternDemands = new WeakMap();
/** @param {any} node @returns {any[]} */
function demandedPatterns(node) {
  const old = patternDemands.get(node);
  if (old) return old;
  const seen = new WeakSet();
  const found = [], stack = [node];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object" || value instanceof Set || seen.has(value)) continue;
    seen.add(value);
    if (value.op === "≅" || value.op === "≇") found.push(value.right.pattern);
    else for (const child of Object.values(value)) stack.push(child);
  }
  patternDemands.set(node, found);
  return found;
}

/** @param {Production} production @returns {boolean} */
function omissionAllowed(production) {
  const test = production.elidedTest;
  if (!test) return true;
  const sound = test.op === "=" ? test.sound : "";
  return leafTest({ test: test.op, value: test.sound !== undefined ? { string: test.sound } : { set: test.tags } },
    sound ?? "", new Set([/** @type {string} */ (production.elided)]));
}

/** @param {ParseContext} context @param {string|null} terminal @returns {number} */
function omittedState(context, terminal) {
  return context.patterns ? context.patterns.node(null, context.patterns.empty, { terminal, sound: "", tags: new Set([terminal]) }) : -1;
}

/** @param {ParseContext} context @param {string} terminal @param {number} at @returns {number} */
export function structuralRead(context, terminal, at) {
  const machine = context.patterns;
  if (!machine) return -1;
  if (context.synthetic?.[at] && !rawObservations(context)) return machine.empty;
  return machine.node(null, machine.empty, { terminal, sound: canonicalSound(context, at), tags: context.tokens[at].tags });
}

/** @param {ParseContext} context @param {Production} production @param {number} dot @param {number} at @returns {number} */
function terminalState(context, production, dot, at) {
  const machine = context.patterns;
  if (!machine) return -1;
  if (context.synthetic?.[at] && !rawObservations(context)) {
    if (production.helper && production.elided !== null && dot === 0) return omittedState(context, production.elided);
    return machine.empty;
  }
  const token = context.tokens[at];
  return machine.node(null, machine.empty, { terminal: production.rhs[dot].name, sound: canonicalSound(context, at), tags: token.tags });
}

/** @param {ParseContext} context @param {Production} production @param {number} dot @param {Item|null} previous @param {Item|null} child @param {number} end @returns {{prefix:number,structure:number}} */
function structuralStep(context, production, dot, previous, child, end) {
  const machine = context.patterns;
  if (!machine) return { prefix: -1, structure: -1 };
  const prefix = previous ? machine.concat(previous.prefix, child ? child.structure : terminalState(context, production, dot - 1, end - 1)) : machine.empty;
  let structure = prefix;
  if (dot === production.rhs.length) {
    if (!production.helper) structure = machine.node(production.lhs, prefix);
    else if (production.rhs.length === 0 && production.elided !== null) structure = omittedState(context, production.elided);
  }
  return { prefix, structure };
}

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
    const patterns = demandedPatterns(lowered.productions);
    this.patterns = patterns.length ? new PatternMachine(patterns) : null;
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
    /**
     * For each position, the first token at or after it whose sound is not
     * empty, made on the first sound test. A test then skips a run of
     * silent tokens in one step, rather than walking it each time.
     * @type {Int32Array | null}
     */
    this.nextSounding = null;
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
    this.prefix = -1;
    this.structure = -1;
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
 * A nested parse whose answer is not yet known, which the evaluation that
 * needs it halts for (engine §4). The recognizer then parses that span on a
 * stack of its own, so that a chain of nested parses costs heap and not the
 * call stack. The evaluation returns HALT. Each part of it that has more
 * to do adds a frame of what is left as HALT leaves it (pause). The answer
 * then goes through the frames, the innermost first, and the evaluation
 * goes on from where it halted. Starting it again would evaluate
 * the parts before the halt once for each query, the square of their number.
 */
class Pending {
  /**
   * @param {ParseContext} context
   * @param {"matches" | "begins" | "tags"} kind
   * @param {string} rule
   * @param {number} start
   * @param {number} end
   * @param {[number, number] | null} at the span in R that fault F21 keys
   *   a query of the check by
   * @param {string} key what the answer is remembered by
   * @param {boolean} unseen whether fault F25 hides the parse from the
   *   check for parses already running
   */
  constructor(context, kind, rule, start, end, at, key, unseen) {
    this.context = context;
    this.kind = kind;
    this.rule = rule;
    this.start = start;
    this.end = end;
    this.at = at;
    this.key = key;
    this.unseen = unseen;
    /**
     * What the halted evaluation has left to do, the innermost part first.
     * Each frame takes the value of the part inside it and gives its own,
     * or HALT where it halts again.
     * @type {((value: any) => any)[]}
     */
    this.frames = [];
  }
}

/**
 * What an evaluation returns where it halts for a nested parse. It is a
 * value, not a throw, since a long text halts hundreds of thousands of
 * times. A throw through each part that saves a frame costs far more than
 * a comparison in each.
 */
const HALT = Symbol("halt");

/** @typedef {typeof HALT} Halt */

/**
 * The nested parse that the evaluation now halting halts for. Only one is
 * ever in flight, since the recognizer takes it before anything else is
 * evaluated.
 * @type {Pending | null}
 */
let halting = null;

/**
 * Adds a frame to the halt that leaves a part of an evaluation.
 * @param {(value: any) => any} frame what the part does with the value of
 *   the part inside it that halted
 * @returns {Halt}
 */
function pause(frame) {
  /** @type {Pending} */ (halting).frames.push(frame);
  return HALT;
}

/**
 * Takes the nested parse that an evaluation halted for.
 * @returns {Pending}
 */
function takeHalt() {
  const halt = /** @type {Pending} */ (halting);
  halting = null;
  return halt;
}

/**
 * Goes on with a halted evaluation: the answer goes through its frames, the
 * innermost first. A frame that halts again keeps the frames outside it,
 * which the new halt adds after its own.
 * @param {((value: any) => any)[]} frames
 * @param {any} value
 * @returns {any}
 */
function proceed(frames, value) {
  for (let index = 0; index < frames.length; index++) {
    value = frames[index](value);
    if (value === HALT) {
      const inner = /** @type {Pending} */ (halting).frames;
      for (let outer = index + 1; outer < frames.length; outer++) inner.push(frames[outer]);
      return HALT;
    }
  }
  return value;
}

/**
 * One recognition in progress, and the nested parse it answers, if it is
 * one. `resume` goes on until the chart is done, or until it halts for a
 * nested parse, which it returns.
 * @typedef {object} Run
 * @property {ParseContext} context
 * @property {(answer?: boolean | TagSet) => Chart | Pending} resume goes
 *   on, with the answer of the nested parse it halted for, if it did
 * @property {Pending | null} query
 * @property {number} outerStart the bounds of the context's input before
 *   the run, which it restores when it ends
 * @property {number} outerEnd
 */

/**
 * Runs the recognizer over tokens[start, end) with `rule` as the start rule.
 * @param {ParseContext} context
 * @param {string} rule
 * @param {number} start
 * @param {number} end
 * @returns {Chart}
 */
export function recognize(context, rule, start, end) {
  return drive(startRun(context, rule, start, end, null));
}

/**
 * Evaluates something outside any recognition, such as a tag term of an
 * emission (engine §11). A nested parse it needs runs first, and the
 * evaluation goes on from where it halted.
 * @template T
 * @param {() => T | Halt} evaluation
 * @returns {T}
 */
export function settled(evaluation) {
  /** @type {T | Halt} */
  let value = evaluation();
  while (value === HALT) {
    const halt = takeHalt();
    drive(startQuery(halt));
    value = proceed(halt.frames, halt.context.nested.get(halt.key));
  }
  return value;
}

/**
 * Runs a recognition and the nested parses it needs, each on a stack of
 * runs, not of calls. A run that halts for a nested parse waits below the
 * run that answers it, and then goes on from where it halted.
 *
 * JavaScript has the generator trampoline of trampoline.js, but conditions
 * and terms run at almost every step, and as generators they would cost
 * far more. They run as ordinary calls, and only a halt saves frames.
 * @param {Run} root
 * @returns {Chart}
 */
function drive(root) {
  /** @type {Run[]} */
  const runs = [root];
  /** @type {boolean | TagSet | undefined} */
  let answer;
  try {
    for (;;) {
      const run = runs[runs.length - 1];
      const chart = run.resume(answer);
      answer = undefined;
      if (chart instanceof Pending) {
        runs.push(startQuery(chart));
        continue;
      }
      runs.pop();
      endRun(run);
      if (run.query !== null) answer = settle(run.query, chart);
      if (runs.length === 0) return chart;
    }
  } finally {
    // A parse that failed frees its place and its bounds, as one that
    // finished does, the innermost first.
    for (let index = runs.length - 1; index >= 0; index--) endRun(runs[index]);
  }
}

/**
 * The run that answers a nested parse: its span alone, with its rule as the
 * start rule. A parse in progress is known by its rule and span, whatever
 * the kind of query, so that alternating kinds cannot hide a query about a
 * span from inside its own parse (engine §4).
 * @param {Pending} query
 * @returns {Run}
 */
function startQuery(query) {
  const { context, rule, start, end, unseen } = query;
  // The recursion that fault F25 lets through ends at a bound, not in
  // running out of memory.
  if (unseen && unseenDepth >= UNSEEN_DEPTH) throw new Error("F25: the queries of the check recurse without end");
  const circular = "parse\u0001" + rule + "\u0001" + start + "\u0001" + end;
  if (context.inProgress.has(circular)) {
    throw new GencmuError("grammar",
      `a condition asks whether ${JSON.stringify(textOf(context, start, end))} parses as ${rule} from inside the parse of that span as ${rule}: ` +
      `the grammar defines ${rule} in terms of itself over the same text`, { rule });
  }
  if (!unseen) context.inProgress.add(circular);
  else unseenDepth++;
  if (context.trace) context.trace.depth++;
  return startRun(context, rule, start, end, query);
}

/**
 * Ends a run: restores the bounds of its context's input and, for a nested
 * parse, frees its place.
 * @param {Run} run
 */
function endRun(run) {
  const { context, query } = run;
  context.inputStart = run.outerStart;
  context.inputEnd = run.outerEnd;
  if (query === null) return;
  if (!query.unseen) context.inProgress.delete("parse\u0001" + query.rule + "\u0001" + query.start + "\u0001" + query.end);
  else unseenDepth--;
  if (context.trace) context.trace.depth--;
}

/**
 * Remembers the answer of a nested parse from its chart. Only the items
 * with an eligible witness count.
 * @param {Pending} query
 * @param {Chart} chart
 * @returns {boolean | TagSet}
 */
function settle(query, chart) {
  const { context, kind, rule, start } = query;
  /** @type {boolean | TagSet} */
  let answer;
  if (kind === "matches") {
    answer = eligibleWitnesses(chart, rootItems(chart, rule), testHolds).length > 0;
  } else if (kind === "begins") {
    // A completed item from the span's start, in any set (engine §4).
    /** @type {Item[]} */
    const witnesses = [];
    for (const set of chart.sets) {
      if (set === undefined) continue;
      for (const item of set.items) if (item.complete && item.origin === start && item.production.lhs === rule) witnesses.push(item);
    }
    answer = eligibleWitnesses(chart, witnesses, testHolds).length > 0;
  } else {
    const result = new TagUnion();
    for (const item of eligibleWitnesses(chart, rootItems(chart, rule), testHolds)) result.add(context.interner.get(item.tagId));
    answer = result.result();
  }
  context.nested.set(query.key, answer);
  return answer;
}

// What a run does next. A step that halts for a nested parse keeps its
// place and the frames of its evaluation, and goes on from there once the
// answer is known. A completed item has no step of its own, since its tags
// are evaluated by the advance that makes it. Its step is the advance of
// its waiting items.
/** Take the next entry of the queue. */
const NEXT = 0;
/** Predict a rule's productions, from the one at the step's index on. */
const PREDICT = 1;
/** Advance an item over the empty constituents of a set, from the index on. */
const EMPTIES = 2;
/** Advance an item over a token. */
const TERMINAL = 3;
/** Advance the items that wait for a completed item, from the index on. */
const WAITERS = 4;

// The parts of a prediction or an advance, after any tag term that a fault
// evaluates first: its conditions, its tag term, and the item it makes.
const PART_CONDITIONS = 0;
const PART_TAGS = 1;
const PART_ITEM = 2;

/**
 * Starts a run over tokens[start, end) with `rule` as the start rule. The
 * run holds its chart, where its queue stands, and the step it is in.
 * @param {ParseContext} context
 * @param {string} rule
 * @param {number} start
 * @param {number} end
 * @param {Pending | null} query the nested parse it answers, if any
 * @returns {Run}
 */
function startRun(context, rule, start, end, query) {
  const outerStart = context.inputStart;
  const outerEnd = context.inputEnd;
  context.inputStart = start;
  context.inputEnd = end;
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
    const projected = structuralStep(context, production, dot, previous, child, set.position);
    let key = itemKey((production.id * dots + dot) * width + origin - start, slots);
    if (context.patterns) key = `${key}/${projected.prefix}/${projected.structure}`;
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
      if (more.length < EDGE_SCAN_LIMIT) {
        for (const edge of more) {
          if (hooks.work) countWork(hooks.work, "edgeChecks");
          if (edge.kind === "scan" && edge.previous === previous) return;
          if (edge.kind === "complete" && edge.previous === previous && edge.child === child) return;
        }
      } else {
        let index = edgeIndexes.get(item);
        if (!index) {
          index = new Map();
          // Each way counts as it is indexed, so that an index built again
          // for each new way fails its budget.
          for (const edge of more) {
            if (hooks.work) countWork(hooks.work, "edgeChecks");
            if (edge.kind === "scan") indexEdge(index, edge.previous, null);
            else if (edge.kind === "complete") indexEdge(index, edge.previous, edge.child);
          }
          edgeIndexes.set(item, index);
        }
        if (hooks.work) countWork(hooks.work, "edgeChecks");
        const children = index.get(previous);
        if (children && children.has(child)) return;
        indexEdge(index, previous, child);
      }
      if (hooks.work) countWork(hooks.work, "packedEdges");
      if (child === null) more.push({ kind: "scan", previous, token: set.position - 1, terminal: production.rhs[dot - 1].name });
      else more.push({ kind: "complete", previous, child });
      return;
    }
    item = new Item(production, dot, origin, slots, previous, child);
    item.prefix = projected.prefix;
    item.structure = projected.structure;
    item.strict = strict;
    if (hooks.work) { countWork(hooks.work, "items"); countWork(hooks.work, "packedEdges"); }
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
    const structure = omittedState(context, production.elided);
    let key = itemKey((production.id * dots) * width + position - start, null);
    if (context.patterns) key = `${key}/${context.patterns.empty}/${structure}`;
    // A restoration whose item exists is another way to build it. Each
    // lookup counts, so that a search slower than the index fails a budget.
    if (hooks.work) countWork(hooks.work, "edgeChecks");
    if (target.index.has(key)) return;
    const item = new Item(production, 0, position, null, null, null);
    item.prefix = context.patterns?.empty ?? -1;
    item.structure = structure;
    item.restores = true;
    if (hooks.work) { countWork(hooks.work, "items"); countWork(hooks.work, "packedEdges"); }
    item.end = position + 1;
    // It has the tags of the empty production, none, unless a fault gives
    // it the synthetic token's (F7:restoration).
    item.tagId = context.interner.intern(fault("F7:restoration") ? token.tags : tagSet());
    target.items.push(item);
    target.index.set(key, item);
    target.queue.push(item);
  };

  // The prediction in progress: its set and rule, whether it is strict,
  // what the set held of the rule before, the production it is at, and
  // whether it skipped one. A prediction that halts for a nested parse goes
  // on from that production.
  /** @type {ChartSet} */
  let predictSet = /** @type {any} */ (null);
  let predictName = "";
  let predictStrict = false;
  /** @type {boolean | undefined} */
  let predictBefore;
  let predictIndex = 0;
  let predictSkipped = false;

  // Begins the prediction of a rule in a set: false when it adds nothing.
  /** @type {(set: ChartSet, name: string, strict?: boolean) => boolean} */
  const beginPredict = (set, name, strict = false) => {
    // A rule's productions are the same at every prediction in one set:
    // predicting them again would only rebuild items that already exist. A
    // strict prediction (engine §7.4) leaves some out, so an ordinary one
    // after it adds them.
    const before = set.predicted.get(name);
    // A fault keeps the strict prediction, and predicts nothing more
    // (F32:predict).
    if (before === false || (before === true && (strict || fault("F32:predict")))) return false;
    set.predicted.set(name, strict);
    predictSet = set;
    predictName = name;
    predictStrict = strict;
    predictBefore = before;
    predictIndex = 0;
    predictSkipped = false;
    return true;
  };

  // Predicts the productions of the prediction in progress, from the one
  // it is at on, or returns HALT where one halts for a nested parse. The
  // frames of the halt finish that production, and the run moves past it.
  // Each part of a production's prediction that halts saves a frame that
  // does the rest, through predictFrom. A long text starts hundreds of
  // thousands of nested parses, each a run that makes every closure here.
  // So the parts after a halt are one closure, not one for each part.
  /** @type {() => void | Halt} */
  const predictRest = () => {
    const set = predictSet;
    const strict = predictStrict;
    const productions = lowered.byLhs.get(predictName) || [];
    const next = set.position < end ? tokens[set.position] : null;
    for (; predictIndex < productions.length; predictIndex++) {
      const production = productions[predictIndex];
      if (production.helper && production.elided !== null && production.rhs.length === 0 && !fault("omission:skip") && !omissionAllowed(production)) continue;
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
      // One scope for the step, which evaluates the tag term at most once
      // (engine §4).
      /** @type {StepScope} */
      const step = { scope: null, structure: structuralStep(context, production, 0, null, null, set.position).structure };
      // The tag term comes after the conditions (engine §4), unless a
      // fault evaluates it first (order:tags).
      if (production.rhs.length === 0 && fault("order:tags", "predict")) {
        if (completeTags(context, production, null, set.position, set.position, step) === HALT) {
          return pause(() => predictFrom(set, production, strict, next, step, PART_CONDITIONS, null));
        }
      }
      if (predictFrom(set, production, strict, next, step, PART_CONDITIONS, null) === HALT) return HALT;
    }
    if (predictSkipped && predictBefore === undefined) set.skipped.push(predictName);
  };

  // The prediction of a production from one of its parts on: its
  // conditions, then its tag term, given whether the conditions held, then
  // its item, given its tag set.
  /** @type {(set: ChartSet, production: Production, strict: boolean, next: Token | null, step: StepScope, part: number, value: any) => void | Halt} */
  const predictFrom = (set, production, strict, next, step, part, value) => {
    if (part === PART_CONDITIONS) {
      const failed = failedCondition(context, production, -1, null, set.position, set.position, step);
      if (failed === HALT) return pause((/** @type {Condition | null} */ found) => predictFrom(set, production, strict, next, step, PART_TAGS, found));
      value = failed;
      part = PART_TAGS;
    }
    if (part === PART_TAGS) {
      const failed = /** @type {Condition | null} */ (value);
      if (failed) {
        const trace = context.trace;
        if (trace && trace.depth === 0 && set.position === trace.position) {
          trace.events.push({ kind: "dropped", production, dot: 0, origin: set.position, condition: failed });
        }
        return;
      }
      // The conditions run first, as they did when every prediction was
      // made an item, so that a trace shows the production as dropped.
      if (lookaheadSkips(context, production, next)) {
        predictSkipped = true;
        return;
      }
      value = -1;
      if (production.rhs.length === 0) {
        const found = completeTags(context, production, null, set.position, set.position, step);
        if (found === HALT) return pause((/** @type {number} */ tagId) => predictFrom(set, production, strict, next, step, PART_ITEM, tagId));
        value = found;
      }
    }
    add(set, production, 0, set.position, null, null, null, value, strict && !fault("F16", "item"));
  };

  // The item advanced over its next symbol, which spans [from, to) and was
  // built by `child`, or read as a token; null when a condition fails, and
  // HALT where the advance halts for a nested parse. Each part that halts
  // saves a frame that does the rest, through advanceFrom.
  /** @type {(item: Item, from: number, to: number, child: Item | null) => Advanced | null | Halt} */
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
    const captureIndex = production.captureAt[item.dot];
    if (captureIndex >= 0) {
      // A terminal that reads a synthetic token captures no tags (engine
      // §7.5), unless a fault gives it the token's, to a capture and to a
      // production that inherits from the terminal (F7:capture).
      const tags = child ? child.tagId
        : context.interner.intern(synthetic !== null && synthetic[from] && !rawObservations(context) && !fault("F7:capture") ? tagSet() : tokens[from].tags);
      slots = captureAfter(context, slots, captureIndex, from, to, tags, child ? child.structure : terminalState(context, production, item.dot, from));
    }
    if (hooks.work) countWork(hooks.work, "captureLookups");
    /** @type {StepScope} */
    const step = { scope: null, structure: structuralStep(context, production, item.dot + 1, item, child, to).structure };
    if (item.dot + 1 === production.rhs.length && fault("order:tags", "advance")) {
      if (completeTags(context, production, slots, item.origin, to, step) === HALT) {
        return pause(() => advanceFrom(item, to, slots, step, PART_CONDITIONS, null));
      }
    }
    return advanceFrom(item, to, slots, step, PART_CONDITIONS, null);
  };

  // An advance from one of its parts on, as predictFrom.
  /** @type {(item: Item, to: number, slots: Captured, step: StepScope, part: number, value: any) => Advanced | null | Halt} */
  const advanceFrom = (item, to, slots, step, part, value) => {
    const production = item.production;
    if (part === PART_CONDITIONS) {
      const failed = failedCondition(context, production, item.dot, slots, item.origin, to, step);
      if (failed === HALT) return pause((/** @type {Condition | null} */ found) => advanceFrom(item, to, slots, step, PART_TAGS, found));
      value = failed;
      part = PART_TAGS;
    }
    if (part === PART_TAGS) {
      const failed = /** @type {Condition | null} */ (value);
      if (failed) {
        const trace = context.trace;
        if (trace && trace.depth === 0 && to === trace.position) {
          trace.events.push({ kind: "dropped", production, dot: item.dot, origin: item.origin, condition: failed });
        }
        return null;
      }
      value = -1;
      if (item.dot + 1 === production.rhs.length) {
        const found = completeTags(context, production, slots, item.origin, to, step);
        if (found === HALT) return pause((/** @type {number} */ tagId) => advanceFrom(item, to, slots, step, PART_ITEM, tagId));
        value = found;
      }
    }
    return { dot: item.dot + 1, slots, tagId: value };
  };

  // Whether a symbol after an item's next symbol can read (engine §7.4).
  /** @type {(item: Item) => boolean} */
  const readsLater = (item) => /** @type {number} */ (/** @type {Reading} */ (reading).last.get(item.production)) > item.dot;
  // Whether an advance from an item over an empty constituent is held back:
  // a strict item does it only where a later symbol can read.
  /** @type {(item: Item) => boolean} */
  const emptyHeldBack = (item) => item.strict && !fault("F16", "empty") && !readsLater(item);

  // Where the queue stands: the position of the set being processed, and
  // whether the run has entered it yet.
  let position = start;
  let entered = false;
  let furthest = start;
  // The step the run is in when it halts for a nested parse, and its place.
  // An item that predicts goes on to advance over the empty constituents of
  // its rule, unless it is null, for the start rule's prediction. The
  // advances over empty constituents, or of the items waiting for a
  // completed item, are at `index` in `list`. While the run goes on, these
  // are in locals, which a hot loop reads faster than the variables of a
  // closure. `halted` holds the frames of the part of the step that halted.
  let step = PREDICT;
  /** @type {Item | null} */
  let item = null;
  /** @type {Item[]} */
  let list = [];
  let index = 0;
  let strict = false;
  /** @type {Pending | null} */
  let halted = null;
  beginPredict(setAt(start), rule);

  /** @type {Run} */
  const run = {
    context,
    query,
    outerStart,
    outerEnd,
    resume(answer) {
      let kind = step;
      let entry = item;
      let waiting = list;
      let next = index;
      let strictly = strict;
      let at = position;
      let set = setAt(at);
      // A step that halts for a nested parse leaves this block, and the run
      // keeps where it is.
      pausing: {
        if (halted !== null) {
          // The part of the step that halted goes on with the answer. Then
          // the step goes on after it, as the loop below would have.
          const frames = halted.frames;
          halted = null;
          const value = proceed(frames, answer);
          if (value === HALT) break pausing;
          const current = /** @type {Item} */ (entry);
          if (kind === PREDICT) predictIndex++;
          else if (kind === EMPTIES) {
            if (value) add(set, current.production, value.dot, current.origin, value.slots, current, waiting[next], value.tagId, current.strict);
            next++;
          } else if (kind === TERMINAL) {
            if (value) add(setAt(at + 1), current.production, value.dot, current.origin, value.slots, current, null, value.tagId, strictly);
            kind = NEXT;
          } else {
            const waiter = waiting[next];
            if (value) add(set, waiter.production, value.dot, waiter.origin, value.slots, waiter, current, value.tagId, current.origin === at && waiter.strict);
            next++;
          }
        }
        for (;;) {
          if (kind === NEXT) {
            // Takes the next entry of the queue, from the next set once one
            // is done, and sets its step.
            if (!entered) {
              if (at > end) break;
              set = setAt(at);
              if (at > start && set.items.length === 0) break;
              furthest = at;
              if (at > start) {
                // Nothing is added to a set once the next one is being
                // built: its index, queue and predictions can go, which a
                // long text needs, and the lists it keeps can be copied to
                // arrays of their own length, rather than of the length
                // growing them by pushes left.
                const done = setAt(at - 1);
                done.index = new Map();
                done.queue = [];
                done.predicted = new Map();
                done.nullable = new Map();
                done.items = done.items.slice();
                done.skipped = done.skipped.slice();
                for (const [name, list] of done.waiting) if (list.length > 1) done.waiting.set(name, list.slice());
              }
              entered = true;
            }
            if (set.head >= set.queue.length) {
              position = ++at;
              entered = false;
              continue;
            }
            const taken = set.queue[set.head++];
            taken.queued = false;
            entry = taken;
            const symbol = taken.production.rhs[taken.dot];
            if (!symbol) {
              waiting = setAt(taken.origin).waiting.get(taken.production.lhs) || [];
              next = 0;
              kind = WAITERS;
            } else if (!symbol.terminal) {
              // A strict item predicts its next symbol strictly where no
              // symbol after it can read (engine §7.4).
              kind = beginPredict(set, symbol.name, mode === "reconstruction" && taken.strict && !readsLater(taken)) ? PREDICT : EMPTIES;
              if (kind === EMPTIES) next = -1;
            } else if (at < end && (symbol.characters === undefined ? tokens[at].tags.has(symbol.name) : carries(context.unicode, symbol.characters, tokens[at].tags))) {
              // The written routes of an elidable optional (engine §7.4):
              // from an original token, or from a synthetic one, after
              // which the rest of the optional must read, so the item after
              // it is strict.
              strictly = false;
              if (mode === "reconstruction" && taken.dot === 0 && taken.production.helper && taken.production.elided !== null) {
                const fromSynthetic = /** @type {boolean[]} */ (synthetic)[at];
                if (fromSynthetic && fault("F14")) continue;
                if (!fromSynthetic && fault("F24")) continue;
                // A fault makes the item after T ordinary where a strict
                // item read T (F31).
                strictly = fromSynthetic && !fault("F15") && !(fault("F31") && taken.strict);
                // An optional whose content is T alone would complete here,
                // which a strict item never does: drop the item before
                // evaluating its test or its tags (engine §7.4).
                if (strictly && taken.dot + 1 === taken.production.rhs.length) continue;
              }
              kind = TERMINAL;
            } else continue;
          }
          const current = /** @type {Item} */ (entry);
          switch (kind) {
            case PREDICT:
              if (predictRest() === HALT) break pausing;
              // The start rule's prediction is followed by the queue.
              if (entry === null) break;
              next = -1;
            // falls through
            case EMPTIES: {
              // An item that predicted advances over the empty constituents
              // of its next symbol, unless a strict item is held back there.
              if (next === -1) {
                if (mode === "reconstruction" && emptyHeldBack(current)) break;
                waiting = set.nullable.get(/** @type {GrammarSymbol} */ (current.production.rhs[current.dot]).name) || [];
                next = 0;
                kind = EMPTIES;
              }
              // The list can grow while it is walked, and the walk reads
              // what is added.
              for (; next < waiting.length; next++) {
                const done = waiting[next];
                const advanced = advance(current, at, at, done);
                if (advanced === HALT) break pausing;
                if (advanced) {
                  add(set, current.production, advanced.dot, current.origin, advanced.slots, current, done, advanced.tagId, current.strict);
                }
              }
              break;
            }
            case TERMINAL: {
              const advanced = advance(current, at, at + 1, null);
              if (advanced === HALT) break pausing;
              if (advanced) {
                add(setAt(at + 1), current.production, advanced.dot, current.origin, advanced.slots, current, null, advanced.tagId, strictly);
              }
              break;
            }
            case WAITERS: {
              // The items waiting for the completed item advance over it.
              // The list can grow while it is walked, and the walk reads
              // what is added.
              const empty = current.origin === at;
              for (; next < waiting.length; next++) {
                const waiter = waiting[next];
                if (empty && mode === "reconstruction" && emptyHeldBack(waiter)) continue;
                const advanced = advance(waiter, current.origin, at, current);
                if (advanced === HALT) break pausing;
                if (advanced) {
                  add(set, waiter.production, advanced.dot, waiter.origin, advanced.slots, waiter, current, advanced.tagId, empty && waiter.strict);
                }
              }
              break;
            }
          }
          kind = NEXT;
        }
        step = NEXT;
        /** @type {(position: number) => ChartSet} */
        const peek = (position) => sets[position - start] || new ChartSet(position);
        return { sets, start, end, setAt: peek, furthest, context };
      }
      step = kind;
      item = entry;
      list = waiting;
      index = next;
      strict = strictly;
      halted = takeHalt();
      return halted;
    },
  };
  return run;
}

/** @type {Edge} */
const SEED = { kind: "seed" };

/**
 * An item advanced: its new dot, its captured parts, and its tags if it is
 * complete, or -1.
 * @typedef {{dot: number, slots: Captured, tagId: number}} Advanced
 */

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
  // Each symbol that the closures read counts, so that a test of every
  // other symbol at each one fails its budget.
  /** @type {(production: Production) => boolean} */
  const productionReads = (production) => {
    const restoration = production.rhs.length === 0 && production.helper && production.elided !== null;
    if (restoration && !withoutRestorations) return true;
    for (const symbol of production.rhs) {
      if (hooks.work) countWork(hooks.work, "closures");
      if (reads(symbol)) return true;
    }
    return false;
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
  // Nothing can read, until nothing more is added (engine §7.4). A
  // worklist: a rule found to read makes each production that names it
  // read, so the closure costs the size of the grammar, not a pass over it
  // for each rule found.
  if (!greatest) {
    /** @type {Map<string, Production[]>} */
    const users = new Map();
    /** @type {string[]} */
    const found = [];
    /** @type {(name: string) => void} */
    const add = (name) => {
      if (rules.has(name)) return;
      rules.add(name);
      found.push(name);
    };
    for (const production of lowered.productions) {
      if (hooks.work) countWork(hooks.work, "closures");
      if (productionReads(production)) add(production.lhs);
      for (const symbol of production.rhs) {
        if (hooks.work) countWork(hooks.work, "closures");
        if (symbol.terminal) continue;
        const list = users.get(symbol.name);
        if (list) list.push(production);
        else users.set(symbol.name, [production]);
      }
    }
    for (let name = found.pop(); name !== undefined; name = found.pop()) {
      for (const production of users.get(name) ?? []) {
        if (hooks.work) countWork(hooks.work, "closures");
        add(production.lhs);
      }
    }
  }
  /** @type {Map<Production, number>} */
  const last = new Map();
  for (const production of lowered.productions) {
    if (hooks.work) countWork(hooks.work, "closures");
    let at = -1;
    production.rhs.forEach((symbol, index) => {
      if (hooks.work) countWork(hooks.work, "closures");
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
  const synthetic = context.synthetic;
  if (synthetic === null) return tagSet();
  const result = new TagUnion();
  for (let index = from; index < to; index++) if (synthetic[index]) result.add(context.tokens[index].tags);
  return result.result();
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
        if (hooks.work) countWork(hooks.work, "tags");
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
  for (let index = nextSounding(context, from); index < to; index = nextSounding(context, index + 1)) {
    const part = canonicalSound(context, index);
    if (!sound.startsWith(part, offset)) return false;
    offset += part.length;
  }
  return offset === sound.length;
}

/**
 * The first token at or after a position whose sound is not empty, or the
 * number of tokens.
 * @param {ParseContext} context
 * @param {number} index
 * @returns {number}
 */
function nextSounding(context, index) {
  let next = context.nextSounding;
  if (next === null) {
    const count = context.tokens.length;
    next = new Int32Array(count + 1);
    next[count] = count;
    for (let at = count - 1; at >= 0; at--) {
      if (hooks.work) countWork(hooks.work, "soundSteps");
      next[at] = canonicalSound(context, at) === "" ? next[at + 1] : at;
    }
    context.nextSounding = next;
  }
  if (hooks.work) countWork(hooks.work, "soundSteps");
  return next[index];
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
 * @param {number} structure
 * @returns {Captured}
 */
function captureAfter(context, parent, index, start, end, tags, structure) {
  const key = (parent === null ? "" : parent.id) + ":" + index + ":" + start + ":" + end + ":" + tags + ":" + structure;
  let found = context.captured.get(key);
  if (!found) {
    // The jumps of a skew-binary list: a sequence jumps to its parent's
    // jump's jump where the two jumps skip the same number of parts, and
    // to its parent otherwise. So a search for any earlier part takes a
    // number of steps that grows with the logarithm of the parts.
    const depth = parent === null ? 1 : parent.depth + 1;
    const skip = parent !== null && parent.jump !== null &&
      parent.depth - parent.jump.depth === parent.jump.depth - (parent.jump.jump === null ? 0 : parent.jump.jump.depth);
    const jump = skip ? /** @type {NonNullable<Captured>} */ (/** @type {NonNullable<Captured>} */ (parent).jump).jump : parent;
    found = { parent, jump, depth, index, start, end, tags, structure, id: context.captured.size };
    context.captured.set(key, found);
    if (hooks.work) countWork(hooks.work, "captures");
  }
  return found;
}

/**
 * The captured part at `index` of a production's captures, found from the
 * last part by its jumps (engine §4). The steps that it took, and one for
 * the search, add to `searcher.searched`.
 * @param {NonNullable<Captured>} last
 * @param {number} index
 * @param {{searched: number}} searcher
 * @returns {NonNullable<Captured>}
 */
function capturedPart(last, index, searcher) {
  let part = last;
  let steps = 0;
  while (part.index > index) {
    if (hooks.work) countWork(hooks.work, "captureSteps");
    steps++;
    const jump = part.jump;
    part = /** @type {NonNullable<Captured>} */ (jump !== null && jump.index >= index ? jump : part.parent);
  }
  searcher.searched += steps + 1;
  return part;
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
 * @param {StepScope} step the scope of the step, shared with its tag term
 * @returns {Condition | null | Halt}
 */
function failedCondition(context, production, readyAt, slots, origin, end, step) {
  // In written order (engine §4), unless a fault takes the conditions that
  // read only captures before those that read `$` (order:conditions).
  // The conditions ready here, grouped once per production: a scan of all
  // of them at each advance would cost their number at every dot.
  const conditions = fault("order:conditions")
    ? [...production.conditions].sort((a, b) => Number(conditionVariables(a.condition).includes("")) - Number(conditionVariables(b.condition).includes("")))
    : production.conditionsAt[readyAt + 1];
  // Most steps have no condition ready.
  if (conditions.length === 0) return null;
  return failedFrom(context, production, conditions, 0, readyAt, slots, origin, end, step);
}

/**
 * The conditions of failedCondition from `from` on. A condition that halts
 * for a nested parse saves a frame that goes on after it.
 * @param {ParseContext} context
 * @param {Production} production
 * @param {ReadyCondition[]} conditions
 * @param {number} from
 * @param {number} readyAt
 * @param {Captured} slots
 * @param {number} origin
 * @param {number} end
 * @param {StepScope} step
 * @returns {Condition | null | Halt}
 */
function failedFrom(context, production, conditions, from, readyAt, slots, origin, end, step) {
  for (let index = from; index < conditions.length; index++) {
    if (hooks.work) countWork(hooks.work, "conditions");
    const { condition, readyAt: at } = conditions[index];
    if (at !== readyAt) continue;
    const scope = step.scope ??= new ChartScope(context, production, slots, origin, end, step.structure);
    const held = holds(scope.observing, condition, scope);
    if (held === HALT) return pause((/** @type {boolean} */ value) => value ? failedFrom(context, production, conditions, index + 1, readyAt, slots, origin, end, step) : condition);
    if (!held) return condition;
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
 * @returns {number | Halt}
 */
function completeTags(context, production, slots, origin, end, step) {
  const scope = step.scope ??= new ChartScope(context, production, slots, origin, end, step.structure);
  const tags = scope.constituent();
  if (tags === HALT) return pause((/** @type {TagSet} */ value) => context.interner.intern(value));
  return context.interner.intern(tags);
}

/**
 * The scope that one step of the recognizer makes on demand, and shares
 * between its conditions and its tag term, so that the tag term runs at
 * most once in the step. This saves time only: how many times a step
 * evaluates its tag term is not observable (engine §4).
 * @typedef {{scope: ChartScope | null, structure: number}} StepScope
 */

/** @type {WeakMap<Production, Map<string, number>>} */
const captureIndexes = new WeakMap();

/**
 * The index of a production's capture by its name.
 * @param {Production} production
 * @param {string} name
 * @returns {number}
 */
function captureIndex(production, name) {
  let indexes = captureIndexes.get(production);
  if (!indexes) {
    indexes = new Map();
    for (const [index, capture] of production.captures.entries()) if (!indexes.has(capture.name)) indexes.set(capture.name, index);
    captureIndexes.set(production, indexes);
  }
  return /** @type {number} */ (indexes.get(name));
}

/** @implements {Scope} */
class ChartScope {
  /**
   * @param {ParseContext} context
   * @param {Production} production
   * @param {Captured} slots
   * @param {number} origin
   * @param {number} end
   * @param {number} structure
   */
  constructor(context, production, slots, origin, end, structure) {
    this.context = context;
    this.production = production;
    this.structure = structure;
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
    /** @type {NonNullable<Captured>[] | null} every captured part by its index, once many are read */
    this.parts = null;
    // The steps that searches for single parts took.
    this.searched = 0;
  }
  /**
   * The constituent's tags, from its production's tag term, evaluated at
   * most once, or HALT where the term halts for a nested parse.
   * @returns {TagSet | Halt}
   */
  constituent() {
    if (this.tagSet !== null) return this.tagSet;
    // A tag term cannot read `$`'s own tags (engine §9).
    const term = this.production.tags;
    if (!term) return (this.tagSet = tagSet());
    const value = evaluate(this.observing, term, this);
    if (value === HALT) return pause((/** @type {TermValue} */ found) => (this.tagSet = asSet(found)));
    return (this.tagSet = asSet(value));
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
        structure: this.structure,
        patterns: this.context.patterns,
        start: this.origin,
        end: this.end,
        // HALT where the tag term halts, which only evaluate reads.
        get tags() { return /** @type {TagSet} */ (scope.constituent()); },
        space: this.space,
      };
    }
    // A part by the jumps from the last one, so that a condition at each
    // capture of a long production does not walk every part before it.
    // Once the searches took half as many steps as there are parts, every
    // part in one walk, so that a term that reads them all walks them
    // about twice at most.
    const last = /** @type {NonNullable<Captured>} */ (this.slots);
    const index = captureIndex(this.production, name);
    if (this.parts === null && this.searched * 2 >= last.depth) {
      this.parts = [];
      for (let part = this.slots; part !== null; part = part.parent) {
        this.parts[part.index] = part;
        if (hooks.work) countWork(hooks.work, "captureSteps");
      }
    }
    let found;
    if (this.parts !== null) found = this.parts[index];
    else found = capturedPart(last, index, this);
    return { structure: found.structure, patterns: this.context.patterns, start: found.start, end: found.end, tags: this.context.interner.get(found.tags), space: this.space };
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
  if (hooks.work) countWork(hooks.work, "visits");
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
  const result = new TagUnion();
  for (let index = start; index < end; index++) result.add(tokens[index].tags);
  return result.result();
}

/**
 * A term's value (engine §10): a string, or a set, of strings or of tags.
 * The reader has made sure that the types agree, so a set's kind needs no
 * mark here. HALT where the term halts for a nested parse, and each part
 * that has more to do saves a frame that goes on after it (see Pending).
 * @param {ParseContext} context
 * @param {Argument} term
 * @param {Scope} scope
 * @returns {TermValue | Halt}
 */
export function evaluate(context, term, scope) {
  if (hooks.work) countWork(hooks.work, "visits");
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
  if ("if" in term) {
    const then = term.then;
    const held = holds(context, term.if, scope);
    if (held === HALT) return pause((/** @type {boolean} */ value) => (value ? evaluate(context, then, scope) : { set: tagSet() }));
    return held ? evaluate(context, then, scope) : { set: tagSet() };
  }
  if ("emptySet" in term) return { set: tagSet() };
  if ("union" in term) return unionFrom(context, term.union, 0, new TagUnion(), scope);
  if ("intersection" in term) return setsFrom(context, term.intersection, 0, [], scope, intersectionOf);
  if ("difference" in term) return setsFrom(context, term.difference, 0, [], scope, differenceOf);
  if ("call" in term) {
    const args = term.args;
    switch (term.call) {
      case "phonemes": {
        // The canonical sound (engine §5).
        const where = observe(context, spanOf(context, args[0], scope), scope, "phonemes");
        let sound = "";
        for (let index = nextSounding(where.context, where.start); index < where.end; index = nextSounding(where.context, index + 1)) {
          sound += canonicalSound(where.context, index);
        }
        return { string: sound };
      }
      case "text": {
        const where = observe(context, spanOf(context, args[0], scope), scope, "text");
        return { string: textOf(where.context, where.start, where.end) };
      }
      case "split": {
        // A set of strings (engine §10); an empty delimiter that only a
        // parse sees is an error of the grammar.
        // A frame is made only where a part halts, which a string never
        // does in a grammar that loads.
        const string = evaluate(context, args[0], scope);
        if (string === HALT) return pause((/** @type {TermValue} */ found) => splitBy(context, asString(found), args[1], scope));
        return splitBy(context, asString(string), args[1], scope);
      }
      case "tag": {
        const name = evaluate(context, args[0], scope);
        if (name === HALT) return pause((/** @type {TermValue} */ found) => tagNamed(asString(found)));
        return tagNamed(asString(name));
      }
      case "tags": {
        const span = spanOf(context, args[0], scope);
        if (args.length === 2) {
          const target = queryTarget(context, span, scope);
          const tags = nestedTags(target.context, ruleName(args[1]), target.start, target.end, target);
          return tags === HALT ? pause(asSetValue) : { set: tags };
        }
        if ("capture" in args[0]) {
          // The tags of `$` are its tag term's, which can halt.
          const tags = /** @type {TagSet | Halt} */ (span.tags);
          return tags === HALT ? pause(asSetValue) : { set: tags };
        }
        return { set: observedTokenTags(observe(context, span, scope, "tags"), scope) };
      }
      case "classify": {
        // The classes that the classifier gives the string, for the
        // features of the parse, or none for an unknown key (engine §10).
        const key = evaluate(context, args[0], scope);
        const name = /** @type {{classifier: string}} */ (args[1]).classifier;
        if (key === HALT) return pause((/** @type {TermValue} */ found) => classified(context, name, asString(found)));
        return classified(context, name, asString(key));
      }
      case "classes": {
        const span = spanOf(context, args[0], scope);
        if (!("capture" in args[0])) return classesAmong(observedTokenTags(observe(context, span, scope, "classes"), scope));
        const tags = /** @type {TagSet | Halt} */ (span.tags);
        return tags === HALT ? pause(classesAmong) : classesAmong(tags);
      }
      default:
        throw new GencmuError("grammar", `unknown function ${term.call}`);
    }
  }
  throw new GencmuError("grammar", `unknown term ${JSON.stringify(term)}`);
}

/**
 * A set as a term's value.
 * @param {TagSet} set
 * @returns {TermValue}
 */
function asSetValue(set) {
  return { set };
}

/**
 * The classes among tags: those that begin with a capital letter.
 * @param {TagSet} tags
 * @returns {TermValue}
 */
function classesAmong(tags) {
  const result = tagSet();
  for (const tag of tags) {
    if (hooks.work) countWork(hooks.work, "tags");
    const first = tag.charCodeAt(0);
    if (first >= 0x41 && first <= 0x5a) result.add(tag);
  }
  return { set: result };
}

/**
 * A union of terms from `from` on, added to `result`.
 * @param {ParseContext} context
 * @param {Argument[]} items
 * @param {number} from
 * @param {TagUnion} result
 * @param {Scope} scope
 * @returns {TermValue | Halt}
 */
function unionFrom(context, items, from, result, scope) {
  for (let index = from; index < items.length; index++) {
    const value = evaluate(context, items[index], scope);
    if (value === HALT) {
      return pause((/** @type {TermValue} */ found) => {
        result.add(asSet(found));
        return unionFrom(context, items, index + 1, result, scope);
      });
    }
    result.add(asSet(value));
  }
  return { set: result.result() };
}

/**
 * The sets of terms from `from` on, added to `sets`, and then what `finish`
 * makes of all of them.
 * @param {ParseContext} context
 * @param {Argument[]} items
 * @param {number} from
 * @param {TagSet[]} sets
 * @param {Scope} scope
 * @param {(sets: TagSet[]) => TermValue} finish
 * @returns {TermValue | Halt}
 */
function setsFrom(context, items, from, sets, scope, finish) {
  for (let index = from; index < items.length; index++) {
    const value = evaluate(context, items[index], scope);
    if (value === HALT) {
      return pause((/** @type {TermValue} */ found) => {
        sets.push(asSet(found));
        return setsFrom(context, items, index + 1, sets, scope, finish);
      });
    }
    sets.push(asSet(value));
  }
  return finish(sets);
}

/**
 * @param {TagSet[]} sets
 * @returns {TermValue}
 */
function intersectionOf([first, ...rest]) {
  return { set: rest.reduce((acc, item) => tagIntersection(acc, item), first) };
}

/**
 * @param {TagSet[]} sets
 * @returns {TermValue}
 */
function differenceOf([left, right]) {
  return { set: tagDifference(left, right) };
}

/**
 * The parts of a string split by a delimiter term (engine §10).
 * @param {ParseContext} context
 * @param {string} string
 * @param {Argument} term the delimiter
 * @param {Scope} scope
 * @returns {TermValue | Halt}
 */
function splitBy(context, string, term, scope) {
  const value = evaluate(context, term, scope);
  if (value === HALT) return pause((/** @type {TermValue} */ found) => splitOf(string, asString(found)));
  return splitOf(string, asString(value));
}

/**
 * @param {string} string
 * @param {string} delimiter
 * @returns {TermValue}
 */
function splitOf(string, delimiter) {
  if (delimiter === "") throw new GencmuError("grammar", "split has an empty delimiter");
  return { set: splitString(string, delimiter) };
}

/**
 * The tag that a string names (engine §10).
 * @param {string} name
 * @returns {TermValue}
 */
function tagNamed(name) {
  if (!isName(name)) throw new GencmuError("grammar", `tag(${JSON.stringify(name)}): the string is not a name`);
  return { set: tagSet([name]) };
}

/**
 * The classes that a classifier gives a string, or none for an unknown key.
 * @param {ParseContext} context
 * @param {string} name the classifier
 * @param {string} key
 * @returns {TermValue}
 */
function classified(context, name, key) {
  const table = context.lowered.classifiers.get(name);
  return { set: (table && table.get(key)) || tagSet() };
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
 * Whether a condition holds (engine §10). HALT where it halts for a
 * nested parse, and each part that has more to do saves a frame that goes
 * on after it (see Pending).
 * @param {ParseContext} context
 * @param {Condition} condition
 * @param {Scope} scope
 * @returns {boolean | Halt}
 */
export function holds(context, condition, scope) {
  if (hooks.work) countWork(hooks.work, "visits");
  if ("any" in condition) return anyFrom(context, condition.any, 0, scope);
  if ("all" in condition) return allFrom(context, condition.all, 0, scope);
  // The consequent is evaluated only where the antecedent holds (engine §10).
  if ("if" in condition) {
    const then = /** @type {Condition} */ (condition.then);
    const held = holds(context, condition.if, scope);
    if (held === HALT) return pause((/** @type {boolean} */ value) => !value || holds(context, then, scope));
    return !held || holds(context, then, scope);
  }
  if ("not" in condition) {
    const held = holds(context, condition.not, scope);
    return held === HALT ? pause(negation) : !held;
  }
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
  const comparison = condition;
  if (comparison.op === "≅" || comparison.op === "≇") {
    const captured = scope.capture(/** @type {{capture:string}} */ (comparison.left).capture);
    const matched = /** @type {PatternMachine} */ (captured.patterns).matches(/** @type {number} */ (captured.structure), /** @type {{pattern:any}} */ (comparison.right).pattern);
    return matched === (comparison.op === "≅");
  }
  const left = evaluate(context, comparison.left, scope);
  if (left === HALT) return pause((/** @type {TermValue} */ value) => compareWith(context, comparison, value, scope));
  return compareWith(context, comparison, left, scope);
}

/**
 * @param {boolean} held
 * @returns {boolean}
 */
function negation(held) {
  return !held;
}

/**
 * Whether any condition from `from` on holds, in order.
 * @param {ParseContext} context
 * @param {Condition[]} items
 * @param {number} from
 * @param {Scope} scope
 * @returns {boolean | Halt}
 */
function anyFrom(context, items, from, scope) {
  for (let index = from; index < items.length; index++) {
    const held = holds(context, items[index], scope);
    if (held === HALT) return pause((/** @type {boolean} */ value) => value || anyFrom(context, items, index + 1, scope));
    if (held) return true;
  }
  return false;
}

/**
 * Whether every condition from `from` on holds, in order.
 * @param {ParseContext} context
 * @param {Condition[]} items
 * @param {number} from
 * @param {Scope} scope
 * @returns {boolean | Halt}
 */
function allFrom(context, items, from, scope) {
  for (let index = from; index < items.length; index++) {
    const held = holds(context, items[index], scope);
    if (held === HALT) return pause((/** @type {boolean} */ value) => value && allFrom(context, items, index + 1, scope));
    if (!held) return false;
  }
  return true;
}

/**
 * A comparison whose left side is evaluated: its right side, and then the
 * comparison.
 * @param {ParseContext} context
 * @param {Comparison} condition
 * @param {TermValue} left
 * @param {Scope} scope
 * @returns {boolean | Halt}
 */
function compareWith(context, condition, left, scope) {
  const right = evaluate(context, condition.right, scope);
  if (right === HALT) return pause((/** @type {TermValue} */ value) => compared(condition, left, value));
  return compared(condition, left, right);
}

/**
 * @typedef {Extract<Condition, {op: unknown}>} Comparison
 */

/**
 * @param {Comparison} condition
 * @param {TermValue} left
 * @param {TermValue} right
 * @returns {boolean}
 */
function compared(condition, left, right) {
  const op = condition.op;
  switch (op) {
    case "=":
    case "≠": {
      let equal;
      if ("string" in left && "string" in right) equal = left.string === right.string;
      else equal = sameTags(asSet(left), asSet(right));
      return equal === (op === "=");
    }
    case "∈":
    case "∉":
      return asSet(right).has(asString(left)) === (op === "∈");
    case "⊆":
    case "⊈":
      return isSubset(asSet(left), asSet(right)) === (op === "⊆");
    default:
      throw new GencmuError("grammar", `unknown comparison ${op}`);
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
 * The remembered answer of a nested parse of [start, end) as `rule`. Where
 * none is remembered yet, the evaluation halts: this returns HALT, with the
 * Pending in `halting`, and the recognizer runs the nested parse on its own
 * stack.
 * @param {ParseContext} context
 * @param {"matches" | "begins" | "tags"} kind
 * @param {string} rule
 * @param {number} start
 * @param {number} end
 * @param {{key: [number, number] | null, fromCheck: boolean} | null} target
 *   where a query of the check came from
 * @returns {boolean | TagSet | Halt}
 */
function nested(context, kind, rule, start, end, target) {
  const at = target === null ? null : target.key;
  // A fault keys a long query of the check by its span in R (F21).
  const key = at !== null && end - start > CONTENT_KEY_LIMIT
    ? JSON.stringify(["at", kind, rule, at[0], at[1]])
    : nestedKey(context, kind, rule, start, end);
  const known = context.nested.get(key);
  if (known !== undefined) return known;
  // A fault finds no query cycle while the check runs (F25).
  halting = new Pending(context, kind, rule, start, end, at, key, context.checking && fault("F25"));
  return HALT;
}

/**
 * @param {ParseContext} context
 * @param {string} rule
 * @param {number} start
 * @param {number} end
 * @param {{key: [number, number] | null, fromCheck: boolean} | null} [target]
 * @returns {boolean | Halt}
 */
function nestedMatches(context, rule, start, end, target = null) {
  return /** @type {boolean | Halt} */ (nested(context, "matches", rule, start, end, target));
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
 * @returns {boolean | Halt}
 */
function nestedBegins(context, rule, start, end, target = null) {
  return /** @type {boolean | Halt} */ (nested(context, "begins", rule, start, end, target));
}

/**
 * @param {ParseContext} context
 * @param {string} rule
 * @param {number} start
 * @param {number} end
 * @param {{key: [number, number] | null, fromCheck: boolean} | null} [target]
 * @returns {TagSet | Halt}
 */
function nestedTags(context, rule, start, end, target = null) {
  return /** @type {TagSet | Halt} */ (nested(context, "tags", rule, start, end, target));
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
      if (!lookaheadSkips(context, production, next)) continue;
      const failed = settled(() => failedCondition(context, production, -1, null, position, position, { scope: null, structure: structuralStep(context, production, 0, null, null, position).structure }));
      if (failed) continue;
      note(writtenSymbol(production.rhs[0]), production.owner);
    }
  }
  return [...expected].sort((left, right) => compareCodePoints(left[0], right[0])).map(([terminal, rules]) => ({
    terminal,
    rules: [...rules].sort(compareCodePoints),
  }));
}
