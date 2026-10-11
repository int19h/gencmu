// Shared close observations for aligned queries. The chart keeps summaries
// of proofs, not completed trees. A cyclic summary remains available to
// ordinary query eligibility, but cannot supply an aligned observation.

import { countWork, hooks } from "./testing.js";

/**
 * @typedef {{kind: "close", terminal: string, at: number, source: [number, number], sound?: string}
 *   | {kind: "block", key: string, start: number, end: number}} CloseEvent
 */
/**
 * @typedef {{id: number, sequence: number, rules: ReadonlySet<string>, valid: boolean}} CloseObservation
 */

export class CloseObservations {
  constructor() {
    /** @type {CloseEvent[]} */ this.events = [];
    /** @type {Map<string,number>} */ this.eventIds = new Map();
    /** @type {{parent:number,event:number}[]} */ this.sequences = [{ parent: 0, event: -1 }];
    /** @type {Map<string,number>} */ this.sequenceIds = new Map();
    /** @type {CloseObservation[]} */ this.states = [];
    /** @type {Map<string,CloseObservation>} */ this.stateIds = new Map();
    /** @type {Map<string,CloseObservation>} */ this.products = new Map();
    /** @type {Map<string,[number,number]>} */ this.ruleSpans = new Map();
    /** @type {Map<string,number>} */ this.alignmentIds = new Map();
    /** @type {Map<number,number>} */ this.sequenceAlignmentIds = new Map([[0, 0]]);
    this.empty = this.intern(0, new Set());
    this.invalid = { id: 1, sequence: 0, rules: new Set(), valid: false };
    this.states.push(this.invalid);
  }

  /** @param {number} sequence @param {ReadonlySet<string>} rules @returns {CloseObservation} */
  intern(sequence, rules) {
    const key = `${sequence}/${JSON.stringify([...rules].sort())}`;
    const old = this.stateIds.get(key);
    if (old) return old;
    const state = { id: this.states.length, sequence, rules, valid: true };
    this.states.push(state);
    this.stateIds.set(key, state);
    if (hooks.work) countWork(hooks.work, "closeStates");
    return state;
  }

  /** @param {number} parent @param {CloseEvent} event @returns {number} */
  append(parent, event) {
    const eventKey = JSON.stringify(event);
    let id = this.eventIds.get(eventKey);
    if (id === undefined) {
      id = this.events.length;
      this.events.push(event);
      this.eventIds.set(eventKey, id);
    }
    const key = `${parent}/${id}`;
    const old = this.sequenceIds.get(key);
    if (old !== undefined) return old;
    const sequence = this.sequences.length;
    this.sequences.push({ parent, event: id });
    this.sequenceIds.set(key, sequence);
    if (hooks.work) countWork(hooks.work, "closeSequences");
    return sequence;
  }

  /** @param {number} sequence @returns {CloseEvent[]} */
  list(sequence) {
    // Keep only the shared links. A flattened prefix list is temporary.
    const result = [];
    for (let at = sequence; at !== 0; at = this.sequences[at].parent) {
      result.push(this.events[this.sequences[at].event]);
    }
    result.reverse();
    return result;
  }

  /** @param {CloseObservation} left @param {CloseObservation} right @returns {CloseObservation} */
  concat(left, right) {
    if (!left.valid || !right.valid) return this.invalid;
    const key = `${left.id}/${right.id}`;
    const old = this.products.get(key);
    if (old) return old;
    let sequence = left.sequence === 0 ? right.sequence : left.sequence;
    if (left.sequence !== 0 && right.sequence !== 0) {
      for (const event of this.list(right.sequence)) {
        sequence = this.append(sequence, event);
      }
    }
    const rules = new Set(left.rules);
    for (const rule of right.rules) rules.add(rule);
    const result = this.intern(sequence, rules);
    this.products.set(key, result);
    return result;
  }

  /** @param {CloseEvent} event @param {ReadonlySet<string>} [rules] @returns {CloseObservation} */
  event(event, rules = this.empty.rules) {
    return this.intern(this.append(0, event), rules);
  }

  /** @param {CloseObservation} inner @param {string} rule @param {number} start @param {number} end @returns {CloseObservation} */
  closeRule(inner, rule, start, end) {
    if (!inner.valid) return inner;
    const occurrence = JSON.stringify([rule, start, end]);
    this.ruleSpans.set(occurrence, [start, end]);
    if (inner.rules.has(occurrence)) return this.invalid;
    const rules = new Set(inner.rules);
    rules.add(occurrence);
    return this.intern(inner.sequence, rules);
  }

  /** @param {CloseObservation} inner @param {number} start @param {number} end @returns {CloseObservation} */
  trim(inner, start, end) {
    // A future ancestor contains this interval. Only a descendant over the
    // complete interval can repeat that ancestor's rule and span.
    if (!inner.valid) return inner;
    const rules = new Set([...inner.rules].filter(rule => {
      const span = this.ruleSpans.get(rule);
      return span?.[0] === start && span[1] === end;
    }));
    return rules.size === inner.rules.size ? inner : this.intern(inner.sequence, rules);
  }

  /** @param {CloseObservation} candidate @param {CloseObservation} witness @param {number} through @returns {boolean} */
  aligned(candidate, witness, through) {
    if (!candidate.valid || !witness.valid) return false;
    const left = this.through(candidate, through);
    const right = this.through(witness, through);
    return left !== null && right !== null && left === right;
  }

  /** @param {CloseObservation} observation @returns {number} */
  identity(observation) {
    if (!observation.valid) return -1;
    const pending = [];
    let sequence = observation.sequence;
    while (!this.sequenceAlignmentIds.has(sequence)) {
      pending.push(sequence);
      sequence = this.sequences[sequence].parent;
    }
    let parent = /** @type {number} */ (this.sequenceAlignmentIds.get(sequence));
    for (let at = pending.length - 1; at >= 0; at--) {
      const link = pending[at];
      const event = this.events[this.sequences[link].event];
      const key = JSON.stringify(event.kind === "close"
        ? [parent, event.terminal, event.at]
        : [parent, "block", event.key, event.start, event.end]);
      let id = this.alignmentIds.get(key);
      if (id === undefined) {
        id = this.alignmentIds.size + 1;
        this.alignmentIds.set(key, id);
      }
      this.sequenceAlignmentIds.set(link, id);
      parent = id;
    }
    return parent;
  }

  /** @param {CloseObservation} state @param {number} through @returns {string|null} */
  through(state, through) {
    const events = [];
    for (const event of this.list(state.sequence)) {
      if (event.kind === "close") {
        if (event.at <= through) events.push([event.terminal, event.at]);
      } else {
        if (event.start < through && through < event.end) return null;
        if (event.end <= through) events.push(["block", event.key, event.start, event.end]);
      }
    }
    return JSON.stringify(events);
  }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function needsCloseObservations(value) {
  const stack = [value];
  const seen = new Set();
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    if (/** @type {any} */ (node).call === "without-elision") return true;
    for (const child of Object.values(node)) stack.push(child);
  }
  return false;
}
