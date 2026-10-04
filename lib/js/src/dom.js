// Checks that a grammar DOM that did not come from reading a document, the
// bootstrap's or a precompiled one from compiled.json, has the shape the
// reader would have given it (docs/output.md, "The DOM"), so that a corrupt
// or hand-made one is refused rather than failing somewhere inside a parse.

import { characterOfTag, isTag } from "./tags.js";
import { PROPERTY_NAMES } from "./unicode.js";

/** @import { Argument, GrammarDom, Term } from "./types.js" */

const DOM_FUNCTIONS = new Set(["phonemes", "text", "split", "tag", "tags", "classes", "classify", "head", "tail", "last", "from", "after", "matches", "begins", "initial"]);
const DOM_COMPARATORS = new Set(["=", "≠", "∈", "∉", "⊆", "⊈"]);
const DOM_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;
// The directives of the notation (engine §9).
const DIRECTIVE_NAMES = new Set(["ambiguity-resolution", "stage", "include", "features"]);
// A capture's name is all lower case (engine §9).
export const CAPTURE_NAME = /^[a-z][a-z0-9-]*$/;
// The nesting the notation allows (engine §9): deeper than any grammar a
// person writes, and shallow enough for the recursive walks over a DOM.
export const DOM_MAX_DEPTH = 256;

// The version of the DOM's shape (docs/output.md), part of every cache key.
export const DOM_FORMAT = 18;
// A constant's name, without its `$`, begins with a capital (engine §2).
export const CONSTANT_NAME = /^[A-Z][A-Za-z0-9-]*$/;
// A classifier's name begins with a lower-case letter, and a class with a
// capital (engine §2, §9).
export const CLASSIFIER_NAME = /^[a-z][A-Za-z0-9-]*$/;
const CLASS_NAME = /^[A-Z][A-Za-z0-9-]*$/;

// The comparators of a test in a body (engine §2): the two sound tests and
// the four tag tests.
export const TEST_OPS = new Set(["=", "≠", "⊇", "⊉", "∩=∅", "∩≠∅"]);

/**
 * Whether a test's comparator is a sound test, whose value is a string,
 * rather than a tag test, whose value is a tag set (engine §2).
 * @param {string} op
 * @returns {boolean}
 */
export function isSoundTest(op) {
  return op === "=" || op === "≠";
}

/**
 * What is wrong with the string of a sound test (engine §9), or null: one
 * that no canonical sound can be, with a comma or a code point that the
 * lowercase mapping would change. Without a table, the lowercase mapping is
 * not checked.
 * @param {string} sound
 * @param {{lowercase(text: string): string}} [unicode]
 * @returns {string | null}
 */
export function soundProblem(sound, unicode) {
  if (sound.includes(",")) return `the string ${JSON.stringify(sound)} holds a comma, which no canonical sound holds`;
  if (unicode && unicode.lowercase(sound) !== sound) return `the string ${JSON.stringify(sound)} is not in lower case, which every canonical sound is`;
  return null;
}

/**
 * Whether an expression can carry a test (engine §2): a reference other
 * than `#`, a terminal, a range or a property, with no other member.
 * @param {unknown} expr
 * @param {{isMark(code: number): boolean}} unicode
 * @returns {boolean}
 */
function isTestable(expr, unicode) {
  if (!isDomObject(expr) || Object.keys(expr).length !== 1) return false;
  return (typeof expr.ref === "string" && DOM_NAME.test(expr.ref)) || isTag(expr.terminal, unicode) || isCharacterClass(expr, unicode);
}

/**
 * What is wrong with a test's value (engine §9), or null: it must be a
 * closed term, of type string for a sound test and tag set for a tag test,
 * and a string literal of a sound test must be a canonical sound. The shape
 * of the value must already be checked, and its nesting bounded.
 * @param {string} op
 * @param {any} value
 * @param {{lowercase(text: string): string}} [unicode]
 * @returns {{problem: string, node: any} | null}
 */
export function testValueFault(op, value, unicode) {
  const open = openPart(value);
  if (open) return { problem: "a test's operand is a closed term, and reads no capture or span", node: open };
  const found = termType(value);
  if ("problem" in found) return found;
  const problem = expectedProblem(found.type, isSoundTest(op) ? "string" : "tags");
  if (problem) return { problem: `${op} tests ${isSoundTest(op) ? "a string" : "a tag set"}: ${problem}`, node: value };
  if (isSoundTest(op) && typeof value.string === "string") {
    const wrong = soundProblem(value.string, unicode);
    if (wrong) return { problem: wrong, node: value };
  }
  return null;
}

/**
 * What is wrong with a range (engine §1, §9), or null: its ends must be two
 * character tags in their canonical spelling by the table, which says which
 * code points are marks, the start not above the end.
 * @param {unknown} range
 * @param {{isMark(code: number): boolean}} unicode
 * @returns {string | null}
 */
export function rangeProblem(range, unicode) {
  if (!Array.isArray(range) || range.length !== 2) return "a malformed range";
  const codes = range.map((end) => (typeof end === "string" ? characterOfTag(end, unicode) : null));
  if (codes[0] === null || codes[1] === null) return "a range's ends are two character tags";
  if (codes[0] > codes[1]) return `the range ${range[0]}..${range[1]} starts above its end`;
  return null;
}

/**
 * What is wrong with a property's name (engine §1, §9), or null.
 * @param {unknown} name
 * @returns {string | null}
 */
export function propertyProblem(name) {
  if (typeof name !== "string" || !PROPERTY_NAMES.has(name)) return `'\\p{${String(name)}}' is not a property: a property is a General_Category value in its short form, a one-letter group of them, White_Space or Any`;
  return null;
}

/**
 * Whether an expression node is a range or a property that the DOM allows,
 * and has no other member.
 * @param {Record<string, unknown>} value
 * @param {{isMark(code: number): boolean}} unicode
 * @returns {boolean}
 */
function isCharacterClass(value, unicode) {
  if (Object.keys(value).length !== 1) return false;
  if ("range" in value) return rangeProblem(value.range, unicode) === null;
  if ("property" in value) return propertyProblem(value.property) === null;
  return false;
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

const DOM_SPANS = new Set(["head", "tail", "last", "from", "after"]);

/**
 * Whether a term is a span: a capture, or head, tail or last of one.
 * @param {unknown} value
 * @returns {boolean}
 */
function isDomSpan(value) {
  return isDomObject(value) && (typeof value.capture === "string" || (typeof value.call === "string" && DOM_SPANS.has(value.call)));
}


/**
 * The forms of an expression, a term and a condition, each as its members
 * (docs/output.md). The first member names the form.
 */
const EXPRESSION_FORMS = [["seq"], ["choice"], ["and"], ["optional", "elidable?", "maximal?"], ["repeat", "separator?", "chain?"], ["ref"], ["terminal"], ["capture", "expr"],
  ["range"], ["property"], ["test", "value", "expr"], ["empty"]];
const TERM_FORMS = [["union"], ["intersection"], ["difference"], ["if", "then"], ["call", "args"], ["string"], ["tag"], ["range"], ["emptySet"], ["capture"], ["const", "at"]];
const CONDITION_FORMS = [["op", "left", "right"], ["matches", "rule"], ["begins", "rule"], ["initial"], ["not"], ["any"], ["all"], ["captured"], ["if", "then"]];

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
 * the loader's table: the lowercase mapping that the strings of sound
 * tests are checked against, and the marks that decide a character tag's canonical spelling.
 * @param {unknown} dom
 * @param {{lowercase(text: string): string, isMark(code: number): boolean}} unicode
 * @returns {string | null}
 */
export function domProblem(dom, unicode) {
  if (!isDomObject(dom) || dom.format !== DOM_FORMAT || !Array.isArray(dom.rules) || !Array.isArray(dom.directives) || !Array.isArray(dom.constants) ||
      !Array.isArray(dom.classifiers) || !Array.isArray(dom.implications)) return `not a DOM of format ${DOM_FORMAT}`;
  for (const directive of dom.directives) {
    if (!isDomObject(directive) || typeof directive.name !== "string" || !Array.isArray(directive.args) ||
        !directive.args.every((arg) => typeof arg === "string") || !isDomPosition(directive.at)) return "a malformed directive";
    // No directive has a maximal member, and the notation has four
    // directives; %elidable is none of them (engine §9).
    if ("maximal" in directive || !DIRECTIVE_NAMES.has(directive.name)) return "a malformed directive";
    // The operands the notation's syntax allows these directives (engine §9).
    const args = /** @type {string[]} */ (directive.args);
    if ((directive.name === "stage" && !(args.length === 1 && DOM_NAME.test(args[0]))) ||
        (directive.name === "include" && args.length !== 1) ||
        (directive.name === "features" && !(args.length > 0 && args.every((arg) => DOM_NAME.test(arg))))) return "a malformed directive";
  }
  // `whole` marks an alternative's whole expression, where a chain may
  // stand, and `sealed` a place inside braces or an elidable optional,
  // where no capture stands.
  /** @type {{kind: string, value: unknown, depth: number, whole?: boolean, sealed?: boolean}[]} */
  const pending = [];
  // The expressions of the alternatives, whose capture names are checked
  // per production once their shape is.
  /** @type {unknown[]} */
  const expressions = [];
  // The tested symbols, whose values are checked once the nesting is
  // bounded.
  /** @type {Record<string, any>[]} */
  const tests = [];
  // A constant's definition: its name, its op, its position and a value
  // that is a closed term (engine §2, §10).
  for (const constant of dom.constants) {
    if (!isDomObject(constant) || typeof constant.name !== "string" || !CONSTANT_NAME.test(constant.name) ||
        (constant.op !== "define" && constant.op !== "redefine") || !isDomPosition(constant.at) || !("value" in constant) ||
        Object.keys(constant).length !== 4) return "a malformed constant";
    pending.push({ kind: "term", value: constant.value, depth: 0 });
  }
  // A classifier: its name, and entries of gates, canonical keys, an
  // operator and a class (engine §2, §9).
  for (const classifier of dom.classifiers) {
    if (!isDomObject(classifier) || typeof classifier.name !== "string" || !CLASSIFIER_NAME.test(classifier.name) ||
        !Array.isArray(classifier.entries) || !isDomPosition(classifier.at) || Object.keys(classifier).length !== 3) return "a malformed classifier";
    for (const entry of classifier.entries) {
      if (!isDomObject(entry) || Object.keys(entry).length !== 5 || !isDomPosition(entry.at) || (entry.op !== "∈" && entry.op !== "∉") ||
          typeof entry.class !== "string" || !CLASS_NAME.test(entry.class) || !Array.isArray(entry.guards) ||
          !entry.guards.every((guard) => isDomObject(guard) && Object.keys(guard).length === 3 && typeof guard.feature === "string" && DOM_NAME.test(guard.feature) &&
            guard.kind === "gate" && typeof guard.negated === "boolean") ||
          !Array.isArray(entry.keys) || entry.keys.length === 0 ||
          !entry.keys.every((key) => typeof key === "string" && soundProblem(key, unicode) === null)) return "a malformed entry of a classifier";
    }
  }
  // An implication: two closed terms whose type is a tag set, checked once
  // the nesting is bounded (engine §2, §9).
  for (const implication of dom.implications) {
    if (!isDomObject(implication) || Object.keys(implication).length !== 3 || !("if" in implication) || !("then" in implication) ||
        !isDomPosition(implication.at)) return "a malformed implication";
    pending.push({ kind: "term", value: implication.if, depth: 0 });
    pending.push({ kind: "term", value: implication.then, depth: 0 });
  }
  for (const rule of dom.rules) {
    if (!isDomObject(rule) || typeof rule.name !== "string" || !(DOM_NAME.test(rule.name) || rule.name === "#") || !["define", "redefine", "extend"].includes(/** @type {string} */ (rule.op)) ||
        !Array.isArray(rule.alternatives) || rule.alternatives.length === 0 || !Array.isArray(rule.conditions) || !isDomPosition(rule.at) ||
        (rule.opaque !== undefined && rule.opaque !== true)) {
      return "a malformed rule";
    }
    if (rule.tags !== undefined) pending.push({ kind: "constituent-tags", value: rule.tags, depth: 0 });
    if (rule.emit !== undefined) pending.push({ kind: "emission", value: rule.emit, depth: 0 });
    for (const condition of rule.conditions) pending.push({ kind: "condition", value: condition, depth: 0 });
    for (const alternative of rule.alternatives) {
      if (!isDomObject(alternative) || !Array.isArray(alternative.guards) ||
          !alternative.guards.every((guard) => isDomObject(guard) && Object.keys(guard).length === 3 && typeof guard.feature === "string" && DOM_NAME.test(guard.feature) && typeof guard.negated === "boolean" &&
            (guard.kind === "gate" || (guard.kind === "warning" && guard.negated === false)))) {
        return "a malformed alternative";
      }
      // Depth counts the compound nodes above a node (engine §9): the
      // items of a top-level sequence are below one, the sequence.
      pending.push({ kind: "expr", value: alternative.expr, depth: 0, whole: true });
      expressions.push(alternative.expr);
      if (alternative.tags !== undefined) pending.push({ kind: "constituent-tags", value: alternative.tags, depth: 0 });
    }
  }
  for (let task = pending.pop(); task !== undefined; task = pending.pop()) {
    const { kind, value, depth } = task;
    // A function's argument is a term where a span may stand.
    const argument = kind === "argument";
    if (depth > DOM_MAX_DEPTH) return "nested too deeply";
    if (!isDomObject(value)) return `a malformed ${kind}`;
    const next = depth + 1;
    /** @type {(kind: string, value: unknown) => void} */
    const push = (childKind, child) => pending.push({ kind: childKind, value: child, depth: next });
    /** @type {(list: unknown, least: number, most?: number) => boolean} */
    const list = (items, least, most = Infinity) => Array.isArray(items) && items.length >= least && items.length <= most;
    // An expression has exactly the members of one form (docs/output.md).
    if (kind === "expr" && !hasOneForm(value, EXPRESSION_FORMS)) return "a malformed expression";
    // A place inside braces or an elidable optional holds no capture, at
    // any depth (engine §3.5).
    /** @type {(child: unknown, sealed?: boolean) => void} */
    const pushExpr = (child, sealed = false) => pending.push({ kind: "expr", value: child, depth: next, sealed: task.sealed || sealed });
    if (kind === "expr") {
      if ("range" in value || "property" in value) {
        if (!isCharacterClass(value, unicode)) return "a malformed expression";
      } else if ("choice" in value || "seq" in value) {
        const items = "choice" in value ? value.choice : value.seq;
        if (!list(items, 2)) return "a malformed expression";
        for (const item of /** @type {unknown[]} */ (items)) pushExpr(item);
      } else if ("and" in value) {
        if (!list(value.and, 2, 16)) return "a malformed expression";
        for (const item of /** @type {unknown[]} */ (value.and)) pushExpr(item);
      } else if ("repeat" in value) {
        // A chain is the whole expression of its alternative (engine §9),
        // and its direction is left or right. A separator counts on from
        // the depth of its repeat, as the item does.
        if ("chain" in value && (!task.whole || (value.chain !== "left" && value.chain !== "right"))) return "a malformed expression";
        pushExpr(value.repeat, true);
        if ("separator" in value) pushExpr(value.separator, true);
      } else if ("optional" in value) {
        // An elidable optional is marked true, and maximal only with it;
        // its expression begins with its terminal (engine §3.8, §9).
        if (("elidable" in value && value.elidable !== true) || ("maximal" in value && (value.maximal !== true || !("elidable" in value)))) return "a malformed expression";
        if (value.elidable === true && elidableHead(value.optional) === null) return "a malformed elidable optional";
        pushExpr(value.optional, value.elidable === true);
      } else if ("capture" in value) {
        // A capture wraps one symbol: a reference, a terminal, a range, a
        // property or a tested one of these, and stands anywhere but in
        // braces or an elidable optional (engine §3.5, §9).
        if (task.sealed) return "a capture inside braces or an elidable optional";
        const inner = value.expr;
        if (typeof value.capture !== "string" || !CAPTURE_NAME.test(value.capture) || !isDomObject(inner) ||
            !["ref", "terminal", "range", "property", "test"].some((member) => member in inner)) return "a malformed capture";
        pushExpr(inner);
      } else if ("test" in value) {
        // A compound node (engine §9) over one symbol; its value counts on
        // from its depth, and is checked once the nesting is bounded.
        if (typeof value.test !== "string" || !TEST_OPS.has(value.test)) return "a malformed test";
        if (!isTestable(value.expr, unicode)) return "a test follows only a reference other than # or a terminal";
        pushExpr(value.expr);
        push("term", value.value);
        tests.push(value);
      } else if (!((typeof value.ref === "string" && (DOM_NAME.test(value.ref) || value.ref === "#")) || isTag(value.terminal, unicode) || value.empty === true)) {
        // A reference is a name or `#` (engine §9).
        return "a malformed expression";
      }
    } else if (kind === "constituent-tags") {
      // A constituent's tags cannot be made of its own (engine §9).
      if (readsOwnTags(value)) return "a constituent's tags made of its own";
      pending.push({ kind: "term", value, depth });
    } else if (kind === "emission") {
      // The reader's rules (engine §9): $ only with $, a capture listed once,
      // no tags on an inserted tag; no items at all is `ε`. Attachments are
      // lists of named captures, present only when not empty, and only on a
      // named capture.
      if (!list(value.items, 0) || Object.keys(value).length !== 1) return "a malformed emission";
      const items = /** @type {unknown[]} */ (value.items);
      const known = (/** @type {string} */ key) => key === "capture" || key === "insert" || key === "tags" || key === "before" || key === "after";
      if (!items.every((item) => isDomObject(item) && (typeof item.capture === "string") !== (typeof item.insert === "string") && Object.keys(item).every(known))) return "a malformed emission";
      // An inserted item is one tag (engine §9).
      if (!items.every((item) => /** @type {Record<string, unknown>} */ (item).insert === undefined || isTag(/** @type {Record<string, unknown>} */ (item).insert, unicode))) return "a malformed emission";
      const records = /** @type {Record<string, unknown>[]} */ (items);
      const whole = records.filter((item) => item.capture === "");
      if (whole.length && whole.length !== records.length) return "a malformed emission";
      for (const item of records) {
        for (const side of [item.before, item.after]) {
          if (side === undefined) continue;
          if (typeof item.capture !== "string" || item.capture === "" || !list(side, 1) ||
              !(/** @type {unknown[]} */ (side)).every((name) => typeof name === "string" && CAPTURE_NAME.test(name))) return "a malformed emission";
        }
      }
      const captures = records.flatMap((item) => (typeof item.capture === "string" && item.capture !== ""
        ? [item.capture, ...(/** @type {string[]} */ (item.before ?? [])), ...(/** @type {string[]} */ (item.after ?? []))] : []));
      if (new Set(captures).size !== captures.length) return "a malformed emission";
      for (const item of records) {
        if (item.tags === undefined) continue;
        if (typeof item.insert === "string") return "a malformed emission";
        if (isDomObject(item.tags) && item.tags.emptySet === true) return "a malformed emission";
        // An emission is not a compound node (engine §9): its items' tag
        // terms stand at its own depth.
        pending.push({ kind: "term", value: item.tags, depth });
      }
    } else if (kind === "condition") {
      // A condition has exactly the members of one form (docs/output.md).
      if (!hasOneForm(value, CONDITION_FORMS)) return "a malformed condition";
      if ("any" in value || "all" in value) {
        const items = value.any ?? value.all;
        if (!list(items, 2)) return "a malformed condition";
        for (const item of /** @type {unknown[]} */ (items)) push("condition", item);
      } else if ("not" in value) {
        push("condition", value.not);
      } else if ("captured" in value) {
        if (typeof value.captured !== "string" || Object.keys(value).length !== 1) return "a malformed condition";
      } else if ("if" in value) {
        if (Object.keys(value).length !== 2 || !("then" in value)) return "a malformed condition";
        push("condition", value.if);
        push("condition", value.then);
      } else if ("matches" in value || "begins" in value) {
        const span = "matches" in value ? value.matches : value.begins;
        if (typeof value.rule !== "string" || !isDomSpan(span) || ("matches" in value && "begins" in value)) return "a malformed condition";
        pending.push({ kind: "argument", value: span, depth: next });
      } else if ("initial" in value) {
        if (Object.keys(value).length !== 1 || !isDomSpan(value.initial)) return "a malformed condition";
        pending.push({ kind: "argument", value: value.initial, depth: next });
      } else {
        if (typeof value.op !== "string" || !DOM_COMPARATORS.has(value.op)) return "a malformed condition";
        push("term", value.left);
        push("term", value.right);
      }
    } else {
      // A term has exactly the members of one form (docs/output.md). So a
      // node that joins two forms, such as {"tag":…,"string":…}, is refused
      // before it is read, and no library reads it one way where another
      // reads it another way.
      if (!hasOneForm(value, TERM_FORMS)) return "a malformed term";
      if ("if" in value) {
        if (Object.keys(value).length !== 2 || !("then" in value)) return "a malformed term";
        push("condition", value.if);
        push("term", value.then);
      } else if ("union" in value || "intersection" in value || "difference" in value) {
        const items = value.union ?? value.intersection ?? value.difference;
        if (!list(items, 2, "difference" in value ? 2 : Infinity)) return "a malformed term";
        for (const item of /** @type {unknown[]} */ (items)) push("term", item);
      } else if ("call" in value) {
        // The reader's signatures (engine §9), with a span where one is due.
        const args = /** @type {unknown[]} */ (Array.isArray(value.args) ? value.args : []);
        const isRule = (/** @type {unknown} */ arg) => isDomObject(arg) && typeof arg.rule === "string" && Object.keys(arg).length === 1;
        const isClassifier = (/** @type {unknown} */ arg) => isDomObject(arg) && typeof arg.classifier === "string" &&
          CLASSIFIER_NAME.test(arg.classifier) && Object.keys(arg).length === 1;
        const call = value.call;
        let ok;
        if (typeof call !== "string" || !DOM_FUNCTIONS.has(call) || call === "matches" || call === "begins" || call === "initial") ok = false;
        else if (call === "tags") ok = (args.length === 1 && isDomSpan(args[0])) || (args.length === 2 && isDomSpan(args[0]) && isRule(args[1]));
        else if (call === "split") ok = args.length === 2 && args.every((arg) => !isRule(arg) && !isClassifier(arg) && !isDomSpan(arg));
        else if (call === "tag") ok = args.length === 1 && !isRule(args[0]) && !isClassifier(args[0]) && !isDomSpan(args[0]);
        else if (call === "classify") ok = args.length === 2 && !isRule(args[0]) && !isClassifier(args[0]) && !isDomSpan(args[0]) && isClassifier(args[1]);
        else ok = args.length === 1 && isDomSpan(args[0]);
        if (!ok || (!argument && DOM_SPANS.has(/** @type {string} */ (call)))) return "a malformed term";
        const seen = literalCallProblem(/** @type {string} */ (call), args);
        if (seen) return seen;
        for (const arg of args) if (!isRule(arg) && !isClassifier(arg)) pending.push({ kind: "argument", value: arg, depth: next });
      } else if (!(typeof value.string === "string" || isTag(value.tag, unicode) || value.emptySet === true || typeof value.capture === "string" ||
          ("range" in value && rangeProblem(value.range, unicode) === null) ||
          (typeof value.const === "string" && CONSTANT_NAME.test(value.const) && isDomPosition(value.at)))) {
        return "a malformed term";
      }
    }
  }
  // A definition the reader would refuse (engine §9), and terms and
  // conditions whose types do not agree (engine §10).
  // A capture name stands at most once in each production (engine §3.5).
  for (const expr of expressions) {
    if (duplicateCaptures(expr).length > 0) return "a capture name used twice in one production";
  }
  for (const rule of /** @type {any[]} */ (dom.rules)) {
    const problem = definitionProblem(rule) || ruleTypeProblem(rule);
    if (problem) return problem;
  }
  // The walks below recurse, so they run only once the nesting is bounded.
  for (const constant of /** @type {any[]} */ (dom.constants)) {
    if (openPart(constant.value) !== null) return "a constant's value is not a closed term";
  }
  for (const implication of /** @type {any[]} */ (dom.implications)) {
    for (const side of [implication.if, implication.then]) {
      if (openPart(side) !== null) return "a side of an implication is not a closed term";
      const found = termType(side);
      if ("problem" in found) return found.problem;
      const problem = expectedProblem(found.type, "tags");
      if (problem) return `a side of an implication is a tag set: ${problem}`;
    }
  }
  for (const test of tests) {
    const fault = testValueFault(test.test, test.value, unicode);
    if (fault) return fault.problem;
  }
  for (const constant of /** @type {any[]} */ (dom.constants)) {
    const problem = valueTypeProblem(constant.value, constant.op === "redefine");
    if (problem) return problem;
  }
  // The order of a document's items is the order of their positions, so no
  // two items share one (engine §9).
  const positions = new Set();
  for (const item of [.../** @type {{at: [number, number]}[]} */ (dom.rules), .../** @type {{at: [number, number]}[]} */ (dom.directives),
    .../** @type {{at: [number, number]}[]} */ (dom.constants), .../** @type {{at: [number, number]}[]} */ (dom.classifiers),
    .../** @type {{at: [number, number]}[]} */ (dom.implications)]) {
    const key = `${item.at[0]}:${item.at[1]}`;
    if (positions.has(key)) return "two items at one position";
    positions.add(key);
  }
  return null;
}

/**
 * What is wrong with a call of split or tag whose argument the reader sees
 * as a string literal (engine §9, §10), or null: an empty delimiter, or a
 * tag's string that is not a name.
 * @param {string} call
 * @param {unknown[]} args
 * @returns {string | null}
 */
export function literalCallProblem(call, args) {
  const literal = (/** @type {unknown} */ arg) => (isDomObject(arg) && typeof arg.string === "string" ? arg.string : null);
  if (call === "split" && literal(args[1]) === "") return "split has an empty delimiter";
  if (call === "tag") {
    const name = literal(args[0]);
    if (name !== null && !DOM_NAME.test(name)) return `tag(${JSON.stringify(name)}): the string is not a name`;
  }
  return null;
}

/**
 * Whether a value is a grammar DOM, by the loader's table.
 * @param {unknown} dom
 * @param {{lowercase(text: string): string, isMark(code: number): boolean}} unicode
 * @returns {dom is GrammarDom}
 */
export function isDom(dom, unicode) {
  return domProblem(dom, unicode) === null;
}

/**
 * Whether a term, or a condition inside one, reads the tags of `$`, the
 * constituent whose tags it may be defining: `$` as a value, `tags($)` or
 * `classes($)`. A span argument such as `phonemes($)` reads tokens, not tags.
 * The DOM's shape need not have been checked: anything malformed reads
 * nothing, and the check of its shape refuses it.
 * @param {unknown} node
 * @returns {boolean}
 */
export function readsOwnTags(node) {
  if (!isDomObject(node)) return false;
  if (node.capture === "" && Object.keys(node).length === 1) return true;
  if (typeof node.call === "string") {
    if (!Array.isArray(node.args)) return false;
    if ((node.call === "tags" || node.call === "classes") && node.args.length === 1) {
      const span = node.args[0];
      return isDomObject(span) && span.capture === "";
    }
    return node.args.some((argument) => isDomObject(argument) && typeof argument.call === "string" && readsOwnTags(argument));
  }
  if ("matches" in node || "begins" in node || "initial" in node) return false;
  for (const key of ["union", "intersection", "difference", "any", "all"]) {
    const items = node[key];
    if (Array.isArray(items)) return items.some(readsOwnTags);
  }
  return ["left", "right", "not", "if", "then"].some((key) => readsOwnTags(node[key]));
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
  if (!isDomObject(node)) return node;
  if (typeof node.captured === "string") return has(node.captured) ? DOM_TRUE : DOM_FALSE;
  if ("not" in node) {
    const inner = simplify(node.not, has);
    return inner === DOM_TRUE ? DOM_FALSE : inner === DOM_FALSE ? DOM_TRUE : { not: inner };
  }
  if (Array.isArray(node.all)) {
    const items = node.all.map((item) => simplify(item, has));
    if (items.includes(DOM_FALSE)) return DOM_FALSE;
    const left = items.filter((item) => item !== DOM_TRUE);
    return left.length === 0 ? DOM_TRUE : left.length === 1 ? left[0] : { all: left };
  }
  if (Array.isArray(node.any)) {
    const items = node.any.map((item) => simplify(item, has));
    if (items.includes(DOM_TRUE)) return DOM_TRUE;
    const left = items.filter((item) => item !== DOM_FALSE);
    return left.length === 0 ? DOM_FALSE : left.length === 1 ? left[0] : { any: left };
  }
  if ("if" in node) {
    const antecedent = simplify(node.if, has);
    const isTerm = !isCondition(node.then);
    if (antecedent === DOM_FALSE) return isTerm ? DOM_EMPTY : DOM_TRUE;
    const consequent = simplify(node.then, has);
    if (antecedent === DOM_TRUE) return consequent;
    if (isTerm && isEmptySet(consequent)) return DOM_EMPTY;
    if (!isTerm && consequent === DOM_TRUE) return DOM_TRUE;
    if (!isTerm && consequent === DOM_FALSE) return { not: antecedent };
    return { if: antecedent, then: consequent };
  }
  if (Array.isArray(node.union)) {
    const items = node.union.map((item) => simplify(item, has)).filter((item) => !isEmptySet(item));
    return items.length === 0 ? DOM_EMPTY : items.length === 1 ? items[0] : { union: items };
  }
  if (Array.isArray(node.intersection)) {
    const items = node.intersection.map((item) => simplify(item, has));
    return items.some(isEmptySet) ? DOM_EMPTY : { intersection: items };
  }
  if (Array.isArray(node.difference)) {
    const [left, right] = node.difference.map((item) => simplify(item, has));
    return isEmptySet(left) ? DOM_EMPTY : isEmptySet(right) ? left : { difference: [left, right] };
  }
  if (typeof node.op === "string") return { op: node.op, left: simplify(node.left, has), right: simplify(node.right, has) };
  if (typeof node.call === "string" && Array.isArray(node.args)) return { call: node.call, args: node.args.map((argument) => simplify(argument, has)) };
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
  return isDomObject(node) && (typeof node.op === "string" || "not" in node || "all" in node || "any" in node ||
    "matches" in node || "begins" in node || "initial" in node || "captured" in node || ("if" in node && isCondition(node.then)) || "constant" in node);
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
    if (!isDomObject(current) && !Array.isArray(current)) continue;
    if (isDomObject(current) && typeof current.capture === "string" && Object.keys(current).length === 1) names.push(current.capture);
    for (const value of Object.values(current)) if (value && typeof value === "object") stack.push(value);
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
    if (!isDomObject(current) && !Array.isArray(current)) continue;
    if (isDomObject(current) && typeof current.captured === "string") names.push(current.captured);
    for (const value of Object.values(current)) if (value && typeof value === "object") stack.push(value);
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
  return captureSequences(alternative.expr).sequences.map((sequence) => {
    /** @type {Map<string, number>} */
    const captures = new Map([["", -1]]);
    sequence.forEach((capture, index) => captures.set(capture.capture, index));
    return captures;
  });
}

/**
 * The distinct sequences of captures that the productions of an expression
 * read, each in the order read (engine §3.2, §3.5): a choice gives each
 * branch's, an `&` each subsequence's, a plain optional none or its
 * content's, and braces and an elidable optional none. Productions that
 * read the same names in the same order are one sequence. `duplicates` are
 * the captures that some production reads after one of the same name, in
 * no particular order. Gates do not matter, since they drop whole
 * alternatives.
 * @param {any} expr
 * @returns {{sequences: {capture: string}[][], duplicates: {capture: string}[]}}
 */
export function captureSequences(expr) {
  /** @type {Set<{capture: string}>} */
  const duplicates = new Set();
  /** @type {(lists: {capture: string}[][]) => {capture: string}[][]} */
  const distinct = (lists) => {
    const seen = new Set();
    return lists.filter((list) => {
      const key = list.map((capture) => capture.capture).join(" ");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  /** @type {(left: {capture: string}[][], right: {capture: string}[][]) => {capture: string}[][]} */
  const product = (left, right) => {
    /** @type {{capture: string}[][]} */
    const result = [];
    for (const a of left) {
      for (const b of right) {
        for (const capture of b) if (a.some((other) => other.capture === capture.capture)) duplicates.add(capture);
        result.push([...a, ...b]);
      }
    }
    return distinct(result);
  };
  /** @type {(node: any) => {capture: string}[][]} */
  const visit = (node) => {
    if (!isDomObject(node)) return [[]];
    if (typeof node.capture === "string") return [[/** @type {{capture: string}} */ (node)]];
    if (Array.isArray(node.seq)) return node.seq.reduce((/** @type {{capture: string}[][]} */ sequences, /** @type {any} */ item) => product(sequences, visit(item)), [[]]);
    if (Array.isArray(node.choice)) return distinct(node.choice.flatMap(visit));
    if (Array.isArray(node.and)) {
      const parts = node.and.map(visit);
      /** @type {{capture: string}[][]} */
      const result = [];
      for (let mask = 1; mask < 1 << parts.length; mask++) {
        /** @type {{capture: string}[][]} */
        let sequences = [[]];
        parts.forEach((/** @type {{capture: string}[][]} */ part, /** @type {number} */ index) => {
          if (mask & (1 << index)) sequences = product(sequences, part);
        });
        for (const sequence of sequences) result.push(sequence);
      }
      return distinct(result);
    }
    if ("optional" in node) return node.elidable === true ? [[]] : distinct([[], ...visit(node.optional)]);
    return [[]];
  };
  const sequences = visit(expr);
  return { sequences, duplicates: [...duplicates] };
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
  /** @type {{capture: string}[]} */
  const duplicates = [];
  // Each node with the captures below it, gathered after its children: an
  // explicit stack, since the depth of a DOM is bounded only by its check.
  /** @type {{node: any, index: number, captures: {capture: string}[][]}[]} */
  const stack = [{ node: expr, index: 0, captures: [] }];
  /** @type {(node: any) => any[]} */
  const children = (node) => {
    if (!isDomObject(node) || typeof node.capture === "string") return [];
    if (Array.isArray(node.seq)) return node.seq;
    if (Array.isArray(node.choice)) return node.choice;
    if (Array.isArray(node.and)) return node.and;
    if ("optional" in node && node.elidable !== true) return [node.optional];
    return [];
  };
  for (;;) {
    const frame = stack[stack.length - 1];
    const node = frame.node;
    const list = children(node);
    if (frame.index < list.length) {
      stack.push({ node: list[frame.index++], index: 0, captures: [] });
      continue;
    }
    // Every child is done: in a sequence or an &, a capture of a later item
    // whose name an earlier item reads is read twice.
    /** @type {{capture: string}[]} */
    let all = [];
    if (isDomObject(node) && typeof node.capture === "string") all = [/** @type {{capture: string}} */ (node)];
    else if (isDomObject(node) && (Array.isArray(node.seq) || Array.isArray(node.and))) {
      /** @type {Set<string>} */
      const seen = new Set();
      for (const part of frame.captures) {
        for (const capture of part) if (seen.has(capture.capture)) duplicates.push(capture);
        for (const capture of part) seen.add(capture.capture);
        for (const capture of part) all.push(capture);
      }
    } else {
      for (const part of frame.captures) for (const capture of part) all.push(capture);
    }
    stack.pop();
    if (stack.length === 0) break;
    stack[stack.length - 1].captures.push(all);
  }
  return duplicates;
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
    ((typeof node.ref === "string" && /^[A-Z][A-Za-z0-9-]*$/.test(node.ref)) || (typeof node.terminal === "string" && DOM_NAME.test(node.terminal)));
  if (isTerminal(head)) return head;
  if (head.test === "=" && isTerminal(head.expr)) return head;
  return null;
}

/**
 * Why a definition, a rule's alternatives with its own clauses, cannot be
 * read (engine §9), or null. The DOM's shape must already be checked. The
 * checks that simplification decides skip a clause that holds a constant
 * without its value.
 * @param {any} rule
 * @returns {string | null}
 */
export function definitionProblem(rule) {
  // A constant is its value in simplification (engine §3.6). A clause that
  // holds a constant without one waits for the loader, which checks the
  // definition again once the constants have their values (engine §9).
  const waits = (/** @type {unknown} */ clause) => constantsIn(clause).some((reference) => !("value" in reference));
  // A definition with no clause has nothing to check about its captures,
  // and its productions, whose number can be exponential, are not listed.
  if (rule.tags === undefined && rule.conditions.length === 0 && rule.emit === undefined &&
      rule.alternatives.every((/** @type {any} */ alternative) => alternative.tags === undefined)) return null;
  // Each production of each alternative, with the captures it reads
  // (engine §3.5, §9); productions that read the same captures in the same
  // order are one.
  const productions = rule.alternatives.flatMap((/** @type {any} */ alternative) => alternativeCaptures(alternative).map((captures) => ({ captures, alternative })));
  const alternatives = productions.map((/** @type {{captures: Map<string, number>}} */ production) => production.captures);
  const anyHas = (/** @type {string} */ name) => alternatives.some((/** @type {Map<string, number>} */ captures) => captures.has(name));
  const items = rule.emit ? rule.emit.items : [];
  // A constituent that does not count is never an opaque part (engine §9).
  if (rule.opaque && rule.emit && items.length === 0) return `${rule.name} is opaque and emits ε`;
  const clauses = [rule.tags, ...rule.conditions, ...rule.alternatives.map((/** @type {any} */ a) => a.tags), ...items];
  // An emission item mentions its own capture and its attachments,
  // whatever else it says.
  const named = items.flatMap((/** @type {any} */ item) => (typeof item.capture === "string" ? [item.capture, ...attachmentsOf(item)] : []));
  for (const name of [...named, ...clauses.flatMap(capturesMentioned)]) {
    if (!anyHas(name)) return `$${name} is captured by no alternative of ${rule.name}`;
  }
  for (const condition of rule.conditions) {
    if (waits(condition)) continue;
    const applies = alternatives.some((/** @type {Map<string, number>} */ captures) => {
      const simple = simplify(condition, (name) => captures.has(name));
      return simple !== DOM_TRUE && capturesUsed(simple).every((name) => captures.has(name));
    });
    if (!applies) return `a condition of ${rule.name} applies to no production`;
  }
  for (const { captures, alternative } of productions) {
    const has = (/** @type {string} */ name) => captures.has(name);
    for (const term of [rule.tags, alternative.tags]) {
      if (term === undefined || waits(term)) continue;
      const missing = capturesUsed(simplify(term, has)).find((name) => !has(name));
      if (missing !== undefined) return `a tag term of ${rule.name} uses $${missing}, which a production lacks; guard it with $${missing} ⟹`;
    }
    if (!rule.emit) continue;
    const present = items.filter((/** @type {any} */ item) => item.capture === undefined || has(item.capture));
    if (items.length > 0 && present.length === 0) return `%emits of ${rule.name} leaves a production nothing to emit`;
    // A production without an item's carrier lacks its attachments too
    // (engine §9).
    for (const item of items) {
      if (item.capture === undefined || has(item.capture)) continue;
      const stray = attachmentsOf(item).find(has);
      if (stray !== undefined) return `%emits of ${rule.name} attaches $${stray} in a production without its carrier $${item.capture}`;
    }
    // The written order of the captures, attachments included, is the order
    // they stand in (engine §9).
    const written = present.flatMap((/** @type {any} */ item) => (item.capture ? [...(item.before ?? []), item.capture, ...(item.after ?? [])] : []));
    const positions = written.filter(has).map((/** @type {string} */ name) => /** @type {number} */ (captures.get(name)));
    if (positions.some((/** @type {number} */ position, /** @type {number} */ at) => at > 0 && position < positions[at - 1])) {
      return `%emits of ${rule.name} lists captures out of the order they stand in`;
    }
    for (const item of present) {
      if (!item.tags || waits(item.tags)) continue;
      const missing = capturesUsed(simplify(item.tags, has)).find((name) => !has(name));
      if (missing !== undefined) return `a tag term of ${rule.name} uses $${missing}, which a production lacks; guard it with $${missing} ⟹`;
    }
  }
  for (let index = 0; index < items.length; index++) {
    if (items[index].insert === undefined) continue;
    const next = items.slice(index + 1).find((/** @type {any} */ item) => item.capture !== undefined);
    if (next && next.capture !== "" && !alternatives.every((/** @type {Map<string, number>} */ captures) => captures.has(next.capture))) {
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
 * @typedef {"string" | "strings" | "tags" | "span" | "set" | "any"} TermType
 */

/**
 * The type of each constant, where the loader knows it (engine §2); the
 * reader knows none, and gives every constant the type `any`.
 * @typedef {(name: string) => TermType} ConstantTypes
 */

const SET_KINDS = new Set(["strings", "tags", "set"]);
/** @type {Record<string, string>} */
const CALL_STRINGS = { split: "two strings", tag: "one string", classify: "a string and a classifier's name" };
const TYPE_NAMES = { string: "a string", strings: "a set of strings", tags: "a tag set", span: "a span", set: "a set", any: "a value" };
/** @type {ConstantTypes} */
const UNKNOWN_CONSTANTS = () => "any";

/**
 * The type of the value a function gives (engine §10).
 * @param {string} call
 * @returns {TermType}
 */
function callType(call) {
  if (call === "phonemes" || call === "text") return "string";
  if (call === "split") return "strings";
  if (call === "tags" || call === "classes" || call === "tag" || call === "classify") return "tags";
  return "span";
}

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
  if (kinds.size > 1) return { problem: `${operator} joins two sets of one kind, not a set of strings and a tag set` };
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
  if (left === "span" || right === "span") return "a span is not a value: tags($x) is the tag set of $x";
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
 * @param {"string" | "tags"} expected
 * @returns {string | null}
 */
export function expectedProblem(type, expected) {
  if (type === expected || type === "any" || (type === "set" && expected === "tags")) return null;
  if (type === "span") return "a span is not a value: tags($x) is the tag set of $x";
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
  if (typeof term.string === "string") return { type: "string" };
  if (typeof term.tag === "string" || "range" in term) return { type: "tags" };
  if (term.emptySet === true) return { type: "set" };
  if (typeof term.capture === "string") return { type: "span" };
  if (typeof term.const === "string") return { type: constants(term.const) };
  for (const [key, operator] of [["union", "∪"], ["intersection", "∩"], ["difference", "∖"]]) {
    if (!Array.isArray(term[key])) continue;
    /** @type {TermType[]} */
    const types = [];
    for (const item of term[key]) {
      const found = termType(item, constants);
      if ("problem" in found) return found;
      types.push(found.type);
    }
    const joined = joinedType(types, operator);
    return "problem" in joined ? { problem: joined.problem, node: term } : joined;
  }
  if ("if" in term) {
    const fault = conditionTypeFault(term.if, constants);
    if (fault) return fault;
    const then = termType(term.then, constants);
    if ("problem" in then) return then;
    const wrong = expectedProblem(then.type, "tags");
    return wrong ? { problem: wrong, node: term } : { type: "tags" };
  }
  if (typeof term.call === "string") {
    for (const argument of term.args) {
      if ("rule" in argument || "classifier" in argument) continue;
      const found = termType(argument, constants);
      if ("problem" in found) return found;
      if (term.call === "split" || term.call === "tag" || term.call === "classify") {
        const wrong = expectedProblem(found.type, "string");
        if (wrong) return { problem: `${term.call} takes ${CALL_STRINGS[term.call]}: ${wrong}`, node: term };
      }
    }
    return { type: callType(term.call) };
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
  if (Array.isArray(condition.any) || Array.isArray(condition.all)) {
    for (const item of condition.any ?? condition.all) {
      const fault = conditionTypeFault(item, constants);
      if (fault) return fault;
    }
    return null;
  }
  if ("not" in condition) return conditionTypeFault(condition.not, constants);
  if ("if" in condition) return conditionTypeFault(condition.if, constants) || conditionTypeFault(condition.then, constants);
  if (typeof condition.op === "string") {
    const left = termType(condition.left, constants);
    if ("problem" in left) return left;
    const right = termType(condition.right, constants);
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
  // A test's value is a string for a sound test and a tag set for a tag
  // test (engine §9, §10).
  for (const alternative of rule.alternatives) {
    for (const test of testsIn(alternative.expr)) {
      const found = termType(test.value, constants);
      if ("problem" in found) return found;
      const problem = expectedProblem(found.type, isSoundTest(test.test) ? "string" : "tags");
      if (problem) return { problem: `${test.test} tests ${isSoundTest(test.test) ? "a string" : "a tag set"}: ${problem}`, node: test.value };
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
    if (!isDomObject(current)) continue;
    if (typeof current.test === "string") found.push(/** @type {any} */ (current));
    for (const key of ["choice", "and", "seq"]) {
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
  if (!isDomObject(term)) return null;
  if ("capture" in term || "if" in term) return term;
  if (typeof term.call === "string") {
    if (term.call !== "split" && term.call !== "tag") return term;
    for (const argument of Array.isArray(term.args) ? term.args : []) {
      const open = openPart(argument);
      if (open) return open;
    }
    return null;
  }
  for (const key of ["union", "intersection", "difference"]) {
    const items = term[key];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const open = openPart(item);
      if (open) return open;
    }
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
  /** @param {unknown} current */
  const walk = (current) => {
    if (Array.isArray(current)) {
      for (const item of current) walk(item);
    } else if (isDomObject(current)) {
      if (typeof current.const === "string") found.push(/** @type {any} */ (current));
      else for (const value of Object.values(current)) walk(value);
    }
  };
  walk(node);
  return found;
}
