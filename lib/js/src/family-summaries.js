// The deletion automaton of engine §4.1. Items retain sets and relations,
// never permission-marked close sequences. Dead summaries filter witnesses
// only. The chart and its omission blockers still retain every item.

import { countWork, hooks } from "./testing.js";

/**
 * A null relation is the identity of a record-free empty item.
 * @typedef {{id:number, dead:boolean, first:bigint, last:bigint, relation:bigint[]|null}} FamilySummary
 */
/** @typedef {import("./close-observations.js").CloseEvent} Event */

/** @param {Event} left @param {Event} right @returns {boolean} */
export function sameRecord(left, right) {
  return left.kind === right.kind && (left.kind === "close"
    ? left.terminal === /** @type {Extract<Event,{kind:"close"}>} */ (right).terminal && left.at === /** @type {Extract<Event,{kind:"close"}>} */ (right).at
    : left.key === /** @type {Extract<Event,{kind:"block"}>} */ (right).key && left.start === /** @type {Extract<Event,{kind:"block"}>} */ (right).start && left.end === /** @type {Extract<Event,{kind:"block"}>} */ (right).end);
}

/**
 * Independent whole-group test for the library's conformance switch. It
 * reads each witness record directly, without item sets or relation joins.
 * @param {Event[]} candidate
 * @param {{event:Event, permitted:boolean}[]} witness
 * @param {number} start @param {number} end
 * @returns {boolean}
 */
export function deletionTest(candidate, witness, start, end) {
  /** @type {(event:Event) => number} */
  const position = event => event.kind === "close" ? event.at : event.start;
  /** @type {(event:Event) => boolean} */
  const inside = event => position(event) <= end && !(event.kind === "block" && event.start === end && event.end > end);
  for (const {event} of witness) if (event.kind === "block" && event.start < end && event.end > end) return false;
  const kept = candidate.filter(inside);
  const records = witness.filter(record => inside(record.event));
  // A state records matched candidate records and whether the last step
  // deleted one. A later match or a following token supplies its right anchor.
  let states = new Set(["0/0"]);
  for (const {event, permitted} of records) {
    const next = new Set();
    for (const state of states) {
      const [index, trailing] = state.split("/").map(Number);
      const at = position(event);
      // Candidate records before this boundary must already be matched.
      if (index < kept.length && position(kept[index]) < at) continue;
      if (index < kept.length && sameRecord(event, kept[index])) next.add(`${index+1}/0`);
      const earlierRecord = index > 0 && position(kept[index-1]) === at;
      if (permitted && event.kind === "close" && (at > start || earlierRecord)) next.add(`${index}/1`);
      // `trailing` stays relevant only at the final boundary.
      void trailing;
    }
    states = next;
  }
  return states.has(`${kept.length}/0`) || (records.length !== 0 && position(records[records.length-1].event) < end && states.has(`${kept.length}/1`));
}

export class FamilySummaries {
  /**
   * @param {import("./close-observations.js").CloseObservations} closes
   * @param {import("./close-observations.js").CloseObservation} candidate
   * @param {number} start
   * @param {number} end
   */
  constructor(closes, candidate, start, end) {
    this.start = start;
    this.end = end;
    /** @type {Map<number,Event[]>} */ this.groups = new Map();
    for (const event of closes.raw.values(candidate.sequence)) {
      const at = event.kind === "close" ? event.at : event.start;
      const group = this.groups.get(at);
      if (group) group.push(event);
      else this.groups.set(at, [event]);
    }
    /** @type {Map<string,FamilySummary>} */ this.summaries = new Map();
    /** @type {Set<number>} */ this.taken = new Set();
    /** @type {Map<string,bigint[]>} */ this.records = new Map();
    /** @type {Map<string,FamilySummary>} */ this.joins = new Map();
    this.identity = this.intern(false, 0n, 0n, null);
    this.dead = this.intern(true, 0n, 0n, null);
  }

  /** @param {number} at @returns {Event[]} */
  group(at) { return this.groups.get(at) ?? []; }

  /** @param {boolean} dead @param {bigint} first @param {bigint} last @param {bigint[]|null} relation @returns {FamilySummary} */
  intern(dead, first, last, relation) {
    const key = dead ? "dead" : `${first}/${last}/${relation?.join(",") ?? "identity"}`;
    let summary = this.summaries.get(key);
    if (!summary) {
      summary = {id:this.summaries.size, dead, first, last, relation};
      this.summaries.set(key, summary);
    }
    return summary;
  }

  /** @param {FamilySummary} summary @returns {FamilySummary} */
  take(summary) {
    if (!this.taken.has(summary.id)) {
      this.taken.add(summary.id);
      if (hooks.work) countWork(hooks.work, "familySummaries");
    }
    return summary;
  }

  /** @param {number} at @param {boolean} final @returns {bigint} */
  accept(at, final = false) {
    if (at > this.end) return 1n;
    const group = this.group(at);
    let count = group.length;
    if (final && count && group[count-1].kind === "block" && /** @type {Extract<Event,{kind:"block"}>} */ (group[count-1]).end > at) count--;
    return (final || at === this.end ? 1n : 3n) << BigInt(2*count);
  }

  /** @param {bigint[]|null} relation @param {bigint} set @returns {bigint} */
  image(relation, set) {
    if (relation === null) return set;
    if (hooks.work) countWork(hooks.work, "familySteps", relation.length);
    let result = 0n;
    for (let index = 0; index < relation.length; index++) if (set & (1n << BigInt(index))) result |= relation[index];
    return result;
  }

  /** @param {bigint[]|null} relation @param {bigint} set @returns {bigint} */
  preimage(relation, set) {
    if (relation === null) return set;
    if (hooks.work) countWork(hooks.work, "familySteps", relation.length);
    let result = 0n;
    for (let index = 0; index < relation.length; index++) if (relation[index] & set) result |= 1n << BigInt(index);
    return result;
  }

  /** @param {Event} event @param {boolean} permitted @returns {FamilySummary} */
  record(event, permitted) {
    const at = event.kind === "close" ? event.at : event.start;
    if (at > this.end || event.kind === "block" && at === this.end && event.end > at) return this.identity;
    const key = JSON.stringify([event.kind === "close" ? [event.terminal,event.at] : [event.key,event.start,event.end], permitted]);
    let relation = this.records.get(key);
    if (!relation) {
      const group = this.group(at);
      relation = Array(2*(group.length+1)).fill(0n);
      if (hooks.work) countWork(hooks.work, "familySteps", relation.length);
      for (let i = 0; i <= group.length; i++) {
        let targets = 0n;
        if (i < group.length && sameRecord(event, group[i])) targets |= 1n << BigInt(2*(i+1));
        if (permitted && event.kind === "close" && (i > 0 || at > this.start)) targets |= 1n << BigInt(2*i+1);
        relation[2*i] = relation[2*i+1] = targets;
      }
      this.records.set(key, relation);
    }
    return this.intern(false, 0n, 0n, relation);
  }

  /**
   * A token or an opaque block reads an interval. Its interior has no
   * visible records. Candidate records there therefore make it dead.
   * @param {number} start @param {number} end @returns {FamilySummary}
   */
  tokens(start, end) {
    if (start < this.end && this.end < end) return this.dead;
    for (const at of this.groups.keys()) if (start < at && at < end && at <= this.end) return this.dead;
    return this.intern(false, this.accept(start), 1n, null);
  }

  /**
   * @param {FamilySummary} left @param {FamilySummary} right
   * @param {number} start @param {number} middle @param {number} end
   * @returns {FamilySummary}
   */
  join(left, right, start, middle, end) {
    if (left.dead || right.dead) return this.dead;
    const key = `${left.id}/${right.id}/${start === middle}/${middle === end}`;
    const known = this.joins.get(key);
    if (known) return known;
    let summary;
    if (start === middle && middle === end) {
      const relation = left.relation === null ? right.relation : right.relation === null ? left.relation : left.relation.map(row => this.image(right.relation, row));
      summary = this.intern(false, 0n, 0n, relation);
    } else if (start === middle) {
      summary = this.intern(false, this.preimage(left.relation, right.first), right.last, null);
    } else if (middle === end) {
      summary = this.intern(false, left.first, this.image(right.relation, left.last), null);
    } else {
      summary = left.last & right.first ? this.intern(false, left.first, right.last, null) : this.dead;
    }
    this.joins.set(key, summary);
    return summary;
  }

  /** @param {FamilySummary} summary @param {number} end @returns {boolean} */
  accepts(summary, end) {
    if (summary.dead) return false;
    const accepting = this.accept(end, true);
    return end === this.start ? !!(this.image(summary.relation, 1n) & accepting)
      : !!(summary.first & 1n) && (end > this.end || !!(summary.last & accepting));
  }
}
