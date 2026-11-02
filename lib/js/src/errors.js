// The one error type the library throws: a grammar that cannot be loaded or
// run. A text that does not parse is not an error but a result.

export class GencmuError extends Error {
  /** @type {string} */
  #description;
  /**
   * @param {"grammar" | "usage"} kind a grammar that cannot be loaded or
   *   run, or a caller's mistake such as an unknown stage name
   * @param {string} message
   * @param {import("./types.js").ErrorLocation} [where]
   * @param {{cause?: unknown}} [options] the error that caused this one
   */
  constructor(kind, message, where, options) {
    where = {...where};
    if (where.group !== undefined) where.group = copyDiagnostic(where.group);
    if (where.expression !== undefined) where.expression = copyDiagnostic(where.expression);
    if (where.inheritance !== undefined) where.inheritance = copyDiagnostic(where.inheritance);
    const location = where?.document === undefined ? "" : [where.document, where.line, where.column].filter(part => part !== undefined).join(":");
    if (location) {
      // Some callers already include all or part of the location.
      const prefixes = [location, [where?.document, where?.line].filter(part => part !== undefined).join(":"), where?.document];
      for (const prefix of prefixes) {
        if (prefix && message.startsWith(`${prefix}: `)) { message = message.slice(prefix.length + 2); break; }
      }
    }
    const stage = where?.stage ? `stage ${where.stage}: ` : "";
    super(`${location ? `${location}: ` : ""}${stage}${message}`, options);
    this.#description = message;
    this.name = "GencmuError";
    this.kind = kind;
    this.where = where || {};
    this.code = this.where.code;
    this.group = this.where.group;
    this.option = this.where.option;
    this.expression = this.where.expression;
    this.inheritance = this.where.inheritance;
  }

  /**
   * Copies the diagnostic with a new location and an optional explanation.
   * @param {import("./types.js").ErrorLocation} where
   * @param {string} [suffix]
   * @returns {GencmuError}
   */
  withLocation(where, suffix = "") {
    return new GencmuError(this.kind, this.#description + suffix, {...this.where, ...where}, {cause:this});
  }

  /** @internal The description without location or stage formatting. */
  get description() {
    return this.#description;
  }

  // Loading diagnostics have their own canonical schema.
  toJSON() {
    return {
      kind: this.kind,
      ...(this.code === undefined ? {} : {code:this.code}),
      message: this.message,
      ...(this.group === undefined ? {} : {group:this.group}),
      ...(this.option === undefined ? {} : {option:this.option}),
      ...(this.expression === undefined ? {} : {expression:this.expression}),
      ...(this.inheritance === undefined ? {} : {inheritance:this.inheritance}),
    };
  }
}

/** @internal @type {WeakMap<import("./types.js").ParseError, import("./types.js").ErrorLocation>} */
export const runtimeErrorLocations = new WeakMap();

/**
 * A runtime grammar error keeps its formatted message and source metadata.
 * @internal
 * @param {GencmuError} error
 * @param {string} stage
 * @returns {import("./types.js").ParseError}
 */
export function runtimeGrammarError(error, stage) {
  /** @type {import("./types.js").ParseError} */
  const result = {kind:"grammar",stage,message:error.message};
  const {document,line,column} = error.where;
  runtimeErrorLocations.set(result,{document,line,column});
  return result;
}

/** @internal The splicer found a declared stage without rules. */
export class EmptyStageError extends GencmuError {}

// Diagnostic members are JSON graphs, copied without recursive calls.
/** @template T @param {T} value @returns {T} */
function copyDiagnostic(value) {
  if (value === null || typeof value !== "object") return value;
  /** @type {any} */
  const root = Array.isArray(value) ? [] : {};
  /** @type {Map<object, any>} */
  const copies = new Map([[value, root]]);
  /** @type {object[]} */
  const pending = [value];
  while (pending.length) {
    const source = /** @type {object} */ (pending.pop());
    const target = copies.get(source);
    for (const [key, part] of Object.entries(source)) {
      let copy = part;
      if (part !== null && typeof part === "object") {
        if (!copies.has(part)) {
          copies.set(part, Array.isArray(part) ? [] : {});
          pending.push(part);
        }
        copy = copies.get(part);
      }
      Object.defineProperty(target, key, {value:copy, enumerable:true, writable:true, configurable:true});
    }
  }
  return root;
}
