// Checks the ranking against its definition (docs/engine.md §6) by
// enumerating every derivation of small random grammars.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngineCase, parseEngineCase, caseTokens } from "./shared.js";
import { Ranker, internals } from "../src/rank.js";
import { ParseContext, recognize, rootItems, testHolds } from "../src/earley.js";
import { maximalRule } from "../src/maximal.js";

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

// Whether a completed item is an elided terminator: the empty production of
// an elidable optional's helper (engine §4).
function isElided(item) {
  return item.production.helper && item.production.elided !== null && item.production.rhs.length === 0;
}

// Under maximal, whether a constituent is not the longest possible: the
// chart has a completed item of its symbol from its origin that ends later,
// and that passes the symbol's test if it has one (engine §4).
function shorter(constituent, test, chart) {
  for (const set of chart.sets) {
    if (!set || set.position <= constituent.end) continue;
    for (const item of set.items) {
      if (!item.complete || item.origin !== constituent.origin || item.production.lhs !== constituent.production.lhs) continue;
      if (!test || testHolds(chart.context, test, item.origin, set.position, chart.context.interner.get(item.tagId))) return true;
    }
  }
  return false;
}

// Every derivation of an item that counts (engine §4), as ropes, each with
// the completed item its last edge advanced over, or null: cyclic ones are
// left out, and under maximal so are those with an elided terminator whose
// constituent could be longer.
function enumerate(item, chart, maximal, open = new Set()) {
  const keys = [item];
  if (item.complete) keys.push(`${item.production.lhs}|${item.origin}|${item.end}`);
  if (keys.some((key) => open.has(key))) return [];
  const inner = new Set([...open, ...keys]);
  const result = [];
  for (const edge of item.edges) {
    if (edge.kind === "seed") result.push({ rope: spend({ empty: true, size: 0 }), last: null });
    else if (edge.kind === "scan") {
      const read = leaf({ kind: "read", token: edge.token, terminal: edge.terminal });
      for (const before of enumerate(edge.previous, chart, maximal, inner)) result.push({ rope: spend(concat(before.rope, read)), last: null });
    } else {
      const close = leaf({ kind: "close", item: edge.child });
      const children = enumerate(edge.child, chart, maximal, inner).map((child) => spend(concat(child.rope, close)));
      // The constituent of an elided terminator is the node just before it,
      // unless that is a terminal, or it stands first, or it is what a
      // left-recursive production has read so far.
      const previous = edge.previous;
      const rhs = previous.production.rhs;
      const guarded = maximal && isElided(edge.child) && previous.dot > 0 && !(previous.dot === 1 && !rhs[0].terminal && rhs[0].name === previous.production.lhs);
      for (const before of enumerate(previous, chart, maximal, inner)) {
        if (guarded && before.last && shorter(before.last, rhs[previous.dot - 1].test, chart)) continue;
        for (const child of children) result.push({ rope: spend(concat(before.rope, child)), last: edge.child });
      }
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

function expected(roots, chart, maximal, lean) {
  const all = roots.flatMap((root) => enumerate(root, chart, maximal).map(({ rope }) => concat(rope, leaf({ kind: "close", item: root }))));
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
  let rejected = 0;
  let empty = 0;
  let withMaximal = 0;
  for (let round = 0; round < rounds; round++) {
    // Greedy, lazy, late-elision, or no lean, which is how elision-only's
    // check ranks (engine §7). Under late-elision, and now and then under
    // another rule, T is elidable, and then now and then the stage declares
    // maximal.
    const leanPick = next();
    const lean = leanPick < 0.3 ? "greedy" : leanPick < 0.6 ? "lazy" : leanPick < 0.85 ? "late-elision" : "none";
    const elidable = lean === "late-elision" || next() < 0.3;
    const maximal = elidable && next() < 0.4;
    const terminals = elidable ? ["A", "B", "T"] : ["A", "B", "C"];
    // A rule reference, now and then tested by its sound (engine §4).
    const reference = () => {
      const rule = rules[Math.floor(next() * rules.length)];
      const pick = next();
      return pick < 0.15 ? `${rule}="x"` : pick < 0.25 ? `${rule}≠"x"` : rule;
    };
    const body = () => {
      const length = Math.floor(next() * 3);
      const symbols = [];
      for (let index = 0; index < length; index++) {
        const symbol = next() < 0.5 ? terminals[Math.floor(next() * terminals.length)] : reference();
        // Now and then the notation's sugar, whose helpers are transparent,
        // and an elidable optional, often after a rule, whose node maximal
        // tests.
        const sugar = next();
        if (elidable && sugar < 0.25) {
          if (next() < 0.5) symbols.push(reference());
          symbols.push(next() < 0.5 ? "[T]" : `[T ${symbol}]`);
        } else if (sugar < 0.08) symbols.push(`[${symbol}]`);
        else if (sugar < 0.12) symbols.push(`${symbol} ...`);
        else if (sugar < 0.16) symbols.push(`[${symbol}] ...`);
        else symbols.push(symbol);
      }
      return symbols.length ? symbols.join(" ") : "ε";
    };
    const lines = ["%rule text " + [body(), body(), body()].join(" | ")];
    for (const rule of rules) lines.push(`%rule ${rule} ${[body(), body()].join(" | ")}`);
    // The input can be empty.
    const specs = [];
    const length = Math.floor(next() * (longest + 1));
    for (let index = 0; index < length; index++) {
      const tags = terminals.filter(() => next() < 0.5);
      specs.push({ text: "x", tags: tags.length ? tags : ["A"], phonemes: next() < 0.6 ? "x" : "y" });
    }
    const directive = `%ambiguity-resolution ${lean === "none" ? "greedy" : lean}${maximal ? " maximal" : ""}`;
    const grammar = `${directive}\n${elidable ? "%elidable T\n" : ""}${lines.join("\n")}`;
    const loaded = loadEngineCase({ grammar });
    if (loaded.loadError) continue;
    // The oracle recognizes the input itself, whatever the stage did with it.
    const { tokens, text } = caseTokens(specs);
    const lowered = loaded.dialect.stages[0].grammar.lower(new Set(), false);
    const context = new ParseContext(lowered, tokens, [...text], loaded.dialect.loader.unicode);
    const chart = recognize(context, "text", 0, tokens.length);
    const roots = rootItems(chart, "text");
    let truth;
    budget = 20000;
    try {
      truth = expected(roots, chart, maximal, lean);
    } catch (error) {
      if (error === TOO_MANY) continue;
      throw error;
    }
    if (truth && truth.count > 200) continue;
    const where = `${grammar}\ntokens ${JSON.stringify(specs)}`;
    // A ranking is null exactly when no derivation counts.
    const got = new Ranker(tokens, lean, maximal ? maximalRule(chart, lowered) : null).rank(roots);
    if (truth === null) assert.equal(got, null, `a ranking where no derivation counts\n${where}`);
    else {
      assert.notEqual(got, null, `no ranking where ${truth.count} derivations count\n${where}`);
      assert.equal(got.verdict, truth.verdict, `verdict\n${where}`);
      assert.ok(sameSequence(got.first, truth.m), `first reading\n${where}`);
      if (truth.second) assert.ok(sameSequence(got.second, truth.second), `second reading\n${where}`);
    }
    // The stage agrees: it rejects exactly when no derivation counts, and
    // otherwise has the verdict of the ranking.
    if (lean !== "none") {
      const stage = parseEngineCase(loaded.dialect, { grammar, tokens: specs }).result.stages[0];
      assert.equal(stage.verdict, truth ? truth.verdict : null, `the stage's verdict\n${where}`);
    }
    if (truth === null) rejected++;
    else if (tokens.length === 0) empty++;
    if (maximal && truth !== null) withMaximal++;
    checked++;
  }
  // Every kind of round is checked often enough to count.
  assert.ok(rejected > rounds / 50 && empty > rounds / 100 && withMaximal > rounds / 50, `${rejected} rejections, ${empty} empty inputs, ${withMaximal} rounds under maximal`);
  assert.ok(checked > rounds / 6, `only ${checked} grammars were checked`);
});

void ParseContext; void actions;
