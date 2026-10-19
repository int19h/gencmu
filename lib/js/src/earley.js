import { BOUNDARY_METHODS, boundaryMachine, boundaryAtoms, firstBoundaryAtom } from "./boundary.js";
import {BoundaryAnnotations} from "./boundary-annotations.js";
// Recognition (engine §4) and the terms and conditions it evaluates
// (engine §10).

import { PatternMachine, leafTest } from "./patterns.js";
import {CloseObservations, closeDemands, localCloseDemand, queryPrefixes} from "./close-observations.js";
import { FamilySummaries, deletionTest } from "./family-summaries.js";
import {restoreTokens} from "./restoration.js";
import { GencmuError } from "./errors.js";
import { SPAN_METHODS } from "./methods.js";
import { Sources } from "./tokens.js";
import { eligibleWitnesses } from "./eligible.js";
import { countWork, fault, faults, hooks } from "./testing.js";
import { conditionVariables } from "./grammar.js";
import {rankedFrameTable} from "./ranked-frame.js";
import { clauseChildren, productionClauses, expressionChildren } from "./clause-walk.js";
import { tagKey, tagUnion, TagUnion, tagIntersection, tagDifference, isSubset, sameTags, tagSet, compareCodePoints, splitString, ngrams } from "./tags.js";

/**
 * @import { Argument, CharacterClass, Condition, Edge, Expectation, GrammarSymbol, LoweredGrammar, Production, ReadyCondition, Scope, Captured, SpanValue, SymbolTest, TagSet, Term, TermValue } from "./types.js"
 * @import { CloseEvent, CloseObservation } from "./close-observations.js"
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
 * @property {boolean} [closeRequested]
 * @property {any[]} [boundaryFailures]
 * @property {FamilySummaries|null} [family]
 * @property {Map<Item,{event:CloseEvent,permitted:boolean}[]>|null} [familyTrace]
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

/** @type {WeakMap<Production[], any[]>} */
const patternDemands = new WeakMap();
/** @param {Production[]} productions @returns {any[]} */
function demandedPatterns(productions) {
  const old = patternDemands.get(productions);
  if (old) return old;
  // Clauses share terms across expansions. Deduplicate only those terms,
  // never the productions, captures, logical symbols or their metadata.
  const seen = new WeakSet();
  const found = [];
  for (let index = productions.length - 1; index >= 0; index--) {
    const production = productions[index];
    const stack = [...productionClauses(production), production.value, production.image,
      production.writtenTags, production.source?.tags, production.source?.value, production.source?.image];
    while (stack.length) {
      const value = /** @type {any} */ (stack.pop());
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      if (value.op === "≅" || value.op === "≇") found.push(value.right.pattern);
      else for (const child of clauseChildren(value)) stack.push(child);
    }
  }
  patternDemands.set(productions, found);
  return found;
}

/** @param {Pick<Production,"elided"|"elidedTest">} production @returns {boolean} */
export function omissionAllowed(production) {
  const test = production.elidedTest;
  if (!test) return true;
  const value = test.op === "=" ? test.value : "";
  const tags = new Set([/** @type {string} */ (production.elided)]);
  /** @param {SymbolTest} current @returns {boolean} */
  const holds = current => {
    if (current.inner && !holds(current.inner)) return false;
    if (current.op === "tags") {
      for (const name of current.positive ?? []) if (!tags.has(name)) return false;
      for (const name of current.negative ?? []) if (tags.has(name)) return false;
      return true;
    }
    return (value === current.value) === (current.op === "=");
  };
  return holds(test);
}

/** @param {ParseContext} context @param {string|null} terminal @returns {number} */
function omittedState(context, terminal) {
  return context.patterns ? context.patterns.node(null, context.patterns.empty, { terminal, value: "", tags: new Set([terminal]) }) : -1;
}

/** @param {ParseContext} context @param {string} terminal @param {number} at @returns {number} */
export function structuralRead(context, terminal, at) {
  const machine = context.patterns;
  if (!machine) return -1;
  if (context.synthetic?.[at] && !rawObservations(context)) return machine.empty;
  return machine.node(null, machine.empty, { terminal, value: storedValue(context, at), tags: context.tokens[at].tags });
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
  return machine.node(null, machine.empty, { terminal: production.rhs[dot].name, value: storedValue(context, at), tags: token.tags });
}

/** @param {ParseContext} context @param {Production} production @param {number} dot @param {Item|null} previous @param {Item|null} child @param {number} end @returns {{prefix:number,structure:number}} */
function structuralStep(context, production, dot, previous, child, end) {
  const machine = context.patterns;
  if (!machine) return { prefix: -1, structure: -1 };
  const prefix = previous ? machine.concat(previous.prefix, child ? production.rhs[dot - 1].slot ? machine.seal : child.structure : terminalState(context, production, dot - 1, end - 1)) : machine.empty;
  let structure = prefix;
  if (dot === production.rhs.length) {
    if (!production.helper) structure = machine.node(production.lhs, prefix);
    else if (production.rhs.length === 0 && production.elided !== null) structure = omittedState(context, production.elided);
  }
  return { prefix, structure };
}

/**
 * @param {ParseContext} context
 * @param {number} position
 * @returns {number}
 */
function originalPosition(context, position) {
  return context.recon ? context.recon.project[position] : position;
}

/**
 * @param {ParseContext} context
 * @param {Production} production
 * @param {number} position
 * @returns {CloseObservation|null}
 */
function restoredClose(context, production, position) {
  const machine = context.closes;
  if (!machine || !production.observesCloses) return null;
  if (context.synthetic?.[position]) {
    return terminalObservation(context, /** @type {string} */ (production.elided), position);
  }
  const observed = context.recon?.observed ?? context;
  const at = originalPosition(context, position);
  const sourceAt = at > 0 ? observed.tokens[at - 1].source[1] : observed.tokens[0]?.source[0] ?? 0;
  /** @type {CloseEvent} */
  const event = {
    kind: "close",
    terminal: /** @type {string} */ (production.elided),
    at,
    source: [sourceAt, sourceAt],
  };
  if (production.elidedTest?.op === "=" && production.elidedTest.value !== undefined) {
    event.value = production.elidedTest.value;
  }
  return machine.event(event);
}

/**
 * @param {ParseContext} context
 * @param {string} terminal
 * @param {number} at
 * @returns {CloseObservation|null}
 */
export function terminalObservation(context, terminal, at) {
  const machine = context.closes;
  if (!machine) return null;
  if (!context.synthetic?.[at]) return machine.empty;
  const token = context.tokens[at];
  /** @type {CloseEvent} */
  const event = { kind: "close", terminal, at: originalPosition(context, at), source: token.source };
  if (token.value !== null) event.value = token.value;
  return machine.event(event);
}

/**
 * @param {ParseContext} context
 * @param {number} state
 * @returns {string|null}
 */
function structuralKey(context, state) {
  if (!context.patterns || state < 0) return null;
  return JSON.stringify(context.patterns.states[state], (_, value) => typeof value === "bigint" ? value.toString() : value);
}

/** @type {WeakMap<import("./ranked.js").RankedGroup,Set<string>>} */
const blockPrivateCaptures = new WeakMap();

/**
 * @param {import("./ranked.js").RankedGroup} group
 * @returns {Set<string>}
 */
function privateCapturesOf(group) {
  const old = blockPrivateCaptures.get(group);
  if (old) return old;
  const names = new Set();
  const pending = [group.expr];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (typeof node.capture === "string") names.add(node.capture);
    for (const child of expressionChildren(node)) pending.push(child);
  }
  blockPrivateCaptures.set(group, names);
  return names;
}

/**
 * @param {ParseContext} context
 * @param {Production} production
 * @returns {unknown[]}
 */
function writtenPrefixKey(context, production) {
  return [production.owner, production.source?.at,
    production.writtenExpression ? context.lowered.ranked.paths.get(production.writtenExpression) : null];
}

/**
 * @param {ParseContext} context
 * @param {GrammarSymbol} symbol
 * @returns {unknown[]}
 */
function prefixSymbolKey(context, symbol) {
  const production = context.lowered.byLhs.get(symbol.name)?.[0];
  return [production?.helper ? writtenPrefixKey(context, production) : symbol.name,
    symbol.terminal, symbol.test];
}

/**
 * @param {ParseContext} context
 * @param {Item} before
 * @param {{origin:number,end:number}} child
 * @param {import("./ranked.js").RankedGroup} group
 * @returns {string}
 */
function blockEntryKey(context, before, child, group) {
  const captures = [];
  const privateNames = privateCapturesOf(group);
  const bound = new Map(before.production.lexicalFrame?.captures ?? []);
  for (let part = before.slots; part; part = part.parent) {
    const name = before.production.captures[part.index].name;
    bound.set(name, part);
  }
  for (const [name, part] of [...bound].sort(([left], [right]) => compareCodePoints(left, right))) {
    if (name.startsWith("\u0000") || privateNames.has(name)) continue;
    const closes = part.observation && context.closes
      ? context.closes.identity(part.observation) : null;
    captures.push([name, originalPosition(context, part.start), originalPosition(context, part.end),
      tagKey(context.interner.get(part.tags)), structuralKey(context, part.structure), closes]);
  }
  const frame = before.production.lexicalFrame;
  const prefix = frame && context.patterns ? context.patterns.concat(frame.prefix, before.prefix) : before.prefix;
  const closePrefix = frame && context.closes
    ? context.closes.concat(frame.observationPrefix ?? context.closes.empty, before.observationPrefix ?? context.closes.empty)
    : before.observationPrefix;
  // The written group and original entry observations survive across runs.
  // Runtime frame IDs and the selected option do not enter this key.
  return JSON.stringify([group.site, originalPosition(context, child.origin), originalPosition(context, child.end),
    originalPosition(context, frame?.namedOrigin ?? before.origin), writtenPrefixKey(context, before.production),
    before.production.rhs.slice(0, before.dot).map(symbol => prefixSymbolKey(context, symbol)),
    structuralKey(context, prefix), captures, closePrefix && context.closes ? context.closes.identity(closePrefix) : null]);
}

/**
 * @param {ParseContext} context
 * @param {Item} before
 * @param {Item} child
 * @returns {CloseObservation|null}
 */
function closeChild(context, before, child) {
  const machine = context.closes;
  if (!machine) return null;
  const contribution = child.observation ?? machine.empty;
  const group = before.production.rhs[before.dot].slot;
  if (!group || !contribution.valid) return contribution;
  return machine.event({
    kind: "block",
    key: blockEntryKey(context, before, child, group),
    start: originalPosition(context, child.origin),
    end: originalPosition(context, child.end),
  }, contribution.rules);
}

/**
 * @param {ParseContext} context
 * @param {Production} production
 * @param {number} dot
 * @param {number} origin
 * @param {Item|null} previous
 * @param {Item|null} child
 * @param {number} end
 * @returns {{prefix:CloseObservation,observation:CloseObservation}|null}
 */
function closeStep(context, production, dot, origin, previous, child, end) {
  const machine = context.closes;
  if (!machine || !production.observesCloses) return null;
  let prefix = previous?.observationPrefix ?? machine.empty;
  if (previous && child) {
    prefix = machine.concat(prefix, /** @type {CloseObservation} */ (closeChild(context, previous, child)));
  } else if (previous && context.synthetic?.[end - 1]) {
    prefix = machine.concat(prefix, /** @type {CloseObservation} */ (terminalObservation(context, production.rhs[dot - 1].name, end - 1)));
  }
  prefix = machine.trim(prefix, originalPosition(context, origin), originalPosition(context, end));
  let observation = prefix;
  if (dot === production.rhs.length) {
    if (production.helper && production.rhs.length === 0 && production.elided !== null) {
      observation = /** @type {CloseObservation} */ (restoredClose(context, production, end));
    }
    if (!production.helper) observation = machine.closeRule(observation, production.lhs, originalPosition(context, origin), originalPosition(context, end));
  }
  return { prefix, observation };
}

/**
 * The raw close step supplies cycle validity. This separate step records
 * only the query family's deletion states and replaces ranked interiors
 * with the same opaque block that the outside observation reads.
 * @param {ParseContext} context @param {FamilySummaries|null} family
 * @param {Set<string>|null|undefined} members @param {Production} production
 * @param {number} dot @param {number} origin
 * @param {Item|null} previous @param {Item|null} child @param {number} end
 * @param {{observation:CloseObservation}|null} close
 * @returns {import("./family-summaries.js").FamilySummary|null}
 */
function familyStep(context, family, members, production, dot, origin, previous, child, end, close) {
  if (!family || !context.closes) return null;
  if (close && !close.observation.valid) return family.dead;
  if (!previous) {
    if (production.helper && production.rhs.length === 0 && production.elided !== null && close) {
      return family.record(context.closes.list(close.observation.sequence)[0], !!members?.has(production.owner));
    }
    return family.identity;
  }
  let part;
  if (child && production.rhs[dot-1].slot) {
    const block = closeChild(context, previous, child);
    part = block?.valid ? family.join(family.record(context.closes.list(block.sequence)[0], false),
      child.origin === child.end ? family.identity : family.tokens(child.origin, child.end),
      child.origin, child.origin, child.end) : family.dead;
  } else part = child ? child.familySummary ?? family.identity : family.tokens(previous.end, end);
  return family.join(previous.familySummary ?? family.identity, part, origin, previous.end, end);
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
    this.boundaries = boundaryMachine(lowered.productions);
    /** @type {any} */
    this.emissionBoundaries = null;
    const patterns = demandedPatterns(lowered.productions);
    this.patterns = patterns.length ? new PatternMachine(patterns) : null;
    this.closeRules = closeDemands(lowered);
    /** @type {CloseObservations|null} */
    this.closes = this.closeRules.size ? new CloseObservations() : null;
    /** @type {Map<number,ReturnType<typeof restoreTokens>>} */
    this.restoredViews = new Map();
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
     * Each token's value in canonical form, for the value tests of
     * symbols and for value(), computed when one first looks at the
     * token (engine §4, §5).
     * @type {(string | undefined)[]}
     */
    this.storedValues = new Array(tokens.length);
    /**
     * For each position, the first token at or after it whose value is not
     * empty, made on the first value test. A test then skips a run of
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
    /** @type {any} */
    this.boundary = null;
    /** @type {BoundaryAnnotations|null} */
    this.boundaryAnnotations = null;
    this.prefix = -1;
    this.structure = -1;
    /** @type {CloseObservation|null} */
    this.observationPrefix = null;
    /** @type {CloseObservation|null} */
    this.observation = null;
    /** @type {import("./family-summaries.js").FamilySummary|null} */
    this.familySummary = null;
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
    /** The count of aligned queries when the query halted (engine §4.3). */
    this.asked = 0;
    /** @type {import("./types.js").AlignedSpan|null} */
    this.aligned = null;
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
  if (query.aligned) sharingOf(context).alignedActive++;
  if (query.aligned && hooks.alignedQuery) hooks.alignedQuery(1);
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
  if (query.aligned) sharingOf(context).alignedActive--;
  if (query.aligned && hooks.alignedQuery) hooks.alignedQuery(-1);
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
  /** @type {boolean | {accepted: boolean, tags: string[]} | null} */
  let shared = null;
  if (query.aligned) {
    const constraint = query.aligned;
    const witnesses = [];
    for (const set of chart.sets) {
      if (!set || set.position > constraint.matchEnd) continue;
      if (kind !== "begins" && set.position !== constraint.matchEnd) continue;
      for (const item of set.items) if (item.complete && item.origin === start && item.production.lhs === rule && !!item.production.closeRequested === !!chart.closeRequested) witnesses.push(item);
    }
    const qualified = eligibleWitnesses(chart, boundaryWitnesses(chart,witnesses));
    const aligned = qualified.filter(item => {
      const answer = !!item.observation && (chart.family
        ? !!item.familySummary && chart.family.accepts(item.familySummary, item.end)
        : !!context.closes?.aligned(constraint.observation,item.observation,Math.min(constraint.candidateEnd,item.end)));
      if (chart.familyTrace && hooks.familyAlignment && context.closes) {
        const direct = !!item.observation?.valid && deletionTest(context.closes.list(constraint.observation.sequence),
          chart.familyTrace.get(item) ?? [], start, Math.min(constraint.candidateEnd, item.end));
        hooks.familyAlignment(answer, direct);
      }
      return answer;
    });
    if (kind === "tags") {
      const tags = new TagUnion();
      for (const item of aligned) tags.add(context.interner.get(item.tagId));
      answer = tags.result();
    } else answer = aligned.length !== 0;
  } else if (kind === "begins") {
    // A completed item from the span's start, in any set (engine §4).
    /** @type {Item[]} */
    const witnesses = [];
    for (const set of chart.sets) {
      if (set === undefined) continue;
      for (const item of set.items) if (item.complete && item.origin === start && item.production.lhs === rule && !!item.production.closeRequested === !!chart.closeRequested) witnesses.push(item);
    }
    answer = eligibleWitnesses(chart, boundaryWitnesses(chart,witnesses)).length > 0;
    shared = answer;
  } else {
    // One recognition answers matches and tags, so the shared memo keeps
    // both in one entry (engine §4.3).
    const witnesses = eligibleWitnesses(chart, boundaryWitnesses(chart,rootItems(chart, rule)));
    const result = new TagUnion();
    for (const item of witnesses) result.add(context.interner.get(item.tagId));
    const tags = result.result();
    answer = kind === "matches" ? witnesses.length > 0 : tags;
    shared = { accepted: witnesses.length > 0, tags: [...tags] };
  }
  context.nested.set(query.key, answer);
  if (shared !== null) rememberShared(query, shared);
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
  /** @type {any[]} */
  let boundaryFailures = [];
  const boundarySeen = new Set();
  /** @type {ChartSet[]} */
  const sets = [];
  // A set is made when something first looks at it: once a set is empty,
  // every later one is, and a nested parse over the rest of a long text
  // stops there.
  /** @type {(position: number) => ChartSet} */
  const setAt = (position) => sets[position - start] || (sets[position - start] = new ChartSet(position));
  const dots = context.dots;
  const width = end - start + 1;
  const members = query?.aligned?.family ? lowered.families.get(query.aligned.family) : null;
  const family = members && query?.aligned && context.closes
    ? new FamilySummaries(context.closes, query.aligned.observation, start, query.aligned.candidateEnd) : null;
  // Only the conformance switch retains a marked proof for the independent
  // deletion test. Production runs retain only unmarked observations.
  const familyTrace = family && hooks.familyAlignment ? new Map() : null;
  // Ordinary and observed uses share the grammar, but have different
  // prediction and completion identities. Otherwise a demand inside a
  // parenthesis also splits unrelated paragraphs into all close sequences.
  /** @type {Map<string,Production>} */
  const variants = new Map();
  /** @param {Production} production @param {boolean} requested @returns {Production} */
  const variant = (production, requested) => {
    if (!context.closes) return production;
    const key = `${production.id}/${production.lexicalFrame?.id ?? -1}/${requested}`;
    let found = variants.get(key);
    if (found) return found;
    found = {...production, baseProduction:production.baseProduction ?? production,
      closeRequested:requested,
      observesCloses:requested || localCloseDemand(production).whole};
    variants.set(key, found);
    return found;
  };
  const prefixTable = context.closes ? queryPrefixes(lowered) : null;
  /** @param {Item} item @returns {boolean} */
  const requestChild = item => {
    if (!context.closes) return false;
    if (item.production.observesCloses) return true;
    const demand = localCloseDemand(item.production);
    if (!demand.parts.has(item.dot)) return false;
    const rules = demand.queries.get(item.dot);
    const child = prefixTable?.get(item.production.rhs[item.dot].name);
    const token = tokens[item.end];
    if (!rules || !child || child.nullable || child.leadingClose || !token || context.recon) return true;
    for (const rule of rules) {
      const prefix = prefixTable?.get(rule);
      if (!prefix || prefix.nullable) return true;
      for (const terminal of prefix.first) if (reads(context,terminal,token)) return true;
    }
    return false;
  };
  /** @param {string} name @param {any} frame @param {boolean|undefined} requested */
  const demandKey = (name, frame, requested) =>
    (frame ? `${name}/${frame.id}` : name) + (requested ? "/observed" : "");
  const lexical = lowered.ranked?.groups.length ? rankedFrameTable(context) : null;
  /** @param {Item} item */
  const waitingKey = item => {
    const name = item.production.rhs[item.dot].name;
    const frame = lexical?.entry(item,name);
    return demandKey(name,frame,requestChild(item));
  };
  /** @param {Production} production */
  const completionKey = production => demandKey(production.lhs,production.lexicalFrame,production.closeRequested);

  // The reconstruction mode of engine §7.4, or the old contract's
  // mandatory optionals (a fault); null for the ordinary mode of §4.
  const mode = context.mode;
  const synthetic = context.synthetic;
  const reading = mode === "reconstruction" ? readingOf(lowered) : null;
  const twoItems = mode === "reconstruction" && fault("F17");

  // Adds the item `previous` makes advanced over `child`, or over the token
  // before the set when `child` is null; a prediction when both are null.
  // `strict` says whether the step that makes it is strict (engine §7.4).
  /** @type {(set: ChartSet, production: Production, dot: number, origin: number, slots: Captured, previous: Item | null, child: Item | null, tagId: number, strict?: boolean, obligations?: any[]) => void} */
  const add = (set, production, dot, origin, slots, previous, child, tagId, strict = false, obligations = []) => {
    // A strict item never completes (engine §7.4).
    if (strict && dot === production.rhs.length) return;
    const fail = (/** @type {any} */ literal, /** @type {number} */ at, /** @type {import("./boundary-annotations.js").BoundarySource|undefined} */ annotation) => boundaryFailures.push({literal,at,end:set.position,annotation});
    const bounded = boundaryStep(context,production,dot,origin,set.position,previous,child,obligations,fail);
    const boundary = bounded?.record ?? null;
    if (context.boundaries && !bounded) return;
    if (context.boundaries && !query && dot === production.rhs.length && production.lhs === rule && origin === start && set.position === end &&
        !context.boundaries.accepts(boundary,literal => {
          const edge = boundary.start & literal.bit ? "start" : "end";
          fail(literal,edge === "start" ? origin : set.position,bounded?.annotations[edge].get(literal.bit));
        })) return;
    const projected = structuralStep(context, production, dot, previous, child, set.position);
    const close = closeStep(context,production,dot,origin,previous,child,set.position);
    const summary = familyStep(context, family, members, production, dot, origin, previous, child, set.position, close);
    let key = itemKey((production.id * dots + dot) * width + origin - start, slots);
    if (production.closeRequested) key = `${key}/observed`;
    if (production.lexicalFrame) key = `${key}/f${production.lexicalFrame.id}`;
    if (context.patterns) key = `${key}/${projected.prefix}/${projected.structure}`;
    if (close) key = `${key}/c${close.prefix.id}/${close.observation.id}`;
    if (summary) key = `${key}/family${summary.id}`;
    if (boundary) key = `${key}/b${boundary.id}`;
    if (twoItems && strict) key = "strict" + key;
    let item = set.index.get(key);
    if (item) {
      if (bounded) item.boundaryAnnotations?.merge(bounded.annotations);
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
    if (boundary && !boundarySeen.has(boundary.id)) {
      boundarySeen.add(boundary.id);
      if (hooks.work) countWork(hooks.work,"boundaryRecords");
    }
    item.boundary = boundary;
    if (bounded) item.boundaryAnnotations = bounded.annotations;
    item.prefix = projected.prefix;
    item.structure = projected.structure;
    item.observationPrefix = close?.prefix ?? null;
    item.observation = close?.observation ?? null;
    item.familySummary = summary && family ? family.take(summary) : null;
    if (familyTrace && context.closes) {
      let records = previous ? familyTrace.get(previous) ?? [] : [];
      if (previous && child) {
        const block = production.rhs[dot-1].slot && closeChild(context, previous, child);
        records = records.concat(block ? context.closes.list(block.sequence).map(event => ({event, permitted:false})) : familyTrace.get(child) ?? []);
      } else if (!previous && production.helper && production.rhs.length === 0 && production.elided !== null && close?.observation.valid) {
        records = context.closes.list(close.observation.sequence).map(event => ({event, permitted:!!members?.has(production.owner)}));
      }
      familyTrace.set(item, records);
    }
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
      const waiting = set.waiting.get(waitingKey(item));
      if (waiting) waiting.push(item);
      else set.waiting.set(waitingKey(item), [item]);
    }
    if (dot === production.rhs.length && origin === set.position) {
      let nullable = set.nullable.get(completionKey(production));
      if (!nullable) set.nullable.set(completionKey(production), (nullable = []));
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
    if (production.closeRequested) key = `${key}/observed`;
    if (production.lexicalFrame) key = `${key}/f${production.lexicalFrame.id}`;
    if (context.patterns) key = `${key}/${context.patterns.empty}/${structure}`;
    const observation = restoredClose(context,production,position);
    if (observation) key = `${key}/c${context.closes?.empty.id}/${observation.id}`;
    // A restoration whose item exists is another way to build it. Each
    // lookup counts, so that a search slower than the index fails a budget.
    if (hooks.work) countWork(hooks.work, "edgeChecks");
    if (context.boundaries) key = `${key}/b${context.boundaries.empty.id}`;
    if (target.index.has(key)) return;
    const item = new Item(production, 0, position, null, null, null);
    item.boundary = context.boundaries?.empty ?? null;
    item.prefix = context.patterns?.empty ?? -1;
    item.structure = structure;
    item.observationPrefix = context.closes?.empty ?? null;
    item.observation = observation;
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
  let predictCloses = false;
  let predictStrict = false;
  /** @type {any} */
  let predictFrame = null;
  /** @type {boolean | undefined} */
  let predictBefore;
  let predictIndex = 0;
  let predictSkipped = false;

  // Begins the prediction of a rule in a set: false when it adds nothing.
  /** @type {(set: ChartSet, name: string, strict?: boolean, frame?: any, requested?: boolean) => boolean} */
  const beginPredict = (set, name, strict = false, frame = null, requested = false) => {
    const key = demandKey(name,frame,requested);
    // A rule's productions are the same at every prediction in one set:
    // predicting them again would only rebuild items that already exist. A
    // strict prediction (engine §7.4) leaves some out, so an ordinary one
    // after it adds them.
    const before = set.predicted.get(key);
    // A fault keeps the strict prediction, and predicts nothing more
    // (F32:predict).
    if (before === false || (before === true && (strict || fault("F32:predict")))) return false;
    set.predicted.set(key, strict);
    predictFrame = frame;
    predictCloses = requested;
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
      const base = productions[predictIndex];
      const production = variant(predictFrame ? /** @type {NonNullable<typeof lexical>} */ (lexical).production(base,predictFrame) : base, predictCloses);
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
      if (strict && !fault("F16", "predict") && /** @type {Reading} */ (reading).last.get(production.baseProduction ?? production) === -1) continue;
      // One scope for the step, which evaluates the tag term at most once
      // (engine §4).
      /** @type {StepScope} */
      const step = { scope: null, structure: structuralStep(context, production, 0, null, null, set.position).structure, observation: closeStep(context,production,0,set.position,null,null,set.position)?.observation ?? null };
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
    if (step.scope?.invalidRestoration) return;
    add(set, production, 0, set.position, null, null, null, value, strict && !fault("F16", "item"), step.obligations);
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
      slots = captureAfter(context, slots, captureIndex, from, to, tags, child ? child.structure : terminalState(context, production, item.dot, from), child ? closeChild(context,item,child) : terminalObservation(context,production.rhs[item.dot].name,from));
    }
    if (hooks.work) countWork(hooks.work, "captureLookups");
    /** @type {StepScope} */
    const step = { scope: null, structure: structuralStep(context, production, item.dot + 1, item, child, to).structure, observation: closeStep(context,production,item.dot+1,item.origin,item,child,to)?.observation ?? null };
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
    if (step.scope?.invalidRestoration) return null;
    return { dot: item.dot + 1, slots, tagId: value, obligations:step.obligations };
  };

  // Whether a symbol after an item's next symbol can read (engine §7.4).
  /** @type {(item: Item) => boolean} */
  const readsLater = (item) => /** @type {number} */ (/** @type {Reading} */ (reading).last.get(item.production.baseProduction ?? item.production)) > item.dot;
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
  beginPredict(setAt(start), rule,false,null,!!query?.aligned);

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
            if (value) add(set, current.production, value.dot, current.origin, value.slots, current, waiting[next], value.tagId, current.strict, value.obligations);
            next++;
          } else if (kind === TERMINAL) {
            if (value) add(setAt(at + 1), current.production, value.dot, current.origin, value.slots, current, null, value.tagId, strictly, value.obligations);
            kind = NEXT;
          } else {
            const waiter = waiting[next];
            if (value) add(set, waiter.production, value.dot, waiter.origin, value.slots, waiter, current, value.tagId, current.origin === at && waiter.strict, value.obligations);
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
              if (boundaryFailures.length) boundaryFailures = boundaryFailures.filter(failure => failure.end >= at);
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
              waiting = setAt(taken.origin).waiting.get(completionKey(taken.production)) || [];
              next = 0;
              kind = WAITERS;
            } else if (!symbol.terminal) {
              // A strict item predicts its next symbol strictly where no
              // symbol after it can read (engine §7.4).
              kind = beginPredict(set, symbol.name, mode === "reconstruction" && taken.strict && !readsLater(taken), lexical?.entry(taken,symbol.name) ?? null,requestChild(taken)) ? PREDICT : EMPTIES;
              if (kind === EMPTIES) next = -1;
            } else if (at < end && reads(context, symbol, tokens[at])) {
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
                waiting = set.nullable.get(waitingKey(current)) || [];
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
                  add(set, current.production, advanced.dot, current.origin, advanced.slots, current, done, advanced.tagId, current.strict, advanced.obligations);
                }
              }
              break;
            }
            case TERMINAL: {
              const advanced = advance(current, at, at + 1, null);
              if (advanced === HALT) break pausing;
              if (advanced) {
                add(setAt(at + 1), current.production, advanced.dot, current.origin, advanced.slots, current, null, advanced.tagId, strictly, advanced.obligations);
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
                  add(set, waiter.production, advanced.dot, waiter.origin, advanced.slots, waiter, current, advanced.tagId, empty && waiter.strict, advanced.obligations);
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
        return { sets, start, end, setAt: peek, furthest, context, closeRequested: !!query?.aligned, family, familyTrace, boundaryFailures };
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
 * @typedef {{dot: number, slots: Captured, tagId: number, obligations?:any[]}} Advanced
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
  if (test.inner && !testHolds(context, test.inner, from, to, tags)) return false;
  if (test.op === "tags") {
    for (const tag of /** @type {TagSet} */ (test.positive)) {
      if (hooks.work) countWork(hooks.work, "tags");
      if (!tags.has(tag)) return false;
    }
    for (const tag of /** @type {TagSet} */ (test.negative)) {
      if (hooks.work) countWork(hooks.work, "tags");
      if (tags.has(tag)) return false;
    }
    return true;
  }
  return valueIs(context,/** @type {string} */ (test.value),from,to) === (test.op === "=");
}

/**
 * Whether the tokens [from, to) concatenate to the exact string
 * is exactly it (engine §4, §5). A token with no value adds nothing.
 * @param {ParseContext} context
 * @param {string} value
 * @param {number} from
 * @param {number} to
 * @returns {boolean}
 */
function valueIs(context, value, from, to) {
  let offset = 0;
  for (let index = nextSounding(context, from); index < to; index = nextSounding(context, index + 1)) {
    const part = storedValue(context, index);
    if (!value.startsWith(part, offset)) return false;
    offset += part.length;
  }
  return offset === value.length;
}

/**
 * The first token at or after a position whose value is not empty, or the
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
      if (hooks.work) countWork(hooks.work, "valueSteps");
      next[at] = storedValue(context, at) === "" ? next[at + 1] : at;
    }
    context.nextSounding = next;
  }
  if (hooks.work) countWork(hooks.work, "valueSteps");
  return next[index];
}

/**
 * A token's exact stored value, memoized without normalization (engine §5).
 * @param {ParseContext} context
 * @param {number} index
 * @returns {string}
 */
function storedValue(context, index) {
  let value = context.storedValues[index];
  if (value === undefined) value = context.storedValues[index] = context.tokens[index].value;
  return value;
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
  if (symbol.wildcard) return true;
  if (symbol.literal !== undefined) return token.value === symbol.literal;
  if (symbol.characters) {
    const characters = [...token.value];
    if (characters.length !== 1) return false;
    const code = /** @type {number} */ (characters[0].codePointAt(0));
    const range = /** @type {{from: number, to: number}} */ (symbol.characters);
    return code >= range.from && code <= range.to;
  }
  return token.tags.has(symbol.name);
}



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
 * @param {CloseObservation|null} observation
 * @returns {Captured}
 */
function captureAfter(context, parent, index, start, end, tags, structure, observation) {
  const key = (parent === null ? "" : parent.id) + ":" + index + ":" + start + ":" + end + ":" + tags + ":" + structure + ":" + (observation?.id ?? "");
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
    found = { parent, jump, depth, index, start, end, tags, structure, observation, id: context.captured.size };
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
    item.complete && item.origin === chart.start && item.production.lhs === rule && !!item.production.closeRequested === !!chart.closeRequested);
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
    const scope = step.scope ??= new ChartScope(context, production, slots, origin, end, step.structure,step.observation);
    const atom = firstBoundaryAtom(condition);
    const held = atom ? boundaryCondition(scope.observing,condition,scope,atom,step,conditions[index].wholeBoundary !== false) : holds(scope.observing, condition, scope);
    if (held === HALT) return pause((/** @type {boolean} */ value) => value && !scope.invalidRestoration ? failedFrom(context, production, conditions, index + 1, readyAt, slots, origin, end, step) : condition);
    if (!held || scope.invalidRestoration) return condition;
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
  const scope = step.scope ??= new ChartScope(context, production, slots, origin, end, step.structure,step.observation);
  const tags = scope.constituent();
  if (tags === HALT) return pause((/** @type {TagSet} */ value) => context.interner.intern(value));
  return context.interner.intern(tags);
}

/**
 * The scope that one step of the recognizer makes on demand, and shares
 * between its conditions and its tag term, so that the tag term runs at
 * most once in the step. This saves time only: how many times a step
 * evaluates its tag term is not observable (engine §4).
 * @typedef {{scope: ChartScope | null, structure: number, observation: CloseObservation|null, obligations?:any[]}} StepScope
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
   * @param {CloseObservation|null} [observation]
   */
  constructor(context, production, slots, origin, end, structure, observation = null) {
    this.context = context;
    this.production = production;
    this.structure = structure;
    this.observation = observation;
    this.invalidRestoration = false;
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
    if (name === "" && this.production.lexicalFrame && !this.production.lexicalFrame.parentWhole) {
      const frame = this.production.lexicalFrame;
      const machine = this.context.patterns;
      const prefix = machine ? machine.concat(frame.sealPrefix,machine.seal) : -1;
      const structure = machine ? machine.node(frame.root.lhs,prefix) : -1;
      let observation = this.observation;
      const closes = this.context.closes;
      if (closes && observation?.valid && frame.sealGroup && frame.sealEntry) {
        const group = frame.sealGroup;
        const entry = frame.sealEntry;
        const block = closes.event({kind:"block",key:blockEntryKey(this.context,entry,
          {origin:entry.end,end:this.end},group),
          start:originalPosition(this.context,entry.end),end:originalPosition(this.context,this.end)},observation.rules);
        observation = closes.concat(frame.sealObservationPrefix ?? closes.empty,block);
        observation = closes.closeRule(observation,frame.root.lhs,
          originalPosition(this.context,frame.namedOrigin),originalPosition(this.context,this.end));
      }
      const parent = new ChartScope(this.context,{...frame.root,tags:this.production.parentTags,lexicalFrame:{...frame,parentWhole:true}},null,frame.namedOrigin,this.end,structure,observation);
      return {observation,structure,patterns:machine,start:frame.namedOrigin,end:this.end,space:this.space,
        get tags() {return /** @type {TagSet} */ (parent.constituent());}};
    }
    if (name === "") {
      const scope = this;
      return {
        observation: this.observation,
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
    if ((!this.production.captureSlot.has(name) || this.production.lexicalFrame?.parentWhole) && this.production.lexicalFrame?.captures.has(name)) {
      const found = this.production.lexicalFrame.captures.get(name);
      return {observation:found.observation,structure:found.structure,patterns:this.context.patterns,start:found.start,end:found.end,tags:this.context.interner.get(found.tags),space:this.space};
    }
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
    return { observation:found.observation, structure: found.structure, patterns: this.context.patterns, start: found.start, end: found.end, tags: this.context.interner.get(found.tags), space: this.space };
  }
}

// A span value: [start, end) of the stage's tokens, and the tags of the
// captured constituent if it is a whole capture.
/**
 * Materializes a restored token view only when an observer requests it.
 * Aligned recognition uses the close observation directly.
 * @param {ParseContext} context
 * @param {CloseObservation} observation
 * @returns {ReturnType<typeof restoreTokens>}
 */
function restoredView(context, observation) {
  const cached = context.restoredViews.get(observation.sequence);
  if (cached) return cached;
  const machine = /** @type {CloseObservations} */ (context.closes);
  const records = machine.list(observation.sequence).flatMap(event => event.kind === "close"
    ? [{ terminal: event.terminal, at: event.at, source: event.source,
      ...(event.value === undefined ? {} : { value: event.value }) }] : []);
  const view = restoreTokens(context.tokens, records);
  context.restoredViews.set(observation.sequence, view);
  return view;
}

/**
 * Keeps query bounds and lazy token provenance in one shared span value.
 * @param {ParseContext} context
 * @param {CloseObservation} observation
 * @param {number} candidateEnd
 * @param {number} contextEnd
 * @param {number} [matchEnd]
 * @param {string|null} [family]
 * @returns {import("./types.js").AlignedSpan}
 */
function alignedSpan(context, observation, candidateEnd, contextEnd, matchEnd = candidateEnd, family = null) {
  return {
    observation,
    candidateEnd,
    contextEnd,
    matchEnd,
    family,
    get view() { return restoredView(context, observation); },
  };
}

/**
 * @param {ParseContext} context
 * @param {Argument} span
 * @param {Scope} scope
 * @returns {SpanValue}
 */
function spanOf(context, span, scope) {
  if (hooks.work) countWork(hooks.work, "visits");
  if ("capture" in span) return scope.capture(span.capture);
  if ("method" in span && (span.method === "without-elision" || span.method === "without-elision-except")) {
    const captured = scope.capture(/** @type {{capture:string}} */ (span.receiver).capture);
    const inner = projectedArgument(captured,scope,span.method);
    const machine = context.closes;
    if (!machine || !captured.observation) throw new GencmuError("grammar","a restored span lacks its captured close observation");
    const observation = captured.observation;
    if (!observation.valid && "invalidRestoration" in scope) scope.invalidRestoration = true;
    const r = reconstructionOf(scope);
    const contextEnd = r ? originalPosition(r,r.inputEnd) : context.inputEnd;
    return { start: inner.start, end: inner.end,
      aligned: alignedSpan(context, observation, inner.end, contextEnd, inner.end,
        span.method === "without-elision-except" ? /** @type {{rule:string}} */ (span.args[0]).rule : null) };
  }
  if ("method" in span && (span.method === "first-token" || span.method === "tokens-after-first" || span.method === "last-token")) {
    // In the check, the projection comes first, then the function (engine
    // §7.5), unless a fault applies the function first (F1).
    const argument = spanOf(context, span.receiver, scope);
    const first = functionFirst(argument, scope, span.method);
    if (first) return first;
    const inner = projectedArgument(argument, scope, span.method);
    const { start, end, space } = inner;
    /** @type {SpanValue} */
    let result;
    if (span.method === "first-token") result = { start, end: Math.min(start + 1, end), space };
    else if (span.method === "tokens-after-first") result = { start: Math.min(start + 1, end), end, space };
    else result = { start: Math.max(end - 1, start), end, space };
    if (inner.reconstructed) result.reconstructed = reconstructedPart(scope, inner.reconstructed, span.method);
    if (inner.exact) result.exact = exactPart(scope, inner.exact, span.method);
    return result;
  }
  if ("method" in span && (span.method === "onward" || span.method === "following-tokens")) {
    const argument = spanOf(context, span.receiver, scope);
    if (argument.aligned) {
      const aligned = argument.aligned;
      return span.method === "onward"
        ? { start: argument.start, end: aligned.contextEnd,
          aligned: alignedSpan(context, aligned.observation, aligned.candidateEnd, aligned.contextEnd, aligned.contextEnd, aligned.family) }
        : {start:argument.end,end:aligned.contextEnd};
    }
    const first = functionFirst(argument, scope, span.method);
    if (first) return first;
    const inner = projectedArgument(argument, scope, span.method);
    const r = reconstructionOf(scope);
    const end = inner.space === "raw" ? /** @type {ParseContext} */ (r).inputEnd : context.inputEnd;
    /** @type {SpanValue} */
    const result = { start: span.method === "onward" ? inner.start : inner.end, end, space: inner.space };
    if (inner.reconstructed) {
      const [a, b] = inner.reconstructed;
      result.reconstructed = [span.method === "onward" ? a : b, /** @type {ParseContext} */ (r).inputEnd];
    }
    if (inner.exact) result.exact = exactPart(scope, inner.exact, span.method);
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
  if (call === "first-token") part = [a, Math.min(a + 1, b)];
  else if (call === "tokens-after-first") part = [Math.min(a + 1, b), b];
  else if (call === "last-token") part = [Math.max(b - 1, a), b];
  else if (call === "onward") part = [a, r.inputEnd];
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
  if (call === "last-token") {
    let at = b - 1;
    while (at >= a && synthetic[at]) at--;
    return at >= a ? [at, at + 1] : [b, b];
  }
  if (call === "first-token") {
    const at = original(a, b);
    return at < b ? [at, at + 1] : [b, b];
  }
  if (call === "tokens-after-first") {
    const first = original(a, b);
    return [first < b ? original(first + 1, b) : b, b];
  }
  const end = r.inputEnd;
  return [original(call === "onward" ? a : b, end), end];
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
  if (call === "last-token") {
    let at = b - 1;
    while (at >= a && synthetic[at]) at--;
    return [Math.max(at, a), b];
  }
  let at = a;
  while (at < b && synthetic[at]) at++;
  return call === "first-token" ? [a, Math.min(at + 1, b)] : [Math.min(at + 1, b), b];
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
 * @returns {{context: ParseContext, start: number, end: number, key: [number, number] | null, fromCheck: boolean, aligned?: import("./types.js").AlignedSpan}}
 */
function queryTarget(context, span, scope) {
  if (span.aligned) return {context,start:span.start,end:span.aligned.contextEnd,key:null,fromCheck:reconstructionOf(scope) !== null,aligned:span.aligned};
  const r = reconstructionOf(scope);
  if (r === null) return { context, start: span.start, end: span.end, key: null, fromCheck: false };
  const recon = /** @type {Reconstruction} */ (r.recon);
  if (span.space === "raw") return { context: faultyContext(r, recon.raw ? "F13" : "F3"), start: span.start, end: span.end, key: null, fromCheck: true };
  // The span in R and its projection.
  const rspan = span.space === "R" ? [span.start, span.end] : span.reconstructed || [span.start, span.end];
  const [start, end] = span.space === "R" ? [recon.project[span.start], recon.project[span.end]] : [span.start, span.end];
  if (fault("F3")) return { context: faultyContext(r, "F3"), start: rspan[0], end: rspan[1], key: null, fromCheck: true };
  for (const name of ["F2"]) {
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
  const lowered = observed.lowered;
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
  if ("capture" in term || "method" in term && SPAN_METHODS.has(term.method)) {
    const where = observe(context, spanOf(context, term, scope), scope, "value");
    return { string: where.context.tokens.slice(where.start, where.end).map(token => token.value).join("") };
  }
  if ("concat" in term) return concatFrom(context, term.concat, 0, "", scope);
  if ("method" in term) {
    const receiver = term.receiver;
    const args = term.args;
    switch (term.method) {
      case "value": case "image": {
        const where = observe(context, spanOf(context, receiver, scope), scope, term.method);
        return { string: where.context.tokens.slice(where.start, where.end).map(token => token[/** @type {"value" | "image"} */ (term.method)]).join("") };
      }
      case "source-text": case "decomposed-source-text": {
        const where = observe(context, spanOf(context, receiver, scope), scope, "source-text");
        const text = textOf(where.context, where.start, where.end);
        return { string: term.method === "decomposed-source-text" ? where.context.unicode.decompose(text) : text };
      }
      case "ngrams": {
        const value = evaluate(context, receiver, scope);
        const digits = /** @type {{integer:string}} */ (args[0]).integer;
        return value === HALT ? pause(found => ({set:ngrams(asString(found), digits)})) : {set:ngrams(asString(value), digits)};
      }
      case "split": {
        const value = evaluate(context, receiver, scope);
        if (value === HALT) return pause(found => splitBy(context, asString(found), args[0], scope));
        return splitBy(context, asString(value), args[0], scope);
      }
      case "classify": {
        const value = evaluate(context, receiver, scope);
        const name = /** @type {{classifier: string}} */ (args[0]).classifier;
        if (value === HALT) return pause(found => classified(context, name, asString(found)));
        return classified(context, name, asString(value));
      }
      case "tags": {
        const span = spanOf(context, receiver, scope);
        if (args.length) {
          const target = queryTarget(context, span, scope);
          const tags = nestedTags(target.context, ruleName(args[0]), target.start, target.end, target);
          return tags === HALT ? pause(asSetValue) : { set: tags };
        }
        if ("capture" in receiver) {
          const tags = /** @type {TagSet | Halt} */ (span.tags);
          return tags === HALT ? pause(asSetValue) : { set: tags };
        }
        return { set: observedTokenTags(observe(context, span, scope, "tags"), scope) };
      }
      case "classes": {
        const span = spanOf(context, receiver, scope);
        if (!("capture" in receiver)) return classesAmong(observedTokenTags(observe(context, span, scope, "classes"), scope));
        const tags = /** @type {TagSet | Halt} */ (span.tags);
        return tags === HALT ? pause(classesAmong) : classesAmong(tags);
      }
      default: throw new GencmuError("grammar", `unknown method ${term.method}`);
    }
  }
  throw new GencmuError("grammar", `unknown term ${JSON.stringify(term)}`);
}

/** @param {ParseContext} context @param {Argument[]} parts @param {number} at @param {string} value @param {Scope} scope @returns {TermValue | Halt} */
function concatFrom(context, parts, at, value, scope) {
  for (; at < parts.length; at++) {
    const found = evaluate(context, parts[at], scope);
    if (found === HALT) return pause(result => concatFrom(context, parts, at + 1, value + asString(result), scope));
    value += asString(found);
  }
  return { string: value };
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
    const last = tag.charCodeAt(tag.length - 1);
    if (first >= 0x41 && first <= 0x5a && last >= 0x41 && last <= 0x5a) result.add(tag);
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
  if ("string" in value) return tagSet([value.string]);
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
  if ("method" in condition) {
    const span = spanOf(context, condition.receiver, scope);
    if (BOUNDARY_METHODS.has(condition.method)) {
      if (scope.boundaryValue !== undefined) return scope.boundaryValue;
      return /** @type {NonNullable<Scope["boundary"]>} */ (scope.boundary)(condition);
    }
    if (condition.method === "ends-input") {
      const where = observe(context,span,scope,"ends-input");
      return where.end === where.context.inputEnd;
    }
    if (condition.method === "starts-input") {
      const where = observe(context, span, scope, "starts-input");
      return where.start === where.context.inputStart;
    }
    if (condition.args.length > 1) return anyFrom(context, condition.args.map(arg => ({...condition,args:[arg]})), 0, scope);
    const target = queryTarget(context, span, scope);
    const argument = condition.args[0];
    const rule = "terminal" in argument ? "\u0000query:" + argument.terminal : ruleName(argument);
    if (condition.method === "matches") return nestedMatches(target.context, rule, target.start, target.end, target);
    return nestedBegins(target.context, rule, target.start, target.end, target);
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
  // text, value, and where it begins and ends in that text, which text()
  // of a part of the span reads.
  const [low, high] = start < end ? context.sources.of(start, end) : [0, 0];
  /** @type {(string | number)[]} */
  const key = ["of", kind, rule, context.sourceText.slice(low, high).join("")];
  for (let index = start; index < end; index++) {
    const token = context.tokens[index];
    key.push(tagKey(token.tags), token.text, token.value, token.image, token.source[0] - low, token.source[1] - low);
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
 * @param {{key: [number, number] | null, fromCheck: boolean, aligned?: import("./types.js").AlignedSpan} | null} target
 *   where a query of the check came from
 * @returns {boolean | TagSet | Halt}
 */
function nested(context, kind, rule, start, end, target) {
  const at = target === null ? null : target.key;
  const aligned = target?.aligned;
  const sharing = sharingOf(context);
  if (aligned) sharing.asked++;
  if (aligned && !aligned.observation.valid) return kind === "tags" ? tagSet() : false;
  const key = aligned ? JSON.stringify(["aligned",kind,rule,start,end,aligned.candidateEnd,aligned.matchEnd,aligned.family,context.closes?.identity(aligned.observation)])
    : at !== null && end - start > CONTENT_KEY_LIMIT
      ? JSON.stringify(["at", kind, rule, at[0], at[1]])
      : nestedKey(context, kind, rule, start, end);
  const known = context.nested.get(key);
  if (known !== undefined) {
    if (sharing.tainted.has(key)) sharing.asked++;
    return known;
  }
  const limit = memoLimit();
  // While an aligned query is active, the shared memo serves nothing
  // (engine §4.3). Then a shared answer cannot hide an error of the stack
  // of active queries, so the stack can be checked after the memos.
  if (!aligned && limit > 0 && sharing.alignedActive === 0 && key.startsWith('["of"')) {
    const found = sharedMemoOf(context.lowered).get(sharedKey(key), limit);
    if (found !== undefined) {
      if (hooks.memoHit) hooks.memoHit(sharedKey(key), sharing.alignedActive);
      // The answer enters the memo of the parse, as the answer of its
      // nested parse does.
      const answer = typeof found === "boolean" ? found : kind === "tags" ? tagSet(found.tags) : found.accepted;
      context.nested.set(key, answer);
      return answer;
    }
  }
  // A fault finds no query cycle while the check runs (F25).
  halting = new Pending(context, kind, rule, start, end, at, key, context.checking && fault("F25"));
  halting.aligned = aligned ?? null;
  halting.asked = sharing.asked;
  return HALT;
}

/**
 * The shared memo of a lowered grammar (engine §4.3): the answers of
 * ordinary nested queries with a key of content, kept across parses, in
 * two generations. A key of content names tags and rules, so it holds no
 * number of one parse. An answer is a boolean for begins, and for matches
 * and tags whether the span is accepted and the names of its tags.
 */
class SharedMemo {
  constructor() {
    /** @type {Map<string, boolean | {accepted: boolean, tags: string[]}>} */
    this.newer = new Map();
    /** @type {Map<string, boolean | {accepted: boolean, tags: string[]}>} */
    this.older = new Map();
  }
  /** @param {number} limit */
  room(limit) {
    if (this.newer.size >= limit) {
      this.older = this.newer;
      this.newer = new Map();
    }
  }
  /**
   * The answer of a key, if the memo holds it. An answer found in the older
   * generation moves to the newer one.
   * @param {string} key
   * @param {number} limit
   * @returns {boolean | {accepted: boolean, tags: string[]} | undefined}
   */
  get(key, limit) {
    const found = this.newer.get(key);
    if (found !== undefined) return found;
    const old = this.older.get(key);
    if (old === undefined) return undefined;
    this.older.delete(key);
    this.room(limit);
    this.newer.set(key, old);
    return old;
  }
  /**
   * @param {string} key
   * @param {boolean | {accepted: boolean, tags: string[]}} answer
   * @param {number} limit
   */
  set(key, answer, limit) {
    if (this.newer.has(key)) return;
    this.room(limit);
    this.newer.set(key, answer);
  }
}

/** @type {WeakMap<object, SharedMemo>} */
const sharedMemos = new WeakMap();

/**
 * @param {object} lowered
 * @returns {SharedMemo}
 */
function sharedMemoOf(lowered) {
  let memo = sharedMemos.get(lowered);
  if (!memo) sharedMemos.set(lowered, memo = new SharedMemo());
  return memo;
}

/**
 * The bound of the shared memos. A fault of the library's own tests
 * changes answers, so a parse with a fault neither reads nor keeps shared
 * answers. Nor does a parse whose work a test counts, so that answers of
 * an earlier parse never shorten the count.
 * @returns {number}
 */
function memoLimit() {
  if (faults.size !== 0 || hooks.work) return 0;
  return hooks.memoLimit ?? DEFAULT_MEMO_LIMIT;
}

/** The default bound on the entries of one generation of a shared memo. */
const DEFAULT_MEMO_LIMIT = 1 << 13;

/**
 * For each context, how many aligned queries it asked, and the keys of the
 * answers that depend on one. Such an answer stays out of the shared memo,
 * and so does every answer that reads it (engine §4.3). Also how many
 * aligned queries are active now.
 * @type {WeakMap<ParseContext, {asked: number, tainted: Set<string>, alignedActive: number}>}
 */
const sharings = new WeakMap();

/**
 * @param {ParseContext} context
 * @returns {{asked: number, tainted: Set<string>, alignedActive: number}}
 */
function sharingOf(context) {
  let sharing = sharings.get(context);
  if (!sharing) sharings.set(context, sharing = { asked: 0, tainted: new Set(), alignedActive: 0 });
  return sharing;
}

/**
 * The key of the shared memo for a key of content: matches and tags share
 * a kind, since one recognition answers both (engine §4.3).
 * @param {string} key
 * @returns {string}
 */
function sharedKey(key) {
  const tags = '["of","tags",';
  return key.startsWith(tags) ? '["of","matches",' + key.slice(tags.length) : key;
}

/**
 * Keeps the answer of a nested parse that has finished in the shared memo,
 * unless it depends on an aligned query.
 * @param {Pending} query
 * @param {boolean | {accepted: boolean, tags: string[]}} answer
 */
function rememberShared(query, answer) {
  const { context, key } = query;
  const sharing = sharingOf(context);
  if (sharing.asked !== query.asked) {
    sharing.tainted.add(key);
    return;
  }
  const limit = memoLimit();
  if (query.aligned || limit === 0 || !key.startsWith('["of"')) return;
  if (hooks.memoInsert) hooks.memoInsert(sharedKey(key));
  sharedMemoOf(context.lowered).set(sharedKey(key), answer, limit);
}

/**
 * @param {ParseContext} context
 * @param {string} rule
 * @param {number} start
 * @param {number} end
 * @param {{key: [number, number] | null, fromCheck: boolean, aligned?: import("./types.js").AlignedSpan} | null} [target]
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
 * @param {{key: [number, number] | null, fromCheck: boolean, aligned?: import("./types.js").AlignedSpan} | null} [target]
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
 * @param {{key: [number, number] | null, fromCheck: boolean, aligned?: import("./types.js").AlignedSpan} | null} [target]
 * @returns {TagSet | Halt}
 */
function nestedTags(context, rule, start, end, target = null) {
  return /** @type {TagSet | Halt} */ (nested(context, "tags", rule, start, end, target));
}

// The furthest position the parse reached, and what could have been read
// there, with the rules that could have read it.
/**
 * @param {Chart} chart
 * @returns {{position: number, expected: Expectation[], boundary?:any}}
 */
export function rejectionOf(chart) {
  const position = chart.furthest;
  const failures = (chart.boundaryFailures ?? []).filter(failure => failure.end >= position);
  const candidates = failures.flatMap(failure => boundarySources(chart.context,failure));
  candidates.sort((a,b) => a.at-b.at || a.order-b.order || a.condition-b.condition);
  /** @type {{position:number,expected:Expectation[],boundary?:any}} */
  const result = {position,expected:expectedAt(chart,position)};
  if (candidates.length) { const {rule,condition,at} = candidates[0]; result.boundary = {rule,condition,at}; }
  return result;
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
      const failed = settled(() => failedCondition(context, production, -1, null, position, position, { scope: null, structure: structuralStep(context, production, 0, null, null, position).structure, observation: closeStep(context,production,0,position,null,null,position)?.observation ?? null }));
      if (failed) continue;
      note(writtenSymbol(production.rhs[0]), production.owner);
    }
  }
  return [...expected].sort((left, right) => compareCodePoints(left[0], right[0])).map(([terminal, rules]) => ({
    terminal,
    rules: [...rules].sort(compareCodePoints),
  }));
}

/** Evaluate each Boolean assignment in the existing order, across query halts.
 * @param {any} context @param {any} condition @param {any} scope @param {any} atom @param {any} step @param {boolean} wholeBoundary */
function boundaryCondition(context,condition,scope,atom,step,wholeBoundary) {
  scope.boundaryValue = true;
  const yes = holds(context,condition,scope);
  const withYes = (/** @type {boolean} */ value) => {
    value = value && !scope.invalidRestoration;
    scope.invalidRestoration = false;
    scope.boundaryValue = false;
    const no = holds(context,condition,scope);
    const finish = (/** @type {boolean} */ other) => {
      delete scope.boundaryValue;
      other = other && !scope.invalidRestoration;
      scope.invalidRestoration = false;
      if (!value && !other) return false;
      if (value !== other) {
        // Enclosing clauses keep ordinary evaluation at nested lexical steps.
        // Only their owning group introduces a whole-rule boundary literal.
        const production = scope.production;
        if (atom.receiver.capture === "" && !wholeBoundary) return true;
        const machine = context.boundaries ?? scope.context.boundaries;
        const source = production.lexicalFrame?.root.logicalSource ?? production.logicalSource;
        (step.obligations ??= []).push({atom,condition,literal:machine.literal(atom,!!value),
          site:scope.context.lowered.boundarySites.get(source?.clauses)?.get(atom)});
      }
      return true;
    };
    return no === HALT ? pause(finish) : finish(no);
  };
  return yes === HALT ? pause(withYes) : withYes(yes);
}
/** @param {any} context @param {any} production @param {number} dot @param {number} origin @param {number} end @param {any} previous @param {any} child @param {any[]} obligations @param {(literal:any,at:number,annotation:import("./boundary-annotations.js").BoundarySource|undefined)=>void} fail */
function boundaryStep(context,production,dot,origin,end,previous,child,obligations,fail) {
  const machine = context.boundaries;
  if (!machine) return null;
  let record = previous?.boundary ?? machine.empty;
  let annotations = previous?.boundaryAnnotations?.retain(record) ?? new BoundaryAnnotations();
  let ownBack = 0n, ownForward = 0n, before = 0n, after = 0n;
  for (const {atom,literal} of obligations) {
    if (atom.receiver.capture === "") {
      if (literal.direction === "f") ownForward |= literal.bit; else ownBack |= literal.bit;
    } else if (literal.direction === "f") after |= literal.bit; else before |= literal.bit;
  }
  if (previous) {
    record = machine.append(record,before);
    for (const {atom,literal,site} of obligations) if (atom.receiver.capture !== "" && literal.direction === "p") annotations.add("end",literal.bit,site);
    const leaf = child?.boundary ?? machine.leaf(production.rhs[dot-1].name,originalPosition(context,previous.end) === originalPosition(context,end));
    const sources = child?.boundaryAnnotations ?? new BoundaryAnnotations();
    const advanced = machine.advance(record,leaf,(/** @type {any} */ literal) => fail(literal,previous.end,annotations.meeting(sources,leaf.empty,literal.bit)));
    if (!advanced) return null;
    annotations = annotations.advance(machine,record,leaf,advanced,sources);
    record = advanced;
    record = machine.append(record,after);
    for (const {atom,literal,site} of obligations) if (atom.receiver.capture !== "" && literal.direction === "f") annotations.add("end",literal.bit,site);
  }
  if (dot === production.rhs.length) {
    const completed = machine.complete(record,production.helper ? null : production.lhs,ownBack,ownForward,(/** @type {any} */ literal) => {
      const edge = literal.direction === "f" ? "start" : "end";
      fail(literal,edge === "start" ? origin : end,annotations[edge].get(literal.bit));
    });
    if (!completed) return null;
    annotations = annotations.retain(completed);
    record = completed;
    for (const {atom,literal,site} of obligations) if (atom.receiver.capture === "") {
      annotations.add(!record.empty && literal.direction === "p" ? "start" : "end",literal.bit,site);
    }
  }
  return {record,annotations};
}
/** @param {any} chart @param {any[]} witnesses */
function boundaryWitnesses(chart,witnesses) {
  const machine = chart.context.boundaries;
  return machine ? witnesses.filter(item => machine.accepts(item.boundary)) : witnesses;
}
/** Read the joined annotation, without walking proof edges.
 * @param {any} context @param {any} failure */
function boundarySources(context,failure) {
  return [...failure.annotation?.sites ?? []].map(site => ({...site,at:originalPosition(context,failure.at)}));
}

/**
 * @param {import("./types.js").Condition[]} conditions
 * @param {Token[]} tokens
 * @param {string[]} sourceText
 * @param {import("./unicode.js").UnicodeTable} unicode
 * @returns {boolean}
 */
export function inputConditionsHold(conditions,tokens,sourceText,unicode) {
  const context = new ParseContext(/** @type {any} */ ({productions:[],byLhs:new Map()}),tokens,sourceText,unicode);
  const tags = tagSet(tokens.flatMap(token => [...token.tags]));
  const scope = {capture:() => ({start:0,end:tokens.length,tags})};
  /** @type {(node:any)=>any} */
  const present = (node) => {
    if (!node || typeof node !== "object") return node;
    if (node instanceof Set) return node;
    if (node.captured !== undefined) return {all:[]};
    if (Array.isArray(node)) return node.map(present);
    return Object.fromEntries(Object.entries(node).map(([key,value]) => [key,present(value)]));
  };
  return conditions.every(condition => settled(() => holds(context,present(condition),scope)));
}
