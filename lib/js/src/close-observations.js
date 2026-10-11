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

const HASH_MASK = (1n << 64n) - 1n;
const HASH_BASE = 1099511628211n;

/**
 * @typedef {{left:number,right:number,event:number,size:bigint,hash:bigint,power:bigint,
 *   height:number,min:number,max:number}} SequenceNode
 */

// A rope keeps shared leaves and concatenations. Fingerprints select a
// bucket, and exact comparisons decide equality across different groupings.
class Sequences {
  /** @param {CloseEvent[]} events @param {boolean} counted @param {bigint} mask */
  constructor(events, counted, mask) {
    this.events = events;
    this.counted = counted;
    this.mask = mask;
    /** @type {SequenceNode[]} */
    this.nodes = [{left:0,right:0,event:-1,size:0n,hash:0n,power:1n,height:0,min:Infinity,max:-Infinity}];
    /** @type {Map<string,number>} */ this.ids = new Map();
    /** @type {Map<string,number[]>} */ this.buckets = new Map();
    /** @type {Map<string,number|null>} */ this.prefixes = new Map();
  }

  /** @param {number} a @param {number} b @returns {boolean} */
  equal(a, b) {
    const left = [a], right = [b];
    while (left.length && right.length) {
      const x = /** @type {number} */ (left.pop());
      const y = /** @type {number} */ (right.pop());
      if (x === y) continue;
      const one = this.nodes[x], two = this.nodes[y];
      if (one.event >= 0 && two.event >= 0) return false;
      if (one.event < 0 && (two.event >= 0 || one.height >= two.height)) {
        left.push(one.right, one.left);
        right.push(y);
      } else {
        left.push(x);
        right.push(two.right, two.left);
      }
    }
    return left.length === right.length;
  }

  /** @param {string} key @param {SequenceNode} node @returns {number} */
  intern(key, node) {
    const old = this.ids.get(key);
    if (old !== undefined) return old;
    const bucketKey = `${node.size}/${node.hash}`;
    const bucket = this.buckets.get(bucketKey) ?? [];
    const trial = this.nodes.length;
    this.nodes.push(node);
    for (const id of bucket) {
      if (this.equal(trial, id)) {
        this.nodes.pop();
        this.ids.set(key, id);
        return id;
      }
    }
    this.ids.set(key, trial);
    bucket.push(trial);
    this.buckets.set(bucketKey, bucket);
    if (this.counted && hooks.work) countWork(hooks.work, "closeSequences");
    return trial;
  }

  /** @param {number} event @returns {number} */
  leaf(event) {
    const value = this.events[event];
    return this.intern(`e${event}`, {left:0,right:0,event,size:1n,
      hash:BigInt(event+1) & this.mask,power:HASH_BASE & this.mask,height:1,
      min:value.kind === "close" ? value.at : value.start,
      max:value.kind === "close" ? value.at : value.end});
  }

  /** @param {number} left @param {number} right @returns {number} */
  concat(left, right) {
    if (left === 0) return right;
    if (right === 0) return left;
    const a = this.nodes[left], b = this.nodes[right];
    return this.intern(`${left}/${right}`, {left,right,event:-1,size:(a.size+b.size) & HASH_MASK,
      hash:(a.hash*b.power+b.hash) & this.mask,power:(a.power*b.power) & this.mask,
      height:Math.max(a.height,b.height)+1,min:Math.min(a.min,b.min),max:Math.max(a.max,b.max)});
  }

  /** @param {number} id @returns {IterableIterator<CloseEvent>} */
  *values(id) {
    const stack = [id];
    while (stack.length) {
      const next = /** @type {number} */ (stack.pop());
      if (next === 0) continue;
      const node = this.nodes[next];
      if (node.event >= 0) yield this.events[node.event];
      else stack.push(node.right,node.left);
    }
  }

  /** @param {number} id @param {number} end @returns {number|null} */
  through(id, end) {
    const key = `${id}/${end}`;
    if (this.prefixes.has(key)) return /** @type {number|null} */ (this.prefixes.get(key));
    const pending = [id];
    while (pending.length) {
      const at = /** @type {number} */ (pending[pending.length-1]);
      const here = `${at}/${end}`;
      if (this.prefixes.has(here)) { pending.pop(); continue; }
      const node = this.nodes[at];
      if (at === 0 || node.min > end) this.prefixes.set(here,0);
      else if (node.max <= end) this.prefixes.set(here,at);
      else if (node.event >= 0) {
        const event = this.events[node.event];
        // Only a block can cross this boundary. At its start, a positive
        // block lies beyond the prefix. Empty blocks remain in the group.
        this.prefixes.set(here,event.kind === "block" && event.start < end ? null : 0);
      } else {
        const left = `${node.left}/${end}`, right = `${node.right}/${end}`;
        if (!this.prefixes.has(left)) pending.push(node.left);
        else if (!this.prefixes.has(right)) pending.push(node.right);
        else {
          const a = /** @type {number|null} */ (this.prefixes.get(left));
          const b = /** @type {number|null} */ (this.prefixes.get(right));
          this.prefixes.set(here,a === null || b === null ? null : this.concat(a,b));
        }
      }
    }
    return /** @type {number|null} */ (this.prefixes.get(key));
  }
}

export class CloseObservations {
  /** @param {bigint} [mask] */
  constructor(mask = HASH_MASK) {
    /** @type {CloseEvent[]} */ this.events = [];
    /** @type {Map<string,number>} */ this.eventIds = new Map();
    this.raw = new Sequences(this.events, true, mask);
    this.sequences = this.raw.nodes;
    /** @type {CloseEvent[]} */ this.normalEvents = [];
    /** @type {Map<string,number>} */ this.normalEventIds = new Map();
    this.normal = new Sequences(this.normalEvents, true, mask);
    /** @type {CloseObservation[]} */ this.states = [];
    /** @type {Map<string,CloseObservation>} */ this.stateIds = new Map();
    /** @type {Map<string,CloseObservation>} */ this.products = new Map();
    /** @type {Map<string,[number,number]>} */ this.ruleSpans = new Map();
    this.alignmentIds = this.normal.ids;
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
    return this.raw.concat(parent,this.raw.leaf(id));
  }

  /** @param {number} sequence @returns {CloseEvent[]} */
  list(sequence) {
    return [...this.raw.values(sequence)];
  }

  /** @param {CloseObservation} left @param {CloseObservation} right @returns {CloseObservation} */
  concat(left, right) {
    if (!left.valid || !right.valid) return this.invalid;
    const key = `${left.id}/${right.id}`;
    const old = this.products.get(key);
    if (old) return old;
    const sequence = this.raw.concat(left.sequence,right.sequence);
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
    const pending = [observation.sequence];
    while (pending.length) {
      const at = /** @type {number} */ (pending[pending.length-1]);
      if (this.sequenceAlignmentIds.has(at)) { pending.pop(); continue; }
      const node = this.sequences[at];
      if (node.event >= 0) {
        const event = this.events[node.event];
        const key = JSON.stringify(event.kind === "close"
          ? [event.terminal,event.at] : ["block",event.key,event.start,event.end]);
        let id = this.normalEventIds.get(key);
        if (id === undefined) {
          id = this.normalEvents.length;
          this.normalEvents.push(event.kind === "close"
            ? {kind:"close",terminal:event.terminal,at:event.at,source:[0,0]} : event);
          this.normalEventIds.set(key,id);
        }
        this.sequenceAlignmentIds.set(at,this.normal.leaf(id));
      } else if (!this.sequenceAlignmentIds.has(node.left)) pending.push(node.left);
      else if (!this.sequenceAlignmentIds.has(node.right)) pending.push(node.right);
      else this.sequenceAlignmentIds.set(at,this.normal.concat(
        /** @type {number} */ (this.sequenceAlignmentIds.get(node.left)),
        /** @type {number} */ (this.sequenceAlignmentIds.get(node.right))));
    }
    return /** @type {number} */ (this.sequenceAlignmentIds.get(observation.sequence));
  }

  /** @param {CloseObservation} state @param {number} through @returns {number|null} */
  through(state, through) {
    return this.normal.through(this.identity(state),through);
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


/** @type {WeakMap<import("./types.js").LoweredGrammar,Set<string>>} */
const demands = new WeakMap();

/**
 * Finds captures and witnesses that reachable queries can observe. Unused
 * rules do not activate observations, and unrelated siblings stay ordinary.
 * @param {import("./types.js").LoweredGrammar} lowered
 * @returns {Set<string>}
 */
export function closeDemands(lowered) {
  const cached = demands.get(lowered);
  if (cached) return cached;
  const wanted = new Set();
  const reachable = new Set();
  const pending = ["text"];
  while (pending.length) {
    const name = /** @type {string} */ (pending.pop());
    if (reachable.has(name)) continue;
    reachable.add(name);
    for (const production of lowered.byLhs.get(name) ?? []) {
      for (const symbol of production.rhs) if (!symbol.terminal) pending.push(symbol.name);
      const stack = [production.conditions,production.tags,production.emit,
        production.rankedDeferred,production.parentTags,production.writtenTagClauses,
        production.source?.clauses];
      const seen = new Set();
      while (stack.length) {
        const node = /** @type {any} */ (stack.pop());
        if (!node || typeof node !== "object" || seen.has(node)) continue;
        seen.add(node);
        if ((node.matches || node.begins) && typeof node.rule === "string") {
          pending.push(node.rule);
          if (needsCloseObservations(node.matches ?? node.begins)) wanted.add(node.rule);
        }
        if (node.call === "tags" && node.args?.[1]?.rule) {
          pending.push(node.args[1].rule);
          if (needsCloseObservations(node.args[0])) wanted.add(node.args[1].rule);
        }
        if (node.call === "without-elision") {
          const capture = node.args[0].capture;
          const part = production.captures.find(c => c.name === capture);
          if (capture === "" || !part || production.rhs.some(s => s.slot)) {
            wanted.add(production.owner);
            wanted.add(production.lhs);
          } else {
            const symbol = production.rhs[part.index];
            if (!symbol.terminal) wanted.add(symbol.name);
          }
        }
        for (const value of Object.values(node)) stack.push(value);
      }
    }
  }
  const queue = [...wanted];
  while (queue.length) {
    const rule = /** @type {string} */ (queue.pop());
    for (const production of lowered.byLhs.get(rule) ?? []) {
      for (const symbol of production.rhs) {
        if (!symbol.terminal && !wanted.has(symbol.name)) {
          wanted.add(symbol.name);
          queue.push(symbol.name);
        }
      }
    }
  }
  demands.set(lowered,wanted);
  return wanted;
}

/** @typedef {{whole:boolean, parts:Set<number>, queries:Map<number,Set<string>|null>}} LocalCloseDemand */
/** @type {WeakMap<import("./types.js").Production,LocalCloseDemand>} */
const localDemands = new WeakMap();

/**
 * Only a caller that consumes an observation asks its child to retain it.
 * A private whole capture also needs the enclosing written alternative.
 * @param {import("./types.js").Production} production
 * @returns {LocalCloseDemand}
 */
export function localCloseDemand(production) {
  const base = production.baseProduction ?? production;
  const old = localDemands.get(base);
  if (old) return old;
  const result = {whole:false, parts:new Set(), queries:new Map()};
  const stack = [base.conditions, base.tags, base.emit, base.rankedDeferred,
    base.parentTags, base.writtenTagClauses, base.source?.clauses.conditions];
  const seen = new Set();
  while (stack.length) {
    const node = /** @type {any} */ (stack.pop());
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    const value = node.matches ?? node.begins;
    const aligned = value?.call === "from" ? value.args[0] : value;
    if (aligned?.call === "without-elision" && typeof node.rule === "string") {
      const part = base.captures.find(capture => capture.name === aligned.args[0].capture);
      if (part) {
        result.parts.add(part.index);
        if (!result.queries.has(part.index)) result.queries.set(part.index,new Set());
        result.queries.get(part.index)?.add(node.rule);
        continue;
      }
    }
    if (node.call === "without-elision") {
      const name = node.args[0].capture;
      if (name === "") result.whole = true;
      else {
        const part = base.captures.find(capture => capture.name === name);
        if (part) {
          result.parts.add(part.index);
          result.queries.set(part.index,null);
        }
      }
    }
    for (const value of Object.values(node)) stack.push(value);
  }
  localDemands.set(base, result);
  return result;
}

/** @typedef {{nullable:boolean, leadingClose:boolean, first:Set<import("./types.js").GrammarSymbol>}} QueryPrefix */
/** @type {WeakMap<import("./types.js").LoweredGrammar,Map<string,QueryPrefix>>} */
const prefixes = new WeakMap();

/**
 * Conditions can only reduce these possible prefixes. A leading omission
 * or an empty capture prevents this shortcut from discarding observations.
 * @param {import("./types.js").LoweredGrammar} grammar
 * @returns {Map<string,QueryPrefix>}
 */
export function queryPrefixes(grammar) {
  const old = prefixes.get(grammar);
  if (old) return old;
  const table = new Map([...grammar.byLhs.keys()].map(name =>
    [name,{nullable:false,leadingClose:false,first:new Set()}]));
  /** @type {Map<string,Set<import("./types.js").Production>>} */
  const dependents = new Map();
  for (const production of grammar.productions) {
    for (const symbol of production.rhs) if (!symbol.terminal) {
      if (!dependents.has(symbol.name)) dependents.set(symbol.name,new Set());
      dependents.get(symbol.name)?.add(production);
    }
  }
  const pending = grammar.productions.slice(), queued = new Set(pending);
  while (pending.length) {
    const production = /** @type {import("./types.js").Production} */ (pending.pop());
    queued.delete(production);
    const here = /** @type {QueryPrefix} */ (table.get(production.lhs));
    const before = here.first.size;
    const wasEmpty = here.nullable, wasClose = here.leadingClose;
    if (production.rhs.length === 0 && production.elided !== null) here.leadingClose = true;
    let empty = true;
    for (const symbol of production.rhs) {
      if (symbol.terminal) { here.first.add(symbol); empty = false; break; }
      const child = /** @type {QueryPrefix} */ (table.get(symbol.name));
      for (const terminal of child.first) here.first.add(terminal);
      here.leadingClose ||= child.leadingClose;
      if (!child.nullable) { empty = false; break; }
    }
    here.nullable ||= empty;
    if (before !== here.first.size || wasEmpty !== here.nullable || wasClose !== here.leadingClose) {
      for (const dependent of dependents.get(production.lhs) ?? []) if (!queued.has(dependent)) {
        queued.add(dependent);
        pending.push(dependent);
      }
    }
  }
  prefixes.set(grammar,table);
  return table;
}
