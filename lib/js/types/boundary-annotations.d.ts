export type BoundarySite = {
    rule: string;
    condition: number;
    order: number;
};
/** @typedef {{rule:string,condition:number,order:number}} BoundarySite */
export declare class BoundarySource {
    /** @type {Set<BoundarySite>} */
    sites: Set<BoundarySite>;
    /** @type {Set<BoundarySource>} */
    users: Set<BoundarySource>;
    constructor();
    /** @param {BoundarySite} site */
    add(site: BoundarySite): void;
    /** Later joins must also reach items that already advanced.
     * @param {BoundarySource|undefined} source */
    inherit(source: BoundarySource | undefined): void;
}
export type Sources = Map<bigint, BoundarySource>;
export declare class BoundaryAnnotations {
    start: Sources;
    end: Sources;
    /** @param {Sources} [start] @param {Sources} [end] */
    constructor(start?: Sources, end?: Sources);
    /** @param {import("./boundary.js").BoundaryRecord} record */
    retain(record: import("./boundary.js").BoundaryRecord): BoundaryAnnotations;
    /** @param {"start"|"end"} edge @param {bigint} bit @param {BoundarySite|undefined} site */
    add(edge: "start" | "end", bit: bigint, site: BoundarySite | undefined): void;
    /** Equal records keep one item and join its annotations.
     * @param {BoundaryAnnotations} other */
    merge(other: BoundaryAnnotations): void;
    /** @param {BoundaryAnnotations} child @param {boolean} empty @param {bigint} bit */
    meeting(child: BoundaryAnnotations, empty: boolean, bit: bigint): BoundarySource;
    /** Follow the same boundary transfers as the record's advance.
     * @param {import("./boundary.js").BoundaryRecords} machine
     * @param {import("./boundary.js").BoundaryRecord} prefix
     * @param {import("./boundary.js").BoundaryRecord} child
     * @param {import("./boundary.js").BoundaryRecord} result
     * @param {BoundaryAnnotations} sources */
    advance(machine: import("./boundary.js").BoundaryRecords, prefix: import("./boundary.js").BoundaryRecord, child: import("./boundary.js").BoundaryRecord, result: import("./boundary.js").BoundaryRecord, sources: BoundaryAnnotations): BoundaryAnnotations;
}
