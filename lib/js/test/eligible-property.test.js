// Checks written-terminator priority (docs/engine.md §4) against a search
// for eligible witnesses, proof trees found one by one, on small random
// grammars.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngineCase, caseTokens } from "./shared.js";
import { ParseContext, recognize } from "../src/earley.js";
import { eligibleWitnesses } from "../src/eligible.js";

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const TOO_MANY = new Error("too many steps");

// Every edge of the chart, as [item, edge] pairs.
function allEdges(chart) {
  const result = [];
  for (const set of chart.sets) {
    if (!set) continue;
    for (const item of set.items) for (const edge of item.edges) result.push([item, edge]);
  }
  return result;
}

const isHelper = (production) => production.helper && production.elided !== null;
const isEmptyHelper = (item) => isHelper(item.production) && item.production.rhs.length === 0;
const isWrittenHelper = (item) => isHelper(item.production) && item.production.rhs.length > 0 && item.dot === item.production.rhs.length;

// The oracle: the witnesses that have an eligible proof tree, found by a
// search over trees that never repeats an item and a state on one path.
// Whether an omission is forbidden is read from the chart's edges as the
// specification words it, with no precomputed tables.
function expected(chart, witnesses) {
  const edges = allEdges(chart);
  // Whether the chart advances `item` over the optional's nonempty
  // alternative.
  const readsWritten = (item) => edges.some(([, edge]) => edge.kind === "complete" && edge.previous === item && isWrittenHelper(edge.child));
  // Whether a path from `before` reads Y through some p' ≥ p and then the
  // optional as written.
  const forbiddenAfter = (before, p) => edges.some(([made, edge]) => edge.kind === "complete" && edge.previous === before && made.end >= p && readsWritten(made));
  // Where the next symbol of `item` is an elidable optional: "constituent"
  // when the symbol before it is the node of a rule that can be longer,
  // "alone" otherwise, and null when no such optional comes next.
  const nextOptional = (item) => {
    const rhs = item.production.rhs;
    const symbol = rhs[item.dot];
    if (!symbol || symbol.terminal) return null;
    const helpers = chart.context.lowered.byLhs.get(symbol.name) || [];
    if (!helpers.some((production) => isHelper(production))) return null;
    if (item.dot === 0) return "alone";
    const before = rhs[item.dot - 1];
    if (before.terminal || (item.dot === 1 && before.name === item.production.lhs)) return "alone";
    return "constituent";
  };
  let budget = 200000;
  // Whether `item` has an eligible proof tree, and, with `permit`, one
  // whose own edge permits the optional after it to be empty.
  const search = (item, permit, path) => {
    if (--budget < 0) throw TOO_MANY;
    const key = `${permit}`;
    let states = path.get(item);
    if (states && states.has(key)) return false;
    const inner = new Map(path);
    inner.set(item, new Set([...(states || []), key]));
    const kind = permit ? nextOptional(item) : null;
    if (kind === "alone" && readsWritten(item)) return false;
    for (const edge of item.edges) {
      if (kind === "constituent" && (edge.kind !== "complete" || forbiddenAfter(edge.previous, item.end))) continue;
      if (edge.kind === "seed") return true;
      if (edge.kind === "scan") {
        if (search(edge.previous, false, inner)) return true;
        continue;
      }
      if (search(edge.previous, isEmptyHelper(edge.child), inner) && search(edge.child, false, inner)) return true;
    }
    return false;
  };
  return witnesses.filter((witness) => search(witness, false, new Map()));
}

test("written-terminator priority agrees with a search for eligible witnesses", () => {
  const next = random(Number(process.env.GENCMU_PROPERTY_SEED || 20261001));
  const rounds = Number(process.env.GENCMU_PROPERTY_CASES || 2000);
  const rules = ["r", "t", "u", "v"];
  const terminals = ["A", "B", "T", "U"];
  let checked = 0;
  let filtered = 0;
  for (let round = 0; round < rounds; round++) {
    const symbol = () => (next() < 0.5 ? terminals[Math.floor(next() * terminals.length)] : rules[Math.floor(next() * rules.length)]);
    const body = () => {
      const length = Math.floor(next() * 4);
      const symbols = [];
      for (let index = 0; index < length; index++) {
        const pick = next();
        if (pick < 0.2) symbols.push("[T]");
        else if (pick < 0.3) symbols.push("[U]");
        else if (pick < 0.38) symbols.push(`[T ${symbol()}]`);
        else symbols.push(symbol());
      }
      return symbols.length ? symbols.join(" ") : "ε";
    };
    const lines = rules.map((rule) => `%rule ${rule} ${[body(), body()].join(" | ")}`);
    const grammar = `%ambiguity-resolution greedy\n%elidable T U\n%rule text A\n${lines.join("\n")}`;
    const loaded = loadEngineCase({ grammar });
    if (loaded.loadError) continue;
    const specs = [];
    const length = Math.floor(next() * 5);
    for (let index = 0; index < length; index++) specs.push({ text: "x", tags: [terminals[Math.floor(next() * terminals.length)]] });
    const { tokens, text } = caseTokens(specs);
    const lowered = loaded.dialect.stages[0].grammar.lower(new Set(), false);
    const context = new ParseContext(lowered, tokens, [...text], loaded.dialect.loader.unicode);
    const chart = recognize(context, "r", 0, tokens.length);
    // The witnesses of begins: completed items of r from the start, in any
    // set.
    const witnesses = [];
    for (const set of chart.sets) {
      if (!set) continue;
      for (const item of set.items) if (item.complete && item.origin === 0 && item.production.lhs === "r") witnesses.push(item);
    }
    if (witnesses.length === 0) continue;
    let truth;
    try {
      truth = expected(chart, witnesses);
    } catch (error) {
      if (error === TOO_MANY) continue;
      throw error;
    }
    const got = eligibleWitnesses(chart, witnesses);
    const where = `${grammar}\ntokens ${JSON.stringify(specs.map((spec) => spec.tags[0]))}`;
    const positions = (list) => witnesses.map((witness, index) => (list.includes(witness) ? index : -1)).filter((index) => index >= 0);
    assert.deepEqual(positions(got), positions(truth), where);
    if (truth.length < witnesses.length) filtered++;
    checked++;
  }
  assert.ok(checked > rounds / 4 && filtered > rounds / 50, `${checked} grammars checked, ${filtered} with a witness filtered out`);
});
