import { BOUNDARY_METHODS, boundaryProblem } from "./boundary.js";
// Checks that a grammar DOM that did not come from reading a document, the
// bootstrap's or a precompiled one from compiled.json, has the shape the
// reader would have given it (docs/output.md, "The DOM"), so that a corrupt
// or hand-made one is refused rather than failing somewhere inside a parse.

import { methodProblem, methodType, QUERY_METHODS, SPAN_METHODS } from "./methods.js";
import { patternProblem, patternParts } from "./patterns.js";
import { PROPERTY_NAMES } from "./unicode.js";
import { run } from "./trampoline.js";
import { countWork, hooks } from "./testing.js";
import { clauseChildren, expressionChildren } from "./clause-walk.js";

/** @import { Argument, GrammarDom, Term } from "./types.js" */
/** @import { Step } from "./trampoline.js" */

const DOM_COMPARATORS = new Set(["=", "≠", "∈", "∉", "⊆", "⊈", "≅", "≇"]);
// The directives of the notation (engine §9).
const DIRECTIVE_NAMES = new Set(["ambiguity-resolution", "stage", "extend-stage", "redefine-stage", "include", "features"]);
// A capture's name is all lower case (engine §9).
export const CAPTURE_NAME = /^[a-z][a-z0-9_-]*$/;
// The nesting the notation allows (engine §9): deeper than any grammar a
// person writes, and shallow enough for the recursive walks over a DOM.
export const DOM_MAX_DEPTH = 256;

// The version of the DOM's shape (docs/output.md), part of every cache key.
export const DOM_FORMAT = 29;
// A constant's name, without its `$`, begins with a capital (engine §2).
export const CONSTANT_NAME = /^[A-Z][A-Za-z0-9_-]*$/;
// A classifier's name begins with a lower-case letter, and a class with a
// capital (engine §2, §9).
export const CLASSIFIER_NAME = /^[a-z][A-Za-z0-9_-]*$/;
// A rule has the same spelling as a classifier, or the name # (engine §9).
export const RULE_NAME = /^(?:[a-z][A-Za-z0-9_-]*|#)$/;
const CLASS_NAME = /^[A-Z](?:[A-Za-z0-9_-]*[A-Z])?$/;
const FEATURE_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;

// The comparators of a test in a body (engine §2): the two value tests and
// the four tag tests.
export const TEST_OPS = new Set(["=", "≠", "tags"]);

/**
 * Whether a test's comparator is a value test, whose value is a string,
 * rather than a tag test, whose value is a tag set (engine §2).
 * @param {string} op
 * @returns {boolean}
 */
export function isSoundTest(op) {
  return op === "=" || op === "≠";
}

/**
 * What is wrong with a test's value (engine §9), or null: it must be a
 * closed term, of type string for a value test and tag set for a tag test,
 * and a string literal of a value test must be a canonical value. The shape
 * of the value must already be checked, and its nesting bounded.
 * @param {string} op
 * @param {any} value
 * @param {{isMark(code: number): boolean, changesInDocument?(code:number):boolean}} [unicode]
 * @returns {{problem: string, node: any} | null}
 */
export function testValueFault(op, value, unicode) {
  const open = openPart(value);
  if (open) return { problem: "a test's operand is a closed term, and reads no capture or span", node: open };
  const found = termType(value);
  if ("problem" in found) return found;
  const problem = expectedProblem(found.type, isSoundTest(op) ? "string" : "tags");
  if (problem) return { problem: `${op} tests ${isSoundTest(op) ? "a string" : "a tag set"}: ${problem}`, node: value };
  return null;
}

/**
 * What is wrong with a range (engine §1, §9), or null: its ends must be two
 * character tags in their canonical spelling by the table, which says which
 * code points are marks, the start not above the end.
 * @param {unknown} range
 * @param {{isMark(code: number): boolean, changesInDocument?(code:number):boolean}} unicode
 * @returns {string | null}
 */
export function rangeProblem(range, unicode) {
  if (!Array.isArray(range) || range.length !== 2) return "a malformed range";
  const strings = range.map(end => {
    if (isDomObject(end) && typeof end.string === "string") return end.string;
    if (isDomObject(end) && isDomObject(end.value) && typeof end.value.string === "string") return end.value.string;
    if (isDomObject(end) && typeof end.const === "string" && /^_[0-9A-F]{4,6}$/.test(end.const)) {
      const code = parseInt(end.const.slice(1), 16);
      if (code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) return String.fromCodePoint(code);
    }
    return null;
  });
  if (strings.some(value => value !== null && [...value].length !== 1)) return "a range endpoint is one scalar";
  if (strings.every(value => value !== null) && /** @type {number} */ (strings[0]?.codePointAt(0)) > /** @type {number} */ (strings[1]?.codePointAt(0))) return "a range starts above its end";
  return null;
}



/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isDomObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isDomPosition(value) {
  return Array.isArray(value) && value.length === 2 && value.every((n) => Number.isInteger(n));
}




/**
 * The forms of an expression, a term and a condition, each as its members
 * (docs/output.md). The first member names the form.
 */
/**
 * Whether a node has exactly the members of one of its forms, and no
 * other. So a node that joins two forms, such as {"tag":…,"string":…}, is
 * refused before it is read, and no library reads it one way where
 * another reads it another way. A member that ends in `?` may be absent.
 * @param {Record<string, unknown>} value
 * @param {string[][]} forms
 * @returns {boolean}
 */
function hasOneForm(value, forms) {
  const form = forms.find((members) => members[0] in value);
  if (form === undefined) return false;
  const names = form.map((member) => member.replace(/\?$/, ""));
  return form.every((member) => member.endsWith("?") || member in value) && Object.keys(value).every((key) => names.includes(key));
}

/**
 * Why a value is not a grammar DOM, or null when it is one. `unicode` is
 * the loader's table: the lowercase mapping that the strings of value
 * tests are checked against, and the marks that decide a character tag's canonical spelling.
 * @param {unknown} dom
 * @param {{isMark(code: number): boolean, changesInDocument?(code:number):boolean}} unicode
 * @param {boolean} [deferEmission] slot checks precede absent-carrier pruning
 * @returns {string | null}
 */
export function domProblem(dom, unicode, deferEmission = false) {
  /** @type {(value: unknown) => value is Record<string, any>} */
  const object = isDomObject;
  if (!object(dom) || dom.format !== DOM_FORMAT || !["rules", "directives", "constants", "classifiers", "implications"].every(key => Array.isArray(dom[key]))) return `not a DOM of format ${DOM_FORMAT}`;
  /** @type {(value: any) => boolean} */
  const position = value => isDomPosition(value) && value.every((/** @type {number} */ n) => n >= 1);
  /** @type {(value: any, fields: string[]) => boolean} */
  const exact = (value, fields) => object(value) && Object.keys(value).every(key => fields.includes(key));
  /** @type {(value: any) => boolean} */
  const stringTerm = value => object(value) && ["string", "const", "interpolate"].some(key => key in value);
  /** @type {(value: any) => boolean} */
  const tag = value => typeof value === "string" && (/^[A-Z][A-Za-z0-9_-]*$/.test(value) || (value.startsWith("_") && value !== "_" && PROPERTY_NAMES.has(value.slice(1))));
  /** @type {(value: any) => boolean} */
  const constant = value => typeof value === "string" && (CONSTANT_NAME.test(value) || (/^_[0-9A-F]{4,6}$/.test(value) && parseInt(value.slice(1), 16) <= 0x10ffff && !(parseInt(value.slice(1), 16) >= 0xd800 && parseInt(value.slice(1), 16) <= 0xdfff)));
  /** @type {(values: any) => boolean} */
  const guards = values => Array.isArray(values) && values.every((/** @type {any} */ guard) => exact(guard, ["feature", "kind", "negated"]) && Object.keys(guard).length === 3 && FEATURE_NAME.test(guard.feature) && typeof guard.negated === "boolean" && (guard.kind === "gate" || guard.kind === "warning" && !guard.negated));
  /** @type {any[]} */
  const pending = [];
  /** @type {(kind: string, value: any, depth?: number, context?: any) => void} */
  const push = (kind, value, depth = 0, context = {}) => pending.push({ kind, value, depth, ...context });
  const positions = new Set();
  for (const item of [...dom.rules, ...dom.directives, ...dom.constants, ...dom.classifiers, ...dom.implications]) {
    if (!object(item) || !position(item.at)) return "a malformed declaration position";
    const key = `${item.at[0]}:${item.at[1]}`;
    if (positions.has(key)) return "two items at one position";
    positions.add(key);
  }
  for (const directive of dom.directives) {
    const { name, args } = directive;
    if (!DIRECTIVE_NAMES.has(name) || "maximal" in directive || !Array.isArray(args) || args.some(arg => typeof arg !== "string")) return "a malformed directive";
    if (["stage", "extend-stage", "redefine-stage"].includes(name) && !(args.length === 1 && CLASSIFIER_NAME.test(args[0]))) return "a malformed directive";
    if (name === "include" && args.length !== 1 || name === "features" && !(args.length > 0 && args.every(arg => FEATURE_NAME.test(arg)))) return "a malformed directive";
    if (name === "ambiguity-resolution" && !(args.length >= 1 && args.length <= 2 && ["greedy", "lazy", "late-elision"].includes(args[0]) && (args.length === 1 || args[1] === "elision-only"))) return "a malformed directive";
  }
  for (const definition of dom.constants) {
    if (!exact(definition, ["name", "op", "value", "at"]) || !CONSTANT_NAME.test(definition.name) || !["define", "redefine"].includes(definition.op)) return "a malformed constant";
    push("term", definition.value);
  }
  for (const classifier of dom.classifiers) {
    if (!exact(classifier, ["name", "entries", "at"]) || !(typeof classifier.name === "string" && CLASSIFIER_NAME.test(classifier.name)) || !Array.isArray(classifier.entries)) return "a malformed classifier";
    for (const entry of classifier.entries) {
      if (!exact(entry, ["guards", "keys", "op", "class", "at"]) || !position(entry.at) || !guards(entry.guards) || entry.guards.some((/** @type {any} */ guard) => guard.kind !== "gate") || !CLASS_NAME.test(entry.class) || !["∈", "∉"].includes(entry.op) || !Array.isArray(entry.keys) || !entry.keys.length) return "a malformed classifier entry";
      for (const key of entry.keys) { if (!stringTerm(key)) return "a malformed classifier key"; push("term", key); }
    }
  }
  for (const implication of dom.implications) {
    if (!exact(implication, ["if", "then", "at"])) return "a malformed implication";
    push("term", implication.if); push("term", implication.then);
  }
  for (const rule of dom.rules) {
    if (!exact(rule, ["name", "op", "flags", "tags", "value", "image", "alternatives", "emit", "conditions", "erased", "at"]) || !(typeof rule.name === "string" && RULE_NAME.test(rule.name)) || !["define", "redefine", "extend"].includes(rule.op) || !Array.isArray(rule.flags) || rule.flags.length > 1 || rule.flags.some((/** @type {string} */ flag) => !["leftmost-longest", "fewest"].includes(flag)) || (rule.op === "extend" && rule.flags.length) || !Array.isArray(rule.alternatives) || !rule.alternatives.length || !Array.isArray(rule.conditions)) return "a malformed rule";
    if ("erased" in rule && (rule.erased !== true || rule.emit || rule.value || rule.image)) return "a malformed erased rule";
    if (rule.tags !== undefined) push("tags", rule.tags, 0, { constituent: true });
    if (rule.value !== undefined) push("recipe", rule.value);
    if (rule.image !== undefined) push("recipe", rule.image);
    if (rule.emit !== undefined) push("emission", rule.emit);
    for (const condition of rule.conditions) push("condition", condition);
    for (const alternative of rule.alternatives) {
      if (!exact(alternative, ["guards", "expr", "tags", "value", "image"]) || !guards(alternative.guards)) return "a malformed alternative";
      push("expr", alternative.expr, 0, { whole: true });
      if (alternative.tags !== undefined) push("tags", alternative.tags, 0, { constituent: true });
      for (const channel of ["value", "image"]) if (alternative[channel] !== undefined) { if (rule.erased) return "a recipe beside erasure"; push("recipe", alternative[channel]); }
    }
  }
  /** @type {(value: any) => boolean} */
  const base = value => object(value) && ((typeof value.ref === "string" && value.ref !== "#") || "literal" in value || "range" in value || value.wildcard === true);
  /** @type {(value: any) => boolean} */
  const target = value => base(value) || object(value) && value.test === "tags" && base(value.expr);
  for (let task = pending.pop(); task; task = pending.pop()) {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    const { kind, value, depth } = task;
    if (depth > DOM_MAX_DEPTH) return "nested too deeply";
    if (!object(value)) return `a malformed ${kind}`;
    /** @type {(kind: string, value: any, context?: any) => void} */
  const child = (kind, value, context = {}) => push(kind, value, depth + 1, context);
    const fields = Object.keys(value);
    if (kind === "expr") {
      if (value.test) {
        if (!TEST_OPS.has(value.test) || !exact(value, value.test === "tags" ? ["test", "requirements", "expr"] : ["test", "value", "expr"]) || !(value.test === "tags" ? base(value.expr) : target(value.expr))) return "a malformed test";
        child("expr", value.expr, { sealed: task.sealed });
        if (value.test === "tags") {
          if (!Array.isArray(value.requirements)) return "a malformed tag test";
          for (const requirement of value.requirements) {
            if (!exact(requirement, ["negated", "value"]) || fields.length === 0 || typeof requirement.negated !== "boolean" || !object(requirement.value) || !("tag" in requirement.value || "const" in requirement.value)) return "a malformed requirement";
            child("term", requirement.value);
          }
        } else { if (!stringTerm(value.value)) return "a malformed value test"; child("term", value.value); }
      } else if ("capture" in value) {
        if (!exact(value, ["capture", "expr"]) || !(typeof value.capture === "string" && CAPTURE_NAME.test(value.capture)) || task.sealed || !(target(value.expr) || ["=", "≠"].includes(value.expr?.test) && target(value.expr.expr) || value.expr?.ref === "#")) return "a malformed capture";
        child("expr", value.expr, { sealed: task.sealed });
      } else if (["seq", "choice", "ranked", "and"].some(key => key in value)) {
        const key = fields[0];
        if (fields.length !== 1 || !Array.isArray(value[key]) || value[key].length < 2 || key === "and" && value[key].length > 16) return key === "ranked" ? "ranked-choice-syntax: a ranked expression requires two options" : "a malformed expression";
        for (const item of value[key]) child("expr", item, { sealed: task.sealed });
      } else if ("optional" in value) {
        if (!exact(value, ["optional", "elidable"]) || "elidable" in value && (value.elidable !== true || !elidableHead(value.optional))) return "a malformed optional";
        child("expr", value.optional, { sealed: task.sealed || value.elidable });
      } else if ("repeat" in value) {
        if (!exact(value, ["repeat", "separator", "chain"]) || "chain" in value && (!task.whole || !["left", "right"].includes(value.chain))) return "a malformed repetition";
        child("expr", value.repeat, { sealed: true });
        if ("separator" in value) child("expr", value.separator, { sealed: true });
      } else if ("literal" in value) { if (fields.length !== 1 || !stringTerm(value.literal)) return "a malformed literal"; child("term", value.literal); }
      else if ("range" in value) {
        if (fields.length !== 1 || !Array.isArray(value.range) || value.range.length !== 2 || !value.range.every(stringTerm)) return "a malformed range";
        for (const end of value.range) child("term", end);
        const problem = rangeProblem(value.range, unicode); if (problem) return problem;
      } else if ("ref" in value) { if (fields.length !== 1 || !(value.ref === "#" || CLASSIFIER_NAME.test(value.ref) || tag(value.ref))) return "a malformed reference"; }
      else if (!(fields.length === 1 && (value.empty === true || value.wildcard === true))) return "a malformed expression";
    } else if (kind === "tags") {
      if (task.constituent && readsOwnTags(value)) return "a constituent reads its own tags";
      if (engineLiterals(value).size) return "a tag clause introduces an engine tag";
      push("term", value, depth);
    } else if (kind === "emission") {
      if (fields.length !== 1 || !Array.isArray(value.items) || !value.items.length) return "a malformed emission";
      const names = [];
      for (const item of value.items) {
        if (!exact(item, ["capture", "insert", "tags", "value", "image", "before", "after"]) || (typeof item.capture === "string") === (item.insert === true) || "insert" in item && item.insert !== true || typeof item.capture === "string" && item.capture !== "" && !CAPTURE_NAME.test(item.capture)) return "a malformed emission item";
        if (item.capture) names.push(item.capture);
        for (const side of ["before", "after"]) if (side in item) {
          if (!item.capture || !Array.isArray(item[side]) || !item[side].length || !item[side].every(name => typeof name === "string" && CAPTURE_NAME.test(name))) return "a malformed attachment";
          for (const name of item[side]) names.push(name);
        }
        if (item.tags !== undefined) push("tags", item.tags, depth);
        for (const channel of ["value", "image"]) if (item[channel] !== undefined) push("recipe", item[channel], depth);
      }
      if (new Set(names).size !== names.length) return "an emission lists a capture twice";
    } else if (kind === "recipe") {
      if (fields.length !== 1 || !Array.isArray(value.concat) || !value.concat.length) return "a malformed recipe";
      for (const atom of value.concat) {
        if (!stringTerm(atom)) {
          if (!object(atom) || !["value", "image", "source-text", "decomposed-source-text", "verbatim-text"].includes(atom.method) || atom.args?.length !== 0) return "a malformed recipe atom";
          const receiver = atom.receiver;
          if (!(typeof receiver?.capture === "string" && Object.keys(receiver).length === 1) && !(["value", "image"].includes(atom.method) && receiver?.method === "emitted" && receiver.args?.length === 0 && typeof receiver.receiver?.capture === "string" && Object.keys(receiver.receiver).length === 1)) return "a malformed recipe receiver";
        }
        child("term", atom, { recipe: true });
      }
    } else if (kind === "condition") {
      if (!hasOneForm(value, [["method", "receiver", "args"], ["op", "left", "right"], ["not"], ["any"], ["all"], ["captured"], ["if", "then"]])) return "a malformed condition";
      if (value.method) { if (!QUERY_METHODS.has(value.method)) return "a malformed query"; push("term", value, depth, { query: true }); }
      else if (value.op) {
        if (!DOM_COMPARATORS.has(value.op) || ["≅", "≇"].includes(value.op) && !(typeof value.left?.capture === "string" && Object.keys(value.left).length === 1)) return "a malformed comparison";
        child("term", value.left); child("term", value.right);
      } else if ("captured" in value) { if (typeof value.captured !== "string" || value.captured !== "" && !CAPTURE_NAME.test(value.captured)) return "a malformed presence"; }
      else if (value.not) child("condition", value.not);
      else if (value.if) { child("condition", value.if); child("condition", value.then); }
      else {
        const values = value.any ?? value.all;
        if (!Array.isArray(values) || values.length < 2) return "a malformed connective";
        for (const condition of values) child("condition", condition);
      }
    } else if (kind === "pattern") {
      const problem = patternProblem(value, () => null); if (problem) return problem;
      push("pattern-part",value,depth);
    } else if (kind === "pattern-part") {
      if (value.test === "tags") for (const requirement of value.requirements) child("term", requirement.value);
      else if (value.test) child("term", value.value);
      if (value.literal) child("term", value.literal);
      if (value.range) for (const endpoint of value.range) child("term", endpoint);
      for (const item of patternParts(value)) if (item !== value.value) child("pattern-part", item);
    } else {
      if (!hasOneForm(value, [["string"], ["interpolate"], ["tag"], ["const", "at"], ["emptySet"], ["capture"], ["method", "receiver", "args"], ["union"], ["intersection"], ["difference"], ["if", "then"], ["pattern"]])) return "a malformed term";
      if ("string" in value) { if (typeof value.string !== "string" || /[\uD800-\uDFFF]/u.test(value.string)) return "a malformed scalar string"; }
      else if (value.tag) { if (!tag(value.tag)) return "a malformed tag"; }
      else if (value.const) { if (!constant(value.const) || !position(value.at)) return "a malformed constant reference"; }
      else if ("emptySet" in value) { if (value.emptySet !== true) return "a malformed empty set"; }
      else if ("capture" in value) { if (typeof value.capture !== "string" || value.capture !== "" && !CAPTURE_NAME.test(value.capture)) return "a malformed capture reference"; }
      else if (value.method) {
        if (!Array.isArray(value.args) || !object(value.receiver) || (!task.recipe && ["emitted", "verbatim-text"].includes(value.method)) || (!task.query && QUERY_METHODS.has(value.method))) return "a malformed method";
        child("term", value.receiver, { recipe: task.recipe });
        for (const arg of value.args) {
          if (object(arg) && typeof arg.rule === "string") { if (Object.keys(arg).length !== 1 || !["tags", "matches", "begins", "without-elision-except", "followed-by", "preceded-by"].includes(value.method) || !RULE_NAME.test(arg.rule)) return "a malformed rule argument"; }
          else if (object(arg) && typeof arg.terminal === "string") { if (Object.keys(arg).length !== 1 || !BOUNDARY_METHODS.has(value.method) || !/^[A-Z][A-Za-z0-9_-]*$/.test(arg.terminal)) return "a malformed boundary target"; }
          else if (object(arg) && typeof arg.classifier === "string") { if (Object.keys(arg).length !== 1 || value.method !== "classify" || !CLASSIFIER_NAME.test(arg.classifier)) return "a malformed classifier argument"; }
          else child("term", arg);
        }
      } else if (value.interpolate) {
        if (!Array.isArray(value.interpolate) || !value.interpolate.length || !value.interpolate.every(item => object(item) && ("string" in item || "const" in item))) return "a malformed interpolation";
        for (const segment of value.interpolate) child("term", segment);
      } else if (value.pattern) child("pattern", value.pattern);
      else if (value.if) { child("condition", value.if); child("term", value.then); }
      else {
        const items = value.union ?? value.intersection ?? value.difference;
        if (!Array.isArray(items) || items.length < 2 || value.difference && items.length !== 2) return "a malformed set operation";
        for (const item of items) child("term", item);
      }
    }
  }
  for (const rule of dom.rules) {
    if (rule.alternatives.some((/** @type {any} */ alternative) => duplicateCaptures(alternative.expr).length)) return "a duplicate capture";
    const problem = boundaryProblem(rule)?.problem || definitionProblem(rule, deferEmission) || ruleTypeProblem(rule); if (problem) return problem;
  }
  for (const definition of dom.constants) {
    if (openPart(definition.value)) return "a constant is not closed";
    if (hasEngineLiteral(definition.value)) return "a constant contains an engine-tag literal";
    const problem = valueTypeProblem(definition.value, definition.op === "redefine"); if (problem) return problem;
  }
  for (const implication of dom.implications) for (const side of [implication.if, implication.then]) {
    if (openPart(side)) return "an implication is not closed";
    if (hasEngineLiteral(side)) return "an implication contains an engine-tag literal";
    const found = termType(side); if ("problem" in found) return found.problem;
    const problem = expectedProblem(found.type, "tags"); if (problem) return problem;
  }
  return null;
}

/** @param {any} term @returns {Set<string>} */
export function engineLiterals(term) {
  return run(literalNames(term));
}

/** @param {any} term @returns {Generator<Step, Set<string>, any>} */
function* literalNames(term) {
  if (!term || typeof term !== "object") return new Set();
  if (typeof term.tag === "string" && term.tag.startsWith("_")) return new Set([term.tag]);
  if (term.if) return yield literalNames(term.then);
  if (term.difference) return yield literalNames(term.difference[0]);
  const operands = term.union ?? term.intersection;
  if (!operands) return new Set();
  /** @type {Set<string>[]} */
  const sets = [];
  for (const operand of operands) sets.push(yield literalNames(operand));
  if (term.union) return new Set(sets.flatMap(set => [...set]));
  return new Set([...sets[0]].filter(name => sets.every(set => set.has(name))));
}

/** @param {any} term @returns {boolean} */
function hasEngineLiteral(term) {
  const pending = [term];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    if (typeof value.tag === "string" && value.tag.startsWith("_")) return true;
    if (value.pattern) continue;
    for (const child of clauseChildren(value)) if (child && typeof child === "object") pending.push(child);
  }
  return false;
}


/**
 * Whether a value is a grammar DOM, by the loader's table.
 * @param {unknown} dom
 * @param {{isMark(code: number): boolean, changesInDocument?(code:number):boolean}} unicode
 * @param {boolean} [deferEmission] slot checks precede absent-carrier pruning
 * @returns {dom is GrammarDom}
 */
export function isDom(dom, unicode, deferEmission = false) {
  return domProblem(dom, unicode, deferEmission) === null;
}

/**
 * Whether a term, or a condition inside one, reads the tags of `$`, the
 * constituent whose tags it may be defining: `$` as a value, `tags($)` or
 * `classes($)`. A span argument such as `value($)` reads tokens, not tags.
 * The DOM's shape need not have been checked: anything malformed reads
 * nothing, and the check of its shape refuses it.
 * @param {unknown} node
 * @returns {boolean}
 */
export function readsOwnTags(node) {
  // The parts to look at, with an explicit stack: the depth of a term is
  // bounded only once the whole document is read (engine §9).
  const stack = [node];
  while (stack.length > 0) {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    const current = stack.pop();
    if (!isDomObject(current)) continue;
    if (typeof current.method === "string") {
      if ((current.method === "tags" || current.method === "classes") && /** @type {any} */ (current).args.length === 0 && /** @type {any} */ (current).receiver.capture === "") return true;
      if (current.method === "tags" || QUERY_METHODS.has(current.method)) continue;
      stack.push(/** @type {any} */ (current).receiver);
      for (const arg of /** @type {any} */ (current).args) stack.push(arg);
      continue;
    }
    if (current.op === "≅" || current.op === "≇") continue;
    const key = ["union", "intersection", "difference", "any", "all"].find((name) => Array.isArray(current[name]));
    if (key) for (const item of /** @type {unknown[]} */ (current[key])) stack.push(item);
    else for (const name of ["left", "right", "not", "if", "then"]) stack.push(current[name]);
  }
  return false;
}

// ---- Clauses against the captures of alternatives (engine §3.6, §9) ----

/** A condition that simplifies to true or false for a production. */
export const DOM_TRUE = Object.freeze({ constant: true });
export const DOM_FALSE = Object.freeze({ constant: false });
/** A term that simplifies to the empty set. */
const DOM_EMPTY = Object.freeze({ emptySet: true });

/**
 * A clause simplified for a production that has the captures `has`: each
 * presence test becomes true or false, and guards and logic over them are
 * reduced (engine §3.6). A condition may become DOM_TRUE or DOM_FALSE; a term may
 * become the empty set.
 * @param {any} node a condition or a term
 * @param {(name: string) => boolean} has
 * @returns {any}
 */
export function simplify(node, has) {
  return run(simplifying(node, has));
}

/**
 * The steps of simplify, run without the call stack.
 * @param {any} node
 * @param {(name: string) => boolean} has
 * @returns {Generator<Step, any, any>}
 */
function* simplifying(node, has) {
  if (!isDomObject(node)) return node;
  if (typeof node.captured === "string") return has(node.captured) ? DOM_TRUE : DOM_FALSE;
  if ("not" in node) {
    const inner = yield simplifying(node.not, has);
    return inner === DOM_TRUE ? DOM_FALSE : inner === DOM_FALSE ? DOM_TRUE : { not: inner };
  }
  if (Array.isArray(node.all)) {
    const items = [];
    for (const item of node.all) items.push(yield simplifying(item, has));
    if (items.includes(DOM_FALSE)) return DOM_FALSE;
    const left = items.filter((item) => item !== DOM_TRUE);
    return left.length === 0 ? DOM_TRUE : left.length === 1 ? left[0] : { all: left };
  }
  if (Array.isArray(node.any)) {
    const items = [];
    for (const item of node.any) items.push(yield simplifying(item, has));
    if (items.includes(DOM_TRUE)) return DOM_TRUE;
    const left = items.filter((item) => item !== DOM_FALSE);
    return left.length === 0 ? DOM_FALSE : left.length === 1 ? left[0] : { any: left };
  }
  if ("if" in node) {
    const antecedent = yield simplifying(node.if, has);
    const isTerm = !isCondition(node.then);
    if (antecedent === DOM_FALSE) return isTerm ? DOM_EMPTY : DOM_TRUE;
    const consequent = yield simplifying(node.then, has);
    if (antecedent === DOM_TRUE) return consequent;
    if (isTerm && isEmptySet(consequent)) return DOM_EMPTY;
    if (!isTerm && consequent === DOM_TRUE) return DOM_TRUE;
    if (!isTerm && consequent === DOM_FALSE) return { not: antecedent };
    return { if: antecedent, then: consequent };
  }
  if (Array.isArray(node.union)) {
    const items = [];
    for (const item of node.union) {
      const simple = yield simplifying(item, has);
      if (!isEmptySet(simple)) items.push(simple);
    }
    return items.length === 0 ? DOM_EMPTY : items.length === 1 ? items[0] : { union: items };
  }
  if (Array.isArray(node.intersection)) {
    const items = [];
    for (const item of node.intersection) items.push(yield simplifying(item, has));
    return items.some(isEmptySet) ? DOM_EMPTY : { intersection: items };
  }
  if (Array.isArray(node.difference)) {
    const left = yield simplifying(node.difference[0], has);
    const right = yield simplifying(node.difference[1], has);
    return isEmptySet(left) ? DOM_EMPTY : isEmptySet(right) ? left : { difference: [left, right] };
  }
  if (typeof node.op === "string") return { op: node.op, left: yield simplifying(node.left, has), right: yield simplifying(node.right, has) };
  return node;
}

/**
 * Whether a term is the empty set, written or left by a guard.
 * @param {any} node
 * @returns {boolean}
 */
function isEmptySet(node) {
  if (!isDomObject(node)) return false;
  if (node.emptySet === true && Object.keys(node).length === 1) return true;
  // A constant is its value here, once the loader has given it one (engine
  // §3.6).
  return typeof node.const === "string" && isDomObject(node.value) && node.value.set instanceof Set && node.value.set.size === 0;
}

/**
 * Whether a DOM node is a condition rather than a term.
 * @param {any} node
 * @returns {boolean}
 */
function isCondition(node) {
  // Down the chain of guards, in a loop.
  let current = node;
  while (isDomObject(current) && !(typeof current.op === "string" || "not" in current || "all" in current || "any" in current ||
    (typeof current.method === "string" && ["matches", "begins", "starts-input", "ends-input", "followed-by", "preceded-by"].includes(current.method)) || "captured" in current || "constant" in current)) {
    if (!("if" in current)) return false;
    current = current.then;
  }
  return isDomObject(current);
}

// ---- A clause simplified for many productions (engine §3.6) ----------

/**
 * A clause prepared once for the productions of a definition. Its parts
 * are the items of a top-level union of a term, or ∧ or ∨ of a condition,
 * the conditions of a list, or the clause alone. A part that tests no
 * presence simplifies the same for every production, and a part `$c ⟹ X`,
 * whose X tests none, simplifies to X's value or to its value without c.
 * Those values are kept, and the guarded parts are indexed by capture. So
 * a production's simplification costs its own captures and its output, not
 * the number of parts. Parts of any other shape are simplified for each
 * production.
 * @typedef {object} PreparedClause
 * @property {"union" | "all" | "any" | null} join how the parts join, or
 *   null for a clause alone
 * @property {any[]} parts
 * @property {boolean} list whether the parts are the conditions of a list,
 *   each of which is prepared in turn
 * @property {number[]} fixed the parts that every production keeps, in
 *   order: those that test no presence and do not vanish, and the others
 * @property {(any | undefined)[]} values each part's simplified value,
 *   where it is the same for every production that keeps it
 * @property {Map<string, number[]>} guards the parts that a production
 *   keeps only if it has a capture, by that capture, each list in order
 * @property {any} absent for a guarded clause alone, its value for a
 *   production without the capture
 * @property {boolean} decided for a ∨, whether a part true for every
 *   production makes it true
 * @property {boolean} guardedTrue for a ∨, whether a guarded part is true
 *   where its capture is present
 */

/**
 * The captures of a production, each once.
 * @typedef {{size: number, keys(): Iterable<string>}} CaptureNames
 */

/** @type {WeakMap<object, PreparedClause>} */
const preparedClauses = new WeakMap();

/**
 * Whether a clause tests the presence of no capture anywhere inside it.
 * @param {unknown} node
 * @returns {boolean}
 */
function testsNoPresence(node) {
  const stack = [node];
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    if (!isDomObject(current) && !Array.isArray(current)) continue;
    if (isDomObject(current) && "captured" in current) return false;
    for (const value of clauseChildren(current)) if (value && typeof value === "object") stack.push(value);
  }
  return true;
}

/**
 * The capture that a part `$c ⟹ X` tests, where X tests no presence, so
 * that the part's value for a production depends on that capture alone.
 * @param {any} part
 * @returns {string | null}
 */
function guardOf(part) {
  if (!isDomObject(part) || Object.keys(part).length !== 2 || !("if" in part) || !("then" in part)) return null;
  const test = part.if;
  if (!isDomObject(test) || Object.keys(test).length !== 1 || typeof test.captured !== "string") return null;
  return testsNoPresence(part.then) ? test.captured : null;
}

/** @type {(name: string) => boolean} */
const hasNone = () => false;

/**
 * The parts of a clause or a list, classified, with the values of those
 * that are the same for every production.
 * @param {any[]} parts
 * @param {"union" | "all" | "any" | null} join
 * @param {boolean} list
 * @returns {PreparedClause}
 */
function prepareParts(parts, join, list) {
  /** @type {PreparedClause} */
  const prepared = { join, parts, list, fixed: [], values: [], guards: new Map(), absent: undefined, decided: false, guardedTrue: false };
  // A part's value vanishes from its join where the join drops it. In a
  // ∨, a part that is true decides the whole instead.
  const vanishes = (/** @type {any} */ value) => (join === "union" ? isEmptySet(value) : join === "all" ? value === DOM_TRUE : join === "any" ? value === DOM_FALSE : false);
  /** @type {(name: string, index: number) => void} */
  const index = (name, at) => {
    const names = prepared.guards.get(name);
    if (names) names.push(at);
    else prepared.guards.set(name, [at]);
  };
  parts.forEach((part, at) => {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    const name = guardOf(part);
    if (name !== null) {
      const absent = isCondition(part.then) ? DOM_TRUE : DOM_EMPTY;
      // Without its capture, a guarded part vanishes from a union or an
      // ∧, and makes a ∨ true.
      if (join === null || vanishes(absent) || (join === "any" && absent === DOM_TRUE)) {
        const value = simplify(part.then, hasNone);
        prepared.values[at] = value;
        prepared.absent = absent;
        // A part that vanishes where its capture is present too is never
        // kept.
        if (join !== null && vanishes(value)) return;
        if (join === "any" && value === DOM_TRUE) prepared.guardedTrue = true;
        index(name, at);
        return;
      }
    } else if (testsNoPresence(part)) {
      const value = simplify(part, hasNone);
      prepared.values[at] = value;
      if (join !== null && vanishes(value)) return;
      if (join === "any" && value === DOM_TRUE) {
        prepared.decided = true;
        return;
      }
      // A condition of a list that uses a capture is dropped by every
      // production without it. So it is kept under the first such name,
      // and a production without that name never looks at it.
      if (list && value !== DOM_FALSE) {
        let first = null;
        for (const used of capturesUsed(value)) if (used !== "" && (first === null || used < first)) first = used;
        if (first !== null) {
          index(first, at);
          return;
        }
      }
    }
    prepared.fixed.push(at);
  });
  return prepared;
}

/**
 * A clause prepared for the productions of its definition, once for each
 * clause.
 * @param {any} node a condition or a term
 * @returns {PreparedClause}
 */
export function prepareClause(node) {
  const known = isDomObject(node) ? preparedClauses.get(node) : undefined;
  if (known) return known;
  // The join that simplifying reads first decides, as it does there.
  /** @type {"union" | "all" | "any" | null} */
  let join = null;
  if (isDomObject(node) && typeof node.captured !== "string" && !("not" in node)) {
    if (Array.isArray(node.all)) join = "all";
    else if (Array.isArray(node.any)) join = "any";
    else if (!("if" in node) && Array.isArray(node.union)) join = "union";
  }
  const prepared = prepareParts(join === "all" ? node.all : join === "any" ? node.any : join === "union" ? node.union : [node], join, false);
  if (isDomObject(node)) preparedClauses.set(node, prepared);
  return prepared;
}

/**
 * A list of conditions prepared for the productions of its definition,
 * once for each list. A condition false for a production removes it, and
 * one true is dropped, as the items of an ∧ are. A condition that uses a
 * capture the production lacks is left out, which the caller would drop.
 * @param {any[]} conditions
 * @returns {PreparedClause}
 */
export function prepareConditions(conditions) {
  const known = preparedClauses.get(conditions);
  if (known) return known;
  const prepared = prepareParts(conditions, "all", true);
  preparedClauses.set(conditions, prepared);
  return prepared;
}

/**
 * The indexes of the parts kept for a production, in order: those every
 * production keeps, and those under the captures it has.
 * @param {number[]} fixed
 * @param {Map<string, number[]>} guards
 * @param {(name: string) => boolean} has
 * @param {CaptureNames} names
 * @returns {number[]}
 */
export function keptIndexes(fixed, guards, has, names) {
  // The guarded parts this production keeps, found from whichever is
  // fewer, its captures or the captures that guard parts.
  /** @type {number[]} */
  const kept = [];
  /** @type {(name: string) => void} */
  const take = (name) => {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    const list = guards.get(name);
    if (!list || !has(name)) return;
    for (const index of list) {
      if (hooks.work) countWork(hooks.work, "walkSteps");
      kept.push(index);
    }
  };
  if (names.size <= guards.size) for (const name of names.keys()) take(name);
  else for (const name of guards.keys()) take(name);
  kept.sort((left, right) => {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    return left - right;
  });
  /** @type {number[]} */
  const merged = [];
  let next = 0;
  for (const index of fixed) {
    while (next < kept.length && kept[next] < index) {
      if (hooks.work) countWork(hooks.work, "walkSteps");
      merged.push(kept[next++]);
    }
    if (hooks.work) countWork(hooks.work, "walkSteps");
    merged.push(index);
  }
  while (next < kept.length) {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    merged.push(kept[next++]);
  }
  return merged;
}

/**
 * The values of a prepared clause's parts that a production keeps, in
 * order: each simplified, without those its join drops.
 * @param {PreparedClause} prepared
 * @param {(name: string) => boolean} has
 * @param {CaptureNames} names
 * @returns {any[]}
 */
export function partsFor(prepared, has, names) {
  const { join, parts, values } = prepared;
  /** @type {any[]} */
  const items = [];
  for (const index of keptIndexes(prepared.fixed, prepared.guards, has, names)) {
    let value = values[index];
    if (value === undefined) value = prepared.list ? simplifyFor(prepareClause(parts[index]), has, names) : simplify(parts[index], has);
    if (join === "union" ? !isEmptySet(value) : join === "any" ? value !== DOM_FALSE : value !== DOM_TRUE) items.push(value);
  }
  return items;
}

/**
 * A prepared clause simplified for a production, the same as simplify
 * gives (engine §3.6).
 * @param {PreparedClause} prepared
 * @param {(name: string) => boolean} has
 * @param {CaptureNames} names
 * @returns {any}
 */
export function simplifyFor(prepared, has, names) {
  const { join, parts, fixed, values, guards } = prepared;
  if (join === null) {
    if (fixed.length === 1) return values[0] !== undefined ? values[0] : simplify(parts[0], has);
    // A guarded clause alone is its value or vanishes.
    const [name] = guards.keys();
    return has(name) ? values[0] : prepared.absent;
  }
  if (join === "any") {
    // A part true for every production, or a guarded part whose capture
    // the production lacks, makes the ∨ true.
    if (prepared.decided) return DOM_TRUE;
    if (names.size < guards.size) return DOM_TRUE;
    for (const name of guards.keys()) {
      if (hooks.work) countWork(hooks.work, "walkSteps");
      if (!has(name)) return DOM_TRUE;
    }
    // Every guarded part is kept, and one that is true makes it true.
    if (prepared.guardedTrue) return DOM_TRUE;
  }
  const items = partsFor(prepared, has, names);
  if (join === "union") return items.length === 0 ? DOM_EMPTY : items.length === 1 ? items[0] : { union: items };
  if (join === "any") {
    if (items.includes(DOM_TRUE)) return DOM_TRUE;
    return items.length === 0 ? DOM_FALSE : items.length === 1 ? items[0] : { any: items };
  }
  if (items.includes(DOM_FALSE)) return DOM_FALSE;
  return items.length === 0 ? DOM_TRUE : items.length === 1 ? items[0] : { all: items };
}

/**
 * The items of an emission indexed once for the productions of its
 * definition: those with no carrier, which every production keeps, those
 * with one, by its name, and those with attachments, by each attachment's
 * name.
 * @typedef {{fixed: number[], carriers: Map<string, number[]>, attached: Map<string, number[]>}} EmissionIndex
 */

/** @type {WeakMap<object, EmissionIndex>} */
const emissionIndexes = new WeakMap();

/**
 * The index of an emission's items, once for each list of items.
 * @param {any[]} items
 * @returns {EmissionIndex}
 */
export function emissionIndex(items) {
  const known = emissionIndexes.get(items);
  if (known) return known;
  /** @type {EmissionIndex} */
  const index = { fixed: [], carriers: new Map(), attached: new Map() };
  /** @type {(map: Map<string, number[]>, name: string, at: number) => void} */
  const add = (map, name, at) => {
    const list = map.get(name);
    if (list) {
      // An item that attaches one name twice is listed once.
      if (list[list.length - 1] !== at) list.push(at);
    } else map.set(name, [at]);
  };
  items.forEach((item, at) => {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    if (item.capture === undefined) index.fixed.push(at);
    else add(index.carriers, item.capture, at);
    for (const name of attachmentsOf(item)) {
      if (hooks.work) countWork(hooks.work, "walkSteps");
      add(index.attached, name, at);
    }
  });
  emissionIndexes.set(items, index);
  return index;
}

/**
 * The indexes of the emission items that a production keeps, in order:
 * those whose carrier it has, and those with none (engine §3.6).
 * @param {any[]} items
 * @param {(name: string) => boolean} has
 * @param {CaptureNames} names
 * @returns {number[]}
 */
export function presentItems(items, has, names) {
  const index = emissionIndex(items);
  return keptIndexes(index.fixed, index.carriers, has, names);
}

/**
 * The first emission item, in order, whose carrier a production lacks but
 * one of whose attachments it has (engine §9), or -1.
 * @param {any[]} items
 * @param {(name: string) => boolean} has
 * @param {CaptureNames} names
 * @returns {number}
 */
export function strayAttachment(items, has, names) {
  const index = emissionIndex(items);
  let first = -1;
  /** @type {(name: string) => void} */
  const look = (name) => {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    const list = index.attached.get(name);
    if (!list || !has(name)) return;
    for (const at of list) {
      if (hooks.work) countWork(hooks.work, "walkSteps");
      const carrier = items[at].capture;
      if (carrier !== undefined && !has(carrier) && (first === -1 || at < first)) first = at;
    }
  };
  if (names.size <= index.attached.size) for (const name of names.keys()) look(name);
  else for (const name of index.attached.keys()) look(name);
  return first;
}

/**
 * The captures a clause uses as values or spans, presence tests aside.
 * @param {unknown} node
 * @returns {string[]}
 */
export function capturesUsed(node) {
  /** @type {string[]} */
  const names = [];
  const stack = [node];
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    if (!isDomObject(current) && !Array.isArray(current)) continue;
    if (isDomObject(current) && typeof current.capture === "string" && Object.keys(current).length === 1) names.push(current.capture);
    for (const value of clauseChildren(current)) if (value && typeof value === "object") stack.push(value);
  }
  return names;
}

/**
 * The captures a clause mentions at all, presence tests included.
 * @param {unknown} node
 * @returns {string[]}
 */
function capturesMentioned(node) {
  const names = capturesUsed(node);
  const stack = [node];
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    if (!isDomObject(current) && !Array.isArray(current)) continue;
    if (isDomObject(current) && typeof current.captured === "string") names.push(current.captured);
    for (const value of clauseChildren(current)) if (value && typeof value === "object") stack.push(value);
  }
  return names;
}

/**
 * The captures of each production of an alternative, name to its place in
 * the order that the production reads them, with `$` at -1 (engine §3.5).
 * @param {any} alternative
 * @returns {Map<string, number>[]}
 */
export function alternativeCaptures(alternative) {
  return captureSequences(alternative.expr).map((sequence) => {
    /** @type {Map<string, number>} */
    const captures = new Map([["", -1]]);
    sequence.forEach((name, index) => captures.set(name, index));
    return captures;
  });
}

/**
 * A sequence of capture names, as a node of a trie of all the sequences
 * of one expression: one node for each distinct sequence, which shares its
 * prefix with the sequences it extends.
 * @typedef {{parent: CaptureNode | null, name: string, length: number, children: Map<string, CaptureNode> | null}} CaptureNode
 */

/**
 * The distinct sequences of captures that the productions of an expression
 * read, each in the order read (engine §3.2, §3.5): a choice gives each
 * branch's, an `&` each subsequence's, a plain optional none or its
 * content's, and braces and an elidable optional none. Productions that
 * read the same names in the same order are one sequence. Gates do not
 * matter, since they drop whole alternatives.
 *
 * The sequences are nodes of a trie, so that extending one by a capture
 * costs one step and two equal sequences are one node. A copy of each
 * growing prefix would cost the square of a sequence's length.
 * @param {any} expr
 * @returns {string[][]}
 */
export function captureSequences(expr) {
  /** @type {CaptureNode} */
  const root = { parent: null, name: "", length: 0, children: null };
  /** @type {(node: CaptureNode, name: string) => CaptureNode} */
  const extended = (node, name) => {
    if (hooks.work) countWork(hooks.work, "lowering");
    const children = node.children ?? (node.children = new Map());
    let child = children.get(name);
    if (!child) children.set(name, (child = { parent: node, name, length: node.length + 1, children: null }));
    return child;
  };
  /** @type {(node: CaptureNode) => string[]} */
  const names = (node) => {
    const list = new Array(node.length);
    for (let at = node; at.parent !== null; at = at.parent) {
      if (hooks.work) countWork(hooks.work, "lowering");
      list[at.length - 1] = at.name;
    }
    return list;
  };
  /** @type {(lists: CaptureNode[]) => CaptureNode[]} */
  const distinct = (lists) => (lists.length < 2 ? lists : [...new Set(lists)]);
  /** @type {(left: CaptureNode[], right: CaptureNode[]) => CaptureNode[]} */
  const product = (left, right) => {
    /** @type {CaptureNode[]} */
    const result = [];
    const suffixes = right.map(names);
    for (const a of left) {
      for (const suffix of suffixes) {
        let node = a;
        for (const name of suffix) node = extended(node, name);
        result.push(node);
      }
    }
    return distinct(result);
  };
  /** @type {(node: any) => Generator<Step, CaptureNode[], any>} */
  const visit = function* (node) {
    if (!isDomObject(node)) return [root];
    if (typeof node.capture === "string") return [extended(root, node.capture)];
    if (Array.isArray(node.seq)) {
      /** @type {CaptureNode[]} */
      let sequences = [root];
      for (const item of node.seq) sequences = product(sequences, yield visit(item));
      return sequences;
    }
    if (Array.isArray(node.choice) || Array.isArray(node.ranked)) {
      /** @type {CaptureNode[]} */
      const all = [];
      for (const item of /** @type {unknown[]} */ (node.choice ?? node.ranked)) for (const sequence of yield visit(item)) all.push(sequence);
      return distinct(all);
    }
    if (Array.isArray(node.and)) {
      /** @type {CaptureNode[][]} */
      const parts = [];
      for (const item of node.and) parts.push(yield visit(item));
      /** @type {CaptureNode[]} */
      const result = [];
      for (let mask = 1; mask < 1 << parts.length; mask++) {
        /** @type {CaptureNode[]} */
        let sequences = [root];
        parts.forEach((part, index) => {
          if (mask & (1 << index)) sequences = product(sequences, part);
        });
        for (const sequence of sequences) result.push(sequence);
      }
      return distinct(result);
    }
    if ("optional" in node) {
      if (node.elidable === true) return [root];
      /** @type {CaptureNode[]} */
      const all = [root];
      for (const sequence of yield visit(node.optional)) all.push(sequence);
      return distinct(all);
    }
    return [root];
  };
  return run(visit(expr)).map(names);
}

/**
 * The captures that some production of an expression reads after a
 * capture of the same name (engine §3.5, §9), found from the structure
 * alone: two captures are read by one production exactly when they stand
 * in different items of one sequence or one &, since each item is read in
 * any of its expansions. So no production is listed. A choice's branches
 * never meet. Braces and an elidable optional hold no capture.
 * @param {any} expr
 * @returns {{capture: string}[]}
 */
export function duplicateCaptures(expr) {
  /** @type {Set<{capture: string}>} */
  const duplicates = new Set();
  // Each node gives its captures by name, and their number, gathered after
  // its children, with an explicit stack, since the depth of a DOM is
  // bounded only by its check. An item of a sequence or an & meets the
  // items before it: the side with fewer captures is looked up in the
  // other, and the two are then joined, the smaller into the larger, so a
  // capture moves a number of times that grows with the logarithm of their
  // count, not with the depth of the expression. A name keeps its place
  // once its captures are marked, but its list of captures not yet marked
  // is emptied, so that a capture is marked once and not again at each
  // level above it.
  /** @typedef {{names: Map<string, {capture: string}[]>, size: number}} Found */
  /** @type {{node: any, index: number, parts: Found[]}[]} */
  const stack = [{ node: expr, index: 0, parts: [] }];
  /** @type {(node: any) => any[]} */
  const children = (node) => {
    if (!isDomObject(node) || typeof node.capture === "string") return [];
    if (Array.isArray(node.seq)) return node.seq;
    if (Array.isArray(node.choice)) return node.choice;
    if (Array.isArray(node.ranked)) return node.ranked;
    if (Array.isArray(node.and)) return node.and;
    if ("optional" in node && node.elidable !== true) return [node.optional];
    return [];
  };
  for (;;) {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    const frame = stack[stack.length - 1];
    const node = frame.node;
    const list = children(node);
    if (frame.index < list.length) {
      stack.push({ node: list[frame.index++], index: 0, parts: [] });
      continue;
    }
    /** @type {Found} */
    let joined = { names: new Map(), size: 0 };
    if (isDomObject(node) && typeof node.capture === "string") {
      joined = { names: new Map([[node.capture, [/** @type {{capture: string}} */ (node)]]]), size: 1 };
    } else {
      const meets = isDomObject(node) && (Array.isArray(node.seq) || Array.isArray(node.and));
      frame.parts.forEach((part, index) => {
        if (index === 0) {
          joined = part;
          return;
        }
        if (meets) {
          if (joined.size <= part.size) {
            for (const name of joined.names.keys()) {
              if (hooks.work) countWork(hooks.work, "walkSteps");
              const captures = part.names.get(name);
              if (!captures) continue;
              for (const capture of captures) {
                if (hooks.work) countWork(hooks.work, "walkSteps");
                duplicates.add(capture);
              }
              part.names.set(name, []);
            }
          } else {
            for (const [name, captures] of part.names) {
              if (hooks.work) countWork(hooks.work, "walkSteps");
              if (!joined.names.has(name)) continue;
              for (const capture of captures) {
                if (hooks.work) countWork(hooks.work, "walkSteps");
                duplicates.add(capture);
              }
              part.names.set(name, []);
            }
          }
        }
        let [large, small] = joined.size >= part.size ? [joined, part] : [part, joined];
        for (const [name, captures] of small.names) {
          if (hooks.work) countWork(hooks.work, "walkSteps");
          const found = large.names.get(name);
          if (!found) {
            large.names.set(name, captures);
            continue;
          }
          for (const capture of captures) {
            if (hooks.work) countWork(hooks.work, "walkSteps");
            found.push(capture);
          }
        }
        large.size += small.size;
        joined = large;
      });
    }
    stack.pop();
    if (stack.length === 0) break;
    stack[stack.length - 1].parts.push(joined);
  }
  return [...duplicates];
}

/**
 * The terminal at the head of an elidable optional's expression, or null
 * when the expression has no such head (engine §3.8, §9): a `ref` whose
 * name begins with a capital, a `terminal` whose tag is a name, or an `=`
 * test of one of these, alone or first in a `seq`.
 * @param {any} expr
 * @returns {any}
 */
export function elidableHead(expr) {
  const head = isDomObject(expr) && Array.isArray(expr.seq) ? expr.seq[0] : expr;
  if (!isDomObject(head)) return null;
  /** @type {(node: any) => boolean} */
  const isTerminal = (node) => isDomObject(node) && Object.keys(node).length === 1 &&
    (typeof node.ref === "string" && /^[A-Z][A-Za-z0-9_-]*$/.test(node.ref));
  if (isTerminal(head)) return head;
  /** @type {any} */
  let base = head;
  while (base.test) base = base.expr;
  if (isTerminal(base)) return head;
  return null;
}

/** @type {WeakMap<object,string>} */
const deferredEmissionProblems = new WeakMap();
/** @type {WeakMap<object,string>} */
const deferredRecipeProblems = new WeakMap();
/** @param {object} rule */
export const deferredRecipeProblem = rule => deferredRecipeProblems.get(rule);
/** @param {object} rule @returns {string | undefined} */
export const deferredEmissionProblem = rule => deferredEmissionProblems.get(rule);

/** @param {any} rule @returns {boolean} */
function ruleHasRanked(rule) {
  const pending = rule.alternatives.map((/** @type {any} */ alternative) => alternative.expr);
  while (pending.length) {
    const expr = pending.pop();
    if (!expr || typeof expr !== 'object') continue;
    if ('ranked' in expr) return true;
    for (const child of expressionChildren(expr)) pending.push(child);
  }
  return false;
}

/**
 * Why a definition, a rule's alternatives with its own clauses, cannot be
 * read (engine §9), or null. The DOM's shape must already be checked. The
 * checks that simplification decides skip a clause that holds a constant
 * without its value.
 * @param {any} rule
 * @param {boolean} [deferEmission] slot checks precede absent-carrier pruning
 * @returns {string | null}
 */
export function definitionProblem(rule, deferEmission = false) {
  // A constant is its value in simplification (engine §3.6). A clause that
  // holds a constant without one waits for the loader, which checks the
  // definition again once the constants have their values (engine §9).
  // Each clause is looked at once, since the checks below ask again for
  // every production.
  /** @type {Map<unknown, boolean>} */
  const waiting = new Map();
  const waits = (/** @type {unknown} */ clause) => {
    let known = waiting.get(clause);
    if (known === undefined) waiting.set(clause, (known = constantsIn(clause).some((reference) => !("value" in reference))));
    return known;
  };
  // A definition with no clause has nothing to check about its captures,
  // and its productions, whose number can be exponential, are not listed.
  if (rule.tags === undefined && rule.conditions.length === 0 && rule.emit === undefined &&
      rule.alternatives.every((/** @type {any} */ alternative) => alternative.tags === undefined && alternative.value === undefined && alternative.image === undefined) && rule.value === undefined && rule.image === undefined) return null;
  // Each production of each alternative, with the captures it reads
  // (engine §3.5, §9); productions that read the same captures in the same
  // order are one.
  const productions = rule.alternatives.flatMap((/** @type {any} */ alternative) => alternativeCaptures(alternative).map((captures) => ({ captures, alternative })));
  const alternatives = productions.map((/** @type {{captures: Map<string, number>}} */ production) => production.captures);
  // The names some production captures, and those every one does, found
  // once rather than by a scan of the productions for each name.
  // The productions that capture each name, in order, which also gives
  // the names some production captures.
  /** @type {Map<string, number[]>} */
  const capturing = new Map();
  alternatives.forEach((/** @type {Map<string, number>} */ captures, /** @type {number} */ index) => {
    for (const name of captures.keys()) {
      if (hooks.work) countWork(hooks.work, "clauses");
      const list = capturing.get(name);
      if (list) list.push(index);
      else capturing.set(name, [index]);
    }
  });
  /** @type {Set<string>} */
  const everywhere = new Set(alternatives.length ? alternatives[0].keys() : []);
  for (const captures of alternatives) {
    for (const name of everywhere) {
      if (hooks.work) countWork(hooks.work, "clauses");
      if (!captures.has(name)) everywhere.delete(name);
    }
  }
  const anyHas = (/** @type {string} */ name) => capturing.has(name);
  const items = rule.emit ? rule.emit.items : [];
  const clauses = [rule.tags, rule.value, rule.image, ...rule.conditions, ...rule.alternatives.flatMap((/** @type {any} */ a) => [a.tags, a.value, a.image]), ...items];
  // An emission item mentions its own capture and its attachments,
  // whatever else it says.
  const named = items.flatMap((/** @type {any} */ item) => (typeof item.capture === "string" ? [item.capture, ...attachmentsOf(item)] : []));
  for (const name of [...named, ...clauses.flatMap(capturesMentioned)]) {
    if (!anyHas(name)) return `$${name} is captured by no alternative of ${rule.name}`;
  }
  for (const condition of rule.conditions) {
    if (waits(condition)) continue;
    const prepared = prepareClause(condition);
    const applies = (/** @type {number} */ index) => {
      if (hooks.work) countWork(hooks.work, "clauses");
      const captures = alternatives[index];
      const has = (/** @type {string} */ name) => captures.has(name);
      const simple = simplifyFor(prepared, has, captures);
      return simple !== DOM_TRUE && capturesUsed(simple).every(has);
    };
    // A condition made only of guarded parts is true for a production
    // that has none of their captures, so only those that have one can
    // apply. A condition the same for every production applies only where
    // each capture it uses is present, so only the productions with the
    // first of them can.
    /** @type {Iterable<string> | null} */
    let candidates = null;
    const guarded = prepared.guards.size > 0 || prepared.join === "all";
    if (prepared.fixed.length === 0 && guarded && (prepared.join === "all" || prepared.join === "any" || (prepared.join === null && prepared.absent === DOM_TRUE))) {
      candidates = prepared.guards.keys();
    } else if (prepared.join === null ? prepared.guards.size === 0 && prepared.values[0] !== undefined : testsNoPresence(condition)) {
      // A condition that tests no presence anywhere, alone or joined, has
      // one value for every production.
      const value = prepared.join === null ? prepared.values[0] : simplify(condition, hasNone);
      let first = null;
      for (const used of capturesUsed(value)) if (used !== "" && (first === null || used < first)) first = used;
      if (first !== null) candidates = [first];
    }
    let found = false;
    if (candidates !== null) {
      for (const name of candidates) {
        for (const index of capturing.get(name) ?? []) {
          if ((found = applies(index))) break;
        }
        if (found) break;
      }
    } else {
      found = alternatives.some((/** @type {unknown} */ _, /** @type {number} */ index) => applies(index));
    }
    if (!found) return `a condition of ${rule.name} applies to no production`;
  }
  for (const { captures, alternative } of productions) {
    const has = (/** @type {string} */ name) => captures.has(name);
    for (const term of [rule.tags, alternative.tags]) {
      if (term === undefined || waits(term)) continue;
      const missing = capturesUsed(simplifyFor(prepareClause(term), has, captures)).find((name) => !has(name));
      if (missing !== undefined) return `a tag term of ${rule.name} uses $${missing}, which a production lacks; guard it with $${missing} ⟹`;
    }
    const recipes = new Set([
      alternative.value ?? rule.value,
      alternative.image ?? rule.image ?? alternative.value ?? rule.value,
    ]);
    for (const recipe of recipes) {
      if (recipe === undefined) continue;
      const missing = capturesUsed(recipe).find((name) => !has(name));
      if (missing !== undefined) {
        const problem = `a recipe of ${rule.name} uses $${missing}, which a production lacks`;
        if (!ruleHasRanked(rule)) return problem;
        if (!deferredRecipeProblems.has(rule)) deferredRecipeProblems.set(rule,problem);
      }
    }
    if (!rule.emit) continue;
    // The items this production keeps, found from an index of the items
    // by their carriers, not by a scan of every item.
    const present = presentItems(items, has, captures).map((index) => items[index]);
    if (items.length > 0 && present.length === 0) {
      const problem = `%emits of ${rule.name} leaves a production nothing to emit`;
      if (!deferEmission || !ruleHasRanked(rule)) return problem;
      deferredEmissionProblems.set(rule, problem);
    }
    // A production without an item's carrier lacks its attachments too
    // (engine §9). The first such item, in order, is found from the index
    // of attachments.
    const strayAt = strayAttachment(items, has, captures);
    if (strayAt !== -1) {
      const item = items[strayAt];
      const stray = attachmentsOf(item).find(has);
      return `%emits of ${rule.name} attaches $${stray} in a production without its carrier $${item.capture}`;
    }
    // The written order of the captures, attachments included, is the order
    // they stand in (engine §9).
    const written = present.flatMap((/** @type {any} */ item) => (item.capture ? [...(item.before ?? []), item.capture, ...(item.after ?? [])] : []));
    const positions = written.filter(has).map((/** @type {string} */ name) => /** @type {number} */ (captures.get(name)));
    if (positions.some((/** @type {number} */ position, /** @type {number} */ at) => at > 0 && position < positions[at - 1])) {
      return `%emits of ${rule.name} lists captures out of the order they stand in`;
    }
    for (const item of present) {
      for (const recipe of [item.value, item.image]) {
        if (recipe === undefined) continue;
        const missing = capturesUsed(recipe).find((name) => !has(name));
        if (missing !== undefined) {
        const problem = `a recipe of ${rule.name} uses $${missing}, which a production lacks`;
        if (!ruleHasRanked(rule)) return problem;
        if (!deferredRecipeProblems.has(rule)) deferredRecipeProblems.set(rule,problem);
      }
      }
      if (!item.tags || waits(item.tags)) continue;
      const missing = capturesUsed(simplifyFor(prepareClause(item.tags), has, captures)).find((name) => !has(name));
      if (missing !== undefined) return `a tag term of ${rule.name} uses $${missing}, which a production lacks; guard it with $${missing} ⟹`;
    }
  }
  // Each inserted tag's anchor is the next capture item, found in one
  // backward pass.
  /** @type {any[]} */
  const anchors = new Array(items.length);
  for (let index = items.length - 1, next = undefined; index >= 0; index--) {
    if (hooks.work) countWork(hooks.work, "clauses");
    anchors[index] = next;
    if (items[index].capture !== undefined) next = items[index];
  }
  /** @type {(name: string) => boolean} */
  const allHave = (name) => alternatives.length === 0 || everywhere.has(name);
  for (let index = 0; index < items.length; index++) {
    if (items[index].insert === undefined) continue;
    const next = anchors[index];
    if (next && next.capture !== "" && !allHave(next.capture)) {
      return `%emits of ${rule.name} inserts a tag before $${next.capture}, which a production lacks`;
    }
  }
  return null;
}

/**
 * An emission item's attachment captures, before and after it, in order.
 * @param {any} item
 * @returns {string[]}
 */
export function attachmentsOf(item) {
  return [...(item.before ?? []), ...(item.after ?? [])];
}

// ---- Types (engine §10) -------------------------------------------------

/**
 * A term's type: a string, a set of strings, a tag set, a span, a set
 * whose kind nothing has given yet, such as `∅`, or, for a constant that
 * the reader cannot know, any type but a span (engine §9).
 * @typedef {"string" | "strings" | "tags" | "span" | "pattern" | "set" | "any" | "emitted" | "condition"} TermType
 */

/**
 * The type of each constant, where the loader knows it (engine §2); the
 * reader knows none, and gives every constant the type `any`.
 * @typedef {(name: string) => TermType} ConstantTypes
 */

const SET_KINDS = new Set(["strings", "tags", "pattern", "set"]);
/** @type {Record<string, string>} */
const TYPE_NAMES = { string: "a string", strings: "a set of strings", tags: "a tag set", span: "a span", pattern: "a pattern", set: "a set", any: "a value", emitted: "an emitted pair", condition: "a condition" };
/** @type {ConstantTypes} */
const UNKNOWN_CONSTANTS = () => "any";


/**
 * The kind of sets joined by ∪, ∩ or ∖, or why they cannot be joined: each
 * is a set, and all whose kind is known have one kind. A constant whose
 * type is not known yet fits any set.
 * @param {TermType[]} types
 * @param {string} operator
 * @returns {{type: TermType} | {problem: string}}
 */
export function joinedType(types, operator) {
  if (types.includes("span")) return { problem: "a span is not a value: tags($x) is the tag set of $x" };
  const known = types.filter((type) => type !== "any");
  const bad = known.find((type) => !SET_KINDS.has(type));
  if (bad) return { problem: `${operator} joins sets, not ${TYPE_NAMES[bad]}` };
  const kinds = new Set(known.filter((type) => type !== "set"));
  if (kinds.size > 1) return { problem: `${operator} joins two sets of one kind, not different value types` };
  if (kinds.size) return { type: /** @type {TermType} */ ([...kinds][0]) };
  return { type: known.length < types.length ? "any" : "set" };
}

/**
 * Why a comparison's two sides do not fit its comparator, or null. A side
 * of type `any` fits, and the loader checks it again (engine §9).
 * @param {string} op
 * @param {TermType} left
 * @param {TermType} right
 * @returns {string | null}
 */
export function comparisonProblem(op, left, right) {
  if (op === "≅" || op === "≇") {
    if (left !== "span") return "a tree comparison requires a bare capture";
    return expectedProblem(right, "pattern");
  }
  if (left === "pattern" || right === "pattern") return `${op} cannot compare pattern values`;
  if (left === "span") left = "string";
  if (right === "span") right = "string";
  if (op === "∈" || op === "∉") {
    if (left !== "string" && left !== "any") return `${op} tests a string, not ${TYPE_NAMES[left]}, in a set of strings; ⊆ and ⊈ compare two sets`;
    if (right !== "strings" && right !== "set" && right !== "any") return `${op} tests a string in a set of strings, not in ${TYPE_NAMES[right]}`;
    return null;
  }
  if (op === "⊆" || op === "⊈") {
    const joined = joinedType([left, right], op);
    if ("problem" in joined) return joined.problem;
    return joined.type === "set" ? `the kind of the sets that ${op} compares is not given` : null;
  }
  // = and ≠ compare two values of one type.
  if (left === "any" || right === "any") return null;
  if (left === "string" || right === "string") return left === right ? null : `${op} compares two values of one type, not ${TYPE_NAMES[left]} and ${TYPE_NAMES[right]}`;
  const joined = joinedType([left, right], op);
  if ("problem" in joined) return joined.problem;
  return joined.type === "set" ? `the kind of the sets that ${op} compares is not given` : null;
}

/**
 * Why a term of type `type` cannot stand where `expected` is needed, or
 * null. A set of open kind takes the kind it is given, and a constant of
 * unknown type fits.
 * @param {TermType} type
 * @param {"string" | "tags" | "pattern"} expected
 * @returns {string | null}
 */
export function expectedProblem(type, expected) {
  if (type === expected || type === "any" || (type === "set" && (expected === "tags" || expected === "pattern"))) return null;
  if (type === "span" && expected === "string") return null;
  if (type === "span") return "a span cannot convert to this value type";
  return `${TYPE_NAMES[expected]} is needed here, not ${TYPE_NAMES[type]}`;
}

/**
 * A disagreement of types, and the smallest construct that holds it.
 * @typedef {{problem: string, node: any}} TypeFault
 */

/**
 * The type of a term, or why its parts do not agree (engine §10), with the
 * smallest construct whose parts disagree. The term's shape must already
 * be checked. `constants` gives the type of each constant.
 * @param {any} term
 * @param {ConstantTypes} [constants]
 * @returns {{type: TermType} | TypeFault}
 */
export function termType(term, constants = UNKNOWN_CONSTANTS) {
  return run(typing(term, constants));
}

/**
 * The types found, by the constants' types and the term or condition: a
 * reader asks the type of each term it reads and of the terms around it,
 * so each is found once, and a deep term costs no more than its size. A
 * DOM is never changed once read.
 * @type {WeakMap<ConstantTypes, WeakMap<object, any>>}
 */
const typesFound = new WeakMap();

/**
 * The memo of types for one way of typing constants.
 * @param {ConstantTypes} constants
 * @returns {WeakMap<object, any>}
 */
function typesFor(constants) {
  let found = typesFound.get(constants);
  if (!found) {
    found = new WeakMap();
    typesFound.set(constants, found);
  }
  return found;
}

/**
 * The steps of termType, run without the call stack.
 * @param {any} term
 * @param {ConstantTypes} constants
 * @returns {Generator<Step, {type: TermType} | TypeFault, any>}
 */
function* typing(term, constants) {
  const memo = typesFor(constants);
  if (memo.has(term)) return memo.get(term);
  const found = yield typingOnce(term, constants);
  memo.set(term, found);
  return found;
}

/**
 * The steps of the type of one term, whose parts are typed through the
 * memo.
 * @param {any} term
 * @param {ConstantTypes} constants
 * @returns {Generator<Step, {type: TermType} | TypeFault, any>}
 */
function* typingOnce(term, constants) {
  if ("pattern" in term) {
    const pending = [term.pattern];
    while (pending.length) {
      const n = pending.pop();
      if (n.constant) {
        const type = constants(n.constant);
        if (!["string","pattern","any"].includes(type)) return {problem:"a pattern atom requires a string or pattern constant",node:n};
      }
      if (n.literal || n.range) for (const operand of n.range ?? [n.literal]) {
        const found = yield typing(operand,constants);
        if ("problem" in found) return found;
        const problem = expectedProblem(found.type,"string");
        if (problem) return {problem,node:operand};
      }
      if (n.test) {
        let base = n.expr;
        while (base.test) base = base.expr;
        if (base.constant && !["string","any"].includes(constants(base.constant))) return {problem:"a tested pattern constant requires a string",node:base};
        const operands = n.test === "tags" ? n.requirements.map((/** @type {any} */ requirement) => requirement.value) : [n.value];
        for (const operand of operands) {
          const found = yield typing(operand,constants);
          if ("problem" in found) return found;
          const problem = expectedProblem(found.type,isSoundTest(n.test)?"string":"tags");
          if (problem) return {problem,node:operand};
        }
      }
      for (const child of patternParts(n)) pending.push(child);
    }
    return {type:"pattern"};
  }
  if (typeof term.string === "string") return { type: "string" };
  if (Array.isArray(term.interpolate) || Array.isArray(term.concat)) {
    for (const part of term.interpolate ?? term.concat) {
      const found = yield typing(part, constants);
      if ("problem" in found) return found;
      const wrong = expectedProblem(found.type, "string");
      if (wrong) return { problem: wrong, node: term };
    }
    return { type: "string" };
  }
  if (typeof term.method === "string") {
    const receiver = yield typing(term.receiver, constants);
    if ("problem" in receiver) return receiver;
    const types = [];
    for (const arg of term.args) {
      if (arg.rule || arg.classifier || arg.terminal) types.push("name");
      else {
        const found = yield typing(arg, constants);
        if ("problem" in found) return found;
        types.push(found.type);
      }
    }
    const problem = methodProblem(term.method, term.receiver, term.args, receiver.type, types, true);
    return problem ? { problem, node: term } : { type: /** @type {TermType} */ (methodType(term.method)) };
  }
  if (typeof term.tag === "string") return { type: "tags" };
  if (term.emptySet === true) return { type: "set" };
  if (typeof term.capture === "string") return { type: "span" };
  if (typeof term.const === "string") return { type: term.const.startsWith("_") ? "string" : constants(term.const) };
  for (const [key, operator] of [["union", "∪"], ["intersection", "∩"], ["difference", "∖"]]) {
    if (!Array.isArray(term[key])) continue;
    /** @type {TermType[]} */
    const types = [];
    for (const item of term[key]) {
      const found = /** @type {{type: TermType} | TypeFault} */ (yield typing(item, constants));
      if ("problem" in found) return found;
      types.push(found.type);
    }
    const joined = joinedType(types, operator);
    return "problem" in joined ? { problem: joined.problem, node: term } : joined;
  }
  if ("if" in term) {
    const fault = /** @type {TypeFault | null} */ (yield conditionTyping(term.if, constants));
    if (fault) return fault;
    const then = /** @type {{type: TermType} | TypeFault} */ (yield typing(term.then, constants));
    if ("problem" in then) return then;
    const wrong = expectedProblem(then.type, "tags");
    return wrong ? { problem: wrong, node: term } : { type: "tags" };
  }
  return { problem: "a malformed term", node: term };
}

/**
 * Why a condition's terms do not agree in type, with the smallest
 * construct that disagrees, or null (engine §10).
 * @param {any} condition
 * @param {ConstantTypes} [constants]
 * @returns {TypeFault | null}
 */
export function conditionTypeFault(condition, constants = UNKNOWN_CONSTANTS) {
  return run(conditionTyping(condition, constants));
}

/**
 * The steps of conditionTypeFault, run without the call stack.
 * @param {any} condition
 * @param {ConstantTypes} constants
 * @returns {Generator<Step, TypeFault | null, any>}
 */
function* conditionTyping(condition, constants) {
  const memo = typesFor(constants);
  if (memo.has(condition)) return memo.get(condition);
  const found = yield conditionTypingOnce(condition, constants);
  memo.set(condition, found);
  return found;
}

/**
 * The steps of the type fault of one condition, whose parts are typed
 * through the memo.
 * @param {any} condition
 * @param {ConstantTypes} constants
 * @returns {Generator<Step, TypeFault | null, any>}
 */
function* conditionTypingOnce(condition, constants) {
  if (condition.method) {
    const found = yield typing(condition, constants);
    if ("problem" in found) return found;
    return found.type === "condition" ? null : { problem: "a condition requires a query method", node: condition };
  }
  if (Array.isArray(condition.any) || Array.isArray(condition.all)) {
    for (const item of condition.any ?? condition.all) {
      const fault = yield conditionTyping(item, constants);
      if (fault) return fault;
    }
    return null;
  }
  if ("not" in condition) return yield conditionTyping(condition.not, constants);
  if ("if" in condition) return (yield conditionTyping(condition.if, constants)) || (yield conditionTyping(condition.then, constants));
  if (typeof condition.op === "string") {
    const left = /** @type {{type: TermType} | TypeFault} */ (yield typing(condition.left, constants));
    if ("problem" in left) return left;
    const right = /** @type {{type: TermType} | TypeFault} */ (yield typing(condition.right, constants));
    if ("problem" in right) return right;
    const problem = comparisonProblem(condition.op, left.type, right.type);
    return problem ? { problem, node: condition } : null;
  }
  return null;
}

/**
 * Why a condition's terms do not agree in type, or null (engine §10).
 * @param {any} condition
 * @returns {string | null}
 */
export function conditionTypeProblem(condition) {
  const fault = conditionTypeFault(condition);
  return fault ? fault.problem : null;
}

/**
 * Why a term that must be a tag set, a constituent's or an item's, is not
 * one, with the construct at fault, or null.
 * @param {any} term
 * @param {ConstantTypes} [constants]
 * @returns {TypeFault | null}
 */
function tagTermFault(term, constants) {
  const found = termType(term, constants);
  if ("problem" in found) return found;
  const problem = expectedProblem(found.type, "tags");
  return problem ? { problem, node: term } : null;
}

/**
 * Why a rule's terms and conditions do not agree in type, with the
 * construct at fault, or null.
 * @param {any} rule
 * @param {ConstantTypes} [constants]
 * @returns {TypeFault | null}
 */
export function ruleTypeFault(rule, constants) {
  const recipes = [rule.value, rule.image,
    ...rule.alternatives.flatMap((/** @type {any} */ alternative) => [alternative.value, alternative.image]),
    ...(rule.emit ? rule.emit.items.flatMap((/** @type {any} */ item) => [item.value, item.image]) : [])];
  for (const recipe of recipes) {
    if (recipe === undefined) continue;
    for (const atom of recipe.concat) {
      const found = termType(atom, constants);
      if ("problem" in found) return found;
      const problem = expectedProblem(found.type, "string");
      if (problem) return { problem, node: atom };
    }
  }
  const tagTerms = [rule.tags, ...rule.alternatives.map((/** @type {any} */ alternative) => alternative.tags),
    ...(rule.emit ? rule.emit.items.map((/** @type {any} */ item) => item.tags) : [])];
  for (const term of tagTerms) {
    if (term === undefined) continue;
    const fault = tagTermFault(term, constants);
    if (fault) return fault;
  }
  for (const condition of rule.conditions) {
    const fault = conditionTypeFault(condition, constants);
    if (fault) return fault;
  }
  for (const alternative of rule.alternatives) {
    const pending = [alternative.expr];
    while (pending.length) {
      const expr = pending.pop();
      const operands = expr.literal ? [expr.literal] : expr.range ?? [];
      for (const operand of operands) {
        const found = termType(operand,constants);
        if ("problem" in found) return found;
        const problem = expectedProblem(found.type,"string");
        if (problem) return {problem,node:operand};
      }
      if (expr.range) {
        const problem = rangeProblem(expr.range,/** @type {any} */ (null));
        if (problem) return {problem,node:expr};
      }
      for (const key of ["seq","choice","ranked","and"]) if (expr[key]) for (const child of expr[key]) pending.push(child);
      for (const key of ["optional","repeat","separator","expr"]) if (expr[key]) pending.push(expr[key]);
    }
  }
  // A test's value is a string for a value test and a tag set for a tag
  // test (engine §9, §10).
  for (const alternative of rule.alternatives) {
    for (const test of testsIn(alternative.expr)) {
      const operands = test.test === "tags" ? /** @type {any} */ (test).requirements.map((/** @type {any} */ requirement) => requirement.value) : [test.value];
      for (const value of operands) {
        const found = termType(value, constants);
        if ("problem" in found) return found;
        const problem = expectedProblem(found.type, test.test === "tags" ? "tags" : "string");
        if (problem) return { problem, node: value };
      }
    }
  }
  return null;
}

/**
 * The tested symbols of an expression, in the order written.
 * @param {any} expr
 * @returns {{test: string, value: any, expr: any}[]}
 */
export function testsIn(expr) {
  /** @type {{test: string, value: any, expr: any}[]} */
  const found = [];
  const stack = [expr];
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    if (!isDomObject(current)) continue;
    if (typeof current.test === "string") found.push(/** @type {any} */ (current));
    for (const key of ["choice", "ranked", "and", "seq"]) {
      const items = current[key];
      if (Array.isArray(items)) for (let index = items.length - 1; index >= 0; index--) stack.push(items[index]);
    }
    // In reverse, so that a repeat's item comes before its separator.
    for (const key of ["expr", "separator", "repeat", "optional"]) if (key in current) stack.push(current[key]);
  }
  return found;
}

/**
 * Why a rule's terms and conditions do not agree in type, or null.
 * @param {any} rule
 * @returns {string | null}
 */
function ruleTypeProblem(rule) {
  const fault = ruleTypeFault(rule);
  return fault ? fault.problem : null;
}

/**
 * The type of a constant's value, or why it cannot be one (engine §2,
 * §10): a string, a set of strings or a tag set. A redefinition keeps the
 * constant's type, which gives `∅` its kind, so its value can be of open
 * kind.
 * @param {any} value
 * @param {boolean} redefine
 * @param {ConstantTypes} [constants]
 * @returns {{type: TermType} | TypeFault}
 */
export function constantValueType(value, redefine, constants) {
  const found = termType(value, constants);
  if ("problem" in found) return found;
  if (found.type === "span") return { problem: "a constant's value is a string or a set, never a span", node: value };
  if (found.type === "set" && !redefine) return { problem: "the kind of the set that the constant holds is not given", node: value };
  return found;
}

/**
 * Why a constant's value cannot be one, or null.
 * @param {any} value
 * @param {boolean} redefine
 * @returns {string | null}
 */
function valueTypeProblem(value, redefine) {
  const found = constantValueType(value, redefine);
  return "problem" in found ? found.problem : null;
}

// ---- Constants (engine §2, §10) -----------------------------------------

/**
 * The first part of a term that is not closed (engine §10), or null: a
 * capture, a guarded term, or a call of anything but split and tag. The
 * shape of the term need not be checked.
 * @param {unknown} term
 * @returns {any}
 */
export function openPart(term) {
  // In the order written, with an explicit stack.
  const stack = [term];
  while (stack.length > 0) {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    const current = stack.pop();
    if (!isDomObject(current)) continue;
    if ("capture" in current || "if" in current) return current;
    /** @type {unknown[]} */
    let items = [];
    if (typeof current.method === "string") {
      if (current.method !== "split") return current;
      items = [current.receiver, .../** @type {any} */ (current).args];
    } else {
      const key = ["union", "intersection", "difference", "interpolate"].find((name) => Array.isArray(current[name]));
      if (key) items = /** @type {unknown[]} */ (current[key]);
    }
    for (let index = items.length - 1; index >= 0; index--) stack.push(items[index]);
  }
  return null;
}

/**
 * The references to constants in a term, a condition, a rule or any part
 * of a DOM, in the order written.
 * @param {unknown} node
 * @returns {import("./types.js").ConstantTerm[]}
 */
export function constantsIn(node) {
  /** @type {import("./types.js").ConstantTerm[]} */
  const found = [];
  // In the order written, with an explicit stack.
  const stack = [node];
  while (stack.length > 0) {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    const current = stack.pop();
    /** @type {unknown[]} */
    let children = [];
    if (Array.isArray(current)) children = current;
    else if (isDomObject(current)) {
      if (typeof current.constant === "string") found.push(/** @type {any} */ ({const: current.constant, at: current.at}));
      else if (typeof current.const === "string") found.push(/** @type {any} */ (current));
      else children = Object.values(current);
    }
    for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
  }
  return found;
}
