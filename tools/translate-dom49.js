// Print format 50 source from the written format 49 records. A decision that
// depends on the intended grammar raises MigrationRequired at the old site.
import { termType } from "../lib/js/src/dom.js";
import { SPAN_METHODS } from "../lib/js/src/methods.js";
import { layeredPatternText } from "../lib/js/src/pattern-shapes.js";
import { stringName } from "../lib/js/src/tags.js";

const operators = {
  seq: " ", choice: " | ", ranked: " ≻ ", and: " & ",
  all: " ∧ ", any: " ∨ ", concat: " ++ ", union: " ∪ ", intersection: " ∩ ", difference: " ∖ ",
};
const precedence = { seq: 3, and: 2, choice: 1, ranked: 1 };
const bag = entries => `{${entries.join(", ")}}`;
const list = items => `[${items.join(", ")}]`;
const gate = item => (item.negated ? "¬" : "") + item.feature + "?";
const keyword = (op, noun) => `%${op === "define" ? "" : op + "-"}${noun}`;
const classifierName = name => `CLASSIFIER-${name}`;
const bareSymbol = node => ["ref", "call", "param", "literal", "range", "wildcard", "splice", "test", "capture"]
  .some(key => Object.hasOwn(node, key));

// Bound the position of every direct capture on all routes. The carrier must
// remain mandatory and siblings must occur in the written attachment order.
function attachmentOrder(node, order, carrier) {
  const optional = !node.elidable && node.optional?.capture;
  const capture = node.capture ?? (optional || undefined);
  if (capture !== undefined) {
    const index = order.indexOf(capture);
    if (capture === carrier && node.expr?.splice) return;
    if (index >= 0) return { first: index, last: index, mandatory: node.capture === carrier };
  }
  const children = node.seq ?? node.choice;
  if (!children) return;
  const parts = children.map(child => attachmentOrder(child, order, carrier));
  if (parts.some(part => !part)) return;
  if (node.seq && parts.some((part, i) => i > 0 && parts[i - 1].last >= part.first)) return;
  return {
    first: Math.min(...parts.map(part => part.first)),
    last: Math.max(...parts.map(part => part.last)),
    mandatory: node.seq ? parts.some(part => part.mandatory) : parts.every(part => part.mandatory),
  };
}

export class MigrationRequired extends Error {
  constructor(message, at) {
    super(message);
    this.at = at;
  }
}

export function translateDom49(dom, unicode, uniqueConstants, omittedValues = new Set(), isUndefined = () => false) {
  if (dom.format !== 49) throw new Error("The translator requires a format 49 DOM.");
  const printer = new Printer(dom, unicode, uniqueConstants, omittedValues, isUndefined);
  return printer.document(dom);
}

class Printer {
  constructor(dom, unicode, uniqueConstants, omittedValues, isUndefined) {
    this.unicode = unicode;
    this.constants = new Map(dom.constants
      .filter(item => item.op === "define" &&
        (uniqueConstants ? uniqueConstants.has(item.name) : dom.constants.filter(other => other.name === item.name).length === 1))
      .map(item => [item.name, item.value]));
    this.valueTypes = new Map();
    this.classifiers = new Set();
    this.spanReceiver = false;
    this.repeated = new Set();
    this.item = undefined;
    this.omittedValues = omittedValues;
    this.isUndefined = isUndefined;
  }

  hand(reason) {
    throw new MigrationRequired(reason, this.at);
  }

  type(node, active = new Set()) {
    const result = termType(node, name => {
      if (active.has(name) || !this.constants.has(name)) return "any";
      if (this.valueTypes.has(name)) return this.valueTypes.get(name);
      active.add(name);
      const type = this.type(this.constants.get(name), active);
      active.delete(name);
      this.valueTypes.set(name, type);
      return type;
    });
    return result.type ?? "any";
  }

  quote(value) {
    return stringName(value, this.unicode);
  }

  document(dom) {
    const kinds = { rules: "rule", directives: "directive", constants: "constant",
      classifiers: "classifier", implications: "implication" };
    const declarations = Object.entries(kinds).flatMap(([category, kind]) =>
      dom[category].map(item => ({ kind, item })))
      .sort((a, b) => a.item.at[0] - b.item.at[0] || a.item.at[1] - b.item.at[1]);
    return declarations.map(({ kind, item }) => {
      this.at = item.at;
      this.changes = [];
      const source = this[kind](item);
      return { from: item.at, identity: item.name ?? kind, source, changes: this.changes };
    });
  }

  directive(item) {
    if (item.steps) return `%${item.name} ${item.steps.map(({ step, pattern }) =>
      pattern ? `${step} ${pattern.const ? this.term(pattern) : this.patternLiteral(pattern)}` : step).join(", ")}`;
    const values = ["include", "names"].includes(item.name) ? item.args.map(arg => this.quote(arg)) : item.args;
    this.spanReceiver = item.name === "features";
    try {
      return [`%${item.name}`, ...values,
        ...(item.conditions?.length ? ["%conditions", item.conditions.map(node => this.term(node, "truth")).join(", ")] : [])].join(" ");
    } finally {
      this.spanReceiver = false;
    }
  }

  constant(item) {
    if (["DEFAULTS", "INPUTS", "OUTPUTS"].includes(item.name)) this.hand("Choose a new name for this reserved stage constant.");
    return `${keyword(item.op, "const")} $${item.name} ${this.term(item.value)}`;
  }

  classifier(item) {
    if (this.classifiers.has(item.name)) this.hand("Combine classifier declarations across their written layers.");
    this.classifiers.add(item.name);
    const classes = new Map();
    for (const row of item.entries) {
      if (row.op !== "∈") this.hand("Choose an explicit classifier for a complement row.");
      const earlier = classes.get(row.class);
      if (earlier && JSON.stringify(earlier.gates) !== JSON.stringify(row.gates)) {
        this.hand("Combine class rows with different gates without changing their order.");
      }
      if (!earlier) classes.set(row.class, { gates: row.gates, values: [] });
      const { values } = classes.get(row.class);
      for (const key of row.keys) {
        const type = this.type(key);
        if (type === "string") values.push(this.term(key));
        else if (type === "strings") values.push(`*${this.term(key)}`);
        else if (type === "set") continue;
        else if (key.const && row.keys.length === 1) values.push(this.term(key));
        else this.hand("Resolve the classifier row expression in its defining stage.");
      }
    }
    return `%const $${classifierName(item.name)} ${bag([...classes].map(([name, { gates, values }]) =>
      [...gates.map(gate), `${name}: ${values.length === 1 && !values[0].startsWith("*") ? values[0] : list(values)}`].join(" ")))}`;
  }

  implication() {
    this.hand("Apply the implication at its original suppliers or in the classifier.");
  }

  rule(item) {
    this.repeated = new Set();
    this.bindings = new Set();
    const scalar = new Set();
    const alternativesWithItem = [];
    const findRepeated = (node, local, inList = false) => {
      if (!node || typeof node !== "object") return;
      if (node.capture !== undefined) {
        this.bindings.add(node.capture);
        if (inList) {
          local.add(node.capture);
          this.repeated.add(node.capture);
        } else scalar.add(node.capture);
      }
      for (const [part, child] of Object.entries(node)) {
        findRepeated(child, local, inList || (part === "repeat" || part === "separator") && !node.chain);
      }
    };
    for (const alt of item.alternatives ?? []) {
      const local = new Set();
      findRepeated(alt.expr, local);
      alternativesWithItem.push(local);
    }
    this.sharedItems = [...this.repeated].filter(name => !scalar.has(name) && alternativesWithItem.every(local => local.has(name)));
    const head = [keyword(item.op, "rule"), item.name].join(" ") +
      (item.params ? `(${item.params.map(param => "@" + param).join(", ")})` :
        item.args ? `(${item.args.map(arg => this.argument(arg)).join(", ")})` : "");
    if (item.instance) return `${head} = ${this.call(item.instance)}`;
    const headerTerm = this.ownerTerm(item);
    const attachment = item.emit?.items.length === 1 && item.emit.items[0];
    const primary = attachment && (attachment.before?.length || attachment.after?.length) ?
      this.attachmentPrimary(attachment, item) : undefined;
    let rebuiltSingleton = false;
    const alternatives = item.alternatives.flatMap(alt => {
      const term = this.ownerTerm(alt, item.image !== undefined);
      const needPrimary = bareSymbol(alt.expr) &&
        primary === undefined && (headerTerm !== undefined || term !== undefined) &&
        item.tags === undefined && alt.tags === undefined;
      const parent = item.alternatives.length > 1 && alt.expr.ranked ? "choice" : undefined;
      const body = (needPrimary ? "^" : "") + this.body(alt.expr, parent, primary);
      const selectsWhole = item.emit && (!item.emit.items.length ||
        item.emit.items.length === 1 && item.emit.items[0].capture === "");
      if (selectsWhole && item.alternatives.length === 1 && !item.conditions.length &&
          headerTerm === undefined && term === undefined && !alt.gates.length) {
        if (alt.expr.optional?.ref && !alt.expr.elidable) {
          rebuiltSingleton = true;
          this.changes.push("Write the optional as two routes. The one-symbol route keeps its input bag.");
          return ["ε", alt.expr.optional.ref];
        }
        const repeated = alt.expr.optional?.repeat ?? alt.expr.repeat;
        const repeat = alt.expr.optional ?? alt.expr;
        if (repeated?.wildcard && !repeat.chain && !repeat.separator && !alt.expr.elidable) {
          rebuiltSingleton = true;
          this.changes.push("Distinguish zero, one and at least two symbols. Only the one-symbol route copies an input bag.");
          return [...(alt.expr.optional ? ["ε"] : []), "_", "_ _ [{_}]"];
        }
      }
      return [...alt.gates.map(gate), body, ...(term === undefined ? [] : ["→", term])].join(" ");
    });
    const lines = [head + (headerTerm === undefined ? "" : ` → ${headerTerm}`)];
    if (headerTerm !== undefined || alternatives.length > 1) {
      for (const alt of alternatives) lines.push(`  | ${alt}`);
    } else {
      lines[0] += ` ${alternatives[0]}`;
    }
    if (item.conditions.length) lines.push(`%conditions ${item.conditions.map(node => this.condition(node)).join(", ")}`);
    if (item.error) lines.push(`%error ${this.term(item.error)}`);
    if (item.warning) lines.push(`%warning ${this.term(item.warning)}`);
    if (item.suppressWarnings) lines.push(`%suppress-warnings ${item.suppressWarnings.join(", ")}`);
    if (item.erased) lines.push("%erased");
    if (primary !== undefined) {
      lines.push("%emit");
    } else if (item.emit) {
      const whole = !item.emit.items.length ||
        item.emit.items.some(output => output.capture === "" && output.tags === undefined);
      if (whole && !rebuiltSingleton && item.tags === undefined && item.alternatives.some(alt => alt.tags === undefined &&
          (alt.expr.repeat || alt.expr.optional || alt.expr.ranked || alt.expr.and))) {
        this.hand("A singleton route can inherit keys in the old publication. Establish its format 50 bag and cover.");
      }
      lines.push(this.emission(item.emit));
    }
    return lines.join("\n");
  }

  attachmentPrimary(output, rule) {
    const order = [...output.before ?? [], output.capture, ...output.after ?? []];
    if (output.tags !== undefined || output.value || output.image ||
        rule.tags !== undefined || rule.value || rule.image || rule.erased) {
      this.hand("Inspect the attachment cover and preserve its selected carrier, children and output strings.");
    }
    for (const alt of rule.alternatives) {
      if (alt.tags !== undefined || alt.value || alt.image ||
          !attachmentOrder(alt.expr, order, output.capture)?.mandatory) {
        this.hand("Inspect the attachment cover and preserve its selected carrier, children and output strings.");
      }
    }
    this.changes.push("The old carrier supplies the primary. The parent covers the whole route, and the selected siblings supply display parts.");
    return output.capture;
  }

  condition(node) {
    const names = new Set();
    const pending = [node];
    let local = "item";
    const used = new Set();
    while (pending.length) {
      const part = pending.pop();
      if (!part || typeof part !== "object") continue;
      const name = part.capture ?? part.captured;
      if (name !== undefined) {
        used.add(name);
        if (this.repeated.has(name)) names.add(name);
      }
      for (const child of Object.values(part)) pending.push(child);
    }
    if (!names.size) return this.term(node, "truth");
    if (names.size !== 1 || used.has("") || !this.sharedItems.includes(names.values().next().value)) {
      this.hand("Preserve the item frame and its co-bound operands.");
    }
    const [name] = names;
    while (used.has(local) || this.repeated.has(local) || this.bindings.has(local)) local += "-item";
    this.item = { name, local };
    try {
      const term = this.term(node, "truth");
      this.changes.push("Use an ordered universal predicate over the item capture. It tests each reached item with its outer bindings.");
      return `$${name}.all($${local} ↦ ${term})`;
    } finally {
      this.item = undefined;
    }
  }


  ownerTerm(owner, inheritedImage = false, insertion = false) {
    const entries = [];
    const direct = new Set();
    for (const entry of owner.tags === undefined ? [] : this.tagEntries(owner.tags)) {
      entries.push(direct.has(entry) ? `*{${entry}}` : entry);
      if (/^[A-Z][A-Za-z0-9_-]*$/.test(entry)) direct.add(entry);
    }
    if (owner.value && !owner.image && !inheritedImage) {
      entries.push(`image: value: ${this.term(owner.value)}`);
    } else {
      if (owner.value) entries.push(`value: ${this.term(owner.value)}`);
      if (owner.image) entries.push(`image: ${this.term(owner.image)}`);
    }
    if (insertion) {
      if (!owner.value && !owner.image) entries.push('image: value: ""');
      else if (!owner.value) entries.push('value: ""');
    }
    return owner.tags !== undefined || entries.length ? bag(entries) : undefined;
  }

  tagEntries(node) {
    if (node.emptySet) return [];
    if (node.tag !== undefined) return [node.tag];
    if (node.union) return node.union.flatMap(child => this.tagEntries(child));
    if (node.if) {
      const guard = `(${this.term(node.if)})?`;
      const entries = this.tagEntries(node.then);
      if (entries.some(entry => entry.startsWith("("))) {
        this.changes.push("Keep nested tag guards in a guarded splat so each entry has one guard.");
        return [`${guard} *${bag(entries)}`];
      }
      return entries.map(entry => `${guard} ${entry}`);
    }
    return [`*${this.term(node)}`];
  }

  emission({ items }) {
    const only = items[0];
    if (items.length === 0 || items.length === 1 && only.capture === "" && this.ownerTerm(only) === undefined) return "%emit";
    return `%emit ${items.map(item => {
      if (item.before?.length || item.after?.length) this.hand("Move attachment captures into the selected node or its children.");
      const term = this.ownerTerm(item, false, item.insert);
      if (item.insert) return `ε${term}`;
      if (item.tags !== undefined) return `$${item.capture}${term}`;
      const entries = [`*$${item.capture}`];
      if (item.value && !item.image) entries.push(`image: value: ${this.term(item.value)}`);
      else {
        if (item.value) entries.push(`value: ${this.term(item.value)}`);
        if (item.image) entries.push(`image: ${this.term(item.image)}`);
      }
      return `$${item.capture}${bag(entries)}`;
    }).join(", ")}`;
  }

  body(node, parent, primary) {
    for (const kind of ["seq", "and", "choice", "ranked"]) {
      if (!node[kind]) continue;
      const text = node[kind].map(child => this.body(child, kind, primary)).join(operators[kind]);
      return parent && precedence[kind] <= precedence[parent] ? `(${text})` : text;
    }
    if (node.optional) {
      const [head, ...tail] = node.optional.seq ?? [node.optional];
      if (!node.elidable) return `[${this.body(node.optional, undefined, primary)}]`;
      const value = node.default === undefined ? "" : ` ≝ ${this.operand(node.default)}`;
      if (head.capture !== undefined) return `[$${head.capture}:+${this.body(head.expr)}${value}]`;
      return `[+${[this.body(head) + value, ...tail.map(child => this.body(child, "seq"))].join(" ")}]`;
    }
    if (node.repeat) {
      const left = node.chain === "left" ? "... " : "";
      const right = node.chain === "right" ? " ..." : "";
      return `{${left}${this.body(node.repeat)}${right}${node.separator ? " / " + this.body(node.separator) : ""}}`;
    }
    if (node.capture !== undefined) return `${node.capture === primary ? "^" : ""}$${node.capture}:${this.body(node.expr)}`;
    if (node.splice) return `*${this.body(node.splice)}`;
    if (node.test) return this.body(node.expr) +
      (node.test === "tags" ? this.requirements(node.requirements) : node.test + this.operand(node.value));
    if (node.literal) return this.operand(node.literal);
    if (node.range) return node.range.map(value => this.operand(value)).join("..");
    if (node.ref) return node.ref;
    if (node.empty) return "ε";
    if (node.wildcard) return "_";
    if (node.remainder) return "…";
    if (node.call) return this.call(node);
    if (node.param) return "@" + node.param;
    this.hand("Preserve an unrecognized body record.");
  }

  requirements(items) {
    return `<${items.map(item => (item.negated ? "¬" : "") + this.operand(item.value)).join(" ")}>`;
  }

  operand(value) {
    if (value.tag) return value.tag;
    if (value.call) return this.call(value);
    if (value.param) return `@${value.param}`;
    if (value.const) return `$${value.const}`;
    if (typeof value.string === "string") return this.quote(value.string);
    this.hand("Resolve the old test operand in its original context.");
  }

  call(node) {
    return `${node.call}(${node.args.map(arg => this.argument(arg)).join(", ")})`;
  }

  argument(node) {
    if (node.body) {
      const body = this.body(node.body);
      return node.body.optional || node.body.repeat || node.body.empty ? body : `(${body})`;
    }
    if (node.targets) return node.targets.map(target => this.target(target)).join(" | ");
    if (node.requirements && !node.test) return this.requirements(node.requirements);
    if (node.rule) return node.rule;
    if (node.tag) return node.tag;
    if (node.test || node.range || node.wildcard || node.splice || node.call || node.param) return this.body(node);
    if (node.string !== undefined || node.const && this.type(node) === "string") return this.operand(node);
    if (node.const && this.type(node) === "any") {
      if (this.isUndefined(node.const)) {
        this.changes.push("Keep the undeclared constant as an expression argument. Constant lookup fails before the argument is substituted.");
        return `= $${node.const}`;
      }
      this.hand(`Resolve $${node.const} at the argument's stage and version before choosing its category.`);
    }
    return `= ${this.term(node)}`;
  }

  target(node) {
    return node.rule ?? node.terminal ?? this.body(node);
  }

  patternLiteral(node) {
    return this.pattern(node);
  }

  pattern(node) {
    const pending = [node];
    while (pending.length) {
      const part = pending.pop();
      if (!part || typeof part !== "object") continue;
      if ((part.test === "=" || part.test === "≠") && part.value.string === "" &&
          (this.omittedValues.has("*") || this.omittedValues.has(part.expr.terminal) ||
            part.expr.wildcard && this.omittedValues.size)) {
        this.hand("The pattern can see a written empty value or an omission with a saved value. Choose the intended operands.");
      }
      for (const child of Object.values(part)) pending.push(child);
    }
    return layeredPatternText(node, item => {
      if (item.call) return this.call(item);
      if (item.name || item.terminal) return item.name ?? item.terminal;
      if (item.constant) return "$" + item.constant;
      if (item.requirements) return this.requirements(item.requirements);
      return this.operand(item);
    });
  }

  term(node, context = "") {
    if (node.capture !== undefined || node.captured !== undefined) {
      const name = node.capture ?? node.captured;
      const capture = `$${name === this.item?.name ? this.item.local : name}`;
      return context === "string" ? this.stringRead(capture, node, "value") : capture;
    }
    if (node.tag) return bag([node.tag]);
    if (node.const) return `$${node.const}`;
    if (node.param) return `@${node.param}`;
    if (node.string !== undefined) return this.quote(node.string);
    if (node.integer !== undefined) return node.integer;
    if (node.emptySet) return context === "strings" ? "[]" : context === "pattern" ? "∅" : "{}";
    if (node.pattern) return this.patternLiteral(node.pattern);
    if (node.call) return this.call(node);
    if (node.method) return this.method(node);
    if (node.nonempty) return this.term(node.nonempty);
    if (node.not) return `¬(${this.term(node.not)})`;
    if (node.if) {
      const then = this.term(node.then, context);
      if (context === "truth") return `(${this.term(node.if, "truth")} ⟹ ${then})`;
      const empty = { tags: "{}", strings: "[]", pattern: "∅" }[this.type(node.then)];
      return empty ? `(${this.term(node.if, "truth")} ? ${then} | ${empty})` :
        `(${this.term(node.if, "truth")} ⟹ ${then})`;
    }
    if (node.op) return this.compare(node);
    for (const kind of ["any", "all", "concat", "union", "intersection", "difference"]) {
      if (!node[kind]) continue;
      const type = ["any", "all"].includes(kind) ? "truth" : kind === "concat" ? "string" : this.type(node);
      if (type === "strings" && kind === "union") {
        return list(node.union.map(child => this.type(child) === "string" ? this.term(child) : `*${this.term(child, "strings")}`));
      }
      if (type === "strings" && kind === "intersection") {
        this.changes.push("Express string intersection as list difference. The surviving members preserve the left operand order.");
        return node.intersection.map(child => this.stringList(child)).reduce((left, right) =>
          `(${left} ∖ (${left} ∖ ${right}))`);
      }
      const operands = node[kind].map(child => this.term(child, type));
      return operands.length === 1 ? operands[0] : `(${operands.join(operators[kind])})`;
    }
    this.hand("Preserve an unrecognized expression operand.");
  }

  stringList(node) {
    if (node.if && this.type(node.then) === "string") {
      return list([`(${this.term(node.if, "truth")})? ${this.term(node.then, "string")}`]);
    }
    return this.type(node) === "string" ? list([this.term(node, "string")]) : this.term(node, "strings");
  }

  compare(node) {
    const { op, left, right } = node;
    if (op === "≅" || op === "≇") return `(${this.term(left)} ${op} ${this.term(right, "pattern")})`;
    const classify = left.method === "classify" && right.emptySet ? left :
      right.method === "classify" && left.emptySet ? right : null;
    if (classify && ["=", "≠"].includes(op)) {
      const value = this.method(classify);
      return op === "=" ? `¬(${value})` : value;
    }
    if (["∈", "∉"].includes(op)) {
      const target = this.stringList(right);
      return `(${this.term(left, "string")} ${op} ${target})`;
    }
    if (["=", "≠", "⊆", "⊈"].includes(op) && [this.type(left), this.type(right)].includes("strings")) {
      const a = this.stringList(left);
      const b = this.stringList(right);
      if (op === "⊆" || op === "⊈") {
        this.changes.push("Test string-set inclusion with list difference.");
        return op === "⊆" ? `¬(${a} ∖ ${b})` : `¬¬(${a} ∖ ${b})`;
      }
      if (left.emptySet || right.emptySet) {
        const value = left.emptySet ? b : a;
        this.changes.push("Compare the string list with the empty set by testing its length.");
        return op === "=" ? `¬(${value})` : `¬¬(${value})`;
      }
      this.changes.push("Compare string lists by membership in both directions. List order and duplicates do not affect the result.");
      const equal = `(¬(${a} ∖ ${b}) ∧ ¬(${b} ∖ ${a}))`;
      return op === "=" ? equal : `¬${equal}`;
    }
    const type = ["string", "span"].includes(this.type(left)) || ["string", "span"].includes(this.type(right)) ? "string" : "";
    return `(${this.term(left, type)} ${op} ${this.term(right, type)})`;
  }

  method({ method, receiver, args }) {
    if (method === "value" || method === "image") {
      const observed = receiver.method === "emitted" ? receiver.receiver : receiver;
      const capture = observed.capture ?? observed.captured;
      if (this.repeated.has(capture) && capture !== this.item?.name) this.hand(`Resolve the ordered string read on repeated capture $${capture}.`);
      if (receiver.method === "emitted") return `${this.term(receiver.receiver)}'${method}`;
      return this.stringRead(this.term(receiver), receiver, method);
    }
    if (method === "classify") return `$${classifierName(args[0].classifier)}.classify(${this.term(receiver, "string")})`;
    if (method === "parse") return `${this.term(receiver)}.parse(${this.body(args[0].body)})`;
    if (method === "tags") return `${this.term(receiver)}.flags`;
    if (method === "emitted") this.hand("Select the computed value or image of the occurrence.");
    if (method === "split" || method === "ngrams") {
      return `${this.term(receiver, "string")}.${method}(${args.map(arg => this.term(arg, "string")).join(", ")})`;
    }
    const operands = args.map(arg => arg.rule || arg.terminal || arg.call || arg.param ? this.target(arg) : this.term(arg));
    const separator = ["followed-by", "preceded-by"].includes(method) ? " | " : ", ";
    return `${this.term(receiver)}.${method}${operands.length ? `(${operands.join(separator)})` : ""}`;
  }

  stringRead(base, receiver, channel) {
    const capture = receiver.capture ?? receiver.captured;
    if (this.repeated.has(capture) && capture !== this.item?.name) {
      this.hand(`Resolve the ordered string read on repeated capture $${capture}.`);
    }
    const span = SPAN_METHODS.has(receiver.method) || this.spanReceiver && capture === "" ? base : `${base}.span`;
    return `${span}.tokens!'${channel}.join()`;
  }
}
