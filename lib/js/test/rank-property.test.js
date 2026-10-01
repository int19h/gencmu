// Checks the ranking against its definition (docs/engine.md §6) by
// enumerating every derivation of small random grammars.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngineCase, parseEngineCase } from "./shared.js";
import { Ranker, internals } from "../src/rank.js";
import { ParseContext, recognize, rootItems } from "../src/earley.js";

const { actions, firstDifference, totalOrder, decide, concat, leaf } = internals;

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

// The enumeration is exponential: a grammar like `%rule v t t %rule t v u` with
// a nullable `u` has more derivations of four tokens than can be listed. It
// gives up past a budget of sequences built, and the round is skipped.
const TOO_MANY = new Error("too many derivations to enumerate");
let budget = 0;

function spend(rope) {
  if (--budget < 0) throw TOO_MANY;
  return rope;
}

// Every derivation of an item, as ropes, excluding cyclic ones.
function enumerate(item, tokens, open = new Set()) {
  const keys = [item];
  if (item.dot === item.production.rhs.length) keys.push(`${item.production.lhs}|${item.origin}|${item.end}`);
  if (keys.some((key) => open.has(key))) return [];
  const inner = new Set([...open, ...keys]);
  const result = [];
  for (const edge of item.edges) {
    if (edge.kind === "seed") result.push(spend({ empty: true, size: 0 }));
    else if (edge.kind === "scan") {
      const read = leaf({ kind: "read", token: edge.token, terminal: edge.terminal });
      for (const before of enumerate(edge.previous, tokens, inner)) result.push(spend(concat(before, read)));
    } else {
      const close = leaf({ kind: "close", item: edge.child });
      const children = enumerate(edge.child, tokens, inner).map((child) => spend(concat(child, close)));
      for (const before of enumerate(edge.previous, tokens, inner)) for (const child of children) result.push(spend(concat(before, child)));
    }
  }
  return result;
}

function sameSequence(left, right) {
  return firstDifference(left, right, false) === null;
}

// A derivation's elision vector under late-elision (engine §6), as the
// positions of its elided terminators in text order.
function elisions(rope) {
  const positions = [];
  for (const action of actions(rope)) {
    const production = action.kind === "close" ? action.item.production : null;
    if (production && production.helper && production.elided !== null && production.rhs.length === 0) positions.push(action.item.origin);
  }
  return positions;
}

// Two elision vectors compared as counts at each boundary, from the first:
// -1 when the left one is less.
function compareVectors(left, right) {
  const count = (positions, at) => positions.filter((p) => p === at).length;
  const boundaries = [...new Set([...left, ...right])].sort((a, b) => a - b);
  for (const at of boundaries) {
    const difference = count(left, at) - count(right, at);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

function expected(roots, tokens, lean) {
  const all = roots.flatMap((root) => enumerate(root, tokens).map((rope) => concat(rope, leaf({ kind: "close", item: root }))));
  if (all.length === 0) return null;
  const late = lean === "late-elision";
  // Under late-elision, one derivation beats another by its vector alone,
  // and T orders equal vectors as no lean does (engine §6).
  const order = late ? "none" : lean;
  const beats = (a, b) => {
    if (late) return compareVectors(elisions(a), elisions(b)) < 0;
    const difference = firstDifference(a, b, true);
    return difference && difference.left && difference.right && decide(difference, lean) < 0;
  };
  const sorted = all.slice().sort((a, b) => (late ? compareVectors(elisions(a), elisions(b)) : 0) || totalOrder(a, b, order));
  const m = sorted[0];
  const undominated = all.filter((d) => !all.some((e) => e !== d && beats(e, d)));
  const tied = all.filter((d) => d !== m && !sameSequence(d, m) && !beats(m, d));
  const verdict = all.length === 1 ? "unique" : undominated.length === 1 ? "resolved" : "tie";
  let second = null;
  if (verdict === "tie") {
    const at = (d) => {
      const difference = firstDifference(m, d, true);
      return difference ? difference.index : Infinity;
    };
    const best = Math.min(...tied.map(at));
    second = tied.filter((d) => at(d) === best).sort((a, b) => totalOrder(a, b, order))[0];
  }
  return { verdict, m, second, count: all.length };
}

test("the ranking agrees with an enumeration of every derivation", () => {
  // GENCMU_PROPERTY_CASES and GENCMU_PROPERTY_SEED run a larger sweep locally.
  const next = random(Number(process.env.GENCMU_PROPERTY_SEED || 20260924));
  const rounds = Number(process.env.GENCMU_PROPERTY_CASES || 3000);
  const longest = Number(process.env.GENCMU_PROPERTY_TOKENS || 3);
  const rules = ["t", "u", "v"];
  let checked = 0;
  for (let round = 0; round < rounds; round++) {
    // Greedy, lazy, late-elision, or no lean, which is how elision-only's
    // check ranks (engine §7). Under late-elision, T is elidable.
    const leanPick = next();
    const lean = leanPick < 0.3 ? "greedy" : leanPick < 0.6 ? "lazy" : leanPick < 0.85 ? "late-elision" : "none";
    const late = lean === "late-elision";
    const terminals = late ? ["A", "B", "T"] : ["A", "B", "C"];
    const body = (depth) => {
      const length = Math.floor(next() * 3);
      const symbols = [];
      for (let index = 0; index < length; index++) {
        const pick = next();
        const symbol = pick < 0.5 ? terminals[Math.floor(next() * terminals.length)] : rules[Math.floor(next() * rules.length)];
        // Now and then the notation's sugar, whose helpers are transparent.
        const sugar = next();
        if (late && sugar < 0.2) symbols.push(next() < 0.5 ? "[T]" : `[T ${symbol}]`);
        else if (sugar < 0.08) symbols.push(`[${symbol}]`);
        else if (sugar < 0.12) symbols.push(`${symbol} ...`);
        else if (sugar < 0.16) symbols.push(`[${symbol}] ...`);
        else symbols.push(symbol);
      }
      return symbols.length ? symbols.join(" ") : "ε";
    };
    const lines = ["%rule text " + [body(), body(), body()].join(" | ")];
    for (const rule of rules) lines.push(`%rule ${rule} ${[body(), body()].join(" | ")}`);
    const tokens = [];
    const length = 1 + Math.floor(next() * longest);
    for (let index = 0; index < length; index++) {
      const tags = terminals.filter(() => next() < 0.5);
      tokens.push({ text: "x", tags: tags.length ? tags : ["A"] });
    }
    const grammar = `%ambiguity-resolution ${lean === "none" ? "greedy" : lean}\n${late ? "%elidable T\n" : ""}${lines.join("\n")}`;
    const loaded = loadEngineCase({ grammar });
    if (loaded.loadError) continue;
    const outcome = parseEngineCase(loaded.dialect, { grammar, tokens });
    if (!outcome.result.ok) continue;
    const stage = outcome.result.stages[0];
    // A result holds nothing of the grammar, so the test recognizes the
    // input again with a context of its own.
    const lowered = loaded.dialect.stages[0].grammar.lower(new Set(), false);
    const context = new ParseContext(lowered, stage.input, [...outcome.result.text], loaded.dialect.loader.unicode);
    const chart = recognize(context, "text", 0, stage.input.length);
    const roots = rootItems(chart, "text");
    let truth;
    budget = 20000;
    try {
      truth = expected(roots, stage.input, lean);
    } catch (error) {
      if (error === TOO_MANY) continue;
      throw error;
    }
    if (!truth || truth.count > 200) continue;
    const got = new Ranker(stage.input, lean).rank(roots);
    const where = `${grammar}\ntokens ${JSON.stringify(tokens)}`;
    if (got === null) continue;
    assert.equal(got.verdict, truth.verdict, `verdict\n${where}`);
    assert.ok(sameSequence(got.chosen, truth.m), `chosen\n${where}`);
    if (truth.second) assert.ok(sameSequence(got.second, truth.second), `tied derivation\n${where}`);
    checked++;
  }
  assert.ok(checked > rounds / 6, `only ${checked} grammars were checked`);
});

void ParseContext; void actions;
