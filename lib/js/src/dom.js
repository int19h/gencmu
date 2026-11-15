import { queryBody, queryCapture } from "./query-forms.js";
import {guardedTagVariants} from "./guarded-tags.js";
import { readsNodeTags } from './ranking-patterns.js';
import { hasUnresolved, argumentReadsCapture, sourceKeys } from "./template-nodes.js";
import { BOUNDARY_METHODS, boundaryProblem } from "./boundary.js";
// Validate source, cached, supplied, and expanded grammar DOMs before use.

import { methodProblem, methodShapeProblem, methodType, METHODS, QUERY_METHODS, SPAN_METHODS, TARGET_METHODS } from "./methods.js";
import { patternParts } from "./patterns.js";
import { layeredPatternFault, layeredPatternProblem } from "./pattern-shapes.js";
import { run } from "./trampoline.js";
import { countWork, hooks } from "./testing.js";
import { clauseChildren, expressionChildren } from "./clause-walk.js";
import { ngrams, splitString } from "./tags.js";

/** @import { Argument, GrammarDom, Term } from "./types.js" */
/** @import { Step } from "./trampoline.js" */

const DOM_COMPARATORS = new Set(["=", "≠", "∈", "∉", "⊆", "⊈", "≅", "≇"]);
// The directives of the notation (engine §9).
const DIRECTIVE_NAMES = new Set(["ambiguity-resolution", "elision-only", "stage", "extend-stage", "redefine-stage", "include", "names", "features"]);
/** The steps of `%ambiguity-resolution` that take a pattern (engine §6). */
export const KEY_STEPS = new Set(["leftmost-longest", "fewest", "most", "late", "early"]);
/** The steps of `%ambiguity-resolution` that compare actions (engine §6). */
export const LEANS = new Set(["greedy", "lazy"]);
/** @param {unknown} steps @returns {boolean} */
export function validSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) return false;
  return steps.every((step,index) => {
    if (!isDomObject(step) || typeof step.step !== "string") return false;
    if (LEANS.has(step.step)) return index === steps.length-1 && Object.keys(step).length === 1;
    return KEY_STEPS.has(step.step) && Object.keys(step).length === 2 && "pattern" in step && isDomObject(step.pattern);
  });
}
// A capture's name is all lower case (engine §9).
export const CAPTURE_NAME = /^(?!.*--)[a-z][a-z0-9_-]*$/;
// The nesting the notation allows (engine §9): deeper than any grammar a
// person writes, and shallow enough for the recursive walks over a DOM.
export const DOM_MAX_DEPTH = 256;

// The version of the DOM's shape (docs/output.md), part of every cache key.
export const DOM_FORMAT = 50;

/** @type {WeakMap<object, object>} */
export const writtenOrigins = new WeakMap();

/**
 * Attach a non-enumerable source position to a DOM node whose JSON schema has
 * no `at` member.
 * @template {object} T
 * @param {T} node
 * @param {import("./types.js").Position | undefined} at
 * @param {string} [field]
 * @returns {T}
 */
export function hideAt(node, at, field = "at") {
  if (node && typeof node === "object" && at) {
    Object.defineProperty(node, field, { value: at, configurable: true, writable: true });
  }
  return node;
}

/**
 * Copy source position properties and written origin from `source` to `target`.
 * @param {any} source
 * @param {any} target
 */
export function copyAt(source, target) {
  if (!source || typeof source !== "object" || !target || typeof target !== "object") return target;
  for (const field of ["at", "nameAt", "classAt", "clauseAt", "tagTermAt", "listAt", "defaultAt", "grouped", "paramAts", "hasHead"]) {
    if (source[field] && !(field in target)) {
      if (Object.prototype.propertyIsEnumerable.call(source, field)) target[field] = source[field];
      else hideAt(target, source[field], field);
    }
  }
  writtenOrigins.set(target, writtenOrigins.get(source) ?? source);
  return target;
}

/**
 * Copy source positions from a freshly read DOM onto an existing cached DOM
 * of the same structure.
 * @param {any} target
 * @param {any} source
 */
export function copyDomLocations(target, source) {
  /** @type {[any, any][]} */
  const pending = [[target, source]];
  const seen = new Set();
  while (pending.length) {
    const [dst, src] = /** @type {[any, any]} */ (pending.pop());
    if (!dst || typeof dst !== "object" || !src || typeof src !== "object" || seen.has(dst)) continue;
    seen.add(dst);
    copyAt(src, dst);
    if (Array.isArray(dst) && Array.isArray(src)) {
      for (let i = Math.min(dst.length, src.length) - 1; i >= 0; i--) pending.push([dst[i], src[i]]);
      continue;
    }
    for (const key of Object.keys(dst)) {
      if (key in src) pending.push([dst[key], src[key]]);
    }
  }
}
// A constant's name, without its `$`, begins with a capital (engine §2).
export const CONSTANT_NAME = /^(?!.*--)[A-Z][A-Za-z0-9_-]*$/;
// A classifier name starts with a lowercase letter. A class name starts
// and ends with an uppercase ASCII letter (engine §2, §9).
export const CLASSIFIER_NAME = /^(?!.*--)[a-z][A-Za-z0-9_-]*$/;
const CLASS_NAME = /^(?!.*--)[A-Z](?:[A-Za-z0-9_-]*[A-Z])?$/;
const FEATURE_NAME = /^(?!.*--)[A-Za-z][A-Za-z0-9-]*$/;

// The comparators of a test in a body (engine §2): the two value tests and
// signed tag requirements.
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
 * What is wrong with a range (engine §1, §9), or null: visible endpoints
 * must each contain one scalar, with the start not above the end.
 * @param {unknown} range
 * @returns {string | null}
 */
export function rangeProblem(range) {
  if (!Array.isArray(range) || range.length !== 2) return "a malformed range";
  const strings = range.map(end => {
    if (isDomObject(end) && typeof end.string === "string") return end.string;

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
  return Array.isArray(value) && value.length === 2 && value.every((n) => Number.isSafeInteger(n));
}




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
 * Why a value is not a grammar DOM, with the source position of the fault, or
 * null when it is one.
 * @param {unknown} dom
 * @param {{isMark(code: number): boolean, changesInDocument?(code:number):boolean, isEmojiName(name:string):boolean, canonicalTag(name:string):string|null}} unicode
 * @param {boolean} [deferEmission] slot checks precede absent-carrier pruning
 * @returns {{problem: string, at?: import("./types.js").Position, code?: string} | null}
 */
export function domFault(dom, unicode, deferEmission = true) {
  return inspectDom(dom, unicode, deferEmission, false);
}

/**
 * Why a value is not a grammar DOM, or null when it is one.
 * The loader's Unicode table supplies engine-tag and emoji-name identities.
 * @param {unknown} dom
 * @param {{isMark(code: number): boolean, changesInDocument?(code:number):boolean, isEmojiName(name:string):boolean, canonicalTag(name:string):string|null}} unicode
 * @param {boolean} [deferEmission] slot checks precede absent-carrier pruning
 * @returns {string | null}
 */
export function domProblem(dom, unicode, deferEmission = true) {
  return domFault(dom, unicode, deferEmission)?.problem ?? null;
}

/**
 * @internal
 * @param {unknown} dom
 * @param {Parameters<typeof domProblem>[1]} unicode
 * @param {boolean} [deferEmission]
 * @param {any[]} [templateConditions]
 * @returns {{problem: string, at?: import("./types.js").Position, code?: string} | null}
 */
export function expandedDomFault(dom, unicode, deferEmission = true, templateConditions = undefined) {
  return inspectDom(dom, unicode, deferEmission, true, templateConditions);
}

/**
 * @internal
 * @param {unknown} dom
 * @param {Parameters<typeof domProblem>[1]} unicode
 * @param {boolean} [deferEmission]
 * @param {any[]} [templateConditions]
 * @returns {string|null}
 */
export function expandedDomProblem(dom, unicode, deferEmission = true, templateConditions = undefined) {
  return expandedDomFault(dom, unicode, deferEmission, templateConditions)?.problem ?? null;
}

/**
 * @param {unknown} dom
 * @param {Parameters<typeof domProblem>[1]} unicode
 * @param {boolean} deferEmission
 * @param {boolean} expanded
 * @param {any[]} [templateConditions] per condition of the one rule, its
 *   form as its template writes it, where it held a parameter (§3.6)
 * @returns {{problem: string, at?: import("./types.js").Position, code?: string} | null}
 */
export function inspectDom(dom, unicode, deferEmission, expanded, templateConditions = undefined) {
  /** @type {(value: unknown) => value is Record<string, any>} */
  const object = isDomObject;
  if (!object(dom) || !Object.keys(dom).every(key => ["format", "rules", "directives", "constants", "classifiers", "implications"].includes(key)) || dom.format !== DOM_FORMAT || !["rules", "directives", "constants", "classifiers", "implications"].every(key => Array.isArray(dom[key]))) return { problem: `not a DOM of format ${DOM_FORMAT}` };
  /** @type {(value: any) => boolean} */
  const position = value => isDomPosition(value) && value.every((/** @type {number} */ n) => n >= 1);
  /** @type {(value: any, fields: string[]) => boolean} */
  const exact = (value, fields) => object(value) && Object.keys(value).every(key => fields.includes(key));
  /** @type {(value: any, fields: string[]) => boolean} */
  const exprExact = (value, fields) => exact(value, [...fields, "at"]) && (!("at" in value) || position(value.at));
  /** @type {(value: any, key: string) => boolean} */
  const exprSingle = (value, key) => exprExact(value, [key]) && key in value;
  /** @type {(value: any) => boolean} */
  const stringAtom = value => object(value) && !value.grouped && ["string", "const"].some(key => key in value);
  /** @type {(value: any) => boolean} */
  const stringTerm = value => !value?.grouped && (stringAtom(value) || object(value) && "param" in value);
  /** @type {(value: any) => boolean} */
  const tag = value => typeof value === "string" && (/^(?!.*--)[A-Z][A-Za-z0-9_-]*$/.test(value) || (value.startsWith("_") && value !== "_" && unicode.canonicalTag(value) === value));
  /** @type {(value: any) => boolean} */
  const constant = value => typeof value === "string" && CONSTANT_NAME.test(value);
  /** @type {(values: any) => boolean} */
  const gates = values => Array.isArray(values) && values.every((/** @type {any} */ gate) => exact(gate, ["feature", "kind", "negated"]) && Object.keys(gate).length === 3 && typeof gate.feature === "string" && FEATURE_NAME.test(gate.feature) && typeof gate.negated === "boolean" && gate.kind === "gate");
  /** @type {(value: any, fallback: import("./types.js").Position | undefined) => import("./types.js").Position | undefined} */
  const nodePos = (value, fallback) => (object(value) && position(value.at) ? value.at : fallback);
  /** @type {(problem: string, value?: any, fallback?: import("./types.js").Position, code?: string) => {problem: string, at?: import("./types.js").Position, code?: string}} */
  const fault = (problem, value = undefined, fallback = undefined, code = undefined) => {
    const at = nodePos(value, fallback);
    return { problem, ...(at ? { at } : {}), ...(code ? { code } : {}) };
  };
  /** @type {any[]} */
  const pending = [];
  let activeParams = new Set();
  /** @type {(kind: string, value: any, depth?: number, context?: any) => void} */
  const push = (kind, value, depth = 0, context = {}) => pending.push({ kind, value, depth, params: activeParams, ...context });
  /** @type {(items: any[], fn: (item: any, index: number) => void) => void} */
  const pushReverse = (items, fn) => {
    for (let index = items.length - 1; index >= 0; index--) fn(items[index], index);
  };
  const ruleName = (/** @type {string} */ name) => typeof name === "string" && (CLASSIFIER_NAME.test(name) || unicode.isEmojiName(name) || expanded && name.includes("(") && name.endsWith(")"));
  /** @type {(value: any) => boolean} */
  const base = value => object(value) && !value.grouped && ("param" in value || "call" in value || "splice" in value || (typeof value.ref === "string") || "literal" in value || "range" in value || value.wildcard === true);
  /** @type {(value: any) => boolean} */
  const target = value => base(value) || object(value) && value.test === "tags" && base(value.expr);
  const positions = new Set();
  const declared = [...dom.rules, ...dom.directives, ...dom.constants, ...dom.classifiers, ...dom.implications];
  for (const item of declared) {
    if (!object(item) || !position(item.at)) return { problem: "a malformed declaration position" };
  }
  for (const item of declared) {
    const key = `${item.at[0]}:${item.at[1]}`;
    if (positions.has(key)) return { problem: "two items at one position", at: item.at };
    positions.add(key);
  }
  const firstStatement = [...dom.rules,...dom.constants,...dom.classifiers,...dom.implications,...dom.directives.filter((/** @type {any} */ d) => d.name !== "names")].map(item => item.at).sort((a,b) => a[0]-b[0] || a[1]-b[1])[0];
  const lateNames = firstStatement && dom.directives.filter((/** @type {any} */ d) => d.name === "names" && (d.at[0] > firstStatement[0] || d.at[0] === firstStatement[0] && d.at[1] > firstStatement[1])).sort((/** @type {any} */ a, /** @type {any} */ b) => a.at[0]-b.at[0] || a.at[1]-b.at[1])[0];
  if (lateNames) return { problem: "%names must precede every other statement", at: lateNames.at };

  /** @type {import("./types.js").Position | null} */
  let firstDeepAt = null;
  /** @type {{problem: string, at?: import("./types.js").Position, code?: string} | null} */
  let firstSemanticFault = null;

  /**
   * @param {import("./types.js").Position} declAt
   * @returns {{problem: string, at?: import("./types.js").Position, code?: string} | null}
   */
  const runShapeTasks = (declAt) => {
    /** @type {{problem: string, at?: import("./types.js").Position, code?: string} | null} */
    let firstShapeFault = null;
    for (let task = pending.pop(); task; task = pending.pop()) {
      const found = runOneShapeTask(task, declAt);
      if (found) {
        if (found.code === "ranked-choice-syntax") return found;
        firstShapeFault ??= found;
      }
    }
    return firstShapeFault;
  };

  /**
   * @param {any} task
   * @param {import("./types.js").Position} declAt
   * @returns {{problem: string, at?: import("./types.js").Position, code?: string} | null}
   */
  const runOneShapeTask = (task, declAt) => {
      if (hooks.work) countWork(hooks.work, "walkSteps");
      const { kind, value, depth } = task;
      const enclosingAt = task.featureDirectiveAt ?? nodePos(value, task.at ?? declAt);
      const report = (/** @type {string} */ problem, /** @type {any} */ targetNode = value, /** @type {string | undefined} */ code = undefined) =>
        fault(problem, task.featureDirectiveAt ? undefined : targetNode, enclosingAt, code);
      activeParams = task.params;
      if (depth > DOM_MAX_DEPTH) {
        firstDeepAt ??= declAt;
      }
      if (!object(value)) return report(`a malformed ${kind}`);
      /** @type {(kind: string, value: any, context?: any) => void} */
      const child = (kind, childValue, context = {}) => push(kind, childValue, depth + 1, {
        params: task.params,
        at: enclosingAt,
        closed: task.closed,
        featureDirectiveAt: task.featureDirectiveAt,
        ...context,
      });
      const fields = Object.keys(value);
      if (kind === "classifier-entry") {
        const badGate = Array.isArray(value.gates) ? value.gates.find((/** @type {any} */ g) => !exact(g, ["feature", "kind", "negated"]) || Object.keys(g).length !== 3 || typeof g.feature !== "string" || !FEATURE_NAME.test(g.feature) || typeof g.negated !== "boolean" || g.kind !== "gate") : undefined;
        if (!exact(value, ["gates", "keys", "op", "class", "at"]) || !position(value.at) || !Array.isArray(value.gates) || badGate || !["∈", "∉"].includes(value.op) || typeof value.class !== "string" || !Array.isArray(value.keys) || !value.keys.length) {
          return report("a malformed classifier entry", badGate ?? value);
        }
        for (const key of value.keys) {
          if (!stringTerm(key)) return report("a malformed classifier key", key);
        }
        push("classifier-class", value, depth, { params: task.params, at: value.classAt ?? value.at });
        pushReverse(value.keys, key => push("term", key, depth, { params: task.params, at: nodePos(key, value.at) }));
        return null;
      }
      if (kind === "classifier-class") {
        if (!CLASS_NAME.test(value.class)) return report(`${value.class} is not a class: a class starts and ends with a capital`, value.classAt ? { at: value.classAt } : value);
        return null;
      }
      if (kind === "alternative") {
        const badGate = Array.isArray(value.gates) ? value.gates.find((/** @type {any} */ g) => !exact(g, ["feature", "kind", "negated"]) || Object.keys(g).length !== 3 || typeof g.feature !== "string" || !FEATURE_NAME.test(g.feature) || typeof g.negated !== "boolean" || g.kind !== "gate") : undefined;
        if (!exact(value, ["gates", "expr", "tags", "value", "image"]) || !("expr" in value) || !Array.isArray(value.gates) || badGate) {
          return report("a malformed alternative", badGate ?? value);
        }
        for (const channel of ["image", "value"]) if (value[channel] !== undefined) push("recipe", value[channel], depth, { params: task.params, at: nodePos(value[channel], enclosingAt), featureDirectiveAt: task.featureDirectiveAt });
        if (value.tags !== undefined) push("tags", value.tags, depth, { params: task.params, constituent: true, owner: task.owner, at: nodePos(value.tags, enclosingAt), featureDirectiveAt: task.featureDirectiveAt });
        push("expr", value.expr, depth, { params: task.params, whole: true, at: nodePos(value.expr, enclosingAt), featureDirectiveAt: task.featureDirectiveAt });
        return null;
      }
      if (kind === "pattern") {
        const pFault = layeredPatternFault(value, { depth, deferDepth: true, name: name => ruleName(name) && !tag(name), terminal: name => name === "_Elided" || tag(name), range: rangeProblem });
        if (pFault) return report(pFault.problem, pFault.node ?? (task.at ? { at: task.at } : value));
        if (layeredPatternProblem(value, { depth, name: name => ruleName(name) && !tag(name), terminal: name => name === "_Elided" || tag(name), range: rangeProblem }) === "nested too deeply") {
          firstDeepAt ??= declAt;
        }
        push("pattern-part", value, depth, { params: task.params, at: enclosingAt, featureDirectiveAt: task.featureDirectiveAt });
        return null;
      }
      if (kind === "pattern-part") {
        if (value.param && !task.params.has(value.param)) return report(`undeclared parameter @${value.param}`);
        if (value.call) {
          const nodes = [value.args];
          while (nodes.length) {
            const node = nodes.pop();
            if (!node || typeof node !== "object") continue;
            if (node.rule && tag(node.rule)) return report("a pattern argument rule reads back as a tag", node);
            const vals = Object.values(node);
            for (let i = vals.length - 1; i >= 0; i--) if (vals[i] && typeof vals[i] === "object") nodes.push(vals[i]);
          }
          pushReverse(value.args, arg => child("arg", arg, { closed: undefined }));
        }
        if (value.children) pushReverse(value.children, item => child("pattern-item", item, { closed: undefined }));
        for (const key of ["union", "intersection", "difference"]) if (value[key]) pushReverse(value[key], operand => child("pattern-part", operand, { closed: undefined }));
        if (value.path) child("pattern-part", value.pattern, { closed: undefined });
        if (value.test === "tags") {
          if (!expanded && object(value.expr) && ["name", "call"].some(k => k in value.expr)) {
            for (const requirement of value.requirements) {
              if (!requirement.negated && requirement.value?.tag === "_Elided") {
                return report("a rule pattern cannot require _Elided", requirement.value);
              }
            }
          }
          pushReverse(value.requirements, requirement => child("term", requirement.value, { patternTag: true, closed: undefined }));
        }
        else if (value.test) child("term", value.value, { closed: undefined });
        if (value.expr) child("pattern-part", value.expr, { closed: undefined });
        if (value.range) {
          const problem = rangeProblem(value.range);
          if (problem) return report(problem);
          pushReverse(value.range, endpoint => push("term", endpoint, depth, { params: task.params, at: enclosingAt, featureDirectiveAt: task.featureDirectiveAt }));
        }
        if (value.literal) push("term", value.literal, depth, { params: task.params, at: enclosingAt, featureDirectiveAt: task.featureDirectiveAt });
        return null;
      }
      if (kind === "pattern-item") {
        if (value.choice) pushReverse(value.choice, arm => pushReverse(arm, item => child("pattern-item", item, { closed: undefined })));
        for (const key of ["separator", "repeat", "optional"]) if (value[key]) pushReverse(value[key], item => child("pattern-item", item, { closed: undefined }));
        if (value.child) child("pattern-part", value.child, { closed: undefined });
        return null;
      }
      // Unresolved leaves still obey the category of their position.
      if ("param" in value) {
        if (!["expr", "arg", "term", "tags", "target", "pattern", "pattern-part"].includes(kind)) return report(`a malformed ${kind}`);
        if (!exact(value, ["param", "at"]) || !position(value.at) || typeof value.param !== "string" || !task.params.has(value.param)) {
          return report(typeof value.param === "string" && exact(value, ["param", "at"]) && position(value.at) ? `undeclared parameter @${value.param}` : "an undeclared or malformed parameter");
        }
        return null;
      }
      if ("call" in value || kind === "call") {
        if (!["expr", "arg", "term", "tags", "target", "pattern", "pattern-part", "call"].includes(kind)) return report(`a malformed ${kind}`);
        if (!exact(value, ["call", "args", "at"]) || !ruleName(value.call) || !position(value.at) || !Array.isArray(value.args) || !value.args.length) return report("a malformed call");
        pushReverse(value.args, arg => child("arg", arg, { closed: undefined }));
        return null;
      }
      if (kind === "arg") {
        if ("classifier" in value || "integer" in value) return report("an argument cannot read or declare captures");
        if ("body" in value) {
          if (!exact(value, ["body"])) return report("a malformed body argument");
          push("expr", value.body, depth, { params: task.params, whole: true, at: enclosingAt, featureDirectiveAt: task.featureDirectiveAt });
        } else if ("targets" in value) {
          if (!exact(value, ["targets"]) || !Array.isArray(value.targets) || value.targets.length < 2) return report("a malformed target choice");
          pushReverse(value.targets, t => push("target", t, depth, { params: task.params, at: enclosingAt, featureDirectiveAt: task.featureDirectiveAt }));
        } else if ("requirements" in value && !value.test) {
          if (!exact(value, ["requirements"]) || !Array.isArray(value.requirements)) return report("a malformed requirement list");
          for (const entry of value.requirements) {
            if (!exact(entry, ["negated", "value"]) || typeof entry.negated !== "boolean" || !object(entry.value) || entry.value.grouped || !(entry.value.tag || entry.value.const || entry.value.param)) return report("a malformed requirement", entry.value ?? entry);
          }
          pushReverse(value.requirements, entry => push("term", entry.value, depth, { params: task.params, at: enclosingAt, featureDirectiveAt: task.featureDirectiveAt }));
        } else if (value.rule) {
          if (!exact(value, ["rule"]) || !ruleName(value.rule)) return report("a malformed nominal rule argument");
        } else if (value.splice || value.test || value.range || value.wildcard) push("expr", value, depth, { params: task.params, at: enclosingAt, featureDirectiveAt: task.featureDirectiveAt });
        else push("term", value, depth, { params: task.params, at: enclosingAt, featureDirectiveAt: task.featureDirectiveAt });
        return null;
      }
      if (kind === "target") {
        if (!(exact(value, ["rule"]) && ruleName(value.rule) || exact(value, ["terminal"]) && /^(?!.*--)[A-Z][A-Za-z0-9_-]*$/.test(value.terminal))) return report("a malformed query target");
        return null;
      }
      if (kind === "test-operands") {
        if (value.test === "tags") {
          for (const requirement of value.requirements) {
            if (!exact(requirement, ["negated", "value"]) || typeof requirement.negated !== "boolean" || !object(requirement.value) || requirement.value.grouped || !("tag" in requirement.value || "const" in requirement.value || "param" in requirement.value)) return report("a malformed requirement", requirement.value ?? requirement);
          }
          pushReverse(value.requirements, requirement => child("term", requirement.value));
        } else {
          if (!stringTerm(value.value)) return report("a malformed value test", value.value);
          child("term", value.value);
        }
        return null;
      }
      if (kind === "method-shape") {
        // An unknown method in a recipe atom is a fault of type inspection,
        // which reports it after the clause's tag terms (engine §9.3).
        const problem = task.recipe && typeof value.method === "string" && !METHODS.has(value.method) ? null : methodShapeProblem(value.method, value.receiver, value.args, task.recipe);
        if (problem) return report(problem);
        if (task.query && METHODS.has(value.method) && !QUERY_METHODS.has(value.method)) return report("a condition requires a query method");
      } else if (kind === "expr") {
        if ("splice" in value) {
          if (!exprSingle(value, "splice") || !object(value.splice) || !(typeof value.splice.ref === "string" && ruleName(value.splice.ref) || value.splice.call)) return report("a malformed splice");
          child("expr", value.splice, { sealed: task.sealed, chain: task.chain, item: task.item, ranked: task.ranked });
        } else if (value.test) {
          if (!TEST_OPS.has(value.test) || !exprExact(value, value.test === "tags" ? ["test", "requirements", "expr"] : ["test", "value", "expr"]) || !(value.test === "tags" ? "requirements" in value : "value" in value) || !("expr" in value) || !(value.test === "tags" ? base(value.expr) : target(value.expr))) return report("a malformed test");
          if (value.test === "tags" && !Array.isArray(value.requirements)) return report("a malformed tag test");
          push("test-operands", value, depth, { params: task.params, at: enclosingAt, closed: task.closed, featureDirectiveAt: task.featureDirectiveAt });
          child("expr", value.expr, { sealed: task.sealed, chain: task.chain, item: task.item, ranked: task.ranked });
        } else if ("capture" in value) {
          if (!exprExact(value, ["capture", "expr"]) || !("expr" in value) || typeof value.capture !== "string" || !object(value.expr)) return report("a malformed capture");
          if (task.chain) return report("a capture cannot stand inside a chain, whose levels are constituents of its rule: a condition on $ serves each level");
          if (task.item && task.ranked) return report("an item capture cannot stand inside a ranked group: name the ranked choice as a rule and capture that rule");
          if (task.sealed && !task.capturedTerminator) return report("a capture cannot stand inside an elidable optional, which elision restores as one unit");
          if (value.capture === "") return report("$ is the whole constituent and wraps nothing");
          if (!CAPTURE_NAME.test(value.capture)) return report("a capture's name is all lower case");
          let inner = value.expr;
          while (object(inner) && !inner.grouped && typeof inner.test === "string") inner = inner.expr;
          if (!base(inner)) return report("a capture wraps one symbol");
          child("expr", value.expr, { sealed: task.sealed, chain: task.chain, item: task.item, ranked: task.ranked });
        } else if (["seq", "choice", "ranked", "and"].some(key => key in value)) {
          const nonAt = fields.filter(k => k !== "at");
          if (nonAt.length !== 1 || !exprExact(value, nonAt)) return report("a malformed expression");
          const key = nonAt[0];
          if (!Array.isArray(value[key]) || value[key].length < 2 || key === "and" && value[key].length > 16) {
            return key === "ranked"
              ? report("ranked-choice-syntax: a ranked expression requires two options", value, "ranked-choice-syntax")
              : report(key === "and" && Array.isArray(value[key]) && value[key].length > 16 ? "an & joins at most 16 items" : "a malformed expression");
          }
          pushReverse(value[key], item => child("expr", item, { sealed: task.sealed, chain: task.chain, item: task.item, ranked: task.ranked || key === "ranked" }));
        } else if ("optional" in value) {
          if (!exprExact(value, ["optional", "elidable", "default"]) || !("optional" in value) || !object(value.optional) || "elidable" in value && (value.elidable !== true || !elidableHead(value.optional))) return report("a malformed optional");
          if ("default" in value) {
            if (value.elidable !== true || !stringTerm(value.default)) return report("a malformed default", value.default);
            if ("string" in value.default) {
              let head = "capture" in value.optional ? value.optional.expr : "seq" in value.optional ? value.optional.seq[0] : value.optional;
              while (object(head) && "test" in head) {
                if (head.test !== "tags" && object(head.value) && "string" in head.value && (value.default.string === head.value.string) !== (head.test === "=")) {
                  return report("a default fails its head test", value.default.defaultAt ? { at: value.default.defaultAt } : value.default);
                }
                head = head.expr;
              }
            }
            child("term", value.default);
          }
          child("expr", value.optional, { sealed: task.sealed || value.elidable, capturedTerminator: !task.sealed && value.elidable && typeof value.optional?.capture === "string", chain: task.chain, item: task.item, ranked: task.ranked });
        } else if ("repeat" in value) {
          if (!exprExact(value, ["repeat", "separator", "chain"]) || "chain" in value && !["left", "right"].includes(value.chain)) return report("a malformed repetition");
          if ("chain" in value && (!task.whole || value.grouped)) return report("a chain is the whole expression of its alternative: name it as a rule to use it here");
          const inside = { sealed: task.sealed, chain: "chain" in value, item: !("chain" in value), ranked: false };
          if ("separator" in value) child("expr", value.separator, inside);
          child("expr", value.repeat, inside);
        } else if ("literal" in value) {
          if (!exprSingle(value, "literal") || !stringTerm(value.literal)) return report("a malformed literal");
          push("term", value.literal, depth, { params: task.params, at: enclosingAt, featureDirectiveAt: task.featureDirectiveAt });
        } else if ("range" in value) {
          if (!exprSingle(value, "range") || !Array.isArray(value.range) || value.range.length !== 2 || !value.range.every(stringTerm)) return report("a malformed range");
          const problem = rangeProblem(value.range);
          if (problem) return report(problem);
          pushReverse(value.range, end => push("term", end, depth, { params: task.params, at: enclosingAt, featureDirectiveAt: task.featureDirectiveAt }));
        } else if ("ref" in value) {
          if (!exprSingle(value, "ref") || !(ruleName(value.ref) || tag(value.ref))) return report("a malformed reference");
        } else if (!((exprSingle(value, "empty") && value.empty === true) || (exprSingle(value, "wildcard") && value.wildcard === true))) {
          return report("a malformed expression");
        }
      } else if (kind === "tags") {
        // A malformed tag term gets its structural fault from its own task.
        let retained = null;
        try { retained = firstEngineLiteral(value); } catch { retained = null; }
        if (retained) return report("a tag clause cannot introduce an engine tag", retained);
        push("term", value, depth, { params: task.params, at: enclosingAt, featureDirectiveAt: task.featureDirectiveAt });
      } else if (kind === "emission") {
        if (fields.length !== 1 || !Array.isArray(value.items) || !value.items.length) return report("a malformed emission");
        for (const item of value.items) {
          if (!exact(item, ["capture", "insert", "tags", "value", "image", "before", "after"]) || ("capture" in item) === ("insert" in item) || "capture" in item && typeof item.capture !== "string" || "insert" in item && item.insert !== true) return report("a malformed emission item", item);
          if (typeof item.capture === "string" && item.capture !== "" && !CAPTURE_NAME.test(item.capture)) return fault("a malformed emission item", undefined, declAt);
          for (const side of ["before", "after"]) if (side in item) {
            if (!item.capture || !Array.isArray(item[side]) || !item[side].length || !item[side].every((/** @type {any} */ name) => typeof name === "string")) return report("a malformed attachment", item);
            if (!item[side].every((/** @type {string} */ name) => CAPTURE_NAME.test(name))) return fault("a malformed attachment", undefined, declAt);
          }
        }
        pushReverse(value.items, item => {
          for (const channel of ["image", "value"]) if (item[channel] !== undefined) push("recipe", item[channel], depth, { params: task.params, at: nodePos(item[channel], nodePos(item, enclosingAt)), featureDirectiveAt: task.featureDirectiveAt });
          if (item.tags !== undefined) push("tags", item.tags, depth, { params: task.params, owner: task.owner, at: nodePos(item.tags, nodePos(item, enclosingAt)), featureDirectiveAt: task.featureDirectiveAt });
        });
      } else if (kind === "recipe") {
        if (fields.length !== 1 || !Array.isArray(value.concat) || !value.concat.length) return report("a malformed recipe");
        if (task.message) {
          if (capturesMentioned(value).some(name => typeof name !== "string")) return report("a malformed message recipe");
          const nodes = [value];
          while (nodes.length) {
            const n = nodes.pop();
            if (n?.method === "emitted") return report("a message recipe cannot read .emitted", value.clauseAt ? { at: value.clauseAt } : value);
            for (const c of clauseChildren(n)) nodes.push(/** @type {any} */ (c));
          }
        }
        for (const atom of value.concat) {
          if (!object(atom)) return report("a malformed recipe atom", atom);
        }
        pushReverse(value.concat, atom => child("term", atom, { recipe: true }));
      } else if (kind === "condition") {
        if (!hasOneForm(value, [["method", "receiver", "args"], ["op", "left", "right"], ["not"], ["any"], ["all"], ["captured"], ["if", "then"], ["nonempty"]])) return report("a malformed condition");
        if ("method" in value) {
          if (typeof value.method !== "string") return report("a condition requires a query method");
          push("term", value, depth, { params: task.params, query: true, at: enclosingAt, featureDirectiveAt: task.featureDirectiveAt });
        } else if ("nonempty" in value) {
          const setConditionAt = object(value.nonempty) && ("union" in value.nonempty || "intersection" in value.nonempty || "difference" in value.nonempty) ? nodePos(value.nonempty, enclosingAt) : undefined;
          push("term", value.nonempty, depth + 1, { params: task.params, setConditionAt, at: enclosingAt, featureDirectiveAt: task.featureDirectiveAt });
        } else if (value.op) {
          if (!DOM_COMPARATORS.has(value.op) || ["≅", "≇"].includes(value.op) && !(typeof value.left?.capture === "string" && Object.keys(value.left).length === 1)) return report("a malformed comparison");
          child("term", value.right);
          child("term", value.left);
        } else if ("captured" in value) {
          if (typeof value.captured !== "string" || value.captured !== "" && !CAPTURE_NAME.test(value.captured)) return report("a malformed presence");
        } else if (value.not) {
          child("condition", value.not);
        } else if (value.if) {
          child("condition", value.then);
          child("condition", value.if);
        } else {
          const values = value.any ?? value.all;
          if (!Array.isArray(values) || values.length < 2) return report("a malformed connective");
          pushReverse(values, condition => child("condition", condition));
        }
      } else {
        if (!hasOneForm(value, [["string"], ["concat"], ["tag"], ["const", "at"], ["emptySet"], ["capture"], ["method", "receiver", "args"], ["union"], ["intersection"], ["difference"], ["if", "then"], ["pattern"]])) return report("a malformed term");
        if ("string" in value) {
          if (typeof value.string !== "string" || /[\uD800-\uDFFF]/u.test(value.string)) return report("a malformed scalar string");
        } else if (value.tag) {
          if (!(task.patternTag && value.tag === "_Elided") && !tag(value.tag)) return report("a malformed tag");
        } else if (value.const) {
          if (!constant(value.const) || !position(value.at)) return report("a malformed constant reference");
        } else if ("emptySet" in value) {
          if (value.emptySet !== true) return report("a malformed empty set");
        } else if ("capture" in value) {
          if (typeof value.capture !== "string" || value.capture !== "" && !CAPTURE_NAME.test(value.capture)) return report("a malformed capture reference");
        } else if ("method" in value) {
          if (["classify", "ngrams"].includes(value.method) && Array.isArray(value.args) && value.args.some(hasUnresolved)) return report("a parameter cannot replace a classifier name or integer argument");
          if (!Array.isArray(value.args) || !object(value.receiver) || (!task.query && QUERY_METHODS.has(value.method) && !["parse", "error-free"].includes(value.method))) {
            return report(!task.query && Array.isArray(value.args) && object(value.receiver) && QUERY_METHODS.has(value.method) ? "a query method is a condition, not a term" : "a malformed method", task.setConditionAt ? { at: task.setConditionAt } : value);
          }
          // Check receiver and args before method-shape so nested ranked choices
          // and argument errors inside them take priority in pre-order.
          if (!task.closed || ["split", "ngrams"].includes(value.method) || !METHODS.has(value.method)) {
            push("method-shape", value, depth, { params: task.params, recipe: task.recipe, query: task.query, at: enclosingAt, featureDirectiveAt: task.featureDirectiveAt });
          }
          if (typeof value.method === "string" && METHODS.has(value.method)) {
            for (let index = value.args.length - 1; index >= 0; index--) {
              const arg = value.args[index];
              if (object(arg) && "body" in arg) {
                if (value.method !== "parse" || !exact(arg, ["body"])) return report("a malformed parse argument", arg);
                const parsed = queryBody(arg.body);
                if (parsed.problem) return report(parsed.problem, arg.body);
                const cap = queryCapture(parsed.body);
                if (cap) return report("a parse argument cannot declare captures", cap);
                push("expr", parsed.body, depth + (Array.isArray(arg.body.seq) && !Array.isArray(parsed.body.seq) ? 2 : 1), { params: task.params, at: nodePos(parsed.body, enclosingAt), featureDirectiveAt: task.featureDirectiveAt });
              } else if (object(arg) && typeof arg.rule === "string") {
                if (Object.keys(arg).length !== 1 || !["without-elision-except", "followed-by", "preceded-by"].includes(value.method) || !ruleName(arg.rule)) return report("a malformed rule argument", value);
              } else if (object(arg) && typeof arg.terminal === "string") {
                if (Object.keys(arg).length !== 1 || !TARGET_METHODS.has(value.method) || !/^(?!.*--)[A-Z][A-Za-z0-9_-]*$/.test(arg.terminal)) return report("a malformed boundary target", value);
              } else if (object(arg) && "integer" in arg) {
                if (Object.keys(arg).length !== 1 || value.method !== "ngrams" || typeof arg.integer !== "string") return report("a malformed integer argument", arg);
                if (!/^[1-9][0-9]*$/.test(arg.integer)) return report("an integer argument is positive and has no leading zeros", arg);
              } else if (object(arg) && typeof arg.classifier === "string") {
                if (Object.keys(arg).length !== 1 || value.method !== "classify" || !CLASSIFIER_NAME.test(arg.classifier)) return report("a malformed classifier argument", value);
              } else {
                child("term", arg);
              }
            }
          }
          child("term", value.receiver, { recipe: task.recipe });
        } else if (value.concat) {
          if (!Array.isArray(value.concat) || value.concat.length < 2) return report("a malformed concatenation");
          pushReverse(value.concat, segment => child("term", segment));
        } else if (value.pattern) {
          child("pattern", value.pattern, { closed: undefined });
        } else if (value.if) {
          child("term", value.then);
          child("condition", value.if);
        } else {
          const items = value.union ?? value.intersection ?? value.difference;
          if (!Array.isArray(items) || items.length < 2 || value.difference && items.length !== 2) return report("a malformed set operation");
          pushReverse(items, item => child("term", item, { setConditionAt: task.setConditionAt }));
        }
      }
    return null;
  };

  /**
   * Single pre-order closedness and engine-tag literal check on a constant or
   * implication term.
   * @param {any} root
   * @param {string} closedFor
   * @param {import("./types.js").Position | undefined} fallback
   * @returns {{problem: string, at?: import("./types.js").Position} | null}
   */
  const closedTermFault = (root, closedFor, fallback) => {
    const stack = [{ node: root, at: nodePos(root, fallback) }];
    while (stack.length) {
      if (hooks.work) countWork(hooks.work, "walkSteps");
      const { node, at: parentAt } = /** @type {{node: any, at: any}} */ (stack.pop());
      if (!object(node)) continue;
      const curAt = nodePos(node, parentAt);
      if ("capture" in node) return fault(`${closedFor} is a closed term, and holds no capture`, node, curAt);
      if ("if" in node) return fault(`${closedFor} is a closed term, and holds no guarded term`, node, curAt);
      if (typeof node.tag === "string" && node.tag.startsWith("_")) return fault(`${closedFor} cannot contain an engine-tag literal`, node, curAt);
      if (node.pattern) continue;
      if (typeof node.method === "string") {
        if (!["split", "ngrams"].includes(node.method)) {
          const recvFault = closedTermFault(node.receiver, closedFor, curAt);
          if (recvFault) return recvFault;
          return fault(`${closedFor} cannot read an input method`, node, curAt);
        }
        for (let i = node.args.length - 1; i >= 0; i--) stack.push({ node: node.args[i], at: curAt });
        stack.push({ node: node.receiver, at: curAt });
        continue;
      }
      const key = ["union", "intersection", "difference", "concat"].find(name => Array.isArray(node[name]));
      if (key) {
        const items = node[key];
        for (let i = items.length - 1; i >= 0; i--) stack.push({ node: items[i], at: curAt });
      }
    }
    return null;
  };

  /**
   * @param {any} root
   * @param {import("./types.js").Position | undefined} fallback
   * @returns {{problem: string, at?: import("./types.js").Position} | null}
   */
  const firstCaptureArgIn = (root, fallback) => {
    const stack = [{ node: root, at: nodePos(root, fallback) }];
    while (stack.length) {
      if (hooks.work) countWork(hooks.work, "walkSteps");
      const { node, at: parentAt } = /** @type {{node: any, at: any}} */ (stack.pop());
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) stack.push({ node: node[i], at: parentAt });
        continue;
      }
      const curAt = nodePos(node, parentAt);
      if (Array.isArray(node.args) && ("call" in node || "alternatives" in node)) {
        for (const arg of node.args) {
          if (argumentReadsCapture(arg)) return fault("an argument cannot read or declare captures", arg, curAt);
        }
      }
      const keys = Object.keys(node);
      for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i];
        if (key === "at") continue;
        stack.push({ node: node[key], at: curAt });
      }
    }
    return null;
  };

  /**
   * @param {any} root
   * @param {any} target
   * @param {import("./types.js").Position | undefined} fallback
   * @returns {import("./types.js").Position | undefined}
   */
  const enclosingAtIn = (root, target, fallback) => {
    if (nodePos(target, undefined)) return nodePos(target, fallback);
    const stack = [{ node: root, at: nodePos(root, fallback) }];
    const seen = new Set();
    while (stack.length) {
      const { node, at } = /** @type {{node: any, at: any}} */ (stack.pop());
      if (!node || typeof node !== "object" || seen.has(node)) continue;
      seen.add(node);
      const curAt = nodePos(node, at);
      if (node === target) return curAt;
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) stack.push({ node: node[i], at: curAt });
        continue;
      }
      const keys = Object.keys(node);
      for (let i = keys.length - 1; i >= 0; i--) {
        if (keys[i] !== "at") stack.push({ node: node[keys[i]], at: curAt });
      }
    }
    return nodePos(target, fallback);
  };

  const allDeclarations = [
    ...dom.directives.map((/** @type {any} */ value) => ({ declKind: "directive", value })),
    ...dom.constants.map((/** @type {any} */ value) => ({ declKind: "constant", value })),
    ...dom.classifiers.map((/** @type {any} */ value) => ({ declKind: "classifier", value })),
    ...dom.implications.map((/** @type {any} */ value) => ({ declKind: "implication", value })),
    ...dom.rules.map((/** @type {any} */ value) => ({ declKind: "rule", value })),
  ].sort((a, b) => a.value.at[0] - b.value.at[0] || a.value.at[1] - b.value.at[1]);

  for (const { declKind, value: decl } of allDeclarations) {
    pending.length = 0;
    activeParams = new Set();
    const declAt = decl.at;
    /** @type {{problem: string, at?: import("./types.js").Position, code?: string} | null} */
    let headerFault = null;

    if (declKind === "directive") {
      const { name, args } = decl;
      if (!DIRECTIVE_NAMES.has(name)) {
        headerFault = fault("a malformed directive", decl, declAt);
      } else if ("conditions" in decl && (name !== "features" || !Array.isArray(decl.conditions) || !decl.conditions.length)) {
        headerFault = fault(name !== "features" ? "only %features accepts conditions" : "malformed feature conditions", decl, declAt);
      } else if (name === "ambiguity-resolution") {
        if ("args" in decl || !validSteps(decl.steps)) {
          headerFault = fault("%ambiguity-resolution requires a pattern for each key step and no operand on a final lean", decl, declAt);
        } else {
          pushReverse(decl.steps, step => {
            if ("pattern" in step) {
              if (Object.hasOwn(step.pattern, "const")) push("term", step.pattern, 0, { at: step.at ?? declAt });
              else push("pattern", step.pattern, 0, { at: step.at ?? nodePos(step.pattern, declAt) });
            }
          });
        }
      } else if (!Array.isArray(args) || args.some((/** @type {any} */ arg) => typeof arg !== "string")) {
        headerFault = fault("a malformed directive", decl, declAt);
      } else if (name === "elision-only" && args.length !== 0) {
        headerFault = fault("a malformed directive", decl, declAt);
      } else if (["stage", "extend-stage", "redefine-stage"].includes(name) && !(args.length === 1 && CLASSIFIER_NAME.test(args[0]))) {
        headerFault = fault(`%${name} takes one lowercase name`, decl, declAt);
      } else if ((name === "include" || name === "names") && args.length !== 1 || name === "features" && !(args.length > 0 && args.every((/** @type {any} */ arg) => FEATURE_NAME.test(arg)))) {
        headerFault = fault(name === "features" ? "%features takes feature names" : "a malformed directive", decl, declAt);
      } else if ("conditions" in decl) {
        pushReverse(decl.conditions, condition => push("condition", condition, 0, { at: declAt, featureDirectiveAt: declAt }));
      }
    } else if (declKind === "constant") {
      if (!exact(decl, ["name", "op", "value", "at"]) || !CONSTANT_NAME.test(decl.name) || !["define", "redefine"].includes(decl.op)) {
        headerFault = fault(typeof decl.name === "string" && !CONSTANT_NAME.test(decl.name) ? "a constant requires a user name" : "a malformed constant", undefined, decl.nameAt ?? declAt);
      } else {
        push("term", decl.value, 0, { at: nodePos(decl.value, declAt), closed: "constant" });
      }
    } else if (declKind === "classifier") {
      if (!exact(decl, ["name", "entries", "at"]) || !(typeof decl.name === "string" && CLASSIFIER_NAME.test(decl.name)) || !Array.isArray(decl.entries)) {
        headerFault = fault(typeof decl.name === "string" && !CLASSIFIER_NAME.test(decl.name) ? `${decl.name} begins with a capital, so it is a tag; a classifier's name begins with a lower-case letter` : "a malformed classifier", undefined, decl.nameAt ?? declAt);
      } else {
        pushReverse(decl.entries, entry => push("classifier-entry", entry, 0, { at: position(entry?.at) ? entry.at : declAt }));
      }
    } else if (declKind === "implication") {
      if (!exact(decl, ["if", "then", "at"])) {
        headerFault = fault("a malformed implication", decl, declAt);
      } else {
        push("term", decl.then, 0, { at: nodePos(decl.then, declAt), closed: "implication" });
        push("term", decl.if, 0, { at: nodePos(decl.if, declAt), closed: "implication" });
      }
    } else {
      const rule = decl;
      activeParams = new Set(Array.isArray(rule.params) ? rule.params : []);
      if ("params" in rule && (!Array.isArray(rule.params) || !rule.params.length || rule.params.some((/** @type {any} */ p) => typeof p !== "string" || !/^(?!.*--)[A-Za-z][A-Za-z0-9_-]*$/.test(p)) || activeParams.size !== rule.params.length || "args" in rule)) {
        const validNames = Array.isArray(rule.params) && rule.params.length > 0 && !("args" in rule) && rule.params.every((/** @type {any} */ p) => typeof p === "string" && /^(?!.*--)[A-Za-z][A-Za-z0-9_-]*$/.test(p));
        const dupIdx = validNames ? rule.params.findIndex((/** @type {string} */ p, /** @type {number} */ i) => rule.params.indexOf(p) < i) : -1;
        headerFault = dupIdx >= 0
          ? fault(`duplicate parameter @${rule.params[dupIdx]}`, undefined, rule.paramAts?.[dupIdx] ?? declAt)
          : fault("malformed template parameters", rule, declAt);
      } else if (rule.instance) {
        if (rule.hasHead) {
          headerFault = fault("a binding requires a plain rule name", rule, declAt);
        } else if (!exact(rule, ["name", "op", "instance", "conditions", "at"]) || !ruleName(rule.name) || !["define", "redefine"].includes(rule.op) || !Array.isArray(rule.conditions) || rule.conditions.length) {
          headerFault = fault(typeof rule.name === "string" && !ruleName(rule.name) ? "a rule name starts with a lowercase letter or uses one eligible emoji" : "a malformed instance binding", undefined, rule.nameAt ?? declAt);
        } else {
          push("call", rule.instance, 0, { at: nodePos(rule.instance, declAt) });
        }
      } else {
        if ("args" in rule) {
          if (!Array.isArray(rule.args) || !rule.args.length) {
            headerFault = fault("a malformed call", undefined, rule.nameAt ?? declAt);
          } else {
            const stack = [...rule.args];
            while (stack.length) {
              const part = stack.pop();
              if (!part || typeof part !== "object") continue;
              if ("param" in part) {
                headerFault = fault("a head cannot mix parameters and concrete arguments", undefined, rule.nameAt ?? declAt);
                break;
              }
              for (const child of Object.values(part)) if (child && typeof child === "object") stack.push(child);
            }
            if (!headerFault && !["redefine", "extend"].includes(rule.op)) {
              headerFault = fault("an instance head requires an edit", undefined, rule.nameAt ?? declAt);
            }
          }
        }
        if (!headerFault && (!exact(rule, ["name", "params", "args", "op", "tags", "value", "image", "alternatives", "emit", "conditions", "erased", "error", "warning", "suppressWarnings", "at"]) || !(typeof rule.name === "string" && ruleName(rule.name)) || !["define", "redefine", "extend"].includes(rule.op) || !Array.isArray(rule.alternatives) || !rule.alternatives.length || !Array.isArray(rule.conditions))) {
          headerFault = fault(typeof rule.name === "string" && !ruleName(rule.name) ? "a rule name starts with a lowercase letter or uses one eligible emoji" : "a malformed rule", undefined, rule.nameAt ?? declAt);
        }
        if (!headerFault && "erased" in rule && rule.erased !== true) {
          headerFault = fault("a malformed erased rule", rule, declAt);
        }
        if (!headerFault && (rule.error !== undefined && rule.warning !== undefined || rule.params && (rule.error !== undefined || rule.warning !== undefined))) {
          headerFault = fault("a definition accepts one diagnostic, and a template accepts none", rule, declAt);
        }
        if (!headerFault && rule.suppressWarnings !== undefined && (!Array.isArray(rule.suppressWarnings) || !rule.suppressWarnings.length || !(rule.suppressWarnings.length === 1 && rule.suppressWarnings[0] === "_") && !rule.suppressWarnings.every((/** @type {any} */ code) => typeof code === "string" && FEATURE_NAME.test(code)))) {
          headerFault = fault("a malformed warning suppression", rule, declAt);
        }
        if (!headerFault) {
          // Push in reverse of rule inspection order so LIFO pops in written order:
          // 1. args (head), 2. tags, 3. value, 4. image, 5. alternatives,
          // 6. conditions, 7. error/warning, 8. emit.
          if (rule.emit !== undefined) push("emission", rule.emit, 0, { owner: rule, at: nodePos(rule.emit, declAt) });
          for (const kind of ["warning", "error"]) if (rule[kind] !== undefined) push("recipe", rule[kind], 0, { message: true, at: nodePos(rule[kind], declAt) });
          pushReverse(rule.conditions, condition => push("condition", condition, 0, { at: nodePos(condition, declAt) }));
          pushReverse(rule.alternatives, alternative => push("alternative", alternative, 0, { owner: rule, at: nodePos(alternative, declAt) }));
          if (rule.image !== undefined) push("recipe", rule.image, 0, { at: nodePos(rule.image, declAt) });
          if (rule.value !== undefined) push("recipe", rule.value, 0, { at: nodePos(rule.value, declAt) });
          if (rule.tags !== undefined) push("tags", rule.tags, 0, { constituent: true, owner: rule, at: nodePos(rule.tags, declAt) });
          if ("args" in rule) push("call", { call: rule.name, args: rule.args, at: rule.nameAt ?? rule.at }, 0, { at: rule.nameAt ?? declAt });
        }
      }
    }

    const shapeFault = headerFault ?? runShapeTasks(declAt);
    if (shapeFault) {
      if (shapeFault.code === "ranked-choice-syntax") return shapeFault;
      if (shapeFault.problem === "split has an empty delimiter") {
        firstSemanticFault ??= shapeFault;
        continue;
      }
      if (firstSemanticFault === null) return shapeFault;
      continue;
    }
    if (firstSemanticFault !== null) continue;

    if (declKind === "directive") {
      firstSemanticFault = firstCaptureArgIn(decl, declAt);
    } else if (declKind === "constant") {
      firstSemanticFault = firstCaptureArgIn(decl, declAt);
      if (!firstSemanticFault) {
        const closedFault = closedTermFault(decl.value, "a constant's value", declAt);
        if (closedFault) {
          firstSemanticFault = closedFault;
        } else {
          const found = constantValueType(decl.value, decl.op === "redefine");
          if ("problem" in found) firstSemanticFault = fault(found.problem, found.node, nodePos(decl.value, declAt));
        }
      }
    } else if (declKind === "implication") {
      firstSemanticFault = firstCaptureArgIn(decl, declAt);
      if (!firstSemanticFault) {
        for (const side of [decl.if, decl.then]) {
          const sideAt = nodePos(side, declAt);
          const closedFault = closedTermFault(side, "a side of an implication", sideAt);
          if (closedFault) { firstSemanticFault = closedFault; break; }
          const found = termType(side);
          if ("problem" in found) { firstSemanticFault = fault(`a side of an implication is a tag set: ${found.problem}`, found.node, sideAt); break; }
          const problem = expectedProblem(found.type, "tags");
          if (problem) { firstSemanticFault = fault(`a side of an implication is a tag set: ${problem}`, side, sideAt); break; }
        }
      }
    } else if (declKind === "rule") {
      const rule = decl;
      if (!rule.instance) {
        if (rule.tags !== undefined) {
          const typeFault = tagTermFault(rule.tags);
          if (typeFault) firstSemanticFault = fault(typeFault.problem, typeFault.at ? { at: typeFault.at } : typeFault.node, enclosingAtIn(rule, typeFault.node, declAt));
          else if (readsOwnTags(rule.tags)) {
            firstSemanticFault = fault("a constituent's tags cannot be made of its own: $.tags or $.classes", rule.tags?.clauseAt ? { at: rule.tags.clauseAt } : rule.tags, nodePos(rule.tags, declAt));
          }
        }
        for (const alternative of rule.alternatives) {
          if (firstSemanticFault) break;
          const altAt = nodePos(alternative, declAt);
          const twice = duplicateCaptures(alternative.expr);
          if (twice.length > 0) {
            const first = /** @type {any} */ (twice.reduce((a, b) => {
              const pa = /** @type {any} */ (a).at, pb = /** @type {any} */ (b).at;
              return pa && pb && (pb[0] < pa[0] || pb[0] === pa[0] && pb[1] < pa[1]) ? b : a;
            }));
            firstSemanticFault = fault(`the capture $${first.capture} is read twice by one production of the alternative`, first, enclosingAtIn(alternative.expr, first, altAt));
            break;
          }
          const repeatedItem = repeatsItemCapture(alternative.expr);
          if (repeatedItem) {
            firstSemanticFault = fault(`the item capture $${repeatedItem.capture} is read again: the name of an item capture stands once in its alternative`, repeatedItem, enclosingAtIn(alternative.expr, repeatedItem, altAt));
            break;
          }
          if (alternative.tags !== undefined) {
            const typeFault = tagTermFault(alternative.tags);
            if (typeFault) {
              firstSemanticFault = fault(typeFault.problem, typeFault.at ? { at: typeFault.at } : typeFault.node, enclosingAtIn(rule, typeFault.node, declAt));
              break;
            }
            if (readsOwnTags(alternative.tags)) {
              firstSemanticFault = fault("a constituent's tags cannot be made of its own: $.tags or $.classes", alternative.tags?.clauseAt ? { at: alternative.tags.clauseAt } : alternative.tags, nodePos(alternative.tags, altAt));
              break;
            }
          }
        }
      }
      if (!firstSemanticFault) {
        firstSemanticFault = firstCaptureArgIn(rule, declAt);
      }
      if (!firstSemanticFault && !rule.instance) {
        const typeFault = ruleTypeFault(rule);
        if (typeFault) {
          firstSemanticFault = fault(typeFault.problem, typeFault.at ? { at: typeFault.at } : typeFault.node, enclosingAtIn(rule, typeFault.node, declAt));
        }
      }
      if (!firstSemanticFault && !rule.instance && rule.emit) {
        const names = [];
        for (const item of rule.emit.items) {
          if (item.capture) names.push(item.capture);
          for (const side of ["before", "after"]) if (item[side]) for (const name of item[side]) names.push(name);
        }
        if (new Set(names).size !== names.length) {
          firstSemanticFault = fault("an emission lists a capture twice", rule.emit, declAt);
        }
      }
      if (!firstSemanticFault && !rule.instance) {
        const bFault = boundaryProblem(rule);
        if (bFault) {
          firstSemanticFault = fault(bFault.problem, bFault.node, enclosingAtIn(rule, bFault.node, declAt));
        } else if (rule.erased && (rule.emit || rule.value || rule.image)) {
          firstSemanticFault = fault("a malformed erased rule", rule, declAt);
        } else if (rule.erased && rule.alternatives.some((/** @type {any} */ a) => a.value !== undefined || a.image !== undefined)) {
          firstSemanticFault = fault("a recipe beside erasure", rule, declAt);
        } else {
          const defProblem = definitionProblem(rule, deferEmission, dom.rules.length === 1 ? templateConditions : undefined);
          if (defProblem) firstSemanticFault = fault(defProblem, rule, declAt);
        }
      }
    }
  }

  if (firstSemanticFault) return firstSemanticFault;
  if (firstDeepAt) return { problem: "nested too deeply", at: firstDeepAt };
  return null;
}

/** @param {any} term @returns {Set<string>} */
export function engineLiterals(term) {
  return run(literalNames(term));
}

/** @param {any} term @returns {any} */
function firstEngineLiteral(term) {
  const retained = run(literalTerms(term));
  return retained[0] ?? null;
}

/** @param {any} term @returns {Generator<Step, any[], any>} */
function* literalTerms(term) {
  if (!term || typeof term !== "object") return [];
  if (typeof term.tag === "string" && term.tag.startsWith("_")) return [term];
  if (term.if) return yield literalTerms(term.then);
  if (term.difference) return yield literalTerms(term.difference[0]);
  const values = term.union ?? term.intersection;
  if (!values) return [];
  const parts = [];
  for (const value of values) parts.push(yield literalTerms(value));
  if (term.union) return parts.flat();
  const names = parts.map(list => new Set(list.map((/** @type {any} */ value) => value.tag)));
  return parts.flat().filter(value => names.every(set => set.has(value.tag)));
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


/**
 * Whether a value is a grammar DOM, by the loader's table.
 * @param {unknown} dom
 * @param {{isMark(code: number): boolean, changesInDocument?(code:number):boolean, isEmojiName(name:string):boolean, canonicalTag(name:string):string|null}} unicode
 * @param {boolean} [deferEmission] slot checks precede absent-carrier pruning
 * @returns {dom is GrammarDom}
 */
export function isDom(dom, unicode, deferEmission = true) {
  return domProblem(dom, unicode, deferEmission) === null;
}

/**
 * Whether a term, or a condition inside one, reads the tags of `$`, the
 * constituent whose tags it defines: `$.tags` or `$.classes`.
 * A string method such as `$.value` reads tokens, not tags.
 * The DOM's shape need not have been checked: anything malformed reads
 * nothing, and the check of its shape refuses it.
 * @param {unknown} node
 * @returns {boolean}
 */
export function readsOwnTags(node) {
  // Only $.tags and $.classes read the constituent's own tags.
  // Bare $ and $.value read input values.
  // The parts to look at, with an explicit stack: the depth of a term is
  // bounded only once the whole document is read (engine §9).
  const stack = [node];
  while (stack.length > 0) {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    const current = stack.pop();
    if (!isDomObject(current)) continue;
    if (typeof current.method === "string") {
      if ((current.method === "tags" || current.method === "classes") && /** @type {any} */ (current).args?.length === 0 && /** @type {any} */ (current).receiver?.capture === "") return true;
      if (current.method === "tags" || QUERY_METHODS.has(current.method)) continue;
      stack.push(/** @type {any} */ (current).receiver);
      for (const arg of /** @type {any} */ (Array.isArray(current.args) ? current.args : [])) stack.push(arg);
      continue;
    }
    if (current.op === "≅" || current.op === "≇") {
      if(/** @type {any} */ (current).left?.capture === "" && /** @type {any} */ (current).right?.pattern && readsNodeTags(/** @type {any} */ (current).right.pattern)) return true;
      continue;
    }
    const key = ["union", "intersection", "difference", "concat", "any", "all"].find((name) => Array.isArray(current[name]));
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
 * become the empty set. An undefined answer retains its presence test
 * for a partial assignment.
 * @param {any} node a condition or a term
 * @param {(name: string) => boolean | undefined} has
 * @returns {any}
 */
export function simplify(node, has) {
  return run(simplifying(node, has))[0];
}

/**
 * The steps of simplify, run without the call stack.
 * @param {any} node
 * @param {(name: string) => boolean | undefined} has
 * @param {WeakMap<object, any>} [fixed]
 * @returns {Generator<Step, any, any>}
 */
function* simplifying(node, has, fixed) {
  if (!isDomObject(node)) return [node, undefined];
  if (fixed?.has(node)) {
    let known = fixed.get(node);
    if (known === null) { known = yield simplifying(node, has); fixed.set(node, known); }
    return known;
  }
  if (typeof node.captured === "string") {
    const present = has(node.captured);
    return present === undefined ? [node, node.captured] : [present ? DOM_TRUE : DOM_FALSE, undefined];
  }
  if ("not" in node) {
    const [inner, guard] = yield simplifying(node.not, has, fixed);
    return inner === DOM_TRUE ? [DOM_FALSE, undefined] : inner === DOM_FALSE ? [DOM_TRUE, undefined]
      : [inner === node.not ? node : {not:inner}, guard];
  }
  if (Array.isArray(node.all) || Array.isArray(node.any)) {
    const key = node.all ? "all" : "any";
    const deciding = key === "all" ? DOM_FALSE : DOM_TRUE;
    const dropped = key === "all" ? DOM_TRUE : DOM_FALSE;
    const parts = [];
    let guard, unchanged = true;
    for (const item of /** @type {any[]} */ (node[key])) {
      const [part, next] = yield simplifying(item, has, fixed);
      if (part === deciding) return [deciding, undefined];
      if (part !== dropped) { parts.push(part); guard ??= next; }
      unchanged &&= part === item;
    }
    return parts.length === 0 ? [dropped, undefined] : parts.length === 1 ? [parts[0], guard]
      : [unchanged ? node : {[key]:parts}, guard];
  }
  if ("if" in node) {
    const [antecedent, guard] = yield simplifying(node.if, has, fixed);
    const isTerm = !isCondition(node.then);
    if (antecedent === DOM_FALSE) return [isTerm ? DOM_EMPTY : DOM_TRUE, undefined];
    const [consequent, next] = yield simplifying(node.then, has, fixed);
    if (antecedent === DOM_TRUE) return [consequent, next];
    if (isTerm && isEmptySet(consequent)) return [DOM_EMPTY, undefined];
    if (!isTerm && consequent === DOM_TRUE) return [DOM_TRUE, undefined];
    if (!isTerm && consequent === DOM_FALSE) return [{not:antecedent}, guard];
    return [antecedent === node.if && consequent === node.then ? node : {if:antecedent, then:consequent}, guard ?? next];
  }
  if ("nonempty" in node) {
    const [term, guard] = yield simplifying(node.nonempty, has, fixed);
    // A set term that simplifies to the empty set is false (engine §3.6).
    if (isEmptySet(term)) return [DOM_FALSE, guard];
    // A closed set term that is not empty is true (engine §3.6).
    const closed = closedSetValue(term);
    if (closed !== null && closed.size > 0) return [DOM_TRUE, guard];
    return [term === node.nonempty ? node : {nonempty:term}, guard];
  }
  if (Array.isArray(node.union) || Array.isArray(node.intersection)) {
    const key = node.union ? "union" : "intersection";
    const parts = [];
    let guard, unchanged = true;
    for (const item of /** @type {any[]} */ (node[key])) {
      const [part, next] = yield simplifying(item, has, fixed);
      if (isEmptySet(part)) {
        if (key === "intersection") return [DOM_EMPTY, undefined];
        unchanged = false;
      } else { parts.push(part); guard ??= next; }
      unchanged &&= part === item;
    }
    if (key === "union" && parts.length === 0) return [DOM_EMPTY, undefined];
    if (key === "union" && parts.length === 1) return [parts[0], guard];
    return [unchanged ? node : {[key]:parts}, guard];
  }
  if (Array.isArray(node.difference)) {
    const [left, guard] = yield simplifying(node.difference[0], has, fixed);
    const [right, next] = yield simplifying(node.difference[1], has, fixed);
    return isEmptySet(left) ? [DOM_EMPTY, undefined] : isEmptySet(right) ? [left, guard]
      : [left === node.difference[0] && right === node.difference[1] ? node : {difference:[left,right]}, guard ?? next];
  }
  if (typeof node.op === "string") {
    const [left, guard] = yield simplifying(node.left, has, fixed);
    const [right, next] = yield simplifying(node.right, has, fixed);
    return [left === node.left && right === node.right ? node : {op:node.op,left,right}, guard ?? next];
  }
  return [node, undefined];
}

/**
 * Whether a bare empty set stands as the term of a wrapper anywhere in a
 * condition, in a Boolean position or in the guard of a term inside one.
 * @param {any} condition
 * @returns {boolean}
 * @internal
 */
export function hasBareEmptySet(condition) {
  const pending = [condition];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) { for (let index = node.length - 1; index >= 0; index--) pending.push(node[index]); continue; }
    if (isDomObject(node.nonempty) && node.nonempty.emptySet === true && Object.keys(node.nonempty).length === 1) return true;
    for (const key of Object.keys(node)) if (key !== "at") pending.push(node[key]);
  }
  return false;
}

/**
 * The value of a closed set term, or null where the term is not closed or
 * its value is not fixed. A closed term is the term of §10, read as the
 * template writes it: it holds no capture, no span, no query, no
 * classifier and no guarded term.
 * @param {any} node
 * @returns {Set<string> | null}
 */
function closedSetValue(node) {
  if (!isDomObject(node)) return null;
  if (node.emptySet === true && Object.keys(node).length === 1) return new Set();
  if (typeof node.tag === "string" && Object.keys(node).length === 1) return new Set([node.tag]);
  if (typeof node.string === "string" && Object.keys(node).length === 1) return new Set([node.string]);
  if (typeof node.const === "string" && isDomObject(node.value) && node.value.set instanceof Set) return /** @type {Set<string>} */ (node.value.set);
  if (Array.isArray(node.union) || Array.isArray(node.intersection)) {
    const key = node.union ? "union" : "intersection";
    /** @type {Set<string> | null} */
    let result = node.union ? new Set() : null;
    for (const part of /** @type {any[]} */ (node[key])) {
      const value = closedSetValue(part);
      if (value === null) return null;
      result = result === null ? value : node.union ? new Set([...result, ...value]) : new Set([...result].filter((/** @type {string} */ item) => value.has(item)));
    }
    return result ?? new Set();
  }
  if (Array.isArray(node.difference)) {
    const left = closedSetValue(node.difference[0]);
    const right = closedSetValue(node.difference[1]);
    if (left === null || right === null) return null;
    return new Set([...left].filter((item) => !right.has(item)));
  }
  // `.split` and `.ngrams` on a closed string are closed (§10). Every
  // other method, `.classify` among them, keeps the term open.
  if ((node.method === "split" || node.method === "ngrams") && isDomObject(node.receiver) && Array.isArray(node.args)) {
    const receiver = closedStringValue(node.receiver);
    if (receiver === null) return null;
    if (node.method === "ngrams") {
      const arg = node.args[0];
      if (!isDomObject(arg) || typeof arg.integer !== "string" || !/^[1-9][0-9]*$/.test(arg.integer)) return null;
      return ngrams(receiver, arg.integer);
    }
    const delimiter = node.args.length === 1 ? closedStringValue(node.args[0]) : null;
    if (delimiter === null || delimiter === "") return null;
    return splitString(receiver, delimiter);
  }
  return null;
}

/**
 * The value of a closed string term, or null where the term is not a
 * closed string (§10): a string, a string constant, or a concatenation
 * of closed strings.
 * @param {any} node
 * @returns {string | null}
 */
function closedStringValue(node) {
  if (!isDomObject(node)) return null;
  if (typeof node.string === "string" && Object.keys(node).length === 1) return node.string;
  if (typeof node.const === "string" && isDomObject(node.value) && typeof node.value.string === "string") return node.value.string;
  if (Array.isArray(node.concat)) {
    let result = "";
    for (const part of node.concat) {
      const value = closedStringValue(part);
      if (value === null) return null;
      result += value;
    }
    return result;
  }
  return null;
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
  while (isDomObject(current) && !(typeof current.op === "string" || "not" in current || "all" in current || "any" in current || "nonempty" in current ||
    (typeof current.method === "string" && ["parse", "error-free", "starts-input", "ends-input", "followed-by", "preceded-by"].includes(current.method)) || "captured" in current || "constant" in current)) {
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
  const prepared = { join, parts, list, fixed: [], values: [], guards: new Map(), absent: undefined };
  // Only fixed terms can vanish. A condition with no presence test stays open.
  const vanishes = (/** @type {any} */ value) => join === "union" && isEmptySet(value);
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
      if (join === null || vanishes(absent) || ((join === "all" || join === "any") && absent === DOM_TRUE)) {
        const value = simplify(part.then, hasNone);
        prepared.values[at] = value;
        prepared.absent = absent;
        // A part that vanishes where its capture is present too is never
        // kept.
        if (join !== null && vanishes(value)) return;
        index(name, at);
        return;
      }
    } else if (testsNoPresence(part)) {
      const value = simplify(part, hasNone);
      prepared.values[at] = value;
      if (join !== null && vanishes(value)) return;
      // A condition of a list that uses a capture is dropped by every
      // production without it. So it is kept under the first such name,
      // and a production without that name never looks at it.
      if (list) {
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
    // A guarded part whose capture the production lacks makes the ∨ true.
    if (names.size < guards.size) return DOM_TRUE;
    for (const name of guards.keys()) {
      if (hooks.work) countWork(hooks.work, "walkSteps");
      if (!has(name)) return DOM_TRUE;
    }
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
    const children = clauseChildren(current);
    for (let index = children.length - 1; index >= 0; index--) {
      const value = children[index];
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return names;
}

/**
 * The captures a clause mentions at all, presence tests included.
 * @param {unknown} node
 * @returns {string[]}
 */
export function capturesMentioned(node) {
  const names = [], stack = [node];
  for (let current = stack.pop(); current !== undefined; current = stack.pop()) {
    if (hooks.work) countWork(hooks.work, "walkSteps");
    if (!isDomObject(current) && !Array.isArray(current)) continue;
    if (isDomObject(current)) {
      if (typeof current.capture === "string") names.push(current.capture);
      if (typeof current.captured === "string") names.push(current.captured);
    }
    const children = clauseChildren(current);
    for (let index = children.length - 1; index >= 0; index--) {
      const value = children[index];
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return names;
}

/**
 * The item captures of an expression: the captures inside flat braces, each
 * with the innermost flat braces around it and the outermost ones (engine
 * §3.5). The production of the alternative reads the outermost braces as
 * one symbol, so the check of item conditions places them among its
 * captures. A chain holds no capture, which the reader makes sure of, so a
 * capture inside a chain's braces is not listed.
 * @param {any} expr
 * @returns {Map<string, {braces: any, outer: any}>} name to its innermost
 *   and outermost flat braces
 */
export function itemCaptures(expr) {
  /** @type {Map<string, {braces: any, outer: any}>} */
  const found = new Map();
  // A loop rather than recursion, since the reader calls this on every
  // alternative, however deeply it nests (engine §9).
  /** @type {[any, {braces: any, outer: any} | null][]} */
  const stack = [[expr, null]];
  for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
    const [node, place] = top;
    if (!isDomObject(node)) continue;
    if (hooks.work) countWork(hooks.work, "walkSteps");
    if (typeof node.capture === "string") {
      if (place !== null && !found.has(node.capture)) found.set(node.capture, place);
      stack.push([node.expr, place]);
      continue;
    }
    if ("repeat" in node) {
      const inner = node.chain === undefined ? { braces: node, outer: place ? place.outer : node } : place;
      if (node.separator !== undefined) stack.push([node.separator, inner]);
      stack.push([node.repeat, inner]);
      continue;
    }
    const children = expressionChildren(/** @type {any} */ (node));
    for (let index = children.length - 1; index >= 0; index--) stack.push([children[index], place]);
  }
  return found;
}

/**
 * The later capture node when the name of an item capture stands more than
 * once in an expression, inside its braces or outside them (engine §3.5, §9),
 * or null.
 * @param {any} expr
 * @returns {any}
 */
function repeatsItemCapture(expr) {
  const items = itemCaptures(expr);
  if (items.size === 0) return null;
  /** @type {Set<string>} */
  const seen = new Set();
  const stack = [expr];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (!isDomObject(node)) continue;
    if (typeof node.capture === "string" && items.has(node.capture)) {
      if (seen.has(node.capture)) return node;
      seen.add(node.capture);
    }
    const children = expressionChildren(/** @type {any} */ (node));
    for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
  }
  return null;
}

/**
 * The sequences of captures that the productions of an expression read, as
 * `captureSequences` lists them, with each pair of flat braces that the
 * production reads as the braces node itself. The item captures inside the
 * braces stay out, as in every production. The check of item conditions
 * compares the place of the braces with the places of the captures a
 * condition reads (engine §3.6).
 * @param {any} expr
 * @returns {unknown[][]}
 */
export function bracesSequences(expr) {
  /** @type {(node: any) => unknown[][]} */
  const visit = (node) => {
    if (!isDomObject(node)) return [[]];
    if (hooks.work) countWork(hooks.work, "walkSteps");
    if (typeof node.capture === "string") return [[node.capture]];
    if ("repeat" in node) {
      if (node.chain === undefined) return [[node]];
      // A chain holds no capture, and its levels read its item and
      // separator, with any flat braces inside them (engine §3.3).
      const items = visit(node.repeat);
      if (node.separator === undefined) return items;
      const separators = visit(node.separator);
      return [...items, ...separators.flatMap((left) => items.map((right) => [...left, ...right]))];
    }
    if (Array.isArray(node.seq)) {
      /** @type {unknown[][]} */
      let sequences = [[]];
      for (const item of node.seq) {
        const next = visit(item);
        sequences = sequences.flatMap((left) => next.map((right) => [...left, ...right]));
      }
      return sequences;
    }
    if (Array.isArray(node.choice) || Array.isArray(node.ranked)) return /** @type {unknown[]} */ (node.choice ?? node.ranked).flatMap(visit);
    if (Array.isArray(node.and)) {
      const parts = node.and.map(visit);
      /** @type {unknown[][]} */
      const result = [];
      for (let mask = 1; mask < 1 << parts.length; mask++) {
        /** @type {unknown[][]} */
        let sequences = [[]];
        parts.forEach((/** @type {unknown[][]} */ part, /** @type {number} */ index) => {
          if (mask & (1 << index)) sequences = sequences.flatMap((left) => part.map((right) => [...left, ...right]));
        });
        for (const sequence of sequences) result.push(sequence);
      }
      return result;
    }
    if ("optional" in node) {
      if (node.elidable === true && !/** @type {any} */ (node.optional)?.capture) return [[]];
      return [[], ...visit(node.optional)];
    }
    return [[]];
  };
  return visit(expr);
}

/**
 * The clauses of a rule in the inspection order of engine §2, each with its
 * kind and mentioned captures.
 * @param {any} rule
 * @returns {Generator<{kind: "a clause" | "condition" | "%emits", clause: any, names: string[]}>}
 */
function* ruleClauses(rule) {
  for (const clause of [rule.tags, rule.value, rule.image, ...rule.alternatives.flatMap((/** @type {any} */ a) => [a.tags, a.value, a.image])]) {
    if (clause !== undefined) yield { kind: "a clause", clause, names: capturesMentioned(clause) };
  }
  for (const clause of rule.conditions) {
    yield { kind: "condition", clause, names: capturesMentioned(clause) };
  }
  for (const clause of [rule.error, rule.warning]) {
    if (clause !== undefined) yield { kind: "a clause", clause, names: capturesMentioned(clause) };
  }
  for (const item of rule.emit ? rule.emit.items : []) {
    const names = [
      ...(typeof item.capture === "string" ? [item.capture] : []),
      ...capturesMentioned(item.tags),
      ...capturesMentioned(item.value),
      ...capturesMentioned(item.image),
      ...attachmentsOf(item),
    ];
    yield { kind: "%emits", clause: item, names };
  }
}

/**
 * Why the item captures of a definition cannot be read (engine §3.6, §9),
 * or null. Only a condition reads an item capture. In each alternative
 * whose item captures it reads, such a condition reads the item captures
 * of one pair of braces, no `$`, and no capture that a production binds
 * after those braces. A pattern comparison names no item capture. Like
 * any condition, an item condition must apply to some production: here a
 * production of its braces' helper, with the captures that the enclosing
 * production binds before the braces.
 * @param {any} rule
 * @param {(clause: unknown) => boolean} waits whether a clause waits for
 *   the value of a constant
 * @param {Iterable<{kind: "a clause" | "condition" | "%emits", clause: any, names: string[]}>} [clauses]
 * @returns {string | null}
 */
function itemCaptureProblem(rule, waits, clauses = ruleClauses(rule)) {
  const places = rule.alternatives.map((/** @type {any} */ alternative) => itemCaptures(alternative.expr));
  /** @type {Set<string>} */
  const itemNames = new Set(places.flatMap((/** @type {Map<string, {braces: any, outer: any}>} */ place) => [...place.keys()]));
  if (itemNames.size === 0) return null;
  /** @type {Map<any, unknown[][]>} */
  const sequences = new Map();
  /** @type {Map<any, string[][]>} */
  const helperSequences = new Map();
  for (const { kind, clause, names } of clauses) {
    if (kind !== "condition") {
      const item = names.find((name) => itemNames.has(name));
      if (item !== undefined) return `${kind} of ${rule.name} names $${item}, an item capture, which only a condition reads`;
      continue;
    }
    const condition = clause;
    const mentioned = [...new Set(names)];
    const inside = mentioned.filter((name) => itemNames.has(name));
    if (inside.length === 0) continue;
    if (mentioned.includes("")) return `a condition of ${rule.name} reads $${inside[0]}, an item capture, together with $, which is not complete at each item`;
    const prepared = waits(condition) ? null : prepareClause(condition);
    let applies = prepared === null;
    for (const [index, alternative] of rule.alternatives.entries()) {
      const place = places[index];
      const here = inside.filter((name) => place.has(name));
      if (here.length === 0) {
        // The condition reads no item capture of this alternative, so
        // here it is an ordinary condition of the alternative's
        // productions.
        if (!applies) applies = ordinaryApplies(prepared, alternative);
        continue;
      }
      const first = /** @type {{braces: any, outer: any}} */ (place.get(here[0]));
      const other = here.find((name) => /** @type {{braces: any}} */ (place.get(name)).braces !== first.braces);
      if (other !== undefined) return `a condition of ${rule.name} reads $${here[0]} and $${other}, item captures of two pairs of braces`;
      const outer = mentioned.filter((name) => !place.has(name));
      let listed = sequences.get(alternative);
      if (!listed) sequences.set(alternative, (listed = bracesSequences(alternative.expr)));
      let helper = helperSequences.get(first.braces);
      if (!helper) helperSequences.set(first.braces, (helper = braceHelperSequences(first.braces)));
      for (const sequence of listed) {
        const at = sequence.indexOf(first.outer);
        if (at === -1) continue;
        const late = outer.find((name) => sequence.indexOf(name) > at);
        if (late !== undefined) return `a condition of ${rule.name} reads $${late} with the item capture $${here[0]}, but a production binds $${late} after the braces`;
        if (applies) continue;
        // The frame holds the captures bound before the braces (engine §4).
        const before = /** @type {string[]} */ (sequence.slice(0, at).filter((name) => typeof name === "string"));
        for (const items of helper) {
          /** @type {Map<string, number>} */
          const captures = new Map([["", -1]]);
          before.forEach((name) => captures.set(name, -1));
          items.forEach((name, position) => captures.set(name, position));
          const has = (/** @type {string} */ name) => captures.has(name);
          const simple = simplifyFor(/** @type {any} */ (prepared), has, captures);
          if ((applies = simple !== DOM_TRUE && capturesUsed(simple).every(has))) break;
        }
      }
    }
    if (!applies) return `a condition of ${rule.name} applies to no production`;
  }
  return null;
}

/**
 * The capture sequences of the productions of a flat list's helper: each
 * item, and each separator followed by an item (engine §3.2).
 * @param {any} braces
 * @returns {string[][]}
 */
function braceHelperSequences(braces) {
  const items = captureSequences(braces.repeat);
  if (braces.separator === undefined) return items;
  const separators = captureSequences(braces.separator);
  return [...items, ...separators.flatMap((left) => items.map((right) => [...left, ...right]))];
}

/**
 * Whether a prepared condition applies to some production of an
 * alternative, as an ordinary condition (engine §3.6).
 * @param {any} prepared
 * @param {any} alternative
 * @returns {boolean}
 */
function ordinaryApplies(prepared, alternative) {
  return alternativeCaptures(alternative).some((captures) => {
    const has = (/** @type {string} */ name) => captures.has(name);
    const simple = simplifyFor(prepared, has, captures);
    return simple !== DOM_TRUE && capturesUsed(simple).every(has);
  });
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
      if (node.elidable === true && !/** @type {any} */ (node.optional)?.capture) return [root];
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
 * never meet. Braces isolate item captures. An elidable optional exports only its terminator capture.
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
 * name begins with a capital, or a declared parameter before expansion.
 * Only `=`, `≠`, and `tags` tests unwrap, after selecting the first `seq` item.
 * @param {any} expr
 * @returns {any}
 */
export function elidableHead(expr) {
  if (!isDomObject(expr) || expr.grouped) return null;
  const head = typeof expr.capture === "string" ? expr.expr : Array.isArray(expr.seq) ? expr.seq[0] : expr;
  if (!isDomObject(head) || head.grouped) return null;
  /** @type {(node: any) => boolean} */
  const isTerminal = (node) => isDomObject(node) && !node.grouped && (typeof node.param === "string" || Object.keys(node).every(k => k === "ref" || k === "at") && typeof node.ref === "string" && /^(?!.*--)[A-Z][A-Za-z0-9_-]*$/.test(node.ref));
  if (isTerminal(head)) return head;
  /** @type {any} */
  let base = head;
  while (isDomObject(base) && !base.grouped && typeof base.test === "string" && TEST_OPS.has(base.test)) base = base.expr;
  if (isTerminal(base)) return head;
  return null;
}

/** @type {WeakMap<object,{kind:"independent"|"recipe-capture"|"empty-emission",problem:string}>} */
const deferredDefinitionProblems = new WeakMap();
/** @param {object} rule */
export const deferredRecipeProblem = rule => {
  const issue = deferredDefinitionProblems.get(rule);
  return issue?.kind === "recipe-capture" ? issue.problem : undefined;
};
/** @param {object} rule @returns {string | undefined} */
export const deferredEmissionProblem = rule => {
  const issue = deferredDefinitionProblems.get(rule);
  return issue?.kind === "empty-emission" ? issue.problem : undefined;
};

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

/** @typedef {{count:number, names:any, key:any, mask?:number, present?:Set<string>}} CaptureWitness */
/** @param {any} tree @returns {any[]} */
function witnessList(tree) {
  const out=[], pending=[tree];
  while(pending.length) {
    const part=pending.pop();
    if(Array.isArray(part)) { pending.push(part[1]); pending.push(part[0]); }
    else if(part!==null && part!==undefined) out.push(part);
  }
  return out;
}
/** @param {CaptureWitness} a @param {CaptureWitness} b @returns {number} */
function witnessOrder(a,b) {
  const x=[a.key],y=[b.key];
  while(x.length && y.length) {
    const u=x[x.length-1],v=y[y.length-1];
    if(u===null || u===undefined) {x.pop();continue;}
    if(v===null || v===undefined) {y.pop();continue;}
    if(u===v) {x.pop();y.pop();continue;}
    if(Array.isArray(u)) {x.pop();x.push(u[1]);x.push(u[0]);continue;}
    if(Array.isArray(v)) {y.pop();y.push(v[1]);y.push(v[0]);continue;}
    return u-v;
  }
  return x.some(v=>v!==null&&v!==undefined)?1:y.some(v=>v!==null&&v!==undefined)?-1:0;
}
/** One bounded-state walk, with no product of production capture lists.
 * @param {any} expr @param {Set<string>} required @param {Set<string>} forbidden
 * @param {string[]} [order] @returns {CaptureWitness|null} */
function captureWitness(expr,required,forbidden,order=[]) {
  if(forbidden.has('') || [...required].some(name=>forbidden.has(name))) return null;
  required=new Set([...required].filter(name=>name!==''));
  const empty=()=>({count:0,names:null,key:null});
  const pick=(/** @type {Map<number,CaptureWitness>} */ into,/** @type {number} */ state,/** @type {CaptureWitness} */ candidate)=>{
    const old=into.get(state);
    if(!old || candidate.count>old.count || candidate.count===old.count && witnessOrder(candidate,old)<0) into.set(state,candidate);
  };
  const join=(/** @type {Map<number,CaptureWitness>} */ left,/** @type {Map<number,CaptureWitness>} */ right)=>{
    const out=new Map();
    for(const [a,x] of left) for(const [b,y] of right) {
      if(a&b || a&2 && b&1) continue;
      pick(out,a|b,{count:x.count+y.count,names:[x.names,y.names],key:[x.key,y.key]});
    }
    return out;
  };
  /** @param {any} node @returns {Generator<any,Map<number,CaptureWitness>,any>} */
  function* visit(node) {
    if(hooks.work) countWork(hooks.work,'clauses');
    if(node.capture!==undefined) return forbidden.has(node.capture) ? new Map() : new Map([[order[0]===node.capture?1:order[1]===node.capture?2:0,{count:+required.has(node.capture),names:node.capture,key:null}]]);
    const children=node.seq??node.choice??node.ranked??node.and;
    if(children) {
      let all=new Map([[0,empty()]]);
      if(node.choice || node.ranked) {
        all.clear();
        for(let i=0;i<children.length;i++) for(const [state,w] of yield visit(children[i])) pick(all,state,{...w,key:[i,w.key]});
      } else if(node.and) {
        // States include the selected mask, but keep only its earliest value.
        let selected=new Map();
        for(let i=0;i<children.length;i++) {
          const part=yield visit(children[i]);
          const next=new Map(selected);
          for(const [state,w] of part) pick(next,state,{...w,key:[1<<i,w.key],mask:1<<i});
          for(const [a,x] of selected) for(const [b,y] of part) {
            if(a&b || a&2 && b&1) continue;
            const mask=(x.mask??0)|(1<<i);
            // Remove the old mask before joining child keys.
            pick(next,a|b,{count:x.count+y.count,names:[x.names,y.names],key:[mask,[x.key[1],y.key]],mask});
          }
          selected=next;
        }
        all=selected;
      } else for(const child of children) all=join(all,yield visit(child));
      return all;
    }
    if(node.optional && (!node.elidable || node.optional.capture)) {
      const out=new Map([[0,{...empty(),key:0}]]);
      for(const [state,w] of yield visit(node.optional)) pick(out,state,{...w,key:[1,w.key]});
      return out;
    }
    if(node.test) return yield visit(node.expr);
    return new Map([[0,empty()]]);
  }
  const result=run(visit(expr)).get(order.length?3:0);
  if(result?.count!==required.size) return null;
  result.present=new Set(['',...witnessList(result.names)]);
  return result;
}
/** @param {any} expr @returns {boolean} */
function variableCaptures(expr) {
  /** @type {any[][]} */ const pending=[[expr,false]];
  /** @type {{has:boolean,variable:boolean}[]} */ const done=[];
  while(pending.length) {
    const [node,ready]=/** @type {any[]} */ (pending.pop());
    const children=node.seq??node.choice??node.ranked??node.and??(node.optional&&(!node.elidable||node.optional.capture)?[node.optional]:node.test?[node.expr]:[]);
    if(!ready) { pending.push([node,true]); for(let i=children.length-1;i>=0;i--) pending.push([children[i],false]); continue; }
    const parts=done.splice(done.length-children.length,children.length);
    /** @type {boolean} */ const has=node.capture!==undefined || parts.some(x=>x.has);
    const variable=parts.some(x=>x.variable) || has && !!(node.optional || children.length>1 && (node.choice||node.ranked||node.and));
    done.push({has,variable});
  }
  return !!done[0].variable;
}
/** @param {any} expr @returns {Map<string,number>[] | null} */
function independentCaptureChoices(expr) {
  const branches = [expr], seen = new Set();
  /** @type {Map<string,number>[]} */
  const lists = [];
  while (branches.length) {
    const branch = branches.pop();
    if (branch.choice || branch.ranked) {
      const parts = branch.choice ?? branch.ranked;
      for (let i = parts.length - 1; i >= 0; i--) branches.push(parts[i]);
      continue;
    }
    if (branch.test) { branches.push(branch.expr); continue; }
    if (variableCaptures(branch)) return null;
    const caps = new Map([["", -1]]), pending = [branch];
    while (pending.length) {
      const node = pending.pop();
      if (node.capture !== undefined) caps.set(node.capture, caps.size - 1);
      else if (node.seq) for (let i = node.seq.length - 1; i >= 0; i--) pending.push(node.seq[i]);
      else if (node.choice || node.ranked || node.and) pending.push((node.choice ?? node.ranked ?? node.and)[0]);
      else if (node.test) pending.push(node.expr);
    }
    const key = JSON.stringify([...caps.keys()]);
    if (!seen.has(key)) { seen.add(key); lists.push(caps); }
  }
  return lists;
}

/** Fixed clause parts keep the same reduction across guard assignments.
 * @param {any} value @returns {WeakMap<object,any>} */
function fixedClauseParts(value) {
  const fixed = new WeakMap(), free = new WeakMap();
  const pending = [[value, false]];
  while (pending.length) {
    const [node, ready] = /** @type {[any,boolean]} */ (pending.pop());
    if (!node || typeof node !== "object" || free.has(node)) continue;
    const children = clauseChildren(node);
    if (!ready) {
      pending.push([node,true]);
      for (const child of children) pending.push([child,false]);
    } else {
      const stable = (typeof node.captured !== "string" || node.captured === "") && children.every(child => !child || typeof child !== "object" || free.get(child) !== false);
      free.set(node,stable);
      if (stable) fixed.set(node,null);
    }
  }
  return fixed;
}

/** @param {any} rule @param {any} alternative @returns {Map<string,number>[]} */
export function validationCaptures(rule,alternative) {
  const lists = independentCaptureChoices(alternative.expr);
  if (lists !== null) return lists;
  /** @type {CaptureWitness[]} */ const witnesses=[];
  const ask=(/** @type {Iterable<string>} */ required=[],/** @type {Iterable<string>} */ forbidden=[],/** @type {string[]} */ order=[])=>{
    const found=captureWitness(alternative.expr,new Set(required),new Set(forbidden),order);
    if(found) witnesses.push(found);
  };
  const initial=captureWitness(alternative.expr,new Set(),new Set(),[]);
  if(initial) witnesses.push(initial);
  const items=rule.emit?.items??[];
  const mentioned=[rule.tags,rule.value,rule.image,rule.error,rule.warning,...rule.conditions,...rule.alternatives.flatMap((/** @type {any} */ a)=>[a.tags,a.value,a.image]),...items];
  for(const clause of mentioned) for(const name of capturesMentioned(clause)) ask([name]);
  for(const item of items) if(item.capture!==undefined) for(const name of [item.capture,...attachmentsOf(item)]) ask([name]);
  const clause=(/** @type {any} */ value,/** @type {boolean} */ condition,/** @type {string[]} */ carrier=[])=>{
    if(value===undefined || constantsIn(value).some(ref=>!('value' in ref))) return;
    if(!condition && value.union) { for(const part of value.union) clause(part,false,carrier); return; }
    const fixed=fixedClauseParts(value);
    const branch=(/** @type {any} */ part,/** @type {string[]} */ yes,/** @type {string[]} */ no,/** @type {CaptureWitness} */ witness)=>{
      const [simple,guard]=run(simplifying(part,name=>name===''||yes.includes(name)?true:no.includes(name)?false:undefined,fixed));
      if(simple===DOM_TRUE) return;
      const extend=(/** @type {string[]} */ required,/** @type {string[]} */ forbidden)=>{
        const names=/** @type {Set<string>} */ (witness.present);
        return required.every(name=>names.has(name)) && forbidden.every(name=>!names.has(name))
          ? witness : captureWitness(alternative.expr,new Set(required),new Set(forbidden),[]);
      };
      if(guard!==undefined) {
        const absent=[...no,guard], present=[...yes,guard];
        const without=extend(yes,absent);
        if(without) branch(simple,yes,absent,without);
        const withGuard=extend(present,no);
        if(withGuard) branch(simple,present,no,withGuard);
        return;
      }
      const used=capturesUsed(simple);
      if(condition) {
        const found=extend([...carrier,...yes,...used],no);
        if(found) witnesses.push(found);
      } else for(const name of used) {
        const found=extend([...carrier,...yes],[...no,name]);
        if(found) witnesses.push(found);
      }
    };
    if(initial) branch(value,[],[],initial);
  };
  for(const c of rule.conditions) clause(c,true);
  for(const t of [rule.tags,alternative.tags]) clause(t,false);
  for(const t of [alternative.value??rule.value,alternative.image??rule.image??alternative.value??rule.value,rule.error,rule.warning]) if(t) for(const name of capturesUsed(t)) ask([],[name]);
  if(items.length && !items.some((/** @type {any} */ item)=>item.insert || item.capture==='')) ask([],items.map((/** @type {any} */ item)=>item.capture));
  const written=[];
  for(const item of items) {
    const carrier=item.capture===undefined?[]:[item.capture];
    if(item.capture!==undefined) for(const name of attachmentsOf(item)) ask([name],[item.capture]);
    for(const recipe of [item.value,item.image]) if(recipe) for(const name of capturesUsed(recipe)) ask(carrier,[name]);
    clause(item.tags,false,carrier);
    if(item.capture) for(const name of [...(item.before??[]),item.capture,...(item.after??[])]) written.push({name,carrier:item.capture});
    if(item.capture!==undefined) ask([],[item.capture]);
  }
  for(let i=0;i<written.length;i++) for(let j=i+1;j<written.length;j++) if(written[i].name!==written[j].name) ask([written[i].name,written[i].carrier,written[j].name,written[j].carrier],[],[written[j].name,written[i].name]);
  witnesses.sort(witnessOrder);
  const seen=new Set();
  return witnesses.map(w=>new Map([['',-1],...witnessList(w.names).map((name,i)=>/** @type {[string,number]} */ ([name,i]))])).filter(caps=>{const key=JSON.stringify([...caps]); if(seen.has(key)) return false; seen.add(key); return true;});
}

/**
 * Why a definition, a rule's alternatives with its own clauses, cannot be
 * read (engine §9), or null. The DOM's shape must already be checked. The
 * checks that simplification decides skip a clause that holds a constant
 * without its value.
 * @param {any} rule
 * @param {boolean} [deferEmission] slot checks precede absent-carrier pruning
 * @param {any[]} [templateConditions] per condition, its form as its
 *   template writes it, where it held a parameter (engine §3.6)
 * @returns {string | null}
 */
export function definitionProblem(rule, deferEmission = false, templateConditions = undefined) {
  if (rule.error && rule.warning || rule.params && (rule.error || rule.warning)) return "a definition accepts one diagnostic, and a template accepts none";
  if (rule.suppressWarnings !== undefined && (!Array.isArray(rule.suppressWarnings) || !rule.suppressWarnings.length || !(rule.suppressWarnings.length === 1 && rule.suppressWarnings[0] === "_") && !rule.suppressWarnings.every((/** @type {any} */ code) => typeof code === "string" && FEATURE_NAME.test(code)))) return "a malformed warning suppression";
  deferredDefinitionProblems.delete(rule);
  const defer = deferEmission && ruleHasRanked(rule);
  for (const issue of definitionIssues(rule, templateConditions)) {
    if (defer && (issue.kind === "recipe-capture" || issue.kind === "empty-emission")) {
      const previous = deferredDefinitionProblems.get(rule);
      if (!previous || previous.kind === "empty-emission" && issue.kind === "recipe-capture") deferredDefinitionProblems.set(rule, issue);
    } else return issue.problem;
  }
  return null;
}

/** @param {any} rule @param {any[]} [templateConditions] @returns {Generator<{kind:"independent"|"recipe-capture"|"empty-emission",problem:string}, void, unknown>} */
function* definitionIssues(rule, templateConditions = undefined) {
  // A constant is its value in simplification (engine §3.6). A clause that
  // holds a constant without one waits for the loader, which checks the
  // definition again once the constants have their values (engine §9).
  // Each clause is looked at once, since the checks below ask again for
  // every production.
  /** @type {Map<unknown, boolean>} */
  const waiting = new Map();
  const waits = (/** @type {unknown} */ clause) => {
    let known = waiting.get(clause);
    if (known === undefined) waiting.set(clause, (known = hasUnresolved(clause) || constantsIn(clause).some((reference) => !("value" in reference))));
    return known;
  };
  // A definition with no clause has nothing to check about its captures,
  // and its productions, whose number can be exponential, are not listed.
  if (rule.tags === undefined && rule.conditions.length === 0 && rule.emit === undefined &&
      rule.alternatives.every((/** @type {any} */ alternative) => alternative.tags === undefined && alternative.value === undefined && alternative.image === undefined) && rule.value === undefined && rule.image === undefined && rule.error === undefined && rule.warning === undefined) return;
  // Each production of each alternative, with the captures it reads
  // (engine §3.5, §9); productions that read the same captures in the same
  // order are one.
  const productions = rule.alternatives.flatMap((/** @type {any} */ alternative) => validationCaptures(rule,alternative).map((captures) => ({ captures, alternative })));
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
  const itemNames = new Set(rule.alternatives.flatMap((/** @type {any} */ alternative) => [...itemCaptures(alternative.expr).keys()]));
  const anyHas = (/** @type {string} */ name) => capturing.has(name) || itemNames.has(name);
  const items = rule.emit ? rule.emit.items : [];
  const clauses = [...ruleClauses(rule)];
  for (const { names } of clauses) for (const name of names) {
    if (!anyHas(name)) yield {kind:"independent", problem:`$${name} is captured by no alternative of ${rule.name}`};
  }
  if (itemNames.size > 0) {
    const problem = itemCaptureProblem(rule, waits, clauses);
    if (problem) yield {kind:"independent", problem};
  }
  // A bare empty set in a Boolean position has no kind, so it is an
  // error wherever it stands: in a condition, or in the guard of a
  // guarded term in a tag clause (engine §10).
  for (const { clause } of clauses) {
    if (hasBareEmptySet(clause)) yield {kind:"independent", problem:`a condition of ${rule.name} is the empty set`};
  }
  for (const [conditionIndex, condition] of rule.conditions.entries()) {
    if (hasBareEmptySet(condition)) { yield {kind:"independent", problem:`a condition of ${rule.name} is the empty set`}; continue; }
    if (waits(condition)) continue;
    // An item condition applies to the productions of its braces' helper
    // (engine §3.6), which itemCaptureProblem checks.
    if (itemNames.size > 0 && capturesMentioned(condition).some((name) => itemNames.has(name))) continue;
    const prepared = prepareClause(condition);
    const applies = (/** @type {number} */ index) => {
      if (hooks.work) countWork(hooks.work, "clauses");
      const captures = alternatives[index];
      const has = (/** @type {string} */ name) => captures.has(name);
      let simple = simplifyFor(prepared, has, captures);
      const template = templateConditions?.[conditionIndex];
      if (simple === DOM_TRUE && template !== undefined) {
        // The closed-set rule reads the condition as its template
        // writes it (engine §3.6): a parameter is never closed, and
        // every other part keeps the rule. So the truth is asked of
        // the template's form, where a parameter never reduces.
        const open = simplify(template, has);
        if (open !== DOM_TRUE) simple = open;
      }
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
    if (!found) yield {kind:"independent", problem:`a condition of ${rule.name} applies to no production`};
  }
  for (const { captures, alternative } of productions) {
    const has = (/** @type {string} */ name) => captures.has(name);
    for (const term of [rule.tags, alternative.tags]) {
      if (term === undefined || waits(term)) continue;
      const missing = capturesUsed(simplifyFor(prepareClause(term), has, captures)).find((name) => !has(name));
      if (missing !== undefined) yield {kind:"independent", problem:`a tag term of ${rule.name} uses $${missing}, which a production lacks; guard it with $${missing} ⟹`};
    }
    const effectiveTags=[rule.tags,alternative.tags].filter(term=>term!==undefined);
    if (effectiveTags.length && !effectiveTags.some(waits)) {
      const terms=effectiveTags.map(term=>simplifyFor(prepareClause(term),has,captures));
      try { guardedTagVariants(terms.length===1?terms[0]:{union:terms}); }
      catch(error) {yield {kind:"independent",problem:/** @type {Error} */ (error).message};}
    }
    const recipes = new Set([
      alternative.value ?? rule.value,
      alternative.image ?? rule.image ?? alternative.value ?? rule.value,
      rule.error, rule.warning,
    ]);
    for (const recipe of recipes) {
      if (recipe === undefined) continue;
      const missing = capturesUsed(recipe).find((name) => !has(name));
      if (missing !== undefined) {
        const problem = `a recipe of ${rule.name} uses $${missing}, which a production lacks`;
        yield {kind:"recipe-capture", problem};
      }
    }
    if (!rule.emit) continue;
    // The items this production keeps, found from an index of the items
    // by their carriers, not by a scan of every item.
    const present = presentItems(items, has, captures).map((index) => items[index]);
    if (items.length > 0 && present.length === 0) {
      const problem = `%emits of ${rule.name} leaves a production nothing to emit`;
      yield {kind:"empty-emission", problem};
    }
    // A production without an item's carrier lacks its attachments too
    // (engine §9). The first such item, in order, is found from the index
    // of attachments.
    const strayAt = strayAttachment(items, has, captures);
    if (strayAt !== -1) {
      const item = items[strayAt];
      const stray = attachmentsOf(item).find(has);
      yield {kind:"independent", problem:`%emits of ${rule.name} attaches $${stray} in a production without its carrier $${item.capture}`};
    }
    // The written order of the captures, attachments included, is the order
    // they stand in (engine §9).
    const written = present.flatMap((/** @type {any} */ item) => (item.capture ? [...(item.before ?? []), item.capture, ...(item.after ?? [])] : []));
    const positions = written.filter(has).map((/** @type {string} */ name) => /** @type {number} */ (captures.get(name)));
    if (positions.some((/** @type {number} */ position, /** @type {number} */ at) => at > 0 && position < positions[at - 1])) {
      yield {kind:"independent", problem:`%emits of ${rule.name} lists captures out of the order they stand in`};
    }
    for (const item of present) {
      for (const recipe of [item.value, item.image]) {
        if (recipe === undefined) continue;
        const missing = capturesUsed(recipe).find((name) => !has(name));
        if (missing !== undefined) {
          const problem = `an item recipe of ${rule.name} uses absent capture $${missing}`;
          yield {kind:"recipe-capture", problem};
        }
      }
      if (!item.tags || waits(item.tags)) continue;
      const missing = capturesUsed(simplifyFor(prepareClause(item.tags), has, captures)).find((name) => !has(name));
      if (missing !== undefined) yield {kind:"independent", problem:`a tag term of ${rule.name} uses $${missing}, which a production lacks; guard it with $${missing} ⟹`};
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
      yield {kind:"independent", problem:`%emits of ${rule.name} inserts a tag before $${next.capture}, which a production lacks`};
    }
  }

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
 * @typedef {"string" | "strings" | "tags" | "span" | "pattern" | "set" | "any" | "emitted" | "condition" | "forest"} TermType
 */

/**
 * The type of each constant, where the loader knows it (engine §2); the
 * reader knows none, and gives every constant the type `any`.
 * @typedef {(name: string) => TermType} ConstantTypes
 */

const SET_KINDS = new Set(["strings", "tags", "pattern", "set"]);
/** @type {Record<string, string>} */
const TYPE_NAMES = { forest: "a witness forest", string: "a string", strings: "a set of strings", tags: "a tag set", span: "a span", pattern: "a pattern", set: "a set", any: "a value", emitted: "an emitted pair", condition: "a condition" };
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
  if (types.includes("span")) return { problem: "a span is not a value: $x.tags is the tag set of $x" };
  const known = types.filter((type) => type !== "any").map(type => type === "string" ? "strings" : type);
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
  if ((op === "⊆" || op === "⊈") && (left === "span" || right === "span")) return "a span cannot convert to a set";
  if ((op === "∈" || op === "∉") && right === "span") return "a span cannot convert to a set";
  if (left === "pattern" || right === "pattern") return `${op} cannot compare pattern values`;
  if (!["∈", "∉"].includes(op) && (left === "span" || right === "span") && (["strings", "tags", "set"].includes(left) || ["strings", "tags", "set"].includes(right))) return "a span cannot convert to a set";
  if (left === "span") left = "string";
  if (right === "span") right = "string";
  if (op === "∈" || op === "∉") {
    if (left !== "string" && left !== "any") return `${op} tests a string, not ${TYPE_NAMES[left]}, in a set of strings; ⊆ and ⊈ compare two sets`;
    if (right !== "string" && right !== "strings" && right !== "set" && right !== "any") return `${op} tests a string in a set of strings, not in ${TYPE_NAMES[right]}`;
    return null;
  }
  if (op === "⊆" || op === "⊈") {
    const joined = joinedType([left, right], op);
    if ("problem" in joined) return joined.problem;
    return joined.type === "set" ? `the kind of the sets that ${op} compares is not given` : null;
  }
  // = and ≠ compare two values of one type.
  if (left === "any" || right === "any") return null;
  if (left === "string" && right === "string") return null;
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
 * @typedef {{problem: string, node: any, at?: import("./types.js").Position}} TypeFault
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
  if (term.param) return {type:"any"};
  if (term.call) return {type:"any"};
  if ("pattern" in term) {
    const pending = [term.pattern];
    while (pending.length) {
      const n = pending.pop();
      if (n.constant) {
        const type = constants(n.constant);
        if (!["string","pattern","any"].includes(type)) return {problem:"a pattern atom requires a string or pattern constant",node:n};
        if(type==="pattern" && (n.exact || n.children)) return {problem:"a pattern-valued constant cannot carry node decorations",node:n};
      }
      if (n.literal || n.range) for (const operand of n.range ?? [n.literal]) {
        const found = yield typing(operand,constants);
        if ("problem" in found) return found;
        const problem = expectedProblem(found.type,"string");
        if (problem) return {problem,node:operand};
      }
      if (n.test) {
        let base = n.expr;
        while (base?.test) base = base.expr;
        if (base?.constant && !["string","any"].includes(constants(base.constant))) return {problem:"a tested pattern constant requires a string",node:base};
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
  if (Array.isArray(term.concat)) {
    for (const part of term.concat) {
      const found = yield typing(part, constants);
      if ("problem" in found) return found;
      const wrong = !["string", "any"].includes(found.type) ? "++ requires string operands" : null;
      if (wrong) return { problem: wrong, node: term };
    }
    return { type: "string" };
  }
  if (typeof term.method === "string") {
    const receiver = yield typing(term.receiver, constants);
    if ("problem" in receiver) return receiver;
    const types = [];
    for (const arg of term.args) {
      if (arg.body || arg.rule || arg.classifier || arg.terminal || arg.integer) types.push("name");
      else {
        const found = yield typing(arg, constants);
        if ("problem" in found) return found;
        types.push(found.type);
      }
    }
    const nominal = TARGET_METHODS.has(term.method) || term.method === "tags" || term.method === "without-elision-except";
    const args = nominal ? term.args.map((/** @type {any} */ arg) => arg.param || arg.call ? {rule:"unresolved"} : arg) : term.args;
    const receiverType = receiver.type === "any" && hasUnresolved(term.receiver) ? "span" : receiver.type;
    const receiverNode = term.receiver.param || term.receiver.call ? {capture:""} : term.receiver;
    const problem = methodProblem(term.method, receiverNode, args, receiverType, types, true);
    return problem ? { problem, node: term } : { type: /** @type {TermType} */ (methodType(term.method)) };
  }
  if (typeof term.tag === "string") return { type: "tags" };
  if (term.emptySet === true) return { type: "set" };
  if (typeof term.capture === "string") return { type: "span" };
  if (typeof term.const === "string") return { type: constants(term.const) };
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
    const joined = joinedType([then.type], "⟹");
    if ("problem" in joined) return {problem:joined.problem,node:term};
    return joined.type === "pattern" ? {problem:"a guarded term requires a tag set or string set",node:term} : joined;
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
    return ["condition","forest","tags","strings"].includes(found.type) ? null : { problem: "a condition requires a query method", node: condition };
  }
  if ("nonempty" in condition) {
    const found = yield typing(condition.nonempty, constants);
    if ("problem" in found) return found;
    return ["tags","strings","set","any"].includes(found.type) ? null : { problem: "a condition requires a set, a forest, or a query method", node: condition };
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
    if ((condition.op === "≅" || condition.op === "≇") && typeof condition.right.capture === "string") {
      return condition.left.capture === condition.right.capture ? {problem:"a tree comparison cannot compare a capture with itself",node:condition} : null;
    }
    const problem = comparisonProblem(condition.op, left.type, right.type);
    return problem ? { problem, node: ["≅","≇"].includes(condition.op) ? condition.right : condition } : null;
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
  return problem ? { problem, node: term, ...(term?.tagTermAt ? { at: term.tagTermAt } : {}) } : null;
}

/**
 * Why a rule's terms and conditions do not agree in type, with the
 * construct at fault, or null.
 * @param {any} rule
 * @param {ConstantTypes} [constants]
 * @returns {TypeFault | null}
 */
export function ruleTypeFault(rule, constants) {
  const faults = [...ruleTypeFaults(rule, constants)];
  if (faults.length <= 1) return faults[0] ?? null;
  // The canonical clause order supplies positions absent from the DOM.
  const roots = [rule.tags, rule.value, rule.image,
    ...rule.alternatives.flatMap((/** @type {any} */ alt) => [alt.expr, alt.tags, alt.value, alt.image]),
    ...rule.conditions, rule.error, rule.warning,
    ...(rule.emit?.items ?? []).flatMap((/** @type {any} */ item) => [item.tags, item.value, item.image])];
  const order = new Map();
  roots.forEach((root, index) => {
    const pending = [root];
    while (pending.length) {
      const node = pending.pop();
      if (!node || typeof node !== "object" || order.has(node)) continue;
      order.set(node, index);
      if (node.const || node.constant) continue;
      for (const child of Object.values(node)) pending.push(child);
    }
  });
  faults.sort((a,b) => order.get(a.node)-order.get(b.node));
  let first = null;
  let next = [Infinity, Infinity];
  let position = [Infinity, Infinity, 2];
  // A construct without a coordinate stands before the next positioned fault.
  for (let index = faults.length - 1; index >= 0; index--) {
    const fault = faults[index];
    const at = constantsIn(fault.node).map(reference => reference.at).sort((a,b) => a[0]-b[0] || a[1]-b[1])[0];
    if (at) next = at;
    const key = [...next, at ? 1 : 0];
    if (key[0] < position[0] || key[0] === position[0] && (key[1] < position[1] || key[1] === position[1] && key[2] <= position[2])) {
      first = fault; position = key;
    }
  }
  return first;
}

/** @param {any} rule @param {ConstantTypes} [constants] @returns {Generator<TypeFault>} */
function* ruleTypeFaults(rule, constants) {
  const recipes = [rule.value, rule.image, rule.error, rule.warning,
    ...rule.alternatives.flatMap((/** @type {any} */ alternative) => [alternative.value, alternative.image]),
    ...(rule.emit ? rule.emit.items.flatMap((/** @type {any} */ item) => [item.value, item.image]) : [])];
  for (const recipe of recipes) {
    if (recipe === undefined) continue;
    for (const atom of recipe.concat) {
      const recipeAtom = /** @type {any} */ (atom);
      const stringAtom = isDomObject(atom) && !recipeAtom.grouped && ["string", "const"].some(key => key in recipeAtom);
      if (isDomObject(atom) && !stringAtom && !recipeAtom.param) {
        if (!["value", "image", "source-text", "decomposed-source-text", "verbatim-text"].includes(recipeAtom.method) || recipeAtom.args?.length !== 0) { yield { problem: "a malformed recipe atom", node: atom }; continue; }
        const receiver = recipeAtom.receiver;
        if (!(typeof receiver?.capture === "string" && Object.keys(receiver).length === 1) && !(["value", "image"].includes(recipeAtom.method) && receiver?.method === "emitted" && receiver.args?.length === 0 && typeof receiver.receiver?.capture === "string" && Object.keys(receiver.receiver).length === 1)) { yield { problem: "a malformed recipe receiver", node: atom }; continue; }
      }
      const found = termType(atom, constants);
      if ("problem" in found) { yield found; continue; }
      const problem = expectedProblem(found.type, "string");
      if (problem) yield { problem, node: atom };
    }
  }
  const tagTerms = [rule.tags, ...rule.alternatives.map((/** @type {any} */ alternative) => alternative.tags),
    ...(rule.emit ? rule.emit.items.map((/** @type {any} */ item) => item.tags) : [])];
  for (const term of tagTerms) {
    if (term === undefined) continue;
    const fault = tagTermFault(term, constants);
    if (fault) yield fault;
  }
  for (const condition of rule.conditions) {
    const fault = conditionTypeFault(condition, constants);
    if (fault) yield fault;
  }
  for (const alternative of rule.alternatives) {
    const pending = [alternative.expr];
    while (pending.length) {
      const expr = pending.pop();
      const operands = expr.literal ? [expr.literal] : expr.range ?? [];
      for (const operand of operands) {
        const found = termType(operand,constants);
        if ("problem" in found) { yield found; continue; }
        const problem = expectedProblem(found.type,"string");
        if (problem) yield {problem,node:operand};
      }
      for (const key of ["seq","choice","ranked","and"]) if (expr[key]) for (let i = expr[key].length - 1; i >= 0; i--) pending.push(expr[key][i]);
      for (const key of ["expr","splice","separator","repeat","optional"]) if (expr[key]) pending.push(expr[key]);
    }
  }
  // A test's value is a string for a value test and a tag set for a tag
  // test (engine §9, §10).
  for (const alternative of rule.alternatives) {
    for (const test of testsIn(alternative.expr)) {
      const operands = test.test === "tags" ? /** @type {any} */ (test).requirements.map((/** @type {any} */ requirement) => requirement.value) : [test.value];
      for (const value of operands) {
        const found = termType(value, constants);
        if ("problem" in found) { yield found; continue; }
        const problem = expectedProblem(found.type, test.test === "tags" ? "tags" : "string");
        if (problem) yield { problem, node: value };
      }
    }
  }

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
    if (current.default !== undefined) found.push({test:"=",value:current.default,expr:current.optional});
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
 * capture, a guarded term, or a call of anything but split and ngrams. The
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
      if (!["split", "ngrams"].includes(current.method)) return current;
      items = [current.receiver, .../** @type {any} */ (current).args];
    } else {
      const key = ["union", "intersection", "difference", "concat"].find((name) => Array.isArray(current[name]));
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
      else children = sourceKeys(current).filter(key => key !== "at").map(key => current[key]);
    }
    for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
  }
  return found;
}

// Feature conditions read tokens before any grammar is lowered.
/** @param {any[]} conditions @returns {string|null} */
export function inputConditionsProblem(conditions) {
  const allowed = new Set(["tags", "classes", "value", "image", "source-text", "decomposed-source-text", "first-token", "tokens-after-first", "last-token", "split", "ngrams"]);
  const pending = [...conditions];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (node.capture !== undefined && node.capture !== "" || node.captured !== undefined && node.captured !== "") return "feature conditions can read only $";
    if (node.op === "≅" || node.op === "≇" || node.method && (!allowed.has(node.method) || node.method === "tags" && node.args.length)) return "feature conditions can read only tokens";
    for (const child of clauseChildren(node)) pending.push(child);
  }
  for (const condition of conditions) {
    const problem = conditionTypeProblem(condition);
    if (problem) return problem;
  }
  return null;
}
