// Checks the ranking against its definition (docs/engine.md §6) by
// enumerating every derivation of small random grammars.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngineCase, parseEngineCase, caseTokens } from "./shared.js";
import { Ranker, internals, compareElisions } from "../src/rank.js";
import { ParseContext, recognize, rootItems, testHolds } from "../src/earley.js";
import { maximalRule } from "../src/maximal.js";
import { GencmuError } from "../src/errors.js";

const { actions, firstDifference, totalOrder, decide, concat, leaf, concatElisions } = internals;

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
  // Only a rule completed again over its own span makes a derivation
  // cyclic. A partial item can repeat below itself in a derivation that is
  // not cyclic (engine §4).
  const key = `${item.production.lhs}|${item.origin}|${item.end}`;
  if (item.complete && open.has(key)) return [];
  const inner = item.complete ? new Set([...open, key]) : open;
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

// The oracle counts closes over each nonempty span in specification order.
// It does not call the library's profile builder or comparator.
function profile(rope, length, flags) {
  const counts = new Map();
  for (const action of actions(rope)) {
    if (action.kind !== "close") continue;
    const { production, origin, end } = action.item;
    if (production.helper || !flags.has(production.lhs) || origin === end) continue;
    const key = `${origin}:${end}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const result = [];
  for (let start = 0; start < length; start++) {
    for (let end = length; end > start; end--) result.push(counts.get(`${start}:${end}`) || 0);
  }
  return result;
}

function compareOracleProfiles(left, right) {
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index] > right[index] ? -1 : 1;
  }
  return 0;
}

function expected(roots, chart, maximal, lean, flags) {
  const all = roots.flatMap((root) => enumerate(root, chart, maximal).map(({ rope }) => concat(rope, leaf({ kind: "close", item: root }))));
  if (all.length === 0) return null;
  const late = lean === "late-elision";
  const profiles = new Map(all.map((rope) => [rope, profile(rope, chart.context.tokens.length, flags)]));
  const profileOrder = (a, b) => compareOracleProfiles(profiles.get(a), profiles.get(b));
  // Profiles rank first, followed by the stage preference on equal profiles.
  const order = late ? "none" : lean;
  const beats = (a, b) => {
    const compared = profileOrder(a, b);
    if (compared !== 0) return compared < 0;
    if (late) return compareVectors(elisions(a), elisions(b)) < 0;
    const difference = firstDifference(a, b, true);
    return difference && difference.left && difference.right && decide(difference, lean) < 0;
  };
  const sorted = all.slice().sort((a, b) => profileOrder(a, b) || (late ? compareVectors(elisions(a), elisions(b)) : 0) || totalOrder(a, b, order));
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
    const best = tied.map(at).reduce((least, value) => Math.min(least, value), Infinity);
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
  let withFlags = 0;
  for (let round = 0; round < rounds; round++) {
    // Greedy, lazy, late-elision, or no lean, which is how elision-only's
    // check ranks (engine §7). Under late-elision, and now and then under
    // another rule, T is elidable, and then now and then its optionals use the maximal marker.
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
          const mark = maximal ? "++" : "+";
          symbols.push(next() < 0.5 ? `[${mark}T]` : `[${mark}T ${symbol}]`);
        } else if (sugar < 0.08) symbols.push(`[${symbol}]`);
        else if (sugar < 0.11) symbols.push(`{${symbol}}`);
        else if (sugar < 0.14) symbols.push(`[{${symbol}}]`);
        else if (sugar < 0.16) symbols.push(`{${symbol} \\ ${terminals[Math.floor(next() * terminals.length)]}}`);
        else symbols.push(symbol);
      }
      return symbols.length ? symbols.join(" ") : "ε";
    };
    const lines = ["%rule text " + [body(), body(), body()].join(" | ")];
    // Now and then a rule is a chain, whose levels are its own nodes
    // (engine §3.3).
    for (const rule of rules) {
      const chain = next();
      const item = () => (next() < 0.5 ? terminals[Math.floor(next() * terminals.length)] : reference());
      if (chain < 0.05) lines.push(`%rule ${rule} {... ${item()} \\ ${item()}}`);
      else if (chain < 0.1) lines.push(`%rule ${rule} {${item()} ... \\ ${item()}}`);
      else lines.push(`%rule ${rule} ${[body(), body()].join(" | ")}`);
    }
    // The input can be empty.
    const specs = [];
    const length = Math.floor(next() * (longest + 1));
    for (let index = 0; index < length; index++) {
      const tags = terminals.filter(() => next() < 0.5);
      specs.push({ text: "x", tags: tags.length ? tags : ["A"], phonemes: next() < 0.6 ? "x" : "y" });
    }
    const directive = `%ambiguity-resolution ${lean === "none" ? "greedy" : lean}`;
    const flagged = new Set(["text", ...rules].filter(() => next() < 0.35));
    const definitions = lines.map((line) => flagged.has(line.split(" ")[1]) ? line.replace("%rule ", "%rule(leftmost-longest) ") : line);
    const grammar = `${directive}\n${definitions.join("\n")}`;
    const loaded = loadEngineCase({ grammar });
    if (loaded.loadError) continue;
    // The oracle recognizes the input itself, whatever the stage did with it.
    // A grammar that repeats an item that can be empty is an error of
    // lowering (engine §3.3), and the round is skipped.
    const { tokens, text } = caseTokens(specs);
    let lowered;
    try {
      lowered = loaded.dialect.stages[0].grammar.lower(new Set());
    } catch (error) {
      if (error instanceof GencmuError && error.kind === "grammar") continue;
      throw error;
    }
    const context = new ParseContext(lowered, tokens, [...text], loaded.dialect.loader.unicode);
    const chart = recognize(context, "text", 0, tokens.length);
    const roots = rootItems(chart, "text");
    let truth;
    budget = 20000;
    try {
      truth = expected(roots, chart, maximal, lean, flagged);
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
    if (truth !== null && flagged.size > 0) withFlags++;
    checked++;
  }
  // Every kind of round is checked often enough to count.
  assert.ok(rejected > rounds / 50 && empty > rounds / 100 && withMaximal > rounds / 50, `${rejected} rejections, ${empty} empty inputs, ${withMaximal} rounds under maximal`);
  assert.ok(withFlags > rounds / 50, `only ${withFlags} flagged grammars were checked`);
  assert.ok(checked > rounds / 6, `only ${checked} grammars were checked`);
});

void ParseContext; void actions;

test("elision vectors compare exactly however many elisions they share, built apart (engine §6)", () => {
  // 2^k elisions at one position, built by doubling, as a new object each
  // time.
  const run = (at, k) => {
    let sequence = { size: 1, first: at, last: at };
    for (let index = 0; index < k; index++) sequence = concatElisions(sequence, { ...sequence });
    return sequence;
  };
  const one = { size: 1, first: 0, last: 0 };
  for (const k of [32, 53, 60, 100]) {
    assert.equal(compareElisions(run(0, k), run(0, k)), 0, `2^${k} and 2^${k}`);
    // One more elision at the same position is greater, also past 2^53.
    assert.equal(compareElisions(run(0, k), concatElisions(run(0, k), one)), -1, `2^${k} and 2^${k} + 1`);
    assert.equal(compareElisions(concatElisions(one, run(0, k)), run(0, k)), 1, `1 + 2^${k} and 2^${k}`);
    // The same counts, followed by elisions at different positions.
    assert.equal(compareElisions(concatElisions(run(0, k), run(3, k)), concatElisions(run(0, k), run(2, k))), -1, `then at 3 or at 2, 2^${k} each`);
  }
});
