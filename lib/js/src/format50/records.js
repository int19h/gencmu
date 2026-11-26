// The written DOM forms in Output formats, "A grammar DOM". A slot selects
// its forms. Within a slot, a form's identifying members select the form.
// The fields follow semantic traversal order. A string names the operand's
// slot. Scalar and name members have no operands.
/** @internal @typedef {true | 0 | string | typeof flag50} Field50 */
/** @internal @typedef {{slots: string[], fields: Record<string, Field50>, when: string[], tag?: string, open?: boolean}} Form50 */
const scalar50 = true;
const name50 = 0;
const flag50 = Symbol("true member");

/** @param {string} slots @param {string} when @param {Record<string, Field50>} fields
 *  @param {{ tag?: string, open?: boolean }} [options] @returns {Form50} */
function form50(slots, when, fields, options) {
  return { slots: slots.split(" "), when: when ? when.split(" ") : [], fields, ...options };
}

/** @type {Record<string, Field50>} */
const ruleFields50 = {
  name: name50, op: scalar50, term: "expression", alternatives: "alternative[]",
  conditions: "expression[]", error: "expression", warning: "expression",
  emit: "emission", suppressWarnings: name50, erased: flag50, at: scalar50,
};
/** @type {Record<string, Field50>} */
const entryPrefix50 = { kind: scalar50, gates: "gate[]", guard: "expression" };
/** @type {Record<string, Field50>} */
const outputPrefix50 = { gates: "gate[]", guard: "expression" };
/** @type {Record<string, Field50>} */
const position50 = { at: scalar50 };
/** @type {Record<string, Field50>} */
const exact50 = { exact: flag50, at: scalar50 };
/** @type {Record<string, Field50>} */
const pathFields50 = { name: scalar50, args: scalar50, at: scalar50 };

/** @type {Record<string, Form50>} */
const recordTable50 = {
  document: form50("document", "", { format: scalar50, rules: "rules[]", directives: "directives[]", constants: "constants[]" }),
  binding: form50("rules", "instance", { name: name50, op: scalar50, instance: "instance", conditions: "expression[]", at: scalar50 }),
  edit: form50("rules", "args", { args: "argument[]", ...ruleFields50 }),
  template: form50("rules", "params", { ...ruleFields50, params: name50 }),
  rule: form50("rules", "", ruleFields50),
  constant: form50("constants", "", { name: name50, op: scalar50, value: "expression", at: scalar50 }),
  stage: form50("directives", "name", { ...pathFields50, args: name50 }, { tag: "stage", open: true }),
  extendStage: form50("directives", "name", { ...pathFields50, args: name50 }, { tag: "extend-stage", open: true }),
  redefineStage: form50("directives", "name", { ...pathFields50, args: name50 }, { tag: "redefine-stage", open: true }),
  include: form50("directives", "name", pathFields50, { tag: "include", open: true }),
  names: form50("directives", "name", pathFields50, { tag: "names", open: true }),
  features: form50("directives", "name", { ...pathFields50, args: name50, conditions: "expression[]" }, { tag: "features", open: true }),
  elisionPolicy: form50("directives", "name", pathFields50, { tag: "elision-only", open: true }),
  resolution: form50("directives", "name", { name: scalar50, steps: "step[]", at: scalar50 }, { tag: "ambiguity-resolution", open: true }),
  step: form50("step", "step", { step: name50, pattern: "resolutionPattern" }),
  alternative: form50("alternative", "expr gates", { gates: "gate[]", expr: "body", term: "expression" }),
  emission: form50("emission", "items", { items: "output[]" }),
  insert: form50("output", "insert", { ...outputPrefix50, insert: flag50, term: "expression", at: scalar50 }),
  braced: form50("output", "capture term", { ...outputPrefix50, capture: name50, term: "expression", at: scalar50 }),
  forward: form50("output", "capture gates", { ...outputPrefix50, capture: name50, at: scalar50 }),
  gate: form50("gate", "kind", { feature: name50, kind: scalar50, negated: scalar50 }, { tag: "gate" }),
  bare: form50("bagEntry", "kind", { ...entryPrefix50, key: name50, at: scalar50 }, { tag: "bare" }),
  write: form50("bagEntry", "kind", { ...entryPrefix50, keys: name50, value: "expression", at: scalar50 }, { tag: "write" }),
  copy: form50("bagEntry", "kind", { ...entryPrefix50, source: "expression", key: name50, at: scalar50 }, { tag: "copy" }),
  delete: form50("bagEntry", "kind", { ...entryPrefix50, key: name50, at: scalar50 }, { tag: "delete" }),
  splat: form50("bagEntry listItem", "kind", { ...entryPrefix50, value: "expression", at: scalar50 }, { tag: "splat" }),
  item: form50("listItem", "kind", { ...entryPrefix50, value: "expression", at: scalar50 }, { tag: "item" }),

  sequence: form50("body", "seq", { seq: "body[]" }),
  choice: form50("body", "choice", { choice: "body[]" }),
  ranked: form50("body", "ranked", { ranked: "body[]" }),
  subset: form50("body", "and", { and: "body[]" }),
  elidable: form50("body", "optional elidable", { optional: "body", elidable: flag50, default: "stringTerm" }),
  optional: form50("body", "optional", { optional: "body" }),
  chain: form50("body", "repeat chain", { repeat: "body", separator: "body", chain: scalar50 }),
  repeat: form50("body", "repeat", { repeat: "body", separator: "body" }),
  reference: form50("body spliceTarget", "ref", { ref: name50 }),
  literal: form50("body", "literal", { literal: "stringTerm" }),
  literalArgument: form50("argument", "literal", { literal: "stringTerm", ...position50 }),
  range: form50("body", "range", { range: "stringTerm[]" }),
  rangeArgument: form50("argument", "range", { range: "stringTerm[]", ...position50 }),
  wildcard: form50("body", "wildcard", { wildcard: flag50 }),
  wildcardArgument: form50("argument", "wildcard", { wildcard: flag50, ...position50 }),
  empty: form50("body", "empty", { empty: flag50 }),
  remainder: form50("body", "remainder", { remainder: flag50 }),
  splice: form50("body", "splice", { splice: "spliceTarget" }),
  spliceArgument: form50("argument", "splice", { splice: "spliceTarget", ...position50 }),
  captureSymbol: form50("body", "capture expr", { capture: name50, expr: "body" }),
  primary: form50("body", "primary", { primary: "body" }),
  bodyTags: form50("body argument", "test", { test: scalar50, expr: "body", requirements: "requirement[]", at: scalar50 }, { tag: "tags" }),
  bodyTest: form50("body argument", "test", { test: scalar50, expr: "body", value: "stringTerm", at: scalar50 }),
  call: form50("body argument target methodArgument instance spliceTarget", "call", { call: name50, args: "argument[]", at: scalar50 }),
  parameter: form50("body argument target methodArgument expression selector stringTerm requirementValue", "param", { param: name50, at: scalar50 }),
  expressionArgument: form50("argument", "expression", { expression: "expression", at: scalar50 }),
  ruleArgument: form50("argument", "rule", { rule: name50, ...position50 }),
  ruleTarget: form50("target methodArgument", "rule", { rule: name50 }),
  tagArgument: form50("argument", "tag", { tag: name50, ...position50 }),
  tagRequirement: form50("requirementValue", "tag", { tag: name50 }),
  terminalTarget: form50("target methodArgument", "terminal", { terminal: name50 }),
  bodyArgument: form50("argument", "body", { body: "body", ...position50 }),
  query: form50("methodArgument", "body", { body: "body" }),
  targetsArgument: form50("argument", "targets", { targets: "target[]", at: scalar50 }),
  requirementsArgument: form50("argument", "requirements", { requirements: "requirement[]", at: scalar50 }),
  requirement: form50("requirement", "negated value", { negated: scalar50, value: "requirementValue" }),
  keyArgument: form50("methodArgument", "key", { key: name50 }),

  conditional: form50("expression methodArgument", "if else", { if: "expression", then: "expression", else: "expression", at: scalar50 }),
  implication: form50("expression methodArgument", "if", { if: "expression", then: "expression", at: scalar50 }),
  lambda: form50("expression methodArgument selector", "lambda body", { lambda: name50, body: "expression", at: scalar50 }),
  disjunction: form50("expression methodArgument", "any", { any: "expression[]", at: scalar50 }),
  conjunction: form50("expression methodArgument", "all", { all: "expression[]", at: scalar50 }),
  negation: form50("expression methodArgument", "not", { not: "expression", at: scalar50 }),
  comparison: form50("expression methodArgument", "op", { op: scalar50, left: "expression", right: "expression", at: scalar50 }),
  union: form50("expression methodArgument", "union", { union: "expression[]", at: scalar50 }),
  intersection: form50("expression methodArgument", "intersection", { intersection: "expression[]", at: scalar50 }),
  difference: form50("expression methodArgument", "difference", { difference: "expression[]", at: scalar50 }),
  concat: form50("expression methodArgument", "concat", { concat: "expression[]", at: scalar50 }),
  flatten: form50("expression methodArgument", "flatten", { flatten: "expression", at: scalar50 }),
  property: form50("expression methodArgument", "property receiver", { property: name50, receiver: "expression", at: scalar50 }),
  method: form50("expression methodArgument", "method receiver", { method: name50, receiver: "expression", args: "methodArgument[]", at: scalar50 }),
  shortProperty: form50("selector", "property", { property: name50, at: scalar50 }),
  shortMethod: form50("selector", "method", { method: name50, args: "methodArgument[]", at: scalar50 }),
  map: form50("expression methodArgument", "map", { map: "expression", by: "selector", at: scalar50 }),
  capture: form50("expression methodArgument selector", "capture", { capture: name50 }),
  constantReference: form50("expression methodArgument selector stringTerm requirementValue resolutionPattern", "const", { const: name50, at: scalar50 }),
  application: form50("expression methodArgument", "apply", { apply: name50, arg: "expression", at: scalar50 }),
  string: form50("expression methodArgument stringTerm", "string", { string: scalar50 }),
  integer: form50("expression methodArgument", "integer", { integer: scalar50 }),
  pattern: form50("expression methodArgument", "pattern", { pattern: "pattern" }),
  emptyPattern: form50("expression methodArgument", "emptySet", { emptySet: flag50 }),
  implicitItem: form50("expression methodArgument", "item", { item: flag50 }),
  bag: form50("expression methodArgument", "bag", { bag: "bagEntry[]" }),
  list: form50("expression methodArgument", "list", { list: "listItem[]" }),

  exactBareChildren: form50("pattern resolutionPattern", "any children exact", { any: flag50, exact: flag50, children: "childItem[]" }),
  bareChildren: form50("pattern resolutionPattern", "any children", { any: flag50, children: "childItem[]" }),
  patternName: form50("pattern patternAtom resolutionPattern", "name", { name: name50, ...exact50, children: "childItem[]" }),
  patternCallWithChildren: form50("pattern resolutionPattern", "call children", { call: name50, args: "argument[]", ...exact50, children: "childItem[]" }),
  patternCall: form50("pattern patternAtom resolutionPattern", "call", { call: name50, args: "argument[]", ...exact50 }),
  patternParameterWithChildren: form50("pattern resolutionPattern", "param children", { param: name50, ...exact50, children: "childItem[]" }),
  patternParameter: form50("pattern patternAtom resolutionPattern", "param", { param: name50, ...exact50 }),
  patternTerminal: form50("pattern patternAtom resolutionPattern", "terminal", { terminal: name50, ...exact50 }),
  patternLiteral: form50("pattern patternAtom resolutionPattern", "literal", { literal: "stringTerm", ...exact50 }),
  patternRange: form50("pattern patternAtom resolutionPattern", "range", { range: "stringTerm[]", ...exact50 }),
  patternWildcard: form50("pattern patternAtom resolutionPattern", "wildcard", { wildcard: flag50, ...exact50 }),
  patternConstant: form50("pattern patternAtom resolutionPattern", "constant", { constant: name50, ...exact50 }),
  patternTags: form50("pattern patternAtom resolutionPattern", "test", { test: scalar50, expr: "patternAtom", requirements: "requirement[]", ...exact50 }, { tag: "tags" }),
  patternTest: form50("pattern resolutionPattern", "test", { test: scalar50, expr: "patternAtom", value: "stringTerm", ...exact50 }),
  patternUnion: form50("pattern resolutionPattern", "union", { union: "pattern[]", ...position50 }),
  patternIntersection: form50("pattern resolutionPattern", "intersection", { intersection: "pattern[]", ...position50 }),
  patternDifference: form50("pattern resolutionPattern", "difference", { difference: "pattern[]", ...position50 }),
  patternPath: form50("pattern resolutionPattern", "path pattern", { path: scalar50, pattern: "pattern" }),
  child: form50("childItem", "child", { child: "pattern" }),
  siblings: form50("childItem", "siblings", { siblings: flag50 }),
  childOptional: form50("childItem", "optional", { optional: "childItem[]" }),
  childRepeatSeparated: form50("childItem", "repeat separator", { repeat: "childItem[]", separator: "childItem[]" }),
  childRepeat: form50("childItem", "repeat", { repeat: "childItem[]" }),
  childChoice: form50("childItem", "choice", { choice: "childItem[][]" }),
};

/** @internal @typedef {{kind: string, when: string[], tag?: string, members: Set<string>, names: string[],
 *             operands: [string, string][], flags: string[], open?: boolean}} Record50 */
/** @type {Map<string, Record50[]>} */
const recordSlots50 = new Map();
for (const [kind, form] of Object.entries(recordTable50)) {
  const entries = Object.entries(form.fields);
  const record = {
    kind, when: form.when, tag: form.tag, open: form.open,
    members: new Set(entries.map(([key]) => key)),
    names: entries.filter(([, field]) => field === name50).map(([key]) => key),
    flags: entries.filter(([, field]) => field === flag50).map(([key]) => key),
    operands: /** @type {[string, string][]} */ (entries.filter(([, field]) => typeof field === "string")),
  };
  for (const slot of form.slots) {
    const records = recordSlots50.get(slot) ?? [];
    if (slot === "patternAtom") {
      const members = new Set(record.members);
      members.delete("exact");
      members.delete("children");
      records.push({ ...record, members, operands: record.operands.filter(([key]) => key !== "children") });
    } else records.push(record);
    recordSlots50.set(slot, records);
  }
  // The local semantic walks receive known structural subtrees. A host or a
  // more specific form wins before a form that shares its leading member.
  if (!["document", "rules", "directives", "constants"].some(slot => form.slots.includes(slot))) {
    const records = recordSlots50.get("operand") ?? [];
    records.push(record);
    recordSlots50.set("operand", records);
  }
}
/** @type {Map<string, Map<string, Record50[]>>} */
const recordDispatch50 = new Map();
for (const [slot, records] of recordSlots50) {
  records.sort((a, b) => b.when.length - a.when.length || Number(b.tag !== undefined) - Number(a.tag !== undefined));
  /** @type {Map<string, Record50[]>} */
  const groups = new Map();
  for (const record of records) {
    const field = record.when[0] ?? "";
    const group = groups.get(field) ?? [];
    group.push(record);
    groups.set(field, group);
  }
  recordDispatch50.set(slot, groups);
}

/** @param {any} node @param {string} [slot] */
function describeRecord50(node, slot = "operand") {
  for (const [field, records] of recordDispatch50.get(slot) ?? []) {
    if (field && !Object.hasOwn(node, field)) continue;
    for (const record of records) {
      if ((record.tag === undefined || node[field] === record.tag) &&
          record.when.every(key => Object.hasOwn(node, key))) return record;
    }
  }
}

/**
 * @internal
 * @param {any} node
 * @param {string} [slot]
 * @returns {any} the name of the form, or undefined for none
 */
export function recordKind50(node, slot) {
  return node && typeof node === "object" && !Array.isArray(node) ? describeRecord50(node, slot)?.kind : undefined;
}

/** @internal @param {any} node @param {string} [slot] @returns {[string, any, string?][]} */
export function operandFields50(node, slot) {
  if (Array.isArray(node)) {
    const item = slot?.endsWith("[]") ? slot.slice(0, -2) : slot;
    return Array.from(node.entries(), ([index, child]) => [String(index), child, item]);
  }
  const record = describeRecord50(node, slot);
  /** @type {[string, any, string?][]} */
  const children = [];
  for (const [key, operand] of record?.operands ?? []) {
    const child = node[key];
    if (child && typeof child === "object" && Object.hasOwn(node, key)) children.push([key, child, operand]);
  }
  return children;
}

/** @internal @param {any} node @param {string} [slot] */
export function nameFields50(node, slot) {
  return describeRecord50(node, slot)?.names ?? [];
}

// The constraints of each form beyond its member names ("A grammar DOM"):
// the members that it needs, the values of its scalar members, the bounds
// of its arrays, and the forms that some operands take.
/** @internal @typedef {{required?: string[], values?: Record<string, any[]>, types?: Record<string, string>,
 *   min?: Record<string, number>, max?: Record<string, number>, kinds?: Record<string, string[]>,
 *   notKinds?: Record<string, string[]>}} Constraint50 */
const COMPOSITE_BODY50 = ["sequence", "choice", "ranked", "subset", "optional", "elidable", "repeat", "chain"];
const COMPARATORS50 = ["=", "≠", "<", "≤", ">", "≥", "∈", "∉", "⊆", "⊈", "≅", "≇", "+"];
const ENTRY50 = { required: ["kind", "gates", "at"] };
const RULE50 = { required: ["name", "op", "alternatives", "conditions", "at"], values: { op: ["define", "extend", "redefine"] },
  min: { alternatives: 1 }, kinds: { term: ["bag"] } };
/** @type {Record<string, Constraint50>} */
const constraints50 = {
  document: { required: ["format", "rules", "directives", "constants"], values: { format: [50] } },
  rule: RULE50,
  template: { ...RULE50, min: { alternatives: 1, params: 1 } },
  edit: { ...RULE50, min: { alternatives: 1, args: 1 } },
  binding: { required: ["name", "op", "instance", "conditions", "at"], max: { conditions: 0 } },
  constant: { required: ["name", "op", "value", "at"], values: { op: ["define", "redefine"] } },
  alternative: { required: ["gates", "expr"], kinds: { term: ["bag"] } },
  insert: { required: ["gates", "insert", "term", "at"], kinds: { term: ["bag"] } },
  braced: { required: ["gates", "capture", "term", "at"], kinds: { term: ["bag"] } },
  forward: { required: ["gates", "capture", "at"] },
  gate: { required: ["feature", "kind", "negated"], types: { negated: "boolean" } },
  bare: ENTRY50, copy: ENTRY50, delete: ENTRY50, splat: ENTRY50, item: ENTRY50,
  write: { ...ENTRY50, min: { keys: 1 } },
  sequence: { min: { seq: 2 } }, choice: { min: { choice: 2 } }, ranked: { min: { ranked: 2 } }, subset: { min: { and: 2 } },
  range: { min: { range: 2 }, max: { range: 2 } },
  rangeArgument: { min: { range: 2 }, max: { range: 2 } },
  chain: { values: { chain: ["left", "right"] } },
  bodyTags: { notKinds: { expr: ["bodyTags", "bodyTest", ...COMPOSITE_BODY50] } },
  bodyTest: { values: { test: ["=", "≠"] }, notKinds: { expr: ["bodyTest", ...COMPOSITE_BODY50] } },
  requirement: { required: ["negated", "value"], types: { negated: "boolean" } },
  call: { min: { args: 1 } },
  targetsArgument: { min: { targets: 2 } },
  string: { types: { string: "string" } },
  integer: { types: { integer: "string" } },
  disjunction: { min: { any: 2 } }, conjunction: { min: { all: 2 } }, union: { min: { union: 2 } },
  concat: { required: ["at"], min: { concat: 2 } },
  intersection: { min: { intersection: 2 } },
  difference: { min: { difference: 2 }, max: { difference: 2 } },
  comparison: { values: { op: COMPARATORS50 } },
  patternLiteral: { kinds: { literal: ["string"] } },
  patternTags: { notKinds: { expr: ["patternTags", "patternTest"] } },
  patternTest: { values: { test: ["=", "≠"] }, notKinds: { expr: ["patternTest"] } },
  patternPath: { values: { path: ["descendant", "first", "last"] } },
  patternUnion: { min: { union: 2 } }, patternIntersection: { min: { intersection: 2 } },
  patternDifference: { min: { difference: 2 }, max: { difference: 2 } },
  childChoice: { min: { choice: 2 } }, childRepeat: { min: { repeat: 1 } }, childOptional: { min: { optional: 1 } },
};

/** @param {string} word the word with its article */
const an50 = word => (/^[aeiou]/.test(word) ? "an " : "a ") + word;

/**
 * The fault of a record against the constraints of its form, or undefined.
 * @param {any} node
 * @param {Record50} record
 */
function constraintFault50(node, record) {
  const constraint = constraints50[record.kind];
  // A position is a line and a column, each a positive integer.
  if (Object.hasOwn(node, "at") && !(Array.isArray(node.at) && node.at.length === 2 && node.at.every((/** @type {any} */ part) => Number.isInteger(part) && part > 0))) {
    return `${an50(record.kind)} record has an invalid position`;
  }
  if (!constraint) return undefined;
  for (const key of constraint.required ?? []) if (!Object.hasOwn(node, key)) return `${an50(record.kind)} record needs "${key}"`;
  for (const [key, values] of Object.entries(constraint.values ?? {})) {
    if (Object.hasOwn(node, key) && !values.includes(node[key])) return `"${key}" of ${an50(record.kind)} record cannot be ${JSON.stringify(node[key])}`;
  }
  for (const [key, type] of Object.entries(constraint.types ?? {})) {
    if (Object.hasOwn(node, key) && typeof node[key] !== type) return `"${key}" of ${an50(record.kind)} record needs ${an50(type)}`;
  }
  for (const [key, least] of Object.entries(constraint.min ?? {})) {
    if (Array.isArray(node[key]) && node[key].length < least) return `"${key}" of ${an50(record.kind)} record needs at least ${least} ${least === 1 ? "item" : "items"}`;
  }
  for (const [key, most] of Object.entries(constraint.max ?? {})) {
    if (Array.isArray(node[key]) && node[key].length > most) return `"${key}" of ${an50(record.kind)} record takes at most ${most} ${most === 1 ? "item" : "items"}`;
  }
  const operand = (/** @type {string} */ key) => record.operands.find(([name]) => name === key)?.[1];
  for (const [key, kinds] of Object.entries(constraint.kinds ?? {})) {
    if (!Object.hasOwn(node, key)) continue;
    const kind = describeRecord50(node[key], operand(key))?.kind;
    if (!kinds.includes(/** @type {string} */ (kind))) return `"${key}" of ${an50(record.kind)} record needs ${an50(kinds.join(" or "))} record`;
  }
  for (const [key, kinds] of Object.entries(constraint.notKinds ?? {})) {
    if (!Object.hasOwn(node, key)) continue;
    const kind = describeRecord50(node[key], operand(key))?.kind;
    if (kinds.includes(/** @type {string} */ (kind))) return `"${key}" of ${an50(record.kind)} record cannot be ${an50(String(kind))} record`;
  }
  return undefined;
}

/** @internal @param {any} node @param {string} slot */
export function memberFault50(node, slot) {
  if (slot.endsWith("[]")) return Array.isArray(node) ? undefined : `a ${slot.slice(0, -2)} list needs an array`;
  if (!node || typeof node !== "object" || Array.isArray(node)) return `a ${slot} needs a record`;
  const record = describeRecord50(node, slot);
  if (!record) return `invalid ${slot} record`;
  if (!record.open) {
    let extra;
    for (const key of Object.keys(node)) {
      if (!record.members.has(key) && (extra === undefined || key < extra)) extra = key;
    }
    if (extra === "children" && (slot === "pattern" || slot === "patternAtom" || slot === "resolutionPattern")) {
      return "only an untested rule atom, call or parameter can have a child list";
    }
    if (extra !== undefined) return `unknown member "${extra}" on a ${record.kind} record`;
  }
  for (const key of record.flags) {
    if (Object.hasOwn(node, key) && node[key] !== true) return `"${key}" must be true on a ${record.kind} record`;
  }
  for (const [key, operand] of record.operands) {
    if (!Object.hasOwn(node, key)) continue;
    const child = node[key];
    if (!child || typeof child !== "object" || Array.isArray(child) !== operand.endsWith("[]")) {
      return `invalid operand "${key}" on a ${record.kind} record`;
    }
  }
  return constraintFault50(node, record);
}

/** @internal */
export const recordKinds50 = Object.keys(recordTable50);
