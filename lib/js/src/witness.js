/**
 * The restored chosen derivation's matched edge indices and action sequence.
 * @typedef {object} Walk
 * @property {Map<import("./types.js").Item, Set<number>>} marks
 * @property {import("./types.js").Action[]} sequence
 */

/**
 * Finds the restored chosen derivation before ranking.
 * The walk matches productions, spans and token provenance.
 * It returns matched edges and the witness's actions.
 * A missing witness gives null.
 * @param {import("./testing.js").ElisionCheckRun} run
 * @returns {Walk | null}
 */
export function walkWitness(run) {
  const { chosen, chart, roots, synthetic, originalAt, recordAt } = run;
  // Visit children before parents and record each reconstructed span.
  // Reads consume original tokens, and omissions consume synthetic tokens.
  /** @type {import("./types.js").Derivation[]} */
  const order = [];
  /** @type {Map<import("./types.js").Derivation, [number, number]>} */
  const spans = new Map();
  /** @param {import("./types.js").Derivation} node */
  const spanOf = (node) => {
    const span = spans.get(node);
    if (!span) throw new Error("a witness node has no reconstructed span");
    return span;
  };
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
    if (witnessElided(node)) {
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
  /** @type {Map<number, Map<string, import("./types.js").Item[]>>} */
  const indexes = new Map();
  /** @param {number} position
   * @param {import("./types.js").Production} production
   * @param {number} dot
   * @param {number} origin */
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

  // Record exact items for each rule node and matched edge indices.
  // Edge indices stay valid when an item creates new edge objects.
  /** @type {Map<import("./types.js").Derivation, Set<import("./types.js").Item>>} */
  const found = new Map();
  /** @type {Map<import("./types.js").Item, Set<number>>} */
  const marks = new Map();
  /** @type {(item: import("./types.js").Item, matched: (edge: import("./types.js").Edge) => boolean) => boolean} */
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
    const [start, end] = spanOf(node);
    if (witnessElided(node)) {
      const restorations = itemsAt(end, node.production, 0, start).filter((item) => item.restores && item.origin === start);
      for (const item of restorations) mark(item, (edge) => edge.kind === "restore");
      found.set(node, new Set(restorations));
      continue;
    }
    const production = node.production;
    let current = new Set(itemsAt(start, production, 0, start).filter((item) => item.previous === null && !item.restores));
    for (const item of current) mark(item, (edge) => edge.kind === "seed");
    node.children.forEach((child, index) => {
      const [, childEnd] = spanOf(child);
      const next = new Set();
      for (const item of itemsAt(childEnd, production, index + 1, start)) {
        const matched = mark(item, (edge) => {
          if (!("previous" in edge) || !current.has(edge.previous)) return false;
          if ("read" in child) return edge.kind === "scan" && edge.token === spanOf(child)[0] && edge.terminal === child.read.terminal;
          return edge.kind === "complete" && found.get(child)?.has(edge.child) === true;
        });
        if (matched) next.add(item);
      }
      current = next;
    });
    found.set(node, current);
  }
  const top = found.get(chosen);
  if (!top || !roots.some((item) => top.has(item))) return null;
  // Bind one coherent proof to its actual reconstruction entry frames.
  /** @type {Map<import("./types.js").Derivation, import("./types.js").Item>} */
  const bound = new Map();
  /** @type {{node:import("./types.js").DerivationRule,item:import("./types.js").Item}[]} */
  const bind = [{node:/** @type {import("./types.js").DerivationRule} */ (chosen),item:/** @type {import("./types.js").Item} */ (roots.find(item => top.has(item)))}];
  while (bind.length) {
    const {node,item} = /** @type {NonNullable<ReturnType<typeof bind.pop>>} */ (bind.pop());
    bound.set(node,item);
    if (witnessElided(node)) continue;
    let current = item;
    for (let index = node.children.length-1; index >= 0; index--) {
      const child = node.children[index];
      const edge = current.edges.find((edge, number) => marks.get(current)?.has(number) && (
        "read" in child
          ? edge.kind === "scan" && edge.token === spanOf(child)[0] && edge.terminal === child.read.terminal
          : edge.kind === "complete" && found.get(child)?.has(edge.child)
      ));
      if (!edge || !("previous" in edge)) return null;
      if (edge.kind === "complete") bind.push({node:/** @type {import("./types.js").DerivationRule} */ (child),item:edge.child});
      current = edge.previous;
    }
  }
  // Build actions after visiting each node's children, without ranking.
  // Each restoration reads its synthetic token and closes over it.
  /** @type {import("./types.js").Action[]} */
  const sequence = [];
  for (const node of order) {
    const [start, end] = spanOf(node);
    if ("read" in node) {
      sequence.push({ kind: "read", token: start, terminal: node.read.terminal });
      continue;
    }
    if (witnessElided(node)) sequence.push({ kind: "read", token: start, terminal: /** @type {string} */ (node.production.elided) });
    const item = /** @type {import("./types.js").Item} */ (bound.get(node));
    sequence.push({ kind: "close", item: item ?? /** @type {any} */ ({ production: node.production, origin: start, end }) });
  }
  return { marks, sequence };
}

/**
 * Whether a node of a derivation is an elided terminator: the empty
 * production of an elidable optional's helper.
 * @param {import("./types.js").Derivation} node
 * @returns {boolean}
 */
function witnessElided(node) {
  return !("read" in node) && node.production.helper && node.production.elided !== null && node.production.rhs.length === 0 && node.children.length === 0;
}
