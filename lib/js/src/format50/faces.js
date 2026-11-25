// @ts-nocheck
// Display faces (part 2 §7). A published node with a primary shows its
// primary with satellites around it: the units that the branches beside the
// primary select. A branch selects the nodes that it would publish by
// itself. A node with no primary, or with no satellite, shows as one unit.

/**
 * The units that a subtree selects: rule nodes with bare emission and the
 * nodes of emission lists, in order. A rule without its own selection
 * forwards those of its children. Erasure selects nothing.
 * @param {any} root
 * @returns {any[]}
 */
export function selectedUnits(root) {
  const units = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if ((node.kind !== "rule" && node.kind !== "splice") || node.erased) continue;
    const emit = node.origin?.rule.emit;
    if (emit) {
      if (!emit.items.length) units.push(node);
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
 */
export function decoration(node) {
  const base = node.kind === "projection" ? node.part : node;
  if (!base || !base.primary || (base.kind !== "rule" && base.kind !== "splice")) return null;
  const index = base.children.indexOf(base.primary);
  if (index < 0) return null;
  const before = base.children.slice(0, index).flatMap(selectedUnits);
  const after = base.children.slice(index + 1).flatMap(selectedUnits);
  if (!before.length && !after.length) return null;
  return { before, after };
}

const CLASS_NAME = /^[A-Z](.*[A-Z])?$/;

/** The image and classes that a unit shows. */
export function unitFace(node) {
  const bag = node.bag();
  return {
    image: bag.value("image") ?? "",
    classes: bag.keys().filter(key => CLASS_NAME.test(key)).sort(),
  };
}
