// The witness hook of tests/README.md: whether the check of elision-only
// kept W(D), the chosen derivation mapped to the reconstructed input, as a
// counted derivation of its forest (engine §7.8). It reads the check through
// the library's private test hook, never through its API, and it ranks
// nothing itself: it marks W(D)'s edges before the check ranks, and reads
// what the check's own ranking did with them.
import { hooks } from "../src/testing.js";
import { ropeOf, secondOrder, totalOrder } from "../src/rank.js";

/**
 * One check that the hook watched: the walk's W(D), or null where the chart
 * does not hold it, and, once the check has ranked, whether it kept W(D).
 * @typedef {{walk: Walk | null, kept: boolean | null}} WatchedCheck
 */

/**
 * Runs `parse` and returns its value with the checks of elision-only that
 * ran in it and met no error of the grammar.
 * @template T
 * @param {() => T} parse
 * @returns {{value: T, checks: WatchedCheck[]}}
 */
export function withChecks(parse) {
  /** @type {WatchedCheck[]} */
  const checks = [];
  const before = hooks.elisionCheck;
  hooks.elisionCheck = (run) => {
    const walk = walkWitness(run);
    /** @type {WatchedCheck} */
    const check = { walk, kept: null };
    checks.push(check);
    return { marks: walk ? walk.marks : null, ranked: (outcome) => { check.kept = walk !== null && keeps(walk, outcome); } };
  };
  try {
    return { value: parse(), checks };
  } finally {
    hooks.elisionCheck = before;
  }
}

/**
 * Whether a watched check kept W(D) (tests/README.md).
 * @param {WatchedCheck} check
 * @returns {boolean}
 */
export function keepsWitness(check) {
  return check.kept === true;
}

/**
 * The two channels of the hook. The count channel: the check's own count,
 * in the same loop that counts, counted a derivation made of W(D)'s marked
 * edges only. The selection channel: where the check reports two readings,
 * the first does not come after W(D) in the canonical order T. Where the
 * first is not W(D), W(D) was a candidate for the second, so the second
 * does not come after W(D) by the criterion of engine §6 that picks it:
 * divergence from the first, earliest first, and then T.
 * @param {Walk} walk
 * @param {{ranking: import("../src/rank.js").Ranking | null, counted: boolean}} outcome
 * @returns {boolean}
 */
function keeps(walk, { ranking, counted }) {
  if (!counted || ranking === null) return false;
  if (ranking.verdict !== "tie") return true;
  const w = ropeOf(walk.sequence);
  const first = totalOrder(ranking.first, w, "none");
  if (first > 0) return false;
  return first === 0 || secondOrder(ranking.first, /** @type {import("../src/types.js").Rope} */ (ranking.second), w, "none") <= 0;
}

/**
 * W(D) as the walk finds it: for each item of W(D), the indices of the
 * edges that W(D) uses, and W(D)'s actions in order.
 * @typedef {object} Walk
 * @property {Map<import("../src/types.js").Item, Set<number>>} marks
 * @property {import("../src/types.js").Action[]} sequence
 */

/**
 * The walk: W(D) in the chart of the check, before the check ranks. For
 * each node of W(D), from the leaves up, a completed item of the node's
 * production over the node's span of R that has an edge whose children are
 * the items of the node's children. A read is of the original token that D
 * reads, found by its provenance. An elided terminator of D is the
 * restoration of its helper over its own synthetic token. The walk marks
 * the edges that it matched, by their index in the item's edges, and builds
 * W(D)'s actions in order. It pins the shape of W(D), not its tags, which
 * the cases pin. Null where the chart does not hold W(D).
 * @param {import("../src/testing.js").ElisionCheckRun} run
 * @returns {Walk | null}
 */
function walkWitness(run) {
  const { chosen, chart, roots, synthetic, originalAt, recordAt } = run;
  // The nodes of D in post-order, each with its span in R. A cursor walks
  // the leaves of D left to right: a read takes the original token, an
  // elided terminator its record's synthetic token, in order.
  const order = [];
  const spans = new Map();
  let cursor = 0;
  let records = 0;
  const stack = [{ node: chosen, next: 0, start: 0 }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const node = frame.node;
    if (frame.next === 0) frame.start = cursor;
    if ("read" in node) {
      const at = originalAt[node.read.token];
      if (at !== cursor || synthetic[at]) return null;
      cursor++;
      spans.set(node, [at, at + 1]);
      order.push(node);
      stack.pop();
      continue;
    }
    if (isElided(node)) {
      const at = recordAt[records++];
      if (at !== cursor || !synthetic[at]) return null;
      cursor++;
      spans.set(node, [at, at + 1]);
      order.push(node);
      stack.pop();
      continue;
    }
    if (frame.next < node.children.length) {
      stack.push({ node: node.children[frame.next++], next: 0, start: cursor });
      continue;
    }
    spans.set(node, [frame.start, cursor]);
    order.push(node);
    stack.pop();
  }
  if (records !== recordAt.length || cursor !== synthetic.length) return null;

  // The items of each set by production, dot and origin, made on demand.
  const indexes = new Map();
  const itemsAt = (position, production, dot, origin) => {
    let index = indexes.get(position);
    if (!index) {
      index = new Map();
      for (const item of chart.setAt(position).items) {
        const key = `${item.production.id}:${item.dot}:${item.origin}`;
        const list = index.get(key);
        if (list) list.push(item);
        else index.set(key, [item]);
      }
      indexes.set(position, index);
    }
    return index.get(`${production.id}:${dot}:${origin}`) || [];
  };

  // For each rule node of W(D), the items that derive it exactly, and for
  // each item found, the indices of the edges that the walk matched. An
  // index, and not an edge object, since an item can make its edge objects
  // anew on each read.
  const found = new Map();
  /** @type {Map<import("../src/types.js").Item, Set<number>>} */
  const marks = new Map();
  /** @type {(item: import("../src/types.js").Item, matched: (edge: import("../src/types.js").Edge) => boolean) => boolean} */
  const mark = (item, matched) => {
    let any = false;
    item.edges.forEach((edge, index) => {
      if (!matched(edge)) return;
      let kept = marks.get(item);
      if (!kept) marks.set(item, (kept = new Set()));
      kept.add(index);
      any = true;
    });
    return any;
  };
  for (const node of order) {
    if ("read" in node) continue;
    const [start, end] = spans.get(node);
    if (isElided(node)) {
      const restorations = itemsAt(end, node.production, 0, start).filter((item) => item.restores && item.origin === start);
      for (const item of restorations) mark(item, (edge) => edge.kind === "restore");
      found.set(node, new Set(restorations));
      continue;
    }
    const production = node.production;
    let current = new Set(itemsAt(start, production, 0, start).filter((item) => item.previous === null && !item.restores));
    for (const item of current) mark(item, (edge) => edge.kind === "seed");
    node.children.forEach((child, index) => {
      const [, childEnd] = spans.get(child);
      const next = new Set();
      for (const item of itemsAt(childEnd, production, index + 1, start)) {
        const matched = mark(item, (edge) => {
          if (!("previous" in edge) || !current.has(edge.previous)) return false;
          if ("read" in child) return edge.kind === "scan" && edge.token === spans.get(child)[0] && edge.terminal === child.read.terminal;
          return edge.kind === "complete" && found.get(child).has(edge.child);
        });
        if (matched) next.add(item);
      }
      current = next;
    });
    found.set(node, current);
  }
  const top = found.get(chosen);
  if (!roots.some((item) => top.has(item))) return null;
  // W(D)'s actions, in the order in which the ranking builds a sequence:
  // reads and closes in post-order, over the tokens of R and the spans of
  // the items found. A restoration reads its synthetic token, and then
  // closes over it. Nothing is ranked to build it.
  /** @type {import("../src/types.js").Action[]} */
  const sequence = [];
  for (const node of order) {
    const [start, end] = spans.get(node);
    if ("read" in node) {
      sequence.push({ kind: "read", token: start, terminal: node.read.terminal });
      continue;
    }
    if (isElided(node)) sequence.push({ kind: "read", token: start, terminal: /** @type {string} */ (node.production.elided) });
    const item = /** @type {import("../src/types.js").Item} */ ([...found.get(node)][0]);
    sequence.push({ kind: "close", item: item ?? /** @type {any} */ ({ production: node.production, origin: start, end }) });
  }
  return { marks, sequence };
}

/**
 * Whether a node of a derivation is an elided terminator: the empty
 * production of an elidable optional's helper.
 * @param {import("../src/types.js").Derivation} node
 * @returns {boolean}
 */
function isElided(node) {
  return !("read" in node) && node.production.helper && node.production.elided !== null && node.production.rhs.length === 0 && node.children.length === 0;
}
