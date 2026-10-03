// The witness hook of tests/README.md: whether the check of elision-only
// kept W(D), the chosen derivation mapped to the reconstructed input, as a
// counted derivation of its forest (engine §7.8). It reads the check through
// the library's private test hook, never through its API.
import { hooks } from "../src/testing.js";

/**
 * Runs `parse` and returns its value with the checks of elision-only that
 * ran in it and met no error of the grammar.
 * @template T
 * @param {() => T} parse
 * @returns {{value: T, checks: import("../src/testing.js").ElisionCheckRun[]}}
 */
export function withChecks(parse) {
  const checks = [];
  const before = hooks.elisionCheck;
  hooks.elisionCheck = (run) => checks.push(run);
  try {
    return { value: parse(), checks };
  } finally {
    hooks.elisionCheck = before;
  }
}

/**
 * Whether a check's forest holds W(D) as a counted derivation. First, the
 * chart must hold it: for each node of W(D), from the leaves up, a completed
 * item of the node's production over the node's span of R that has an edge
 * whose children are the items of the node's children. A read is of the
 * original token that D reads, found by its provenance. An elided terminator
 * of D is the restoration of its helper over its own synthetic token. Then
 * the check's own ranking must count it: the sub-forest of the items found,
 * each with only the edges that the walk matched, must have a derivation
 * that counts. A faulty ranker can lose W(D) from a chart that holds it.
 * The walk pins the shape of W(D) and its count, not its tags, which the
 * cases pin.
 * @param {import("../src/testing.js").ElisionCheckRun} run
 * @returns {boolean}
 */
export function keepsWitness(run) {
  const { chosen, chart, roots, rank, synthetic, originalAt, recordAt } = run;
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
      if (at !== cursor || synthetic[at]) return false;
      cursor++;
      spans.set(node, [at, at + 1]);
      order.push(node);
      stack.pop();
      continue;
    }
    if (isElided(node)) {
      const at = recordAt[records++];
      if (at !== cursor || !synthetic[at]) return false;
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
  if (records !== recordAt.length || cursor !== synthetic.length) return false;

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
  // each item found, the edges that the walk matched.
  const found = new Map();
  /** @type {Map<import("../src/types.js").Item, Set<import("../src/types.js").Edge>>} */
  const matchedEdges = new Map();
  /** @type {(item: import("../src/types.js").Item, edges: import("../src/types.js").Edge[]) => void} */
  const keep = (item, edges) => {
    let kept = matchedEdges.get(item);
    if (!kept) matchedEdges.set(item, (kept = new Set()));
    for (const edge of edges) kept.add(edge);
  };
  for (const node of order) {
    if ("read" in node) continue;
    const [start, end] = spans.get(node);
    if (isElided(node)) {
      const restorations = itemsAt(end, node.production, 0, start).filter((item) => item.restores && item.origin === start);
      for (const item of restorations) keep(item, item.edges.filter((edge) => edge.kind === "restore"));
      found.set(node, new Set(restorations));
      continue;
    }
    const production = node.production;
    let current = new Set(itemsAt(start, production, 0, start).filter((item) => item.previous === null && !item.restores));
    for (const item of current) keep(item, item.edges.filter((edge) => edge.kind === "seed"));
    node.children.forEach((child, index) => {
      const [, childEnd] = spans.get(child);
      const next = new Set();
      for (const item of itemsAt(childEnd, production, index + 1, start)) {
        const matched = item.edges.filter((edge) => {
          if (!("previous" in edge) || !current.has(edge.previous)) return false;
          if ("read" in child) return edge.kind === "scan" && edge.token === spans.get(child)[0] && edge.terminal === child.read.terminal;
          return edge.kind === "complete" && found.get(child).has(edge.child);
        });
        if (matched.length > 0) {
          next.add(item);
          keep(item, matched);
        }
      }
      current = next;
    });
    found.set(node, current);
  }
  const top = found.get(chosen);
  const tops = roots.filter((item) => top.has(item));
  if (tops.length === 0) return false;
  // The sub-forest: each item found, as a view that keeps only its matched
  // edges, which lead to the views of their items. The check's own ranker
  // must count a derivation of it, in the cycle contexts of the whole
  // forest.
  const views = new Map();
  for (const item of matchedEdges.keys()) views.set(item, Object.create(item));
  for (const [item, edges] of matchedEdges) {
    const kept = [...edges].map((edge) => {
      if (edge.kind === "scan") return { ...edge, previous: views.get(edge.previous) };
      if (edge.kind === "complete") return { ...edge, previous: views.get(edge.previous), child: views.get(edge.child) };
      return edge;
    });
    Object.defineProperty(views.get(item), "edges", { value: kept });
  }
  return rank(tops.map((item) => views.get(item))) !== null;
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
