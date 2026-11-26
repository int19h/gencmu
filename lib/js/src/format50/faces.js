// Display faces (engine §11.3). A published node with a primary shows its
// primary with satellites around it: the units that the branches beside the
// primary select. A branch selects the nodes that it would publish by
// itself. A node with no primary, or with no satellite, shows as one unit.

import { CLASS_KEY } from "./bag.js";
import { GencmuError } from "../errors.js";

// The face of each unit that a published token can show, made when its
// stage publishes. Display reads these and evaluates no recipe again.
/** @type {WeakMap<object, {image: string, classes: string[]}>} */
const FACES = new WeakMap();

// The units that the emission list of a node selects, as its stage made
// them when it published: its projections and insertions, and the units
// that its forwarded parts select.
/** @type {WeakMap<object, any[]>} */
const LISTED = new WeakMap();

/**
 * The units that a subtree selects: rule nodes with bare emission and the
 * nodes of emission lists, in order. A rule without its own selection
 * forwards those of its children. Erasure selects nothing. The units of an
 * emission list come from `listed`, which the publishing stage passes, and
 * later from the units that it stored.
 * @param {any} root
 * @param {((node: any) => any[]) | null} [listed]
 * @returns {any[]}
 */
export function selectedUnits(root, listed = null) {
  const units = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if ((node.kind !== "rule" && node.kind !== "splice") || node.erased) continue;
    const emit = node.origin?.rule.emit;
    if (emit) {
      if (!emit.items.length) units.push(node);
      else {
        if (listed && !LISTED.has(node)) LISTED.set(node, listed(node));
        for (const unit of LISTED.get(node) ?? []) units.push(unit);
      }
      continue;
    }
    for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]);
  }
  return units;
}

/**
 * The satellites of a display unit before and after its primary, or null
 * for a unit that shows as one leaf or as its primary alone.
 * @param {any} node
 * @param {((node: any) => any[]) | null} [listed] the units of an emission
 * list, while the stage publishes
 */
export function decoration(node, listed = null) {
  const base = node.kind === "projection" ? node.part : node;
  if (!base || !base.primary || (base.kind !== "rule" && base.kind !== "splice")) return null;
  const index = base.children.indexOf(base.primary);
  if (index < 0) return null;
  const before = base.children.slice(0, index).flatMap((/** @type {any} */ child) => selectedUnits(child, listed));
  const after = base.children.slice(index + 1).flatMap((/** @type {any} */ child) => selectedUnits(child, listed));
  if (!before.length && !after.length) return null;
  return { before, after };
}


/**
 * Makes the faces of the units that the published tokens of a stage can
 * show: each satellite beside a primary, along the primary path of each
 * token, and each node of that path. A satellite needs an image, and a
 * failing recipe of a satellite fails the publication. A satellite branch
 * with an emission list shows the units that its list selects, which
 * `listed` makes.
 * @param {any[]} tokens
 * @param {((node: any) => any[]) | null} [listed]
 */
export function publishFaces(tokens, listed = null) {
  /** @type {any[]} */
  const pending = tokens.map(token => token.node).filter(Boolean);
  const seen = new Set();
  while (pending.length) {
    let current = pending.pop();
    while (current && !seen.has(current)) {
      seen.add(current);
      const decorated = decoration(current, listed);
      for (const unit of decorated ? [...decorated.before, ...decorated.after] : []) {
        if (FACES.has(unit)) continue;
        FACES.set(unit, faceNow(unit, true));
        pending.push(unit);
      }
      if (current.kind !== "token" && !FACES.has(current)) FACES.set(current, faceNow(current, false));
      current = current.kind === "projection" ? current.part : (current.kind === "rule" || current.kind === "splice") ? current.primary : null;
    }
  }
}

/**
 * The image and classes of a unit, from its bag.
 * @param {any} node
 * @param {boolean} satellite
 */
function faceNow(node, satellite) {
  const bag = node.bag();
  const image = bag.value("image");
  if (satellite && typeof image !== "string") {
    throw new GencmuError("grammar", `the satellite ${node.rule ?? node.terminal ?? "node"} at [${node.span}] has no image to show`);
  }
  return {
    image: typeof image === "string" ? image : "",
    classes: bag.keys().filter((/** @type {any} */ key) => CLASS_KEY.test(key)).sort(),
  };
}

/**
 * The image and classes that a unit shows, as its stage made them when it
 * published.
 * @param {any} node
 */
export function unitFace(node) {
  const face = FACES.get(node);
  if (!face) throw new GencmuError("usage", "the face of this unit was not made when its stage published");
  return face;
}
