export type Observation = {
    id: string;
    form: string;
    receivers: string[];
    check?: string;
    proof: string;
};
/** @type {Map<string, Observation>} */
export declare const OBSERVATIONS: Map<string, Observation>;
/**
 * The row of a read with this receiver, or null.
 * @param {string} id
 * @param {string} receiver
 * @returns {Observation | null}
 */
export declare function observationRow(id: string, receiver: string): Observation | null;
