// Lossless complete-reading ranking when preferences can participate.
import { Ranker, compareProfiles, sumProfiles, firstDifference, totalOrder, internals } from "./rank.js";
import { compareCodePoints } from "./tags.js";
import { hooks } from "./testing.js";

/** @import { Item, Rope, Lean, Action, Token } from "./types.js" */
/** @import { Candidate, RuleProfile, Ranking } from "./rank.js" */
/** @typedef {{profile: RuleProfile, occurrences: Map<string, bigint>, elisions: Map<number, bigint>, candidates: Candidate[], count: number}} Signature */
/** @typedef {Map<string, Signature>} SignatureSet */
/** @typedef {{all: SignatureSet, allowed: SignatureSet}} SignatureSummary */
/** @typedef {{span: [number, number], higher: string, lower: string, path: string[], residualCounts: [string, string]}} Contest */
/** @typedef {{basis: "prefer", contests: Contest[]} | {basis: "stage", directive: string, boundary?: number, counts?: [string, string], witness?: [Action | null, Action | null]}} EdgeReason */
/** @typedef {EdgeReason & {from: number, to: number}} CycleEdge */
/** @typedef {{forward: Contest[], reverse: Contest[]}} PreferenceConflict */
/** @typedef {Ranking & {cycle?: CycleEdge[], readings?: Rope[], conflict?: PreferenceConflict, slow?: boolean}} PreferenceRanking */

const { concat: prefConcat, actions: prefActions, decide: prefDecide } = internals;
/** @type {Rope} */
const PREFERENCE_EMPTY = { empty: true, size: 0 };

export class PreferenceRanker extends Ranker {
  /** @param {Token[]} tokens @param {Lean} lean @param {import("./preferences.js").Preferences} preferences @param {import("./maximal.js").Maximal | null} [maximal] @param {number[] | null} [cycleProject] */
  constructor(tokens, lean, preferences, maximal = null, cycleProject = null) {
    super(tokens, lean, maximal, cycleProject);
    this.preferences = preferences;
    this.stageLean = lean;
    /** @type {{plain: Map<Item, SignatureSummary>, contextual: Map<Item, Map<string, SignatureSummary>>}} */
    this.signatureMemo = { plain: new Map(), contextual: new Map() };
    this.statistics = { slow: false, forestItems: 0, forestEdges: 0, contexts: 0, signatures: 0, largestSet: 0, comparisons: 0 };
  }

  /** @override @param {Item[]} roots @returns {PreferenceRanking | null} */
  rank(roots) {
    try { return this.rankComplete(roots); }
    finally { if (this.preferences.names.size) hooks.preferenceRanking?.(this.statistics); }
  }

  /** @param {Item[]} roots @returns {PreferenceRanking | null} */
  rankComplete(roots) {
    if (!this.possibleContest(roots)) return super.rank(roots);
    this.statistics.slow = true;
    this.groupRules(roots);
    /** @type {SignatureSet} */
    const root = new Map();
    for (const item of roots) for (const signature of this.signatures(item).all.values()) {
      const close = this.closeLeaf(item);
      this.storeSignature(root, { ...signature, candidates: signature.candidates.map((entry) => this.extend(entry, close)) });
    }
    this.statistics.contexts++;
    this.statistics.signatures += root.size;
    this.statistics.largestSet = Math.max(this.statistics.largestSet, root.size);
    if (root.size === 0) return null;
    const all = [...root.values()];
    const count = Math.min(2, all.reduce((n, entry) => n + entry.count, 0));
    let profile = all[0].profile;
    for (const entry of all) if (compareProfiles(entry.profile, profile) < 0) profile = entry.profile;
    // Every class keeps its canonical first and earliest-diverging second
    // through the original action-summary machinery. No class is ranked
    // against another before this complete root comparison.
    const best = all.filter((entry) => compareProfiles(entry.profile, profile) === 0).map((entry) => {
      /** @type {Candidate[]} */
      let kept = [];
      for (const candidate of entry.candidates) kept = this.keep(kept, candidate);
      kept.sort((a, b) => totalOrder(a.seq, b.seq, this.lean));
      let canonical = kept[0];
      for (const candidate of kept.slice(1)) {
        const difference = firstDifference(canonical.seq, candidate.seq, true);
        const at = difference?.index ?? Infinity;
        canonical = this.offer(canonical, candidate.seq, at);
        for (const alt of candidate.alts) canonical = this.offer(canonical, alt, at < candidate.at ? at : candidate.at);
      }
      return { ...entry, canonical };
    });
    best.sort((a, b) => this.canonicalOrder(a, b));
    const incoming = new Uint8Array(best.length);
    /** @type {Map<number, EdgeReason>[]} */
    const edges = best.map(() => new Map());
    for (let i = 0; i < best.length; i++) for (let j = i + 1; j < best.length; j++) {
      this.statistics.comparisons++;
      const pair = this.compare(best[i], best[j]);
      if (pair.order === 0) continue;
      const from = pair.order < 0 ? i : j;
      const to = pair.order < 0 ? j : i;
      const directed = pair.order < 0 ? pair : this.compare(best[j], best[i]);
      incoming[to] = 1;
      edges[from].set(to, /** @type {EdgeReason} */ (directed.reason));
    }
    const cycle = directedCycle(edges);
    const marks = this.marks;
    const witnessCounted = marks === null ? null : roots.some((item) => marks.has(item) && this.countOf(item).w);
    const base = { profile, witnessCounted, slow: true };
    if (cycle) {
      const readings = cycle.map((index) => best[index].canonical.seq);
      return { ...base, verdict: "tie", first: readings[0], second: null, witness: null, readings,
        cycle: cycle.map((index, i) => ({ from: i, to: (i + 1) % cycle.length, .../** @type {EdgeReason} */ (edges[index].get(cycle[(i + 1) % cycle.length])) })) };
    }
    const survivors = best.filter((_, i) => !incoming[i]);
    const first = survivors[0].canonical.seq;
    const alternatives = survivors.flatMap((entry, i) => [...(i === 0 ? [] : [entry.canonical.seq]), ...entry.canonical.alts]);
    if (alternatives.length === 0) return { ...base, verdict: count === 1 ? "unique" : "resolved", first, second: null, witness: null };
    // E and L are equal within a class. Across surviving classes, use T
    // only after the earliest visible divergence criterion.
    alternatives.sort((a, b) => {
      const da = firstDifference(first, a, true)?.index ?? Infinity;
      const db = firstDifference(first, b, true)?.index ?? Infinity;
      if (da < db) return -1;
      if (da > db) return 1;
      const sa = survivors.find((s) => s.canonical.seq === a || s.canonical.alts.includes(a));
      const sb = survivors.find((s) => s.canonical.seq === b || s.canonical.alts.includes(b));
      if (!sa || !sb) throw new Error("A preference witness lacks its signature.");
      return (this.stageLean === "late-elision" ? compareVectors(sa.elisions, sb.elisions).order : 0) || totalOrder(a, b, this.lean);
    });
    const second = alternatives[0];
    const secondSignature = survivors.find((entry) => entry.canonical.seq === second || entry.canonical.alts.includes(second));
    if (!secondSignature) throw new Error("The second preference witness lacks its signature.");
    const conflict = compareOccurrences(this.preferences, survivors[0].occurrences, secondSignature.occurrences);
    /** @type {PreferenceRanking} */
    const result = { ...base, verdict: /** @type {const} */ ("tie"), first, second, witness: actionWitness(first, second) };
    if (conflict.forward.length && conflict.reverse.length) result.conflict = conflict;
    return result;
  }

  /** @param {Item[]} roots */
  possibleContest(roots) {
    if (this.preferences.names.size === 0) return false;
    const seen = new Set();
    const inventory = new Map();
    const stack = roots.slice();
    let possible = false;
    while (stack.length) {
      const item = /** @type {Item} */ (stack.pop());
      if (seen.has(item)) continue;
      seen.add(item);
      this.statistics.forestItems++;
      this.statistics.forestEdges += item.edges.length;
      const p = this.profileProject?.[item.origin] ?? item.origin;
      const q = this.profileProject?.[item.end] ?? item.end;
      const name = item.production.lhs;
      if (!item.production.helper && item.dot === item.production.rhs.length && p < q && this.preferences.names.has(name)) {
        const key = `${p},${q}`;
        const names = inventory.get(key) || new Set();
        for (const other of names) if (this.preferences.paths.get(name)?.has(other) || this.preferences.paths.get(other)?.has(name)) possible = true;
        names.add(name);
        inventory.set(key, names);
      }
      for (const edge of item.edges) {
        if (edge.kind === "scan" || edge.kind === "complete") stack.push(edge.previous);
        if (edge.kind === "complete") stack.push(edge.child);
      }
    }
    return possible;
  }

  /** @param {Candidate} entry @param {Rope} action @returns {Candidate} */
  extend(entry, action) { return { ...entry, seq: prefConcat(entry.seq, action), alts: entry.alts.map((alt) => prefConcat(alt, action)) }; }

  /** @param {Item} item @returns {SignatureSummary} */
  signatures(item) {
    return this.traverse(item, this.signatureMemo, (current, dependency) => {
      const guarded = this.maximal !== null && this.maximal.guards(current);
      /** @type {SignatureSet} */
      const all = new Map();
      const allowed = guarded ? new Map() : all;
      for (const edge of current.edges) {
        /** @type {Signature[]} */
        let produced = [];
        let permitted = true;
        if (edge.kind === "seed" || edge.kind === "restore") {
          const elisions = new Map();
          if (edge.kind === "seed" && current.production.elided !== null && current.production.rhs.length === 0) elisions.set(current.origin, 1n);
          produced = [{ profile: [], occurrences: new Map(), elisions, count: 1,
            candidates: [{ seq: edge.kind === "restore" ? this.readLeaf(edge.token, edge.terminal) : PREFERENCE_EMPTY, alts: [], at: Infinity }] }];
        } else if (edge.kind === "scan") {
          const read = this.readLeaf(edge.token, edge.terminal);
          produced = [...dependency(edge.previous).all.values()].map((s) => ({ ...s, candidates: s.candidates.map((/** @type {Candidate} */ c) => this.extend(c, read)) }));
        } else {
          const before = this.maximal !== null && this.maximal.elided(edge.child) ? dependency(edge.previous).allowed : dependency(edge.previous).all;
          const close = this.closeLeaf(edge.child);
          for (const x of before.values()) for (const y of dependency(edge.child).all.values()) {
            /** @type {Candidate[]} */
            const candidates = [];
            for (const a of x.candidates) for (const b of y.candidates) {
              const child = this.extend(b, close);
              /** @type {Candidate} */
              let candidate = { seq: prefConcat(a.seq, child.seq), alts: [], at: Infinity };
              for (const alt of a.alts) candidate = this.offer(candidate, prefConcat(alt, child.seq), a.at);
              for (const alt of child.alts) candidate = this.offer(candidate, prefConcat(a.seq, alt), addCount(a.seq.size, child.at));
              candidates.push(candidate);
            }
            produced.push({ profile: sumProfiles(x.profile, y.profile), occurrences: sumMap(x.occurrences, y.occurrences),
              elisions: sumMap(x.elisions, y.elisions), candidates, count: Math.min(2, x.count * y.count) });
          }
          if (guarded) permitted = !/** @type {import("./maximal.js").Maximal} */ (this.maximal).forbids(edge.child, current.production.rhs[current.dot - 1].test);
        }
        const complete = current.dot === current.production.rhs.length;
        const p = this.profileProject?.[current.origin] ?? current.origin;
        const q = this.profileProject?.[current.end] ?? current.end;
        for (let signature of produced) {
          if (complete && !current.production.helper && p < q) {
            if (current.production.flags.includes("leftmost-longest")) signature = { ...signature, profile: sumProfiles(signature.profile, [[p, q, 1]]) };
            if (this.preferences.names.has(current.production.lhs)) {
              const occurrences = new Map(signature.occurrences);
              const key = JSON.stringify([current.production.lhs, p, q]);
              occurrences.set(key, (occurrences.get(key) || 0n) + 1n);
              signature = { ...signature, occurrences };
            }
          }
          this.storeSignature(all, signature);
          if (guarded && permitted) this.storeSignature(allowed, signature);
        }
      }
      this.statistics.contexts++;
      this.statistics.signatures += all.size;
      this.statistics.largestSet = Math.max(this.statistics.largestSet, all.size, allowed.size);
      return { all, allowed };
    }, { all: new Map(), allowed: new Map() });
  }

  /** @param {SignatureSet} set @param {Signature} signature */
  storeSignature(set, signature) {
    const actionKey = this.stageLean === "late-elision" || this.stageLean === "none" ? null
      : [...prefActions(signature.candidates[0].seq)].filter((a) => internals.visible(a)).map((a) => a.kind === "read" ? ["r", a.token, a.terminal] : ["c", a.item.production.id, a.item.origin, a.item.end]);
    const key = JSON.stringify([signature.profile.map(([p, q, n]) => [p, q, String(n)]), mapKey(signature.occurrences),
      this.stageLean === "late-elision" ? mapKey(signature.elisions) : null, actionKey]);
    const previous = set.get(key);
    if (!previous) { set.set(key, { ...signature, candidates: signature.candidates.slice() }); return; }
    previous.count = Math.min(2, previous.count + signature.count);
    for (const candidate of signature.candidates) previous.candidates = this.keep(previous.candidates, candidate);
  }

  /** @param {Signature & {canonical: Candidate}} a @param {Signature & {canonical: Candidate}} b */
  canonicalOrder(a, b) {
    return (this.stageLean === "late-elision" ? compareVectors(a.elisions, b.elisions).order : 0) || totalOrder(a.canonical.seq, b.canonical.seq, this.lean);
  }

  /** @param {Signature & {canonical: Candidate}} a @param {Signature & {canonical: Candidate}} b @returns {{order: number, reason?: EdgeReason}} */
  compare(a, b) {
    const contests = compareOccurrences(this.preferences, a.occurrences, b.occurrences);
    if (contests.forward.length && contests.reverse.length) return { order: 0 };
    if (contests.forward.length) return { order: -1, reason: { basis: "prefer", contests: contests.forward } };
    if (contests.reverse.length) return { order: 1 };
    if (this.stageLean === "late-elision") {
      const compared = compareVectors(a.elisions, b.elisions);
      return compared.order === 0 ? compared : { ...compared, reason: { basis: "stage", directive: "late-elision", boundary: compared.boundary, counts: compared.counts } };
    }
    const difference = firstDifference(a.canonical.seq, b.canonical.seq, true);
    if (!difference?.left || !difference.right) return { order: 0 };
    const order = prefDecide({ left: difference.left, right: difference.right }, this.stageLean);
    return { order, reason: { basis: "stage", directive: this.stageLean, witness: [difference.left, difference.right] } };
  }
}

/** @template K @param {Map<K, bigint>} a @param {Map<K, bigint>} b @returns {Map<K, bigint>} */
function sumMap(a, b) { const result = new Map(a); for (const [key, count] of b) result.set(key, (result.get(key) || 0n) + count); return result; }
/** @param {number | bigint} a @param {number | bigint} b */
function addCount(a, b) { if (a === Infinity || b === Infinity) return Infinity; const n = BigInt(a) + BigInt(b); return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n; }
/** @param {Map<any, bigint>} map */
function mapKey(map) { return [...map].map(([key, n]) => [key, String(n)]).sort((a, b) => compareCodePoints(String(a[0]), String(b[0]))); }
/** @param {Map<number, bigint>} a @param {Map<number, bigint>} b @returns {{order: number, boundary?: number, counts?: [string, string]}} */
export function compareVectors(a, b) {
  for (const p of [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y)) {
    const x = a.get(p) || 0n, y = b.get(p) || 0n;
    if (x !== y) return { order: x < y ? -1 : 1, boundary: p, counts: [String(x), String(y)] };
  }
  return { order: 0 };
}

/** @param {import("./preferences.js").Preferences} preferences @param {Map<string, bigint>} a @param {Map<string, bigint>} b @returns {PreferenceConflict} */
export function compareOccurrences(preferences, a, b) {
  const left = new Map(), right = new Map();
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const delta = (a.get(key) || 0n) - (b.get(key) || 0n);
    if (delta > 0n) left.set(key, delta);
    if (delta < 0n) right.set(key, -delta);
  }
  /** @type {Contest[]} */
  const forward = [];
  /** @type {Contest[]} */
  const reverse = [];
  for (const [x, xn] of left) for (const [y, yn] of right) {
    const [xr, xp, xq] = JSON.parse(x), [yr, yp, yq] = JSON.parse(y);
    if (xp !== yp || xq !== yq) continue;
    const path = preferences.paths.get(xr)?.get(yr);
    const back = preferences.paths.get(yr)?.get(xr);
    if (path) forward.push({ span: [xp, xq], higher: xr, lower: yr, path, residualCounts: [String(xn), String(yn)] });
    if (back) reverse.push({ span: [xp, xq], higher: yr, lower: xr, path: back, residualCounts: [String(yn), String(xn)] });
  }
  /** @param {Contest} x @param {Contest} y */
  const order = (x, y) => x.span[0] - y.span[0] || x.span[1] - y.span[1] || compareCodePoints(x.higher, y.higher) || compareCodePoints(x.lower, y.lower);
  return { forward: forward.sort(order), reverse: reverse.sort(order) };
}

/** @param {Map<number, EdgeReason>[]} edges @returns {number[] | null} */
export function directedCycle(edges) {
  const done = new Set();
  for (let start = 0; start < edges.length; start++) {
    if (done.has(start)) continue;
    const stack = [{ vertex: start, targets: [...edges[start].keys()].sort((a, b) => a - b)[Symbol.iterator]() }];
    const active = new Map([[start, 0]]);
    while (stack.length) {
      const frame = stack[stack.length - 1], next = frame.targets.next();
      if (next.done) { done.add(frame.vertex); active.delete(frame.vertex); stack.pop(); continue; }
      if (active.has(next.value)) {
        const cycle = stack.slice(active.get(next.value)).map((f) => f.vertex);
        let least = 0;
        for (let i = 1; i < cycle.length; i++) if (cycle[i] < cycle[least]) least = i;
        return [...cycle.slice(least), ...cycle.slice(0, least)];
      }
      if (!done.has(next.value)) {
        active.set(next.value, stack.length);
        stack.push({ vertex: next.value, targets: [...edges[next.value].keys()].sort((a, b) => a - b)[Symbol.iterator]() });
      }
    }
  }
  return null;
}

/** @param {Rope} first @param {Rope} second @returns {[Action | null, Action | null] | null} */
function actionWitness(first, second) {
  let difference = firstDifference(first, second, true);
  if (!difference?.left || !difference.right) difference = firstDifference(first, second, false);
  return difference ? [difference.left, difference.right] : null;
}

/** @param {Rope} rope @param {import("./preferences.js").Preferences} preferences @param {number[]} project @returns {Map<string, bigint>} */
export function occurrencesOfRope(rope, preferences, project) {
  const occurrences = new Map();
  for (const action of prefActions(rope)) {
    if (action.kind !== "close" || action.item.production.helper || !preferences.names.has(action.item.production.lhs)) continue;
    const { origin, end, production } = action.item;
    const p = project[origin], q = project[end];
    if (p >= q) continue;
    const key = JSON.stringify([production.lhs, p, q]);
    occurrences.set(key, (occurrences.get(key) || 0n) + 1n);
  }
  return occurrences;
}
