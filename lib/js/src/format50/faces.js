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
 * The satellites that a published unit shows, along its whole primary
 * path: the satellites before the core from the outermost level inwards,
 * and those after it from the innermost level outwards. The path crosses
 * into earlier stages through input tokens (engine §11.3).
 * @param {any} node
 * @returns {{before: any[], after: any[]}}
 */
export function satellitesOf(node) {
  /** @type {any[][]} */
  const befores = [];
  /** @type {any[][]} */
  const afters = [];
  const seen = new Set();
  for (let current = node; current && !seen.has(current); current = nextOnPath(current)) {
    seen.add(current);
    // A projection shows the satellites of its part, which is the next
    // node of the path.
    if (current.kind === "token" || current.kind === "projection") continue;
    const decorated = decoration(current);
    if (!decorated) continue;
    befores.push(decorated.before);
    afters.unshift(decorated.after);
  }
  return { before: befores.flat(), after: afters.flat() };
}

/**
 * The next node of a primary path: the part of a projection, the primary
 * of a rule or splice, or the node of an earlier stage that an input token
 * stands for.
 * @param {any} node
 * @returns {any}
 */
function nextOnPath(node) {
  if (node.kind === "projection") return node.part;
  if (node.kind === "rule" || node.kind === "splice") return node.primary ?? null;
  if (node.kind === "token") return node.input?.node ?? null;
  return null;
}

/**
 * Makes the faces of the units that the published tokens of a stage can
 * show: each satellite beside a primary, and each primary whose path
 * reaches satellites, as display reads them. A satellite needs an image,
 * and a failing recipe of a satellite fails the publication. No other
 * recipe runs, so an overridden recipe makes no verbatim claim. A satellite branch
 * with an emission list shows the units that its list selects, which
 * `listed` makes.
 * @param {any[]} tokens
 * @param {((node: any) => any[]) | null} [listed]
 */
export function publishFaces(tokens, listed = null) {
  /** @param {any} node @returns {any} the next node of a primary path, across stages */
  const next = node => node.kind === "projection" ? node.part :
    (node.kind === "rule" || node.kind === "splice") ? node.primary ?? null :
    node.kind === "token" ? node.input?.node ?? null : null;
  // Whether the primary path from a node reaches a unit with satellites.
  /** @param {any} start @param {boolean} self whether the node itself counts */
  const reaches = (start, self) => {
    for (let current = start, first = true; current; current = next(current), first = false) {
      if ((!first || self) && current.kind !== "token" && decoration(current, listed)) return true;
    }
    return false;
  };
  // Display shows the satellites of each unit, and the primary of a unit
  // only where its path reaches satellites. Only those units get a face,
  // so no other recipe runs. The faces are made in display order: the
  // tokens in order, and in each unit its satellites before, its primary,
  // then its satellites after (engine §11.3).
  /** @type {any[]} */
  const pending = tokens.map(token => token.node).filter(Boolean).reverse();
  const seen = new Set();
  while (pending.length) {
    const node = pending.pop();
    if (seen.has(node)) continue;
    seen.add(node);
    const decorated = decoration(node, listed);
    const base = node.kind === "projection" ? node.part : node;
    const primary = base && (base.kind === "rule" || base.kind === "splice") ? base.primary : null;
    const shown = primary && primary.kind !== "token" && reaches(primary, true) ? primary : null;
    /** @type {[any, boolean][]} */
    const units = [...(decorated?.before ?? []).map((/** @type {any} */ unit) => /** @type {[any, boolean]} */ ([unit, true])),
      ...(shown ? [/** @type {[any, boolean]} */ ([shown, false])] : []),
      ...(decorated?.after ?? []).map((/** @type {any} */ unit) => /** @type {[any, boolean]} */ ([unit, true]))];
    for (const [unit, satellite] of units) if (!FACES.has(unit)) FACES.set(unit, faceNow(unit, satellite));
    for (let index = units.length - 1; index >= 0; index--) pending.push(units[index][0]);
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
