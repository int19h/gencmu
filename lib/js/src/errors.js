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
