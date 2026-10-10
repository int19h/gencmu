// The one error type the library throws: a grammar that cannot be loaded or
// run. A text that does not parse is not an error but a result.

export class GencmuError extends Error {
  /**
   * @param {"grammar" | "usage"} kind a grammar that cannot be loaded or
   *   run, or a caller's mistake such as an unknown stage name
   * @param {string} message
   * @param {import("./types.js").ErrorLocation} [where]
   * @param {{cause?: unknown}} [options] the error that caused this one
   */
  constructor(kind, message, where, options) {
    super(message, options);
    this.name = "GencmuError";
    this.kind = kind;
    this.where = where || {};
    this.code = this.where.code;
    this.group = this.where.group;
    this.option = this.where.option;
    this.expression = this.where.expression;
    this.inheritance = this.where.inheritance;
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
