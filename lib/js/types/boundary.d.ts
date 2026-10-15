export declare const BOUNDARY_METHODS: Set<string>;
/** @type {WeakMap<object, any>} */
export declare const boundaryLocations: WeakMap<object, any>;
/** Preserve positions when constants or patterns copy a clause.
 * @param {object} from @param {object} to */
export declare function copyBoundaryLocation(from: object, to: object): void;
/** @param {any} node @returns {any[]} */
export declare function boundaryAtoms(node: any): any[];
/** @param {any} rule @returns {{problem:string,node:any}|null} */
export declare function boundaryProblem(rule: any): {
    problem: string;
    node: any;
} | null;
/** Body reachability, independently of gates and conditions. @param {any} grammar */
export declare function boundaryReachability(grammar: any): {
    text: {
        rules: Set<any>;
        terminals: Set<any>;
    };
    all: {
        rules: Set<any>;
        terminals: Set<any>;
    };
    queries: {
        rule: any;
        alternative: any;
        target: any;
        reached: {
            rules: Set<any>;
            terminals: Set<any>;
        };
    }[];
    atoms: {
        rule: any;
        alternative: any;
        atom: any;
    }[];
};
export type BoundaryLiteral = {
    bit: bigint;
    direction: string;
    target: bigint;
    positive: boolean;
};
export type BoundaryRecord = {
    id: number;
    empty: boolean;
    start: bigint;
    first: bigint;
    end: bigint;
    last: bigint;
};
/** @typedef {{bit:bigint,direction:string,target:bigint,positive:boolean}} BoundaryLiteral */
/** @typedef {{id:number,empty:boolean,start:bigint,first:bigint,end:bigint,last:bigint}} BoundaryRecord */
export declare class BoundaryRecords {
    names: Map<any, any>;
    forward: bigint;
    backward: bigint;
    /** @type {BoundaryLiteral[]} */
    literals: BoundaryLiteral[];
    /** @type {Map<string,BoundaryLiteral>} */
    literalKeys: Map<string, BoundaryLiteral>;
    /** @type {Map<string,BoundaryRecord>} */
    records: Map<string, BoundaryRecord>;
    empty: BoundaryRecord;
    /** @param {any[]} productions */
    constructor(productions: any[]);
    /** @param {string} name */
    name(name: string): any;
    /** @param {any} atom */
    demand(atom: any): void;
    /** @param {any} atom @param {boolean} positive */
    literal(atom: any, positive: boolean): BoundaryLiteral;
    /** @param {boolean} empty @param {bigint} start @param {bigint} first @param {bigint} end @param {bigint} last */
    intern(empty: boolean, start: bigint, first: bigint, end: bigint, last: bigint): BoundaryRecord;
    /** @param {bigint} literals @param {bigint} offers @param {string} direction @param {boolean} final @param {(literal:any)=>void} fail */
    meet(literals: bigint, offers: bigint, direction: string, final: boolean, fail: (literal: any) => void): bigint | null;
    /** @param {BoundaryRecord} record @param {bigint} bits */
    append(record: BoundaryRecord, bits: bigint): BoundaryRecord;
    /** @param {string} name @param {boolean} empty */
    leaf(name: string, empty: boolean): BoundaryRecord;
    /** @param {BoundaryRecord} prefix @param {BoundaryRecord} child @param {(literal:any)=>void} fail */
    advance(prefix: BoundaryRecord, child: BoundaryRecord, fail: (literal: any) => void): BoundaryRecord | null;
    /** @param {BoundaryRecord} record @param {string|null} name @param {bigint} backward @param {bigint} forward @param {(literal:any)=>void} fail */
    complete(record: BoundaryRecord, name: string | null, backward: bigint, forward: bigint, fail: (literal: any) => void): BoundaryRecord | null;
    /** @param {BoundaryRecord} record @param {(literal:any)=>void} fail */
    accepts(record: BoundaryRecord, fail?: (literal: any) => void): boolean;
    /** The option's facts after qualification, without the prefix's facts. @param {BoundaryRecord} prefix @param {BoundaryRecord} child */
    open(prefix: BoundaryRecord, child: BoundaryRecord): string | number | null;
}
/** @param {any} condition */
export declare function firstBoundaryAtom(condition: any): any;
/** @param {any[]} productions */
export declare function boundaryMachine(productions: any[]): BoundaryRecords | null;
/** A cached document needs source positions only when it raises an error.
 * @type {WeakMap<object,{document:string,node:object}>} */
export declare const boundaryDocumentErrors: WeakMap<object, {
    document: string;
    node: object;
}>;
/** @param {any} dom @param {any[]} tokens @param {(token:any)=>[number,number]} positionOf */
export declare function restoreBoundaryLocations(dom: any, tokens: any[], positionOf: (token: any) => [number, number]): void;
/** @param {any[]} productions */
export declare function emissionTargets(productions: any[]): Set<string>;
