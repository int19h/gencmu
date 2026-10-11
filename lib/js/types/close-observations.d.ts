export type CloseEvent = {
    kind: "close";
    terminal: string;
    at: number;
    source: [number, number];
    sound?: string;
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
/**
 * @typedef {{kind: "close", terminal: string, at: number, source: [number, number], sound?: string}
 *   | {kind: "block", key: string, start: number, end: number}} CloseEvent
 */
/**
 * @typedef {{id: number, sequence: number, rules: ReadonlySet<string>, valid: boolean}} CloseObservation
 */
export declare class CloseObservations {
    /** @type {CloseEvent[]} */ events: CloseEvent[];
    /** @type {Map<string,number>} */ eventIds: Map<string, number>;
    /** @type {{parent:number,event:number}[]} */ sequences: {
        parent: number;
        event: number;
    }[];
    /** @type {Map<string,number>} */ sequenceIds: Map<string, number>;
    /** @type {CloseObservation[]} */ states: CloseObservation[];
    /** @type {Map<string,CloseObservation>} */ stateIds: Map<string, CloseObservation>;
    /** @type {Map<string,CloseObservation>} */ products: Map<string, CloseObservation>;
    /** @type {Map<string,[number,number]>} */ ruleSpans: Map<string, [number, number]>;
    /** @type {Map<string,number>} */ alignmentIds: Map<string, number>;
    /** @type {Map<number,number>} */ sequenceAlignmentIds: Map<number, number>;
    empty: CloseObservation;
    invalid: {
        id: number;
        sequence: number;
        rules: Set<any>;
        valid: boolean;
    };
    constructor();
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
    /** @param {CloseObservation} state @param {number} through @returns {string|null} */
    through(state: CloseObservation, through: number): string | null;
}
/**
 * @param {unknown} value
 * @returns {boolean}
 */
export declare function needsCloseObservations(value: unknown): boolean;
