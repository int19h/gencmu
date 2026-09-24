// Recognition (engine §4) and the terms and conditions it evaluates
// (engine §10).

import { GencmuError } from "./errors.js";
import { tagKey, tagUnion, tagIntersection, sameTagNames, strongTag, weakTag, tagSet, compareCodePoints } from "./tags.js";

// Interns tag sets, so that an item names a captured part's tags by number.
export class TagInterner {
  constructor() {
    this.sets = [];
    this.ids = new Map();
  }
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
  get(id) {
    return this.sets[id];
  }
}

// What a parse and every nested parse it starts share.
export class ParseContext {
  constructor(lowered, tokens, sourceText, unicode) {
    this.lowered = lowered;
    this.tokens = tokens;
    this.sourceText = sourceText;
    this.unicode = unicode;
    this.interner = new TagInterner();
    this.nested = new Map();
    this.inProgress = new Set();
  }
}

class Item {
  constructor(production, dot, origin, slots, key) {
    this.production = production;
    this.dot = dot;
    this.origin = origin;
    this.slots = slots;
    this.key = key;
    this.tagId = -1;
    this.edges = [];
    this.end = -1;
  }
  get complete() {
    return this.dot === this.production.rhs.length;
  }
}

class ChartSet {
  constructor(position) {
    this.position = position;
    this.items = [];
    this.index = new Map();
    this.queue = [];
    this.head = 0;
    this.waiting = new Map();
    this.nullable = new Map();
  }
}

// Runs the recognizer over tokens[start, end) with `rule` as the start rule.
export function recognize(context, rule, start, end) {
  const { lowered, tokens } = context;
  const sets = [];
  for (let position = start; position <= end; position++) sets.push(new ChartSet(position));
  const setAt = (position) => sets[position - start];

  const add = (set, production, dot, origin, slots, edge, tagId) => {
    const key = slotKey(production.id, dot, origin, slots);
    let item = set.index.get(key);
    if (item) {
      if (!item.edges.some((existing) => sameEdge(existing, edge))) item.edges.push(edge);
      return;
    }
    item = new Item(production, dot, origin, slots, key);
    item.end = set.position;
    item.tagId = tagId;
    item.edges.push(edge);
    set.items.push(item);
    set.index.set(key, item);
    set.queue.push(item);
    const next = production.rhs[dot];
    if (next && !next.terminal) {
      if (!set.waiting.has(next.name)) set.waiting.set(next.name, []);
      set.waiting.get(next.name).push(item);
    }
    if (dot === production.rhs.length && origin === set.position) {
      if (!set.nullable.has(production.lhs)) set.nullable.set(production.lhs, []);
      set.nullable.get(production.lhs).push(item);
    }
  };

  const predict = (set, name) => {
    for (const production of lowered.byLhs.get(name) || []) {
      const slots = emptySlots(production);
      if (!conditionsHold(context, production, -1, slots)) continue;
      const tagId = production.rhs.length === 0 ? completeTags(context, production, slots) : -1;
      add(set, production, 0, set.position, slots, SEED, tagId);
    }
  };

  // The item advanced over its next symbol, which spans [from, to) and was
  // built by `child`, or read as a token; null when a condition fails.
  const advance = (item, from, to, child) => {
    const production = item.production;
    let slots = item.slots;
    const captureIndex = production.captures.findIndex((capture) => capture.index === item.dot);
    if (captureIndex >= 0) {
      slots = slots.slice();
      const tags = child ? child.tagId : context.interner.intern(tokens[from].tags);
      slots[captureIndex] = [from, to, tags];
    }
    if (!conditionsHold(context, production, item.dot, slots)) return null;
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
  return { sets, start, end, setAt };
}

const SEED = { kind: "seed" };

function sameEdge(left, right) {
  if (left.kind !== right.kind) return false;
  if (left.kind === "seed") return true;
  if (left.kind === "scan") return left.previous === right.previous && left.token === right.token && left.terminal === right.terminal;
  return left.previous === right.previous && left.child === right.child;
}

function emptySlots(production) {
  return production.captures.map(() => null);
}

function slotKey(id, dot, origin, slots) {
  let key = id + "," + dot + "," + origin;
  for (const slot of slots) key += slot ? "," + slot[0] + ":" + slot[1] + ":" + slot[2] : ",-";
  return key;
}

// The completed items of `rule` spanning [start, end).
export function rootItems(chart, rule) {
  return chart.setAt(chart.end).items.filter((item) =>
    item.complete && item.origin === chart.start && item.production.lhs === rule);
}

function conditionsHold(context, production, readyAt, slots) {
  for (const { condition, readyAt: at } of production.conditions) {
    if (at !== readyAt) continue;
    const scope = new ChartScope(context, production, slots);
    if (!holds(context, condition, scope)) return false;
  }
  return true;
}

function completeTags(context, production, slots) {
  if (!production.tags) return context.interner.intern(tagSet());
  const scope = new ChartScope(context, production, slots);
  return context.interner.intern(asTagSet(evaluate(context, production.tags, scope)));
}

class ChartScope {
  constructor(context, production, slots) {
    this.context = context;
    this.production = production;
    this.slots = slots;
  }
  capture(name) {
    const index = this.production.captures.findIndex((capture) => capture.name === name);
    const slot = this.slots[index];
    return { start: slot[0], end: slot[1], tags: this.context.interner.get(slot[2]) };
  }
}

// A span value: [start, end) of the stage's tokens, and the tags of the
// captured constituent if it is a whole capture.
function spanOf(context, span, scope) {
  if (span.capture !== undefined) return scope.capture(span.capture);
  if (span.call === "head" || span.call === "tail" || span.call === "last") {
    const inner = spanOf(context, span.args[0], scope);
    const { start, end } = inner;
    if (span.call === "head") return { start, end: Math.min(start + 1, end) };
    if (span.call === "tail") return { start: Math.min(start + 1, end), end };
    return { start: Math.max(end - 1, start), end };
  }
  throw new GencmuError("grammar", `expected a span, found ${JSON.stringify(span)}`);
}

export function phonemesOf(tokens, start, end) {
  let result = "";
  for (let index = start; index < end; index++) result += tokens[index].phonemes || "";
  return result;
}

export function textOf(context, start, end) {
  if (start >= end) return "";
  const from = context.tokens[start].source[0];
  const to = context.tokens[end - 1].source[1];
  return context.sourceText.slice(from, to).join("");
}

function tokensTags(tokens, start, end) {
  let result = tagSet();
  for (let index = start; index < end; index++) result = tagUnion(result, tokens[index].tags);
  return result;
}

export function evaluate(context, term, scope) {
  if (term.literal !== undefined) return { string: term.literal };
  if (term.weak !== undefined) return { tags: weakTag(term.weak) };
  if (term.emptySet) return { tags: tagSet() };
  if (term.set) return { tags: term.set.reduce((acc, item) => tagUnion(acc, asTagSet(evaluate(context, item, scope))), tagSet()) };
  if (term.union) return { tags: term.union.reduce((acc, item) => tagUnion(acc, asTagSet(evaluate(context, item, scope))), tagSet()) };
  if (term.intersection) {
    const [first, ...rest] = term.intersection.map((item) => asTagSet(evaluate(context, item, scope)));
    return { tags: rest.reduce((acc, item) => tagIntersection(acc, item), first) };
  }
  if (term.call !== undefined) {
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
        if (args.length === 2) return { tags: nestedTags(context, args[1].rule, span.start, span.end) };
        if (span.tags && args[0].capture !== undefined) return { tags: span.tags };
        return { tags: tokensTags(context.tokens, span.start, span.end) };
      }
      case "classes": {
        const span = spanOf(context, args[0], scope);
        const tags = span.tags && args[0].capture !== undefined ? span.tags : tokensTags(context.tokens, span.start, span.end);
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
  if (term.capture !== undefined) {
    const span = scope.capture(term.capture);
    return { tags: span.tags };
  }
  throw new GencmuError("grammar", `unknown term ${JSON.stringify(term)}`);
}

function asTagSet(value) {
  if (value.tags) return value.tags;
  if (value.string !== undefined) return strongTag(value.string);
  return tagSet(value.list.map((item) => [item, true]));
}

function asString(value) {
  if (value.string !== undefined) return value.string;
  throw new GencmuError("grammar", "expected a string");
}

export function holds(context, condition, scope) {
  if (condition.any) return condition.any.some((item) => holds(context, item, scope));
  if (condition.not) return !holds(context, condition.not, scope);
  if (condition.matches !== undefined) {
    const span = spanOf(context, condition.matches, scope);
    return nestedMatches(context, condition.rule, span.start, span.end);
  }
  const left = evaluate(context, condition.left, scope);
  const right = evaluate(context, condition.right, scope);
  switch (condition.op) {
    case "=":
    case "≠": {
      let equal;
      if (left.string !== undefined && right.string !== undefined) equal = left.string === right.string;
      else equal = sameTagNames(asTagSet(left), asTagSet(right));
      return equal === (condition.op === "=");
    }
    case "∈":
    case "∉": {
      const needle = asString(left);
      let member;
      if (right.list) member = right.list.includes(needle);
      else if (right.tags) member = right.tags.has(needle);
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
function nestedKey(context, kind, rule, start, end) {
  let key = kind + "\u0001" + rule + "\u0001" + textOf(context, start, end);
  for (let index = start; index < end; index++) {
    const token = context.tokens[index];
    key += "\u0001" + tagKey(token.tags) + "\u0002" + token.text + "\u0002" + (token.phonemes || "");
  }
  return key;
}

function nested(context, kind, rule, start, end, compute) {
  const key = nestedKey(context, kind, rule, start, end);
  if (context.nested.has(key)) return context.nested.get(key);
  const circular = nestedKey(context, "parse", rule, start, end);
  if (context.inProgress.has(circular)) {
    throw new GencmuError("grammar",
      `a condition asks whether ${JSON.stringify(textOf(context, start, end))} parses as ${rule} from inside the parse of that span as ${rule}: ` +
      `the grammar defines ${rule} by its own negation over the same text`, { rule });
  }
  context.inProgress.add(circular);
  try {
    const chart = recognize(context, rule, start, end);
    const answer = compute(chart);
    context.nested.set(key, answer);
    return answer;
  } finally {
    context.inProgress.delete(circular);
  }
}

function nestedMatches(context, rule, start, end) {
  return nested(context, "matches", rule, start, end, (chart) => rootItems(chart, rule).length > 0);
}

function nestedTags(context, rule, start, end) {
  return nested(context, "tags", rule, start, end, (chart) =>
    rootItems(chart, rule).reduce((acc, item) => tagUnion(acc, context.interner.get(item.tagId)), tagSet()));
}

// The furthest position the parse reached, and what could have been read
// there, with the rules that could have read it.
export function rejectionOf(chart, lowered) {
  let position = chart.end;
  while (position > chart.start && chart.setAt(position).items.length === 0) position--;
  const expected = new Map();
  for (const item of chart.setAt(position).items) {
    const next = item.production.rhs[item.dot];
    if (!next || !next.terminal) continue;
    if (!expected.has(next.name)) expected.set(next.name, new Set());
    expected.get(next.name).add(item.production.owner);
  }
  void lowered;
  return {
    position,
    expected: [...expected.keys()].sort(compareCodePoints).map((terminal) => ({
      terminal,
      rules: [...expected.get(terminal)].sort(compareCodePoints),
    })),
  };
}
