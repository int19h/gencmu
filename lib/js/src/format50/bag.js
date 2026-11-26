// The bag of a node, a constant or a token (engine §3.7). A key is absent,
// present with no value, or present with a value. A bag is an ordered list
// of writes. A later write wins for its key. A reader of one key looks for
// the winning write from the last write back, so a hidden write is never
// evaluated, and its errors never surface.

import { GencmuError } from "../errors.js";
import { compareCodePoints } from "../tags.js";

/**
 * Work counts of the format 50 engine, for the cost measurements of part 2
 * §10: the values that bags compute, the writes into bags, the lookups of
 * one key, and the parts that string joins share. A caller resets them.
 */
export const counts50 = { values: 0, writes: 0, lookups: 0, joinParts: 0 };

/** A key that names a class (engine §3.7). */
export const CLASS_KEY = /^[A-Z](.*[A-Z])?$/;

/** The entry of a key with no value. */
export const BARE = Object.freeze({ bare: true });

// A value can read a value of a child, which reads a value of its own
// child. A long run of one rule nests these reads as deep as the tree. A
// read that is deeper than DEPTH stops, and the outermost read runs that
// deeper value first, so the host stack stays bounded (part 2 §10).
const DEPTH = 64;
let depth = 0;

/** The signal that a read went too deep. It is not an error of a grammar. */
class TooDeep {
  /** @param {Deferred} deferred */
  constructor(deferred) {
    this.deferred = deferred;
  }
}

/**
 * A written value whose expression runs once, and only when a reader needs
 * the payload.
 */
export class Deferred {
  /** @param {() => any} compute */
  constructor(compute) {
    this.compute = compute;
    this.done = false;
    this.computing = false;
    /** @type {any} */
    this.payload = undefined;
  }

  force() {
    if (this.done) return this.payload;
    if (depth > 0) return this.run();
    // The outermost read. Each value that went too deep runs first, from a
    // short stack, and then the reads above it run again. A value that is
    // done keeps its payload, so each run gets further.
    const pending = [/** @type {Deferred} */ (this)];
    while (pending.length) {
      const next = /** @type {Deferred} */ (pending.at(-1));
      if (next.done) {
        pending.pop();
        continue;
      }
      try {
        next.run();
        pending.pop();
      } catch (signal) {
        if (!(signal instanceof TooDeep)) throw signal;
        pending.push(signal.deferred);
      }
    }
    return this.payload;
  }

  /** @private */
  run() {
    if (this.done) return this.payload;
    if (depth >= DEPTH) throw new TooDeep(this);
    if (this.computing) throw new GencmuError("grammar", "a value of a bag reads itself");
    this.computing = true;
    depth++;
    counts50.values++;
    try {
      this.payload = this.compute();
      this.done = true;
    } finally {
      depth--;
      this.computing = false;
    }
    return this.payload;
  }
}

/**
 * A key with no value, or a key with a value that runs on demand.
 * @typedef {typeof BARE | {deferred: Deferred}} Entry
 */

/**
 * An entry with a value.
 * @param {any} payload a payload, or a deferred computation of one
 * @returns {Entry}
 */
export function valued(payload) {
  return { deferred: payload instanceof Deferred ? payload : new Deferred(() => payload) };
}

/**
 * A guard or a gate that runs once.
 * @param {(() => boolean) | null} test
 */
function once(test) {
  if (test === null) return null;
  let known;
  return () => (known ??= test());
}

export class Bag {
  constructor() {
    /** @type {any[]} */
    this.writes = [];
    /** @type {Map<string, any>} */
    this.resolved = new Map();
    /** @type {string[] | null} */
    this.keyList = null;
    /** @type {Set<string>} */
    this.resolving = new Set();
  }

  /**
   * A bag that holds these entries, in key order.
   * @param {Iterable<[string, Entry]>} entries
   */
  static from(entries) {
    const bag = new Bag();
    for (const [key, entry] of entries) bag.write([key], entry, null);
    return bag;
  }

  /**
   * Writes one entry under each key.
   * @param {string[]} keys
   * @param {any} entry BARE, or an entry with a value
   * @param {(() => boolean) | null} guard
   */
  write(keys, entry, guard) {
    counts50.writes++;
    this.writes.push({ kind: "write", keys: new Set(keys), entry, guard: once(guard) });
  }

  /**
   * Writes the entry that `source` has for `key`, where it has one.
   * @param {string} key
   * @param {() => Bag} source
   * @param {(() => boolean) | null} guard
   */
  copy(key, source, guard) {
    this.writes.push({ kind: "copy", key, source: new Deferred(source), guard: once(guard) });
  }

  /**
   * Removes a key.
   * @param {string} key
   * @param {(() => boolean) | null} guard
   */
  delete(key, guard) {
    this.writes.push({ kind: "delete", key, guard: once(guard) });
  }

  /**
   * Writes each entry of a bag as it is.
   * @param {() => Bag} source
   * @param {(() => boolean) | null} guard
   */
  splat(source, guard) {
    this.writes.push({ kind: "splat", source: new Deferred(source), guard: once(guard) });
  }

  /**
   * The winning entry for a key, or null where the key is absent.
   * @param {string} key
   */
  entry(key) {
    if (this.resolved.has(key)) return this.resolved.get(key);
    if (this.resolving.has(key)) throw new GencmuError("grammar", `the key ${key} of a bag reads itself`);
    this.resolving.add(key);
    try {
      const found = this.resolve(key);
      this.resolved.set(key, found);
      return found;
    } finally {
      this.resolving.delete(key);
    }
  }

  /**
   * @param {string} key
   * @returns {Entry | null}
   */
  resolve(key) {
    counts50.lookups++;
    let found = null;
    for (let index = this.writes.length - 1; index >= 0; index--) {
      const write = this.writes[index];
      if (write.kind === "write") {
        if (!write.keys.has(key) || (write.guard && !write.guard())) continue;
        found = write.entry;
        break;
      }
      if (write.kind === "delete") {
        if (write.key !== key || (write.guard && !write.guard())) continue;
        break;
      }
      if (write.kind === "copy") {
        if (write.key !== key || (write.guard && !write.guard())) continue;
        const source = write.source.force();
        const entry = source.entry(key);
        if (entry === null) continue;
        found = entry;
        break;
      }
      if (write.guard && !write.guard()) continue;
      const entry = write.source.force().entry(key);
      if (entry !== null) {
        found = entry;
        break;
      }
    }
    return found;
  }

  /** @param {string} key */
  has(key) {
    return this.entry(key) !== null;
  }

  /** @param {string} key */
  hasValue(key) {
    const entry = this.entry(key);
    return entry !== null && entry !== BARE;
  }

  /**
   * The payload of a key, or undefined where it has none.
   * @param {string} key
   * @returns {any}
   */
  value(key) {
    const entry = this.entry(key);
    return entry === null || entry === BARE ? undefined : entry.deferred.force();
  }

  /** The present keys, in code point order. */
  keys() {
    if (this.keyList !== null) return this.keyList;
    const candidates = new Set();
    for (const write of this.writes) {
      if (write.kind === "write") for (const key of write.keys) candidates.add(key);
      else if (write.kind === "copy") candidates.add(write.key);
      else if (write.kind === "splat" && (!write.guard || write.guard())) {
        for (const key of write.source.force().keys()) candidates.add(key);
      }
    }
    this.keyList = [...candidates].sort(compareCodePoints).filter(key => this.has(key));
    return this.keyList;
  }

  get size() {
    return this.keys().length;
  }
}

/**
 * A bag of bare keys.
 * @param {Iterable<string>} keys
 */
export function keySet(keys) {
  return Bag.from([...new Set(keys)].sort(compareCodePoints).map(key => [key, BARE]));
}

/**
 * Whether every present entry of a bag has no value.
 * @param {Bag} bag
 */
export function isKeySet(bag) {
  return bag.keys().every(key => bag.entry(key) === BARE);
}
