export type CloseEvent = {
    kind: "close";
    terminal: string;
    at: number;
    source: [number, number];
    value?: string;
} | {
    kind: "block";
    key: string;
    start: number;
    end: number;
};
export type CloseObservation = {
    id: number;
    sequence: number;
    rules: ReadonlySet<string>;
    valid: boolean;
};
export type SequenceNode = {
    left: number;
    right: number;
    event: number;
    size: bigint;
    hash: bigint;
    power: bigint;
    height: number;
    min: number;
    max: number;
};
/**
 * @typedef {{left:number,right:number,event:number,size:bigint,hash:bigint,power:bigint,
 *   height:number,min:number,max:number}} SequenceNode
 */
declare class Sequences {
    events: CloseEvent[];
    counted: boolean;
    mask: bigint;
    /** @type {SequenceNode[]} */
    nodes: SequenceNode[];
    /** @type {Map<string,number>} */ ids: Map<string, number>;
    /** @type {Map<string,number[]>} */ buckets: Map<string, number[]>;
    /** @type {Map<string,number|null>} */ prefixes: Map<string, number | null>;
    /** @param {CloseEvent[]} events @param {boolean} counted @param {bigint} mask */
    constructor(events: CloseEvent[], counted: boolean, mask: bigint);
    /** @param {number} a @param {number} b @returns {boolean} */
    equal(a: number, b: number): boolean;
    /** @param {string} key @param {SequenceNode} node @returns {number} */
    intern(key: string, node: SequenceNode): number;
    /** @param {number} event @returns {number} */
    leaf(event: number): number;
    /** @param {number} left @param {number} right @returns {number} */
    concat(left: number, right: number): number;
    /** @param {number} id @returns {IterableIterator<CloseEvent>} */
    values(id: number): IterableIterator<CloseEvent>;
    /** @param {number} id @param {number} end @returns {number|null} */
    through(id: number, end: number): number | null;
}
export declare class CloseObservations {
    /** @type {CloseEvent[]} */ events: CloseEvent[];
    /** @type {Map<string,number>} */ eventIds: Map<string, number>;
    raw: Sequences;
    sequences: SequenceNode[];
    /** @type {CloseEvent[]} */ normalEvents: CloseEvent[];
    /** @type {Map<string,number>} */ normalEventIds: Map<string, number>;
    normal: Sequences;
    /** @type {CloseObservation[]} */ states: CloseObservation[];
    /** @type {Map<string,CloseObservation>} */ stateIds: Map<string, CloseObservation>;
    /** @type {Map<string,CloseObservation>} */ products: Map<string, CloseObservation>;
    /** @type {Map<string,[number,number]>} */ ruleSpans: Map<string, [number, number]>;
    alignmentIds: Map<string, number>;
    /** @type {Map<number,number>} */ sequenceAlignmentIds: Map<number, number>;
    empty: CloseObservation;
    invalid: {
        id: number;
        sequence: number;
        rules: Set<any>;
        valid: boolean;
    };
    /** @param {bigint} [mask] */
    constructor(mask?: bigint);
    /** @param {number} sequence @param {ReadonlySet<string>} rules @returns {CloseObservation} */
    intern(sequence: number, rules: ReadonlySet<string>): CloseObservation;
    /** @param {number} parent @param {CloseEvent} event @returns {number} */
    append(parent: number, event: CloseEvent): number;
    /** @param {number} sequence @returns {CloseEvent[]} */
    list(sequence: number): CloseEvent[];
    /** @param {CloseObservation} left @param {CloseObservation} right @returns {CloseObservation} */
    concat(left: CloseObservation, right: CloseObservation): CloseObservation;
    /** @param {CloseEvent} event @param {ReadonlySet<string>} [rules] @returns {CloseObservation} */
    event(event: CloseEvent, rules?: ReadonlySet<string>): CloseObservation;
    /** @param {CloseObservation} inner @param {string} rule @param {number} start @param {number} end @returns {CloseObservation} */
    closeRule(inner: CloseObservation, rule: string, start: number, end: number): CloseObservation;
    /** @param {CloseObservation} inner @param {number} start @param {number} end @returns {CloseObservation} */
    trim(inner: CloseObservation, start: number, end: number): CloseObservation;
    /** @param {CloseObservation} candidate @param {CloseObservation} witness @param {number} through @returns {boolean} */
    aligned(candidate: CloseObservation, witness: CloseObservation, through: number): boolean;
    /** @param {CloseObservation} observation @returns {number} */
    identity(observation: CloseObservation): number;
    /** @param {CloseObservation} state @param {number} through @returns {number|null} */
    through(state: CloseObservation, through: number): number | null;
}
/**
 * @param {unknown} value
 * @returns {boolean}
 */
export declare function needsCloseObservations(value: unknown): boolean;
/**
 * Finds captures and witnesses that reachable queries can observe. Unused
 * rules do not activate observations, and unrelated siblings stay ordinary.
 * @param {import("./types.js").LoweredGrammar} lowered
 * @returns {Set<string>}
 */
export declare function closeDemands(lowered: import("./types.js").LoweredGrammar): Set<string>;
export type LocalCloseDemand = {
    whole: boolean;
    parts: Set<number>;
    queries: Map<number, Set<string> | null>;
};
/**
 * Only a caller that consumes an observation asks its child to retain it.
 * A private whole capture also needs the enclosing written alternative.
 * @param {import("./types.js").Production} production
 * @returns {LocalCloseDemand}
 */
export declare function localCloseDemand(production: import("./types.js").Production): LocalCloseDemand;
export type QueryPrefix = {
    nullable: boolean;
    leadingClose: boolean;
    first: Set<import("./types.js").GrammarSymbol>;
};
/**
 * Conditions can only reduce these possible prefixes. A leading omission
 * or an empty capture prevents this shortcut from discarding observations.
 * @param {import("./types.js").LoweredGrammar} grammar
 * @returns {Map<string,QueryPrefix>}
 */
export declare function queryPrefixes(grammar: import("./types.js").LoweredGrammar): Map<string, QueryPrefix>;
export {};
