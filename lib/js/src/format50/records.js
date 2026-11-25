// Walk written operands in semantic order. A declaration's array supplies its
// category. In particular, a directive's name supplies its record shape and any
// other members belong to its opaque extension data.
/** @param {string[]} operands @param {string[]} names */
const recordShapeFields50 = (operands = [], names = []) => ({ operands, names });
const leafFields50 = recordShapeFields50();
/** @param {string} field */
const namedLeaf50 = field => recordShapeFields50([], [field]);
/** @param {string} field */
const singleOperand50 = field => recordShapeFields50([field]);
const recordShapes50 = {
  document: recordShapeFields50(["rules", "directives", "constants"]),
  rule: recordShapeFields50(["term", "alternatives", "conditions", "error", "warning", "emit"], ["name", "suppressWarnings"]),
  template: recordShapeFields50(["term", "alternatives", "conditions", "error", "warning", "emit"], ["name", "params", "suppressWarnings"]),
  edit: recordShapeFields50(["args", "term", "alternatives", "conditions", "error", "warning", "emit"], ["name", "suppressWarnings"]),
  binding: recordShapeFields50(["instance", "conditions"], ["name"]),
  constant: recordShapeFields50(["value"], ["name"]),
  stage: recordShapeFields50([], ["args"]),
  features: recordShapeFields50(["conditions"], ["args"]),
  resolution: singleOperand50("steps"),
  step: recordShapeFields50(["pattern"], ["step"]),
  alternative: recordShapeFields50(["gates", "expr", "term"]),
  emission: singleOperand50("items"),
  insert: recordShapeFields50(["gates", "guard", "term"]),
  forward: recordShapeFields50(["gates", "guard"], ["capture"]),
  braced: recordShapeFields50(["gates", "guard", "term"], ["capture"]),
  gate: namedLeaf50("feature"),
  bare: recordShapeFields50(["gates", "guard"], ["key"]),
  delete: recordShapeFields50(["gates", "guard"], ["key"]),
  copy: recordShapeFields50(["gates", "guard", "source"], ["key"]),
  write: recordShapeFields50(["gates", "guard", "value"], ["keys"]),
  splat: recordShapeFields50(["gates", "guard", "value"]),
  item: recordShapeFields50(["gates", "guard", "value"]),
  call: recordShapeFields50(["args"], ["call"]),
  test: recordShapeFields50(["expr", "value"]),
  tags: recordShapeFields50(["expr", "requirements"]),
  requirement: singleOperand50("value"),
  captureSymbol: recordShapeFields50(["expr"], ["capture"]),
  optional: singleOperand50("optional"),
  elidable: recordShapeFields50(["optional", "default"]),
  repeat: recordShapeFields50(["repeat", "separator"]),
  conditional: recordShapeFields50(["if", "then", "else"]),
  comparison: recordShapeFields50(["left", "right"]),
  method: recordShapeFields50(["receiver", "args"], ["method"]),
  property: recordShapeFields50(["receiver"], ["property"]),
  map: recordShapeFields50(["map", "by"]),
  lambda: recordShapeFields50(["body"], ["lambda"]),
  apply: recordShapeFields50(["arg"], ["apply"]),
  patternCall: recordShapeFields50(["args", "children"], ["call"]),
  patternName: recordShapeFields50(["children"], ["name"]),
  patternParam: recordShapeFields50(["children"], ["param"]),
};

const operatorFields50 = ["any", "all", "not", "union", "intersection", "difference", "concat", "flatten", "bag", "list"];
const bodyFields50 = ["primary", "splice", "seq", "choice", "ranked", "and", "literal", "range"];
const wrapperFields50 = ["targets", "requirements", "body", "expression", "pattern", "child"];
const operandShapes50 = new Map([...operatorFields50, ...bodyFields50, ...wrapperFields50].map(key => [key, singleOperand50(key)]));
const nameShapes50 = new Map(["const", "constant", "param", "ref", "rule", "tag", "terminal", "key", "capture"]
  .map(key => [key, namedLeaf50(key)]));
const stageNames50 = new Set(["stage", "extend-stage", "redefine-stage"]);

/** @param {any} node @param {string} [category] */
function recordShape50(node, category) {
  if (category === "document") return recordShapes50.document;
  if (category === "rules") {
    if (node.instance) return recordShapes50.binding;
    if (node.args) return recordShapes50.edit;
    return node.params ? recordShapes50.template : recordShapes50.rule;
  }
  if (category === "constants") return recordShapes50.constant;
  if (category === "directives") {
    if (node.name === "features") return recordShapes50.features;
    if (node.name === "ambiguity-resolution") return recordShapes50.resolution;
    return stageNames50.has(node.name) ? recordShapes50.stage : leafFields50;
  }

  // Structural records have exclusive constructors. Use the constructor to
  // select operands, and use the surrounding slot for the output variants.
  if (category === "output" || Object.hasOwn(node, "insert") ||
      Object.hasOwn(node, "capture") && Object.hasOwn(node, "gates")) {
    return node.insert ? recordShapes50.insert : node.term ? recordShapes50.braced : recordShapes50.forward;
  }
  if (node.kind !== undefined) {
    const kind = /** @type {keyof typeof recordShapes50} */ (node.kind);
    switch (kind) {
      case "gate": case "bare": case "delete": case "copy": case "write": case "splat": case "item":
        return recordShapes50[kind];
      default: return leafFields50;
    }
  }
  if (Object.hasOwn(node, "items")) return recordShapes50.emission;
  if (Object.hasOwn(node, "step")) return recordShapes50.step;
  if (Object.hasOwn(node, "test")) return node.test === "tags" ? recordShapes50.tags : recordShapes50.test;
  if (Object.hasOwn(node, "negated")) return recordShapes50.requirement;
  if (Object.hasOwn(node, "expr")) return Object.hasOwn(node, "capture") ? recordShapes50.captureSymbol : recordShapes50.alternative;
  if (Object.hasOwn(node, "call")) return Object.hasOwn(node, "children") ? recordShapes50.patternCall : recordShapes50.call;
  if (Object.hasOwn(node, "name")) return recordShapes50.patternName;
  if (Object.hasOwn(node, "param")) return recordShapes50.patternParam;
  if (node.any === true) return bareChildren50;
  if (Object.hasOwn(node, "optional")) return node.elidable ? recordShapes50.elidable : recordShapes50.optional;
  if (Object.hasOwn(node, "repeat")) return recordShapes50.repeat;
  if (Object.hasOwn(node, "if")) return recordShapes50.conditional;
  if (Object.hasOwn(node, "op")) return recordShapes50.comparison;
  if (Object.hasOwn(node, "method")) return recordShapes50.method;
  if (Object.hasOwn(node, "property")) return recordShapes50.property;
  if (Object.hasOwn(node, "map")) return recordShapes50.map;
  if (Object.hasOwn(node, "lambda")) return recordShapes50.lambda;
  if (Object.hasOwn(node, "apply")) return recordShapes50.apply;
  for (const [key, form] of operandShapes50) if (Object.hasOwn(node, key)) return form;
  for (const [key, form] of nameShapes50) if (Object.hasOwn(node, key)) return form;
  return leafFields50;
}

const bareChildren50 = singleOperand50("children");

/** @internal @param {any} node @param {string} [category] @returns {[string, any, string?][]} */
export function operandFields50(node, category) {
  if (Array.isArray(node)) return Array.from(node.entries(), ([index, child]) => [String(index), child, category]);
  /** @type {[string, any, string?][]} */
  const children = [];
  const form = recordShape50(node, category);
  for (const key of form.operands) {
    const child = node[key];
    if (child && typeof child === "object" && Object.hasOwn(node, key)) {
      children.push([key, child, category === "document" ? key : key === "items" ? "output" : undefined]);
    }
  }
  return children;
}

/** @internal @param {any} node @param {string} [category] */
export function nameFields50(node, category) {
  return recordShape50(node, category).names;
}
