// The one error type the library throws: a grammar that cannot be loaded or
// run. A text that does not parse is not an error but a result.

export class GencmuError extends Error {
  /**
   * @param {"grammar"} kind what went wrong; grammar errors are the only kind
   * @param {string} message
   * @param {import("./types.js").ErrorLocation} [where]
   */
  constructor(kind, message, where) {
    super(message);
    this.name = "GencmuError";
    this.kind = kind;
    this.where = where || {};
  }
}
