// Recognition (engine §4) and the terms and conditions it evaluates
// (engine §10).

import { GencmuError } from "./errors.js";
import { tagKey, tagUnion, tagIntersection, sameTagNames, strongTag, weakTag, tagSet, compareCodePoints } from "./tags.js";

/**
 * @import { Argument, Condition, Edge, Expectation, LoweredGrammar, Production, Scope, Slot, SpanValue, TagSet, Term, TermValue } from "./types.js"
 * @import { Token } from "./tokens.js"
 * @import { UnicodeTable } from "./unicode.js"
 */

/**
 * A chart: one set per position of the span it was run over.
 * @typedef {object} Chart
 * @property {ChartSet[]} sets
 * @property {number} start
 * @property {number} end
 * @property {(position: number) => ChartSet} setAt
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

// What a parse and every nested parse it starts share.
export class ParseContext {
  /**
   * @param {LoweredGrammar} lowered
   * @param {Token[]} tokens
   * @param {string[]} sourceText the text's code points
   * @param {UnicodeTable} unicode
   */
  constructor(lowered, tokens, sourceText, unicode) {
    this.lowered = lowered;
    this.tokens = tokens;
    this.sourceText = sourceText;
    this.unicode = unicode;
    this.interner = new TagInterner();
    /** @type {Map<string, boolean | TagSet>} */
    this.nested = new Map();
    /** @type {Set<string>} */
    this.inProgress = new Set();
    /**
     * When set, the recognizer records what happens at one position of the
     * top-level parse, for diagnostics (see diagnostics.js, trace).
     * @type {{position: number, events: TraceEvent[], depth: number} | null}
     */
    this.trace = null;
  }
}

/**
 * Something the recognizer did at the traced position: an item predicted,
 * advanced or completed there, or an advance that a condition refused.
 * @typedef {object} TraceEvent
 * @property {"predicted" | "advanced" | "completed" | "dropped"} kind
 * @property {Production} production
 * @property {number} dot the dot of the item made, or of the item refused
 * @property {number} origin
 * @property {Condition} [condition] for a drop, the condition that failed
 */

// A chart item: a production with a dot, its origin, and its captured
// parts; `end` is the position of the set that holds it.
export class Item {
  /**
   * @param {Production} production
   * @param {number} dot
   * @param {number} origin
   * @param {Slot[]} slots
   * @param {string} key
   */
  constructor(production, dot, origin, slots, key) {
    this.production = production;
    this.dot = dot;
    this.origin = origin;
    this.slots = slots;
    this.key = key;
    this.tagId = -1;
    /** @type {Edge[]} */
    this.edges = [];
    this.end = -1;
  }
  get complete() {
    return this.dot === this.production.rhs.length;
  }
}

export class ChartSet {
  /** @param {number} position */
  constructor(position) {
    this.position = position;
    /** @type {Item[]} */
    this.items = [];
    /** @type {Map<string, Item>} */
    this.index = new Map();
    /** @type {Item[]} */
    this.queue = [];
    this.head = 0;
    /** @type {Map<string, Item[]>} */
    this.waiting = new Map();
    /** @type {Map<string, Item[]>} */
    this.nullable = new Map();
    /** @type {Set<string>} the rules already predicted here */
    this.predicted = new Set();
    /**
     * Productions predicted here but not made items, since they begin with
     * a terminal the next token does not carry; kept for saying what could
     * have come next.
     * @type {Production[]}
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
  const { lowered, tokens } = context;
  /** @type {ChartSet[]} */
  const sets = [];
  for (let position = start; position <= end; position++) sets.push(new ChartSet(position));
  /** @type {(position: number) => ChartSet} */
  const setAt = (position) => sets[position - start];

  /** @type {(set: ChartSet, production: Production, dot: number, origin: number, slots: Slot[], edge: Edge, tagId: number) => void} */
  const add = (set, production, dot, origin, slots, edge, tagId) => {
    const key = slotKey(production.id, dot, origin, slots);
    let item = set.index.get(key);
    if (item) {
      if (!item.edges.some((existing) => sameEdge(existing, edge))) item.edges.push(edge);
      return;
    }
    item = new Item(production, dot, origin, slots, key);
    item.end = set.position;
    const trace = context.trace;
    if (trace && trace.depth === 0 && set.position === trace.position) {
      const kind = dot === production.rhs.length ? "completed" : dot === 0 ? "predicted" : "advanced";
      trace.events.push({ kind, production, dot, origin });
    }
    item.tagId = tagId;
    item.edges.push(edge);
    set.items.push(item);
    set.index.set(key, item);
    set.queue.push(item);
    const next = production.rhs[dot];
    if (next && !next.terminal) {
      let waiting = set.waiting.get(next.name);
      if (!waiting) set.waiting.set(next.name, (waiting = []));
      waiting.push(item);
    }
    if (dot === production.rhs.length && origin === set.position) {
      let nullable = set.nullable.get(production.lhs);
      if (!nullable) set.nullable.set(production.lhs, (nullable = []));
      nullable.push(item);
    }
  };

  /** @type {(set: ChartSet, name: string) => void} */
  const predict = (set, name) => {
    // A rule's productions are the same at every prediction in one set:
    // predicting them again would only rebuild items that already exist.
    if (set.predicted.has(name)) return;
    set.predicted.add(name);
    const next = set.position < end ? tokens[set.position] : null;
    for (const production of lowered.byLhs.get(name) || []) {
      // One token of lookahead: an item whose first symbol is a terminal the
      // next token lacks could never advance, so it is not made.
      const first = production.rhs[0];
      if (first && first.terminal && !(next && next.tags.has(first.name))) {
        set.skipped.push(production);
        continue;
      }
      const slots = emptySlots(production);
      const failed = failedCondition(context, production, -1, slots);
      if (failed) {
        const trace = context.trace;
        if (trace && trace.depth === 0 && set.position === trace.position) {
          trace.events.push({ kind: "dropped", production, dot: 0, origin: set.position, condition: failed });
        }
        continue;
      }
      const tagId = production.rhs.length === 0 ? completeTags(context, production, slots) : -1;
      add(set, production, 0, set.position, slots, SEED, tagId);
    }
  };

  // The item advanced over its next symbol, which spans [from, to) and was
  // built by `child`, or read as a token; null when a condition fails.
  /** @type {(item: Item, from: number, to: number, child: Item | null) => {dot: number, slots: Slot[], tagId: number} | null} */
  const advance = (item, from, to, child) => {
    const production = item.production;
    let slots = item.slots;
    const captureIndex = production.captures.findIndex((capture) => capture.index === item.dot);
    if (captureIndex >= 0) {
      slots = slots.slice();
      const tags = child ? child.tagId : context.interner.intern(tokens[from].tags);
      slots[captureIndex] = [from, to, tags];
    }
    const failed = failedCondition(context, production, item.dot, slots);
    if (failed) {
      const trace = context.trace;
      if (trace && trace.depth === 0 && to === trace.position) {
        trace.events.push({ kind: "dropped", production, dot: item.dot, origin: item.origin, condition: failed });
      }
      return null;
    }
    const dot = item.dot + 1;
    const tagId = dot === production.rhs.length ? completeTags(context, production, slots) : -1;
    return { dot, slots, tagId };
  };

  predict(setAt(start), rule);
  for (let position = start; position <= end; position++) {
    const set = setAt(position);
    while (set.head < set.queue.length) {
      const item = set.queue[set.head++];
      const next = item.production.rhs[item.dot];
      if (!next) {
        const origin = setAt(item.origin);
        for (const waiting of origin.waiting.get(item.production.lhs) || []) {
          const advanced = advance(waiting, item.origin, position, item);
          if (advanced) {
            add(set, waiting.production, advanced.dot, waiting.origin, advanced.slots,
              { kind: "complete", previous: waiting, child: item }, advanced.tagId);
          }
        }
      } else if (!next.terminal) {
        predict(set, next.name);
        for (const done of set.nullable.get(next.name) || []) {
          const advanced = advance(item, position, position, done);
          if (advanced) {
            add(set, item.production, advanced.dot, item.origin, advanced.slots,
              { kind: "complete", previous: item, child: done }, advanced.tagId);
          }
        }
      } else if (position < end && tokens[position].tags.has(next.name)) {
        const advanced = advance(item, position, position + 1, null);
        if (advanced) {
          add(setAt(position + 1), item.production, advanced.dot, item.origin, advanced.slots,
            { kind: "scan", previous: item, token: position, terminal: next.name }, advanced.tagId);
        }
      }
    }
  }
  return { sets, start, end, setAt, context };
}

/** @type {Edge} */
const SEED = { kind: "seed" };

/**
 * @param {Edge} left
 * @param {Edge} right
 * @returns {boolean}
 */
function sameEdge(left, right) {
  if (left.kind === "seed" || right.kind === "seed") return left.kind === right.kind;
  if (left.kind === "scan" || right.kind === "scan") {
    return left.kind === "scan" && right.kind === "scan" &&
      left.previous === right.previous && left.token === right.token && left.terminal === right.terminal;
  }
  return left.previous === right.previous && left.child === right.child;
}

/**
 * @param {Production} production
 * @returns {Slot[]}
 */
function emptySlots(production) {
  return production.captures.map(() => null);
}

/**
 * @param {number} id
 * @param {number} dot
 * @param {number} origin
 * @param {Slot[]} slots
 * @returns {string}
 */
function slotKey(id, dot, origin, slots) {
  let key = id + "," + dot + "," + origin;
  for (const slot of slots) key += slot ? "," + slot[0] + ":" + slot[1] + ":" + slot[2] : ",-";
  return key;
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
 * @param {Slot[]} slots
 * @returns {Condition | null}
 */
function failedCondition(context, production, readyAt, slots) {
  for (const { condition, readyAt: at } of production.conditions) {
    if (at !== readyAt) continue;
    const scope = new ChartScope(context, production, slots);
    if (!holds(context, condition, scope)) return condition;
  }
  return null;
}

/**
 * @param {ParseContext} context
 * @param {Production} production
 * @param {Slot[]} slots
 * @returns {number}
 */
function completeTags(context, production, slots) {
  if (!production.tags) return context.interner.intern(tagSet());
  const scope = new ChartScope(context, production, slots);
  return context.interner.intern(asTagSet(evaluate(context, production.tags, scope)));
}

/** @implements {Scope} */
class ChartScope {
  /**
   * @param {ParseContext} context
   * @param {Production} production
   * @param {Slot[]} slots
   */
  constructor(context, production, slots) {
    this.context = context;
    this.production = production;
    this.slots = slots;
  }
  /**
   * @param {string} name
   * @returns {SpanValue}
   */
  capture(name) {
    const index = this.production.captures.findIndex((capture) => capture.name === name);
    const slot = /** @type {[number, number, number]} */ (this.slots[index]);
    return { start: slot[0], end: slot[1], tags: this.context.interner.get(slot[2]) };
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
    const inner = spanOf(context, span.args[0], scope);
    const { start, end } = inner;
    if (span.call === "head") return { start, end: Math.min(start + 1, end) };
    if (span.call === "tail") return { start: Math.min(start + 1, end), end };
    return { start: Math.max(end - 1, start), end };
  }
  throw new GencmuError("grammar", `expected a span, found ${JSON.stringify(span)}`);
}

/**
 * @param {Token[]} tokens
 * @param {number} start
 * @param {number} end
 * @returns {string}
 */
export function phonemesOf(tokens, start, end) {
  let result = "";
  for (let index = start; index < end; index++) result += tokens[index].phonemes || "";
  return result;
}

/**
 * @param {ParseContext} context
 * @param {number} start
 * @param {number} end
 * @returns {string}
 */
export function textOf(context, start, end) {
  if (start >= end) return "";
  const from = context.tokens[start].source[0];
  const to = context.tokens[end - 1].source[1];
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
 * @param {ParseContext} context
 * @param {Argument} term
 * @param {Scope} scope
 * @returns {TermValue}
 */
export function evaluate(context, term, scope) {
  if ("literal" in term) return { string: term.literal };
  if ("weak" in term) return { tags: weakTag(term.weak) };
  if ("emptySet" in term) return { tags: tagSet() };
  if ("set" in term) return { tags: term.set.reduce((acc, item) => tagUnion(acc, asTagSet(evaluate(context, item, scope))), tagSet()) };
  if ("union" in term) return { tags: term.union.reduce((acc, item) => tagUnion(acc, asTagSet(evaluate(context, item, scope))), tagSet()) };
  if ("intersection" in term) {
    const [first, ...rest] = term.intersection.map((item) => asTagSet(evaluate(context, item, scope)));
    return { tags: rest.reduce((acc, item) => tagIntersection(acc, item), first) };
  }
  if ("call" in term) {
    const args = term.args;
    switch (term.call) {
      case "phonemes": {
        const span = spanOf(context, args[0], scope);
        return { string: phonemesOf(context.tokens, span.start, span.end) };
      }
      case "text": {
        const span = spanOf(context, args[0], scope);
        return { string: textOf(context, span.start, span.end) };
      }
      case "lowercase": {
        const inner = evaluate(context, args[0], scope);
        return { string: context.unicode.lowercase(asString(inner)) };
      }
      case "words": {
        const span = spanOf(context, args[0], scope);
        return { list: phonemesOf(context.tokens, span.start, span.end).split(" ").filter((word) => word !== "") };
      }
      case "tags": {
        const span = spanOf(context, args[0], scope);
        if (args.length === 2) return { tags: nestedTags(context, ruleName(args[1]), span.start, span.end) };
        if (span.tags && "capture" in args[0]) return { tags: span.tags };
        return { tags: tokensTags(context.tokens, span.start, span.end) };
      }
      case "classes": {
        const span = spanOf(context, args[0], scope);
        const tags = span.tags && "capture" in args[0] ? span.tags : tokensTags(context.tokens, span.start, span.end);
        const result = tagSet();
        for (const [tag, strong] of tags) {
          const first = tag.charCodeAt(0);
          if (first >= 0x41 && first <= 0x5a) result.set(tag, strong);
        }
        return { tags: result };
      }
      default:
        throw new GencmuError("grammar", `unknown function ${term.call}`);
    }
  }
  if ("capture" in term) {
    const span = scope.capture(term.capture);
    return { tags: span.tags || tagSet() };
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
 * @returns {TagSet}
 */
function asTagSet(value) {
  if ("tags" in value) return value.tags;
  if ("string" in value) return strongTag(value.string);
  return tagSet(value.list.map((item) => [item, true]));
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
  if ("not" in condition) return !holds(context, condition.not, scope);
  if ("matches" in condition) {
    const span = spanOf(context, condition.matches, scope);
    return nestedMatches(context, condition.rule, span.start, span.end);
  }
  const left = evaluate(context, condition.left, scope);
  const right = evaluate(context, condition.right, scope);
  switch (condition.op) {
    case "=":
    case "≠": {
      let equal;
      if ("string" in left && "string" in right) equal = left.string === right.string;
      else equal = sameTagNames(asTagSet(left), asTagSet(right));
      return equal === (condition.op === "=");
    }
    case "∈":
    case "∉": {
      const needle = asString(left);
      let member;
      if ("list" in right) member = right.list.includes(needle);
      else if ("tags" in right) member = right.tags.has(needle);
      else member = right.string === needle;
      return member === (condition.op === "∈");
    }
    case "⊆": {
      const small = asTagSet(left);
      const large = asTagSet(right);
      for (const tag of small.keys()) if (!large.has(tag)) return false;
      return true;
    }
    default:
      throw new GencmuError("grammar", `unknown comparison ${condition.op}`);
  }
}

// The key under which a nested parse's answer is remembered: everything a
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
  let key = kind + "\u0001" + rule + "\u0001" + textOf(context, start, end);
  for (let index = start; index < end; index++) {
    const token = context.tokens[index];
    key += "\u0001" + tagKey(token.tags) + "\u0002" + token.text + "\u0002" + (token.phonemes || "");
  }
  return key;
}

/**
 * @template {boolean | TagSet} T
 * @param {ParseContext} context
 * @param {string} kind
 * @param {string} rule
 * @param {number} start
 * @param {number} end
 * @param {(chart: Chart) => T} compute
 * @returns {T}
 */
function nested(context, kind, rule, start, end, compute) {
  const key = nestedKey(context, kind, rule, start, end);
  if (context.nested.has(key)) return /** @type {T} */ (context.nested.get(key));
  const circular = nestedKey(context, "parse", rule, start, end);
  if (context.inProgress.has(circular)) {
    throw new GencmuError("grammar",
      `a condition asks whether ${JSON.stringify(textOf(context, start, end))} parses as ${rule} from inside the parse of that span as ${rule}: ` +
      `the grammar defines ${rule} by its own negation over the same text`, { rule });
  }
  context.inProgress.add(circular);
  if (context.trace) context.trace.depth++;
  try {
    const chart = recognize(context, rule, start, end);
    const answer = compute(chart);
    context.nested.set(key, answer);
    return answer;
  } finally {
    context.inProgress.delete(circular);
    if (context.trace) context.trace.depth--;
  }
}

/**
 * @param {ParseContext} context
 * @param {string} rule
 * @param {number} start
 * @param {number} end
 * @returns {boolean}
 */
function nestedMatches(context, rule, start, end) {
  return nested(context, "matches", rule, start, end, (chart) => rootItems(chart, rule).length > 0);
}

/**
 * @param {ParseContext} context
 * @param {string} rule
 * @param {number} start
 * @param {number} end
 * @returns {TagSet}
 */
function nestedTags(context, rule, start, end) {
  return nested(context, "tags", rule, start, end, (chart) =>
    rootItems(chart, rule).reduce((acc, item) => tagUnion(acc, context.interner.get(item.tagId)), tagSet()));
}

// The furthest position the parse reached, and what could have been read
// there, with the rules that could have read it.
/**
 * @param {Chart} chart
 * @returns {{position: number, expected: Expectation[]}}
 */
export function rejectionOf(chart) {
  let position = chart.end;
  while (position > chart.start && chart.setAt(position).items.length === 0) position--;
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
    if (next && next.terminal) note(next.name, item.production.owner);
  }
  for (const production of set.skipped) {
    if (failedCondition(chart.context, production, -1, emptySlots(production)) === null) note(production.rhs[0].name, production.owner);
  }
  return [...expected].sort((left, right) => compareCodePoints(left[0], right[0])).map(([terminal, rules]) => ({
    terminal,
    rules: [...rules].sort(compareCodePoints),
  }));
}
