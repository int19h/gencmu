export type FamilySummary = {
    id: number;
    dead: boolean;
    first: bigint;
    last: bigint;
    relation: bigint[] | null;
};
export type Event = import("./close-observations.js").CloseEvent;
/**
 * A null relation is the identity of a record-free empty item.
 * @typedef {{id:number, dead:boolean, first:bigint, last:bigint, relation:bigint[]|null}} FamilySummary
 */
/** @typedef {import("./close-observations.js").CloseEvent} Event */
/** @param {Event} left @param {Event} right @returns {boolean} */
export declare function sameRecord(left: Event, right: Event): boolean;
/**
 * Independent whole-group test for the library's conformance switch. It
 * reads each witness record directly, without item sets or relation joins.
 * @param {Event[]} candidate
 * @param {{event:Event, permitted:boolean}[]} witness
 * @param {number} start @param {number} end
 * @returns {boolean}
 */
export declare function deletionTest(candidate: Event[], witness: {
    event: Event;
    permitted: boolean;
}[], start: number, end: number): boolean;
export declare class FamilySummaries {
    start: number;
    end: number;
    /** @type {Map<number,Event[]>} */ groups: Map<number, Event[]>;
    /** @type {Map<string,FamilySummary>} */ summaries: Map<string, FamilySummary>;
    /** @type {Set<number>} */ taken: Set<number>;
    /** @type {Map<string,bigint[]>} */ records: Map<string, bigint[]>;
    /** @type {Map<string,FamilySummary>} */ joins: Map<string, FamilySummary>;
    identity: FamilySummary;
    dead: FamilySummary;
    /**
     * @param {import("./close-observations.js").CloseObservations} closes
     * @param {import("./close-observations.js").CloseObservation} candidate
     * @param {number} start
     * @param {number} end
     */
    constructor(closes: import("./close-observations.js").CloseObservations, candidate: import("./close-observations.js").CloseObservation, start: number, end: number);
    /** @param {number} at @returns {Event[]} */
    group(at: number): Event[];
    /** @param {boolean} dead @param {bigint} first @param {bigint} last @param {bigint[]|null} relation @returns {FamilySummary} */
    intern(dead: boolean, first: bigint, last: bigint, relation: bigint[] | null): FamilySummary;
    /** @param {FamilySummary} summary @returns {FamilySummary} */
    take(summary: FamilySummary): FamilySummary;
    /** @param {number} at @param {boolean} final @returns {bigint} */
    accept(at: number, final?: boolean): bigint;
    /** @param {bigint[]|null} relation @param {bigint} set @returns {bigint} */
    image(relation: bigint[] | null, set: bigint): bigint;
    /** @param {bigint[]|null} relation @param {bigint} set @returns {bigint} */
    preimage(relation: bigint[] | null, set: bigint): bigint;
    /** @param {Event} event @param {boolean} permitted @returns {FamilySummary} */
    record(event: Event, permitted: boolean): FamilySummary;
    /**
     * A token or an opaque block reads an interval. Its interior has no
     * visible records. Candidate records there therefore make it dead.
     * @param {number} start @param {number} end @returns {FamilySummary}
     */
    tokens(start: number, end: number): FamilySummary;
    /**
     * @param {FamilySummary} left @param {FamilySummary} right
     * @param {number} start @param {number} middle @param {number} end
     * @returns {FamilySummary}
     */
    join(left: FamilySummary, right: FamilySummary, start: number, middle: number, end: number): FamilySummary;
    /** @param {FamilySummary} summary @param {number} end @returns {boolean} */
    accepts(summary: FamilySummary, end: number): boolean;
}
