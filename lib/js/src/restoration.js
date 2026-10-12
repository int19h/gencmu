// Tokens and source projection shared by elision-only and restored spans.
import { Token } from "./tokens.js";
import { tagSet } from "./tags.js";

/** @typedef {{terminal: string, at: number, source: [number, number], value?: string}} RestorationRecord */

/**
 * @param {import("./tokens.js").Token[]} tokens
 * @param {RestorationRecord[]} records
 * @param {number[]} [order]
 * @param {boolean} [emptySourceIsSynthetic]
 */
export function restoreTokens(tokens, records, order = records.map((_, index) => index), emptySourceIsSynthetic = false) {
  /** @type {import("./tokens.js").Token[]} */ const restored = [];
  /** @type {boolean[]} */ const synthetic = [];
  /** @type {number[]} */ const originalAt = [];
  /** @type {number[]} */ const recordAt = new Array(records.length);
  /** @type {(number|undefined)[]} */ const recordOf = [];
  let next = 0;
  for (let at = 0; at <= tokens.length; at++) {
    while (next < order.length && records[order[next]].at === at) {
      const index = order[next++];
      const record = records[index];
      recordAt[index] = restored.length;
      recordOf.push(index);
      synthetic.push(true);
      restored.push(new Token(tagSet([record.terminal]), [restored.length, restored.length], record.source, "", record.value ?? "", undefined));
    }
    if (at < tokens.length) {
      originalAt.push(restored.length);
      recordOf.push(undefined);
      const token = tokens[at];
      synthetic.push(emptySourceIsSynthetic && token.source[0] === token.source[1]);
      restored.push(token);
    }
  }
  const project = [0];
  for (const flag of synthetic) project.push(project[project.length - 1] + (flag ? 0 : 1));
  return { restored, synthetic, originalAt, recordAt, recordOf, project };
}
